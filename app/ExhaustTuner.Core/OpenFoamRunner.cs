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

        // the solver, with the case's own convergence watchdog beside it
        Process? watcher = null;
        var watchLog = new StringBuilder();
        StepResult run;
        try
        {
            run = await StepAsync(solver, Exe(solver), Array.Empty<string>(), caseDir, progress, ct, endTime, started: pid =>
            {
                var psi = Psi(_python, new[] { "intake_report.py", "--watch", pid.ToString(CultureInfo.InvariantCulture) }, caseDir);
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                watcher = new Process { StartInfo = psi };
                watcher.OutputDataReceived += (_, e) => { if (e.Data is not null) lock (watchLog) watchLog.Append(e.Data).Append('\n'); };
                watcher.ErrorDataReceived += (_, e) => { if (e.Data is not null) lock (watchLog) watchLog.Append(e.Data).Append('\n'); };
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
        lock (watchLog) watchText = watchLog.ToString();
        File.WriteAllText(Path.Combine(caseDir, "log.watch"), watchText);
        run.Json["stoppedBy"] = watchText.Contains("watch: converged") ? "convergence" : "endTime";
        steps.Add(run.Json);
        // restore stopAt so that a restarted run continues normally (as Allrun does)
        File.WriteAllText(controlDict, File.ReadAllText(controlDict).Replace("stopAt          writeNow;", "stopAt          endTime;"));
        if (run.ExitCode != 0) return Failed(runDir, caseDir, steps, solver + " failed: " + run.Tail);

        var rep = await StepAsync("report", _python, new[] { "intake_report.py" }, caseDir, progress, ct);
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

    async Task<StepResult> StepAsync(string name, string exe, string[] args, string dir, Action<JsonObject>? progress,
        CancellationToken ct, int endTime = 0, Action<int>? started = null)
    {
        progress?.Invoke(new JsonObject { ["event"] = "step", ["step"] = name });
        var psi = Psi(exe, args, dir);
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        var log = new StringBuilder();
        var iteration = 0;
        var lastReport = DateTime.MinValue;
        var sw = Stopwatch.StartNew();
        using var p = new Process { StartInfo = psi };
        void Line(string? s)
        {
            if (s is null) return;
            lock (log) log.Append(s).Append('\n');
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
        try { await p.WaitForExitAsync(ct); }
        catch (OperationCanceledException)
        {
            try { p.Kill(entireProcessTree: true); } catch { /* already gone */ }
            throw;
        }
        p.WaitForExit();
        sw.Stop();
        string text;
        lock (log) text = log.ToString();
        File.WriteAllText(Path.Combine(dir, "log." + name), text);
        var tail = string.Join('\n', text.Split('\n').Where(l => l.Trim().Length > 0).TakeLast(12));
        var json = new JsonObject { ["step"] = name, ["exitCode"] = p.ExitCode, ["seconds"] = Math.Round(sw.Elapsed.TotalSeconds, 1) };
        if (p.ExitCode != 0) json["logTail"] = tail;
        progress?.Invoke(new JsonObject { ["event"] = "stepDone", ["step"] = name, ["exitCode"] = p.ExitCode, ["seconds"] = Math.Round(sw.Elapsed.TotalSeconds, 1) });
        return new StepResult(p.ExitCode, text, tail, iteration, json);
    }
}
