using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;

namespace ExhaustTuner.Core;

/// <summary>One OpenWAM model's outcome.</summary>
public sealed record WamModelResult(string Name, bool Finished, int ExitCode, double Seconds, string Folder,
    string? Avg, string? Ins, string LogTail);

/// <summary>
/// Runs the .wam models the page wrote, the way its run_all.bat does: each model NAME in its own folder NAME,
/// "OpenWAM NAME.wam" with that folder as the working directory, output NAMEAVG.DAT / NAMEINS.DAT / NAME.log.
/// A model counts as finished only when OpenWAM printed "SIMULATION FINISHED CORRECTLY" (exit code 0 alone is not
/// enough: OpenWAM can finish a run whose last cycle is NaN; the page's reader checks for that).
/// </summary>
public sealed class OpenWamRunner
{
    public const string FinishedMarker = "SIMULATION FINISHED CORRECTLY";
    readonly string _exe;

    public OpenWamRunner(string exe) { _exe = exe; }

    public bool Available => File.Exists(_exe);

    /// <param name="parallel">Models run at once; default half the logical processors (OpenWAM is single-threaded).</param>
    public async Task<List<WamModelResult>> RunAsync(string caseDir, IReadOnlyList<CaseFile> files,
        Action<JsonObject>? progress, CancellationToken ct, int parallel = 0)
    {
        if (!Available) throw new FileNotFoundException("OpenWAM is not installed where the program expects it: " + _exe);
        CaseFiles.Write(caseDir, files);
        var models = files.Select(f => CaseFiles.RelativeParts(f.Name))
            .Where(p => p.Length == 1 && p[0].EndsWith(".wam", StringComparison.OrdinalIgnoreCase))
            .Select(p => Path.GetFileNameWithoutExtension(p[0])).Distinct().ToList();
        if (models.Count == 0) throw new InvalidOperationException("The case has no .wam model files.");
        if (parallel <= 0) parallel = Math.Max(1, Environment.ProcessorCount / 2);
        var gate = new SemaphoreSlim(Math.Min(parallel, models.Count));
        var done = 0;
        var tasks = models.Select(async name =>
        {
            await gate.WaitAsync(ct);
            try
            {
                progress?.Invoke(new JsonObject { ["event"] = "start", ["model"] = name, ["of"] = models.Count });
                var r = await RunOneAsync(caseDir, name, progress, ct);
                var n = Interlocked.Increment(ref done);
                progress?.Invoke(new JsonObject { ["event"] = "done", ["model"] = name, ["finished"] = r.Finished,
                    ["seconds"] = Math.Round(r.Seconds, 1), ["count"] = n, ["of"] = models.Count });
                return r;
            }
            finally { gate.Release(); }
        }).ToList();
        var results = await Task.WhenAll(tasks);
        return results.OrderBy(r => models.IndexOf(r.Name)).ToList();
    }

    async Task<WamModelResult> RunOneAsync(string caseDir, string name, Action<JsonObject>? progress, CancellationToken ct)
    {
        var dir = Path.Combine(caseDir, name);
        Directory.CreateDirectory(dir);
        File.Copy(Path.Combine(caseDir, name + ".wam"), Path.Combine(dir, name + ".wam"), overwrite: true);
        var log = new StringBuilder();
        var psi = new ProcessStartInfo(_exe, "\"" + name + ".wam\"")
        {
            WorkingDirectory = dir, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
        };
        var sw = Stopwatch.StartNew();
        using var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
        var lastReport = DateTime.MinValue;
        void Line(string? s)
        {
            if (s is null) return;
            lock (log) log.AppendLine(s);
            if ((DateTime.UtcNow - lastReport).TotalSeconds >= 2 && s.Trim().Length > 0)
            {
                lastReport = DateTime.UtcNow;
                progress?.Invoke(new JsonObject { ["event"] = "output", ["model"] = name, ["line"] = s.Trim() });
            }
        }
        p.OutputDataReceived += (_, e) => Line(e.Data);
        p.ErrorDataReceived += (_, e) => Line(e.Data);
        p.Start();
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        try { await p.WaitForExitAsync(ct); }
        catch (OperationCanceledException)
        {
            try { p.Kill(entireProcessTree: true); } catch { /* already gone */ }
            throw;
        }
        p.WaitForExit();   // drains the redirected streams
        sw.Stop();
        string text;
        lock (log) text = log.ToString();
        File.WriteAllText(Path.Combine(dir, name + ".log"), text);
        string? Read(string suffix)
        {
            var f = Path.Combine(dir, name + suffix);
            return File.Exists(f) ? File.ReadAllText(f) : null;
        }
        var tail = string.Join('\n', text.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Trim().Length > 0).TakeLast(8));
        return new WamModelResult(name, text.Contains(FinishedMarker), p.ExitCode, sw.Elapsed.TotalSeconds, dir,
            Read("AVG.DAT"), Read("INS.DAT"), tail);
    }

    public static JsonObject ToJson(string caseDir, IEnumerable<WamModelResult> results) => new()
    {
        ["folder"] = caseDir,
        ["models"] = new JsonArray(results.Select(r => (JsonNode)new JsonObject
        {
            ["name"] = r.Name, ["finished"] = r.Finished, ["exitCode"] = r.ExitCode, ["seconds"] = Math.Round(r.Seconds, 1),
            ["folder"] = r.Folder, ["avg"] = r.Avg, ["ins"] = r.Ins, ["logTail"] = r.LogTail,
        }).ToArray()),
    };
}
