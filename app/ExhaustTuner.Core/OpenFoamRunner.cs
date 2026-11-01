using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ExhaustTuner.Core;

/// <summary>
/// Runs an OpenFOAM case the page wrote (cfd/intake_cfd.js: system/, constant/, 0/, intake_report.py, case_info.json)
/// the way the case's own Allrun does, without bash: blockMesh [surfaceFeatureExtract, snappyHexMesh -overwrite],
/// checkMesh, topoSet, then the solver named in system/controlDict while "intake_report.py --watch PID" watches the
/// monitors and asks for a clean stop once they have settled, then intake_report.py for results.json.
/// A 3-D design arrives as design.json + intake_cfd.py (the browser does not write snappyHexMesh cases); the case is
/// generated here first, with the same generator.
/// Serial runs only: the packaged OpenFOAM is built without MPI.
/// </summary>
public sealed class OpenFoamRunner
{
    /// <summary>The programs the packaged build has (tools/openfoam/build_mingw.sh).</summary>
    public static readonly string[] Programs =
        { "blockMesh", "snappyHexMesh", "surfaceFeatureExtract", "checkMesh", "topoSet", "foamDictionary", "simpleFoam", "rhoSimpleFoam" };

    readonly string _foamDir, _python;

    /// <param name="foamDir">OpenFOAM folder: bin\ with the programs and DLLs, etc\ (WM_PROJECT_DIR).</param>
    /// <param name="python">Python for intake_report.py and intake_cfd.py (standard library only).</param>
    public OpenFoamRunner(string foamDir, string python) { _foamDir = foamDir; _python = python; }

    public string Exe(string app) => Path.Combine(_foamDir, "bin", OperatingSystem.IsWindows() ? app + ".exe" : app);
    public bool FoamAvailable => Programs.All(p => File.Exists(Exe(p))) && Directory.Exists(Path.Combine(_foamDir, "etc"));
    public bool PythonAvailable => File.Exists(_python) || (!_python.Contains(Path.DirectorySeparatorChar) && OnPath(_python));
    public bool Available => FoamAvailable && PythonAvailable;

    static bool OnPath(string exe) =>
        (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)
            .Any(d => d.Length > 0 && (File.Exists(Path.Combine(d, exe)) || File.Exists(Path.Combine(d, exe + ".exe"))));

    public async Task<JsonObject> RunAsync(string runDir, IReadOnlyList<CaseFile> files, Action<JsonObject>? progress, CancellationToken ct)
    {
        if (!FoamAvailable) throw new FileNotFoundException("OpenFOAM is not installed where the program expects it: " + _foamDir);
        if (!PythonAvailable) throw new FileNotFoundException("Python (for the case report) is not installed where the program expects it: " + _python);
        CaseFiles.Write(runDir, files);
        var steps = new JsonArray();
        var caseDir = runDir;
        if (!File.Exists(Path.Combine(runDir, "system", "controlDict")))
        {
            if (!File.Exists(Path.Combine(runDir, "design.json")) || !File.Exists(Path.Combine(runDir, "intake_cfd.py")))
                throw new InvalidOperationException("Neither an OpenFOAM case (system/controlDict) nor a design to generate one from (design.json + intake_cfd.py).");
            caseDir = Path.Combine(runDir, "case");
            var g = await StepAsync("generate", _python, new[] { "intake_cfd.py", "design.json", "case" }, runDir, progress, ct);
            steps.Add(g.Json);
            if (g.ExitCode != 0) return Failed(runDir, caseDir, steps, "intake_cfd.py could not write the case: " + g.Tail);
        }
        var controlDict = Path.Combine(caseDir, "system", "controlDict");
        var cd = File.ReadAllText(controlDict);
        var solver = Regex.Match(cd, @"^application\s+(\w+)\s*;", RegexOptions.Multiline).Groups[1].Value;
        if (solver is not ("simpleFoam" or "rhoSimpleFoam"))
            throw new InvalidOperationException("The case asks for '" + solver + "'; the packaged OpenFOAM has simpleFoam and rhoSimpleFoam.");
        var endTime = int.TryParse(Regex.Match(cd, @"^endTime\s+(\d+)\s*;", RegexOptions.Multiline).Groups[1].Value, out var et) ? et : 0;

        var mesh = new List<(string app, string[] args)> { ("blockMesh", Array.Empty<string>()) };
        if (File.Exists(Path.Combine(caseDir, "system", "snappyHexMeshDict")))
        {
            mesh.Add(("surfaceFeatureExtract", Array.Empty<string>()));
            mesh.Add(("snappyHexMesh", new[] { "-overwrite" }));
        }
        foreach (var (app, args) in mesh)
        {
            var s = await StepAsync(app, Exe(app), args, caseDir, progress, ct);
            steps.Add(s.Json);
            if (s.ExitCode != 0) return Failed(runDir, caseDir, steps, app + " failed: " + s.Tail);
        }
        var check = await StepAsync("checkMesh", Exe("checkMesh"), Array.Empty<string>(), caseDir, progress, ct);
        steps.Add(check.Json);
        // checkMesh counts cells with an aspect ratio over 1000 as a failed check. The generated meshes grade the wall
        // cells down to y+ of about 1, so long thin wall cells are intended there; only other failed checks
        // (non-orthogonality, skewness, negative volumes ...) are reported as a warning.
        var failedChecks = Regex.Match(check.Log, @"Failed (\d+) mesh checks");
        var flagged = check.Log.Split('\n').Where(l => l.Contains("***")).Select(l => l.Trim()).ToList();
        string? meshWarning = null, meshNote = null;
        if (failedChecks.Success && flagged.Count > 0 && flagged.All(l => l.Contains("aspect ratio", StringComparison.OrdinalIgnoreCase)))
        {
            var max = Regex.Match(check.Log, @"Max aspect ratio\s*[=:]\s*([0-9.eE+]+)");
            meshNote = "checkMesh flags high-aspect-ratio cells" + (max.Success ? " (max " + Math.Round(double.Parse(max.Groups[1].Value, CultureInfo.InvariantCulture)) + ")" : "") +
                       ": the thin wall cells that resolve the boundary layer, as intended";
        }
        else if (failedChecks.Success)
            meshWarning = "checkMesh reports " + failedChecks.Groups[1].Value + " failed checks: " + string.Join("; ", flagged.Take(6));
        var topo = await StepAsync("topoSet", Exe("topoSet"), Array.Empty<string>(), caseDir, progress, ct);
        steps.Add(topo.Json);
        if (topo.ExitCode != 0) return Failed(runDir, caseDir, steps, "topoSet failed: " + topo.Tail);

        // the solver, with the case's own convergence watchdog beside it; the watchdog's lines go to log.watch as they
        // come, so a run that does not stop leaves a record of what the watchdog saw
        Process? watcher = null;
        var watchLog = new StringBuilder();
        using var watchFile = new StreamWriter(Path.Combine(caseDir, "log.watch"), false, new UTF8Encoding(false)) { AutoFlush = true };
        var watchClosed = false;
        void WatchLine(string? line)
        {
            if (line is null) return;
            lock (watchLog) { if (watchClosed) return; watchLog.Append(line).Append('\n'); watchFile.WriteLine(line); }
        }
        StepResult run;
        try
        {
            run = await StepAsync(solver, Exe(solver), Array.Empty<string>(), caseDir, progress, ct, endTime, started: pid =>
            {
                var psi = Psi(_python, new[] { "intake_report.py", "--watch", pid.ToString(CultureInfo.InvariantCulture) }, caseDir);
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                watcher = new Process { StartInfo = psi };
                watcher.OutputDataReceived += (_, e) => WatchLine(e.Data);
                watcher.ErrorDataReceived += (_, e) => WatchLine(e.Data);
                watcher.Start();
                watcher.BeginOutputReadLine();
                watcher.BeginErrorReadLine();
            });
        }
        finally
        {
            if (watcher is { HasExited: false }) { try { watcher.Kill(true); } catch { /* gone */ } }
            watcher?.WaitForExit(5000);
            watcher?.Dispose();
        }
        string watchText;
        lock (watchLog) { watchText = watchLog.ToString(); watchClosed = true; }
        run.Json["stoppedBy"] = watchText.Contains("watch: converged") ? "convergence" : "endTime";
        steps.Add(run.Json);
        // restore stopAt so that a restarted run continues normally (as Allrun does)
        File.WriteAllText(controlDict, File.ReadAllText(controlDict).Replace("stopAt          writeNow;", "stopAt          endTime;"));
        if (run.ExitCode != 0) return Failed(runDir, caseDir, steps, solver + " failed: " + run.Tail);

        // the report reads postProcessing/ and writes results.json in seconds; a report still running after 10 minutes
        // is stopped, so the page hears about it instead of waiting
        var rep = await StepAsync("report", _python, new[] { "intake_report.py" }, caseDir, progress, ct, timeout: TimeSpan.FromMinutes(10));
        steps.Add(rep.Json);
        var resultsJson = Path.Combine(caseDir, "results.json");
        var results = File.Exists(resultsJson) ? JsonNode.Parse(File.ReadAllText(resultsJson)) : null;
        var resultsTxt = Path.Combine(caseDir, "results.txt");
        return new JsonObject
        {
            ["ok"] = rep.ExitCode == 0 && results is not null,
            ["folder"] = runDir, ["case"] = caseDir, ["solver"] = solver, ["iterations"] = run.LastIteration,
            ["endTime"] = endTime, ["meshWarning"] = meshWarning, ["meshNote"] = meshNote,
            ["results"] = results, ["resultsText"] = File.Exists(resultsTxt) ? File.ReadAllText(resultsTxt) : null,
            ["steps"] = steps,
            ["msg"] = rep.ExitCode == 0 ? null : "intake_report.py failed: " + rep.Tail,
        };
    }

    static JsonObject Failed(string runDir, string caseDir, JsonArray steps, string msg) =>
        new() { ["ok"] = false, ["folder"] = runDir, ["case"] = caseDir, ["steps"] = steps, ["msg"] = msg };

    ProcessStartInfo Psi(string exe, IEnumerable<string> args, string dir)
    {
        var psi = new ProcessStartInfo(exe) { WorkingDirectory = dir, UseShellExecute = false, CreateNoWindow = true };
        foreach (var a in args) psi.ArgumentList.Add(a);
        // what OpenFOAM's etc/bashrc would set that the programs read: etc/ files come from WM_PROJECT_DIR
        psi.Environment["WM_PROJECT"] = "OpenFOAM";
        psi.Environment["WM_PROJECT_VERSION"] = "v2412";
        psi.Environment["WM_PROJECT_DIR"] = _foamDir;
        psi.Environment["PATH"] = Path.Combine(_foamDir, "bin") + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH");
        psi.Environment["PYTHONIOENCODING"] = "utf-8";
        return psi;
    }

    sealed record StepResult(int ExitCode, string Log, string Tail, int LastIteration, JsonObject Json);

    // Runs one program in the case folder. Its output goes to log.<name> as it comes (the solver's log can be watched,
    // and a step that hangs leaves its log behind); with a timeout the process tree is stopped once it is exceeded and
    // the step returns exit code -1.
    async Task<StepResult> StepAsync(string name, string exe, string[] args, string dir, Action<JsonObject>? progress,
        CancellationToken ct, int endTime = 0, Action<int>? started = null, TimeSpan? timeout = null)
    {
        progress?.Invoke(new JsonObject { ["event"] = "step", ["step"] = name });
        var psi = Psi(exe, args, dir);
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        var log = new StringBuilder();
        using var logFile = new StreamWriter(Path.Combine(dir, "log." + name), false, new UTF8Encoding(false));
        var lastFlush = DateTime.UtcNow;
        var closed = false;   // late output events after the step returns are dropped, not written to a closed file
        var iteration = 0;
        var lastReport = DateTime.MinValue;
        var sw = Stopwatch.StartNew();
        using var p = new Process { StartInfo = psi };
        void Line(string? s)
        {
            if (s is null) return;
            lock (log)
            {
                if (closed) return;
                log.Append(s).Append('\n');
                logFile.WriteLine(s);
                if ((DateTime.UtcNow - lastFlush).TotalSeconds >= 1) { logFile.Flush(); lastFlush = DateTime.UtcNow; }
            }
            if (s.StartsWith("Time = ", StringComparison.Ordinal) && int.TryParse(s.AsSpan(7).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var it))
            {
                iteration = it;
                if ((DateTime.UtcNow - lastReport).TotalSeconds >= 2)
                {
                    lastReport = DateTime.UtcNow;
                    progress?.Invoke(new JsonObject { ["event"] = "progress", ["step"] = name, ["iteration"] = it, ["of"] = endTime,
                        ["seconds"] = Math.Round(sw.Elapsed.TotalSeconds) });
                }
            }
        }
        p.OutputDataReceived += (_, e) => Line(e.Data);
        p.ErrorDataReceived += (_, e) => Line(e.Data);
        p.Start();
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        started?.Invoke(p.Id);
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct);
        if (timeout is { } t) limit.CancelAfter(t);
        var timedOut = false;
        try { await p.WaitForExitAsync(limit.Token); }
        catch (OperationCanceledException)
        {
            try { p.Kill(entireProcessTree: true); } catch { /* already gone */ }
            if (ct.IsCancellationRequested) throw;
            timedOut = true;
        }
        // with the process gone, its output pipes close; do not wait forever on a handle a stray child might hold
        p.WaitForExit(30000);
        sw.Stop();
        var exitCode = timedOut ? -1 : p.ExitCode;
        string text;
        lock (log)
        {
            if (timedOut) { var m = name + " did not finish within " + timeout!.Value.TotalMinutes + " min and was stopped"; log.Append(m).Append('\n'); logFile.WriteLine(m); }
            text = log.ToString();
            logFile.Flush();
            closed = true;
        }
        var tail = string.Join('\n', text.Split('\n').Where(l => l.Trim().Length > 0).TakeLast(12));
        var json = new JsonObject { ["step"] = name, ["exitCode"] = exitCode, ["seconds"] = Math.Round(sw.Elapsed.TotalSeconds, 1) };
        if (exitCode != 0) json["logTail"] = tail;
        progress?.Invoke(new JsonObject { ["event"] = "stepDone", ["step"] = name, ["exitCode"] = exitCode, ["seconds"] = Math.Round(sw.Elapsed.TotalSeconds, 1) });
        return new StepResult(exitCode, text, tail, iteration, json);
    }
}
