using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using ExhaustTuner.Core;
using Xunit;

namespace ExhaustTuner.Core.Tests;

static class Repo
{
    /// <summary>The repository root (the folder holding web/ and app/), found from the test assembly's location.</summary>
    public static string Root
    {
        get
        {
            var d = new DirectoryInfo(AppContext.BaseDirectory);
            while (d != null && !(Directory.Exists(Path.Combine(d.FullName, "web")) && Directory.Exists(Path.Combine(d.FullName, "app")))) d = d.Parent;
            return d?.FullName ?? throw new InvalidOperationException("repository root not found");
        }
    }
    public static string Fixture(string name) => Path.Combine(Root, "app", "ExhaustTuner.Core.Tests", "fixtures", name);
    public static string Temp() { var t = Path.Combine(Path.GetTempPath(), "et-test-" + Guid.NewGuid().ToString("N")[..8]); Directory.CreateDirectory(t); return t; }
}

sealed class FakeUi : IHostUi
{
    public string? Folder; public string? Opened;
    public string? PickFolder(string title) => Folder;
    public string? PickSaveFile(string title, string suggestedName) => Folder is null ? null : Path.Combine(Folder, suggestedName);
    public void OpenFolder(string path) => Opened = path;
}

public class CaseFilesTests
{
    [Fact]
    public void Writes_subfolders_and_line_ends()
    {
        var t = Repo.Temp();
        var w = CaseFiles.Write(t, new[]
        {
            new CaseFile("a.wam", "x\ny\n"), new CaseFile("case/system/controlDict", "p\nq\n"), new CaseFile("run_all.bat", "@echo off\nexit\n"),
        });
        Assert.Equal(new[] { "a.wam", "case/system/controlDict", "run_all.bat" }, w);
        Assert.Equal("x\r\ny\r\n", File.ReadAllText(Path.Combine(t, "a.wam")));
        Assert.Equal("p\nq\n", File.ReadAllText(Path.Combine(t, "case", "system", "controlDict")));
        Assert.Equal("@echo off\r\nexit\r\n", File.ReadAllText(Path.Combine(t, "run_all.bat")));
    }

    [Fact]
    public void Cannot_leave_the_folder()
    {
        var t = Repo.Temp();
        var w = CaseFiles.Write(Path.Combine(t, "inner"), new[] { new CaseFile("../../escape.txt", "no"), new CaseFile("/abs/x.txt", "ok") });
        Assert.False(File.Exists(Path.Combine(t, "escape.txt")));
        Assert.True(File.Exists(Path.Combine(t, "inner", "escape.txt")));   // ".." parts dropped, file stays inside
        Assert.True(File.Exists(Path.Combine(t, "inner", "abs", "x.txt")));
        Assert.Equal(2, w.Count);
    }
}

public class PaletteTests
{
    [Fact]
    public void Matches_make_palette_py()
    {
        var page = Path.Combine(Repo.Root, "web", "index.html");
        var ours = PaletteBuilder.Build(File.ReadAllText(page));
        var t = Repo.Temp();
        var outFile = Path.Combine(t, "palette.html");
        var py = OperatingSystem.IsWindows() ? "python" : "python3";
        var psi = new ProcessStartInfo(py, $"\"{Path.Combine(Repo.Root, "web", "make_palette.py")}\" \"{page}\" \"{outFile}\"") { UseShellExecute = false, RedirectStandardOutput = true };
        Process? p;
        try { p = Process.Start(psi); }
        catch { Assert.True(Environment.GetEnvironmentVariable("REQUIRE_ALL") != "1", "Python is required (REQUIRE_ALL=1)"); return; }   // no Python here: nothing to compare against
        p!.WaitForExit();
        Assert.Equal(0, p.ExitCode);
        // Python on Windows writes CRLF in text mode; the content is what has to agree
        Assert.Equal(File.ReadAllText(outFile).Replace("\r\n", "\n"), ours.Replace("\r\n", "\n"));
    }
}

public class FusionAddInTests
{
    [Fact]
    public void Installs_files_and_palette_and_reports_versions()
    {
        var fusion = Repo.Temp();
        var paths = new AppPaths(appRoot: Repo.Root, dataRoot: Repo.Temp(), fusionAddInsRoot: fusion);
        var a = new FusionAddIn(paths);
        Assert.Null(a.Status()["installed"]?.GetValue<string>());
        var r = a.Install();
        Assert.True(r["ok"]!.GetValue<bool>());
        foreach (var f in FusionAddIn.Files) Assert.True(File.Exists(Path.Combine(fusion, "ExhaustTuner", f)), f);
        var pal = File.ReadAllText(Path.Combine(fusion, "ExhaustTuner", "palette.html"));
        Assert.StartsWith("<!doctype html>", pal);
        Assert.Equal(a.Status()["bundled"]!.GetValue<string>(), a.Status()["installed"]!.GetValue<string>());
        // a file of the user's in the add-in folder survives an update
        File.WriteAllText(Path.Combine(fusion, "ExhaustTuner", "my_notes.txt"), "keep");
        a.Install();
        Assert.Equal("keep", File.ReadAllText(Path.Combine(fusion, "ExhaustTuner", "my_notes.txt")));
    }
}

public class RouterTests
{
    [Fact]
    public async Task HostInfo_round_trip_and_unknown_action()
    {
        var sent = new List<JsonNode>();
        var paths = new AppPaths(appRoot: Repo.Root, dataRoot: Repo.Temp(), fusionAddInsRoot: Repo.Temp());
        var r = new MessageRouter(new HostDispatcher(paths, new FakeUi()), s => sent.Add(JsonNode.Parse(s)!));
        await r.HandleAsync("{\"id\":7,\"action\":\"hostInfo\",\"data\":{}}");
        await r.HandleAsync("{\"id\":8,\"action\":\"nope\",\"data\":{}}");
        Assert.Equal(7, sent[0]["id"]!.GetValue<int>());
        Assert.True(sent[0]["ok"]!.GetValue<bool>());
        Assert.Equal("Exhaust Tuner", sent[0]["result"]!["app"]!.GetValue<string>());
        Assert.False(sent[1]["ok"]!.GetValue<bool>());
        Assert.Contains("Unknown request", sent[1]["error"]!.GetValue<string>());
        Assert.Contains("exhaustTunerHost", MessageRouter.BridgeScript());
    }

    [Fact]
    public async Task SaveFiles_uses_the_picked_folder_and_cancel_is_respected()
    {
        var ui = new FakeUi { Folder = Repo.Temp() };
        var paths = new AppPaths(appRoot: Repo.Root, dataRoot: Repo.Temp(), fusionAddInsRoot: Repo.Temp());
        var d = new HostDispatcher(paths, ui);
        var res = await d.DispatchAsync("saveFiles", JsonNode.Parse("{\"files\":[{\"name\":\"x/a.txt\",\"text\":\"1\"}],\"folder\":\"case\"}"), null, default);
        Assert.True(res!["ok"]!.GetValue<bool>());
        Assert.True(File.Exists(Path.Combine(ui.Folder, "case", "x", "a.txt")));
        ui.Folder = null;
        res = await d.DispatchAsync("saveFiles", JsonNode.Parse("{\"files\":[{\"name\":\"a.txt\",\"text\":\"1\"}]}"), null, default);
        Assert.Equal("Not saved.", res!["msg"]!.GetValue<string>());
    }
}

public class OpenWamTests
{
    /// <summary>The real solver, when one is available: EXHAUST_TUNER_OPENWAM, or the bundled engines/openwam.</summary>
    static string? Solver()
    {
        var p = new AppPaths(appRoot: Repo.Root).OpenWamExe;
        return File.Exists(p) ? p : null;
    }

    [Fact]
    public async Task Runner_logic_with_a_stand_in_solver()
    {
        if (OperatingSystem.IsWindows()) return;   // the stand-in is a shell script
        var t = Repo.Temp();
        var fake = Path.Combine(t, "fakewam.sh");
        File.WriteAllText(fake, "#!/bin/sh\nn=$(basename \"$1\" .wam)\nif [ \"$n\" = bad ]; then echo crashed; exit 3; fi\nprintf 'Cycle(-)\\n1\\n' > \"${n}AVG.DAT\"\necho 'INFO: *** CMT : SIMULATION FINISHED CORRECTLY ***'\n");
        File.SetUnixFileMode(fake, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        var events = new List<JsonObject>();
        var res = await new OpenWamRunner(fake).RunAsync(Path.Combine(t, "case"),
            new[] { new CaseFile("good_3000.wam", "x"), new CaseFile("bad.wam", "x"), new CaseFile("README.txt", "r") },
            e => { lock (events) events.Add(e); }, default, parallel: 2);
        Assert.Equal(new[] { "good_3000", "bad" }, res.Select(r => r.Name));
        Assert.True(res[0].Finished); Assert.NotNull(res[0].Avg);
        Assert.False(res[1].Finished); Assert.Equal(3, res[1].ExitCode); Assert.Null(res[1].Avg);
        Assert.Contains("crashed", res[1].LogTail);
        Assert.Equal(2, events.Count(e => e["event"]!.GetValue<string>() == "done"));
    }

    [Fact]
    public async Task Real_solver_reproduces_the_reference_run()
    {
        var exe = Solver();
        if (exe is null)
        {   // CI builds OpenWAM and sets EXHAUST_TUNER_OPENWAM and REQUIRE_ALL=1, so a missing solver fails there
            Assert.True(Environment.GetEnvironmentVariable("REQUIRE_ALL") != "1", "OpenWAM solver not found (REQUIRE_ALL=1)");
            return;
        }
        var t = Repo.Temp();
        var res = await new OpenWamRunner(exe).RunAsync(t, new[] { new CaseFile("single450.wam", File.ReadAllText(Repo.Fixture("single450.wam"))) }, null, default);
        Assert.True(res[0].Finished, res[0].LogTail);
        // last cycle's net torque and volumetric efficiency against the reference (Linux build of the same source);
        // a different compiler may move the last digits, not the physics
        double Col(string avg, string name)
        {
            var lines = avg.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Length > 0).ToArray();
            var head = lines[0].Split('\t');
            var i = Array.IndexOf(head, name);
            Assert.True(i >= 0, name + " column missing");
            return double.Parse(lines[^1].Split('\t')[i], CultureInfo.InvariantCulture);
        }
        var refAvg = File.ReadAllText(Repo.Fixture("single450AVG.DAT"));
        foreach (var c in new[] { "Net_Torque(Nm)", "Volumetric_Efficiency(-)", "NMEP(bar)" })
        {
            double a = Col(res[0].Avg!, c), b = Col(refAvg, c);
            Assert.True(Math.Abs(a - b) <= 0.005 * Math.Abs(b) + 1e-9, $"{c}: {a} vs reference {b}");
        }
    }
}
