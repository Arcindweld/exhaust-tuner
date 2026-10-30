using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;

namespace ExhaustTuner.Core;

/// <summary>
/// Plays a design through Engine Simulator (Arcindweld fork, 1-D exhaust) without its window: engine-sim-headless
/// compiles the .mr file the page wrote, holds the engine at a speed and writes the sound to a WAV.
/// The fork's sound is qualitative (it has never been checked against a microphone); the page says so next to it.
/// </summary>
public sealed class EngineSimRunner
{
    readonly string _dir;   // the packaged fork: bin\engine-sim-headless.exe and es\
    public EngineSimRunner(string dir) { _dir = dir; }

    public string Exe => Path.Combine(_dir, "bin", OperatingSystem.IsWindows() ? "engine-sim-headless.exe" : "engine-sim-headless");
    public bool Available => File.Exists(Exe) && Directory.Exists(Path.Combine(_dir, "es"));

    /// <summary>Runs one engine file at each requested speed. Returns one entry per speed (WAV path, run JSON, log tail).</summary>
    public async Task<JsonObject> RunAsync(string runDir, string fileName, string text, IReadOnlyList<double> rpms,
        double seconds, double gain, Action<JsonObject>? progress, CancellationToken ct)
    {
        if (!Available) throw new FileNotFoundException("Engine Simulator (headless) is not installed with this program: " + Exe);
        if (rpms.Count == 0) throw new ArgumentException("Give at least one engine speed.");
        Directory.CreateDirectory(runDir);
        var mr = Path.Combine(runDir, CaseFiles.SafeName(fileName.EndsWith(".mr", StringComparison.OrdinalIgnoreCase) ? fileName : fileName + ".mr"));
        File.WriteAllText(mr, text);
        // The page's file defines "public node main" like the shipped engines; Engine Simulator's assets/main.mr
        // imports an engine and calls main(). This wrapper does the same for the headless runner.
        var wrapper = Path.Combine(runDir, Path.GetFileNameWithoutExtension(mr) + ".main.mr");
        File.WriteAllText(wrapper, "import \"engine_sim.mr\"\nimport \"" + Path.GetFileName(mr) + "\"\nmain()\n");
        var outs = new JsonArray();
        foreach (var rpm in rpms)
        {
            ct.ThrowIfCancellationRequested();
            var tag = Math.Round(rpm).ToString(CultureInfo.InvariantCulture);
            var wav = Path.Combine(runDir, "hold_" + tag + ".wav");
            var json = Path.Combine(runDir, "hold_" + tag + ".json");
            var args = new[] { wrapper, "--hold-rpm", tag, "--sim", seconds.ToString(CultureInfo.InvariantCulture),
                "--settle", "1.5", "--gain", gain.ToString(CultureInfo.InvariantCulture), "--wav", wav, "--json", json };
            progress?.Invoke(new JsonObject { ["event"] = "start", ["rpm"] = rpm });
            var psi = new ProcessStartInfo(Exe) { WorkingDirectory = _dir, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (var a in args) psi.ArgumentList.Add(a);
            using var p = Process.Start(psi)!;
            var so = p.StandardOutput.ReadToEndAsync(ct);
            var se = p.StandardError.ReadToEndAsync(ct);
            try { await p.WaitForExitAsync(ct); }
            catch (OperationCanceledException) { try { p.Kill(true); } catch { } throw; }
            var log = (await so) + (await se);
            File.WriteAllText(Path.Combine(runDir, "hold_" + tag + ".log"), log);
            var ok = p.ExitCode == 0 && File.Exists(wav);
            outs.Add(new JsonObject
            {
                ["rpm"] = rpm, ["ok"] = ok, ["exitCode"] = p.ExitCode,
                ["wav"] = ok ? wav : null,
                // the sound itself for the page to play (a 6 s mono 16-bit clip is about 0.5 MB)
                ["wavBase64"] = ok && new FileInfo(wav).Length < 20_000_000 ? Convert.ToBase64String(File.ReadAllBytes(wav)) : null,
                ["run"] = File.Exists(json) ? JsonNode.Parse(File.ReadAllText(json)) : null,
                ["logTail"] = string.Join('\n', log.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Trim().Length > 0).TakeLast(6)),
            });
            progress?.Invoke(new JsonObject { ["event"] = "done", ["rpm"] = rpm, ["ok"] = ok });
        }
        return new JsonObject { ["folder"] = runDir, ["file"] = mr, ["holds"] = outs };
    }
}
