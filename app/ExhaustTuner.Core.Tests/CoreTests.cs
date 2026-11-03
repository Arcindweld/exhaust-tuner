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
    public string? Folder; public string? Opened; public bool? Dark; public int DevTools;
    public string? PickFolder(string title) => Folder;
    public string? PickSaveFile(string title, string suggestedName) => Folder is null ? null : Path.Combine(Folder, suggestedName);
    public void OpenFolder(string path) => Opened = path;
    public void SetTheme(bool dark) => Dark = dark;
    public void OpenDevTools() => DevTools++;
}

public class ProgramMenuTests
{
    // the page carries the program's menu now (the window has no menu bar): these are the requests it sends
    [Fact]
    public async Task Runs_folder_is_made_then_opened()
    {
        var t = Repo.Temp();
        var paths = new AppPaths(t, Path.Combine(t, "data"), Path.Combine(t, "fusion"));
        var ui = new FakeUi();
        var r = await new HostDispatcher(paths, ui).DispatchAsync("openRunsFolder", null, null, CancellationToken.None);
        Assert.True(Directory.Exists(paths.RunsDir));
        Assert.Equal(paths.RunsDir, ui.Opened);
        Assert.Equal(paths.RunsDir, r!["path"]!.GetValue<string>());
    }

    [Fact]
    public async Task Open_folder_only_for_runs_and_folders_the_user_saved_into()
    {
        var t = Repo.Temp();
        var paths = new AppPaths(t, Path.Combine(t, "data"), Path.Combine(t, "fusion"));
        var ui = new FakeUi();
        var d = new HostDispatcher(paths, ui);
        var other = Path.Combine(t, "elsewhere"); Directory.CreateDirectory(other);
        var r = await d.DispatchAsync("openFolder", new JsonObject { ["path"] = other }, null, CancellationToken.None);
        Assert.False(r!["ok"]!.GetValue<bool>());
        Assert.Null(ui.Opened);
        var run = Path.Combine(paths.RunsDir, "x_1"); Directory.CreateDirectory(run);
        r = await d.DispatchAsync("openFolder", new JsonObject { ["path"] = run }, null, CancellationToken.None);
        Assert.True(r!["ok"]!.GetValue<bool>());
        Assert.Equal(Path.GetFullPath(run), ui.Opened);
        ui.Folder = other;   // the user picks "elsewhere" in the save dialog
        await d.DispatchAsync("saveFiles", JsonNode.Parse("{\"files\":[{\"name\":\"a.txt\",\"text\":\"x\"}]}"), null, CancellationToken.None);
        r = await d.DispatchAsync("openFolder", new JsonObject { ["path"] = other }, null, CancellationToken.None);
        Assert.True(r!["ok"]!.GetValue<bool>());
    }

    [Fact]
    public void Version_comes_from_the_build()
    {
        // builds on a PC are 0.1.0 (app/Directory.Build.props); CI stamps the program, the host and the installer with
        // APP_VERSION = 0.1.<run number>, on the same 0.1 line, so every release is newer than a PC build and than
        // the one before it. The page's menu and the update check use HostDispatcher.Version, read from the assembly.
        var props = File.ReadAllText(Path.Combine(Repo.Root, "app", "Directory.Build.props"));
        var yml = File.ReadAllText(Path.Combine(Repo.Root, ".github", "workflows", "windows.yml"));
        var local = System.Text.RegularExpressions.Regex.Match(props, @"<Version>([0-9.]+)</Version>").Groups[1].Value;
        var line = System.Text.RegularExpressions.Regex.Match(yml, @"APP_VERSION:\s*([0-9]+\.[0-9]+)\.\$\{\{\s*github\.run_number\s*\}\}").Groups[1].Value;
        Assert.Equal("0.1.0", local);
        Assert.Equal("0.1", line);
        Assert.Equal(local, HostDispatcher.Version);
        Assert.Contains("dotnet publish app/ExhaustTuner.HostCli -c Release -r win-x64 --self-contained true -o publish/host -p:Version=${{ env.APP_VERSION }}", yml);
        Assert.Contains("-o publish/desktop -p:Version=${{ env.APP_VERSION }}", yml);
        Assert.Contains("/DAppVersion=${{ env.APP_VERSION }}", yml);
        Assert.DoesNotContain("<Version>", File.ReadAllText(Path.Combine(Repo.Root, "app", "ExhaustTuner.Desktop", "ExhaustTuner.Desktop.csproj")));
    }

    [Fact]
    public async Task Theme_and_devtools_reach_the_window()
    {
        var t = Repo.Temp();
        var ui = new FakeUi();
        var d = new HostDispatcher(new AppPaths(t, Path.Combine(t, "data"), Path.Combine(t, "fusion")), ui);
        await d.DispatchAsync("uiTheme", JsonNode.Parse("{\"dark\":true}"), null, CancellationToken.None);
        Assert.True(ui.Dark);
        await d.DispatchAsync("uiTheme", JsonNode.Parse("{\"dark\":false}"), null, CancellationToken.None);
        Assert.False(ui.Dark);
        await d.DispatchAsync("devTools", null, null, CancellationToken.None);
        Assert.Equal(1, ui.DevTools);
        Assert.EndsWith("licenses", d.Info()["licenses"]!.GetValue<string>());
    }
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
    public void Binary_files_from_base64_are_written_as_they_came()
    {
        var t = Repo.Temp();
        var bytes = new byte[] { 0, 1, 2, 13, 10, 255, 10, 13 };
        var files = CaseFiles.FromJson(JsonNode.Parse("[{\"name\": \"part.stl\", \"base64\": \"" + Convert.ToBase64String(bytes) + "\"}, {\"name\": \"a.txt\", \"text\": \"x\\n\"}]"));
        Assert.Equal(2, files.Count);
        CaseFiles.Write(t, files);
        Assert.Equal(bytes, File.ReadAllBytes(Path.Combine(t, "part.stl")));
        Assert.Equal("x\r\n", File.ReadAllText(Path.Combine(t, "a.txt")));
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
        // the Rust core: copied when the bundle has it, and a stale copy removed when it does not
        var lib = Path.Combine(fusion, "ExhaustTuner", "et_core.dll");
        var bundled = File.Exists(Path.Combine(paths.AddInSourceDir, "et_core.dll"));
        File.WriteAllText(lib, "stale");
        a.Install();
        Assert.Equal(bundled, File.Exists(lib));
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

public class OpenFoamTests
{
    static void Exec(string path, string text)
    {
        File.WriteAllText(path, text);
        File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    }

    /// <summary>Stand-in OpenFOAM programs and a stand-in report script: checks the order of the steps, that the
    /// watchdog gets the solver's process id and can stop it, that stopAt is put back, and the mesh warning.</summary>
    [Fact]
    public async Task Runner_logic_with_stand_in_programs()
    {
        if (OperatingSystem.IsWindows()) return;   // the stand-ins are shell scripts
        var t = Repo.Temp();
        var foam = Path.Combine(t, "foam");
        Directory.CreateDirectory(Path.Combine(foam, "bin"));
        Directory.CreateDirectory(Path.Combine(foam, "etc"));
        foreach (var p in OpenFoamRunner.Programs)
            Exec(Path.Combine(foam, "bin", p), "#!/bin/sh\necho \"$(basename \"$0\") $*\" >> ../steps.txt\necho \"WM_PROJECT_DIR=$WM_PROJECT_DIR\"\n");
        Exec(Path.Combine(foam, "bin", "checkMesh"), "#!/bin/sh\necho checkMesh >> ../steps.txt\necho ' ***High aspect ratio cells found, Max aspect ratio: 1368.87, number of cells 40'\n" +
            "echo ' ***Number of severely non-orthogonal (> 70 degrees) faces: 12.'\necho 'Failed 2 mesh checks.'\n");
        // the solver runs until the watchdog switches stopAt to writeNow (or 400 iterations)
        Exec(Path.Combine(foam, "bin", "simpleFoam"), "#!/bin/sh\necho simpleFoam >> ../steps.txt\ni=0\nwhile [ $i -lt 400 ]; do i=$((i+1)); echo \"Time = $i\"; grep -q writeNow system/controlDict && exit 0; sleep 0.02; done\n");
        var report = "import os, sys, time, json\n" +
                     "if len(sys.argv) > 2 and sys.argv[1] == '--watch':\n" +
                     "    pid = int(sys.argv[2]); time.sleep(0.5); os.kill(pid, 0)\n" +
                     "    s = open('system/controlDict').read().replace('stopAt          endTime;', 'stopAt          writeNow;')\n" +
                     "    open('system/controlDict', 'w').write(s); print('watch: converged at iteration 20 -> stopAt writeNow')\n" +
                     "else:\n" +
                     "    json.dump({'solver': 'simpleFoam', 'summary': {'K': 0.5}}, open('results.json', 'w')); open('results.txt', 'w').write('K 0.5\\n')\n";
        var files = new[]
        {
            new CaseFile("system/controlDict", "application     simpleFoam;\nstopAt          endTime;\nendTime         400;\n"),
            new CaseFile("intake_report.py", report),
        };
        var events = new List<JsonObject>();
        var res = await new OpenFoamRunner(foam, "python3").RunAsync(Path.Combine(t, "run"), files, e => { lock (events) events.Add(e); }, default);
        Assert.True(res["ok"]!.GetValue<bool>(), res.ToJsonString());
        Assert.Equal(new[] { "blockMesh ", "checkMesh", "topoSet ", "simpleFoam" }, File.ReadAllLines(Path.Combine(t, "steps.txt")));
        Assert.Contains("2 failed checks", res["meshWarning"]!.GetValue<string>());
        Assert.Contains("non-orthogonal", res["meshWarning"]!.GetValue<string>());
        var solverStep = res["steps"]!.AsArray().First(s => s!["step"]!.GetValue<string>() == "simpleFoam")!;
        Assert.Equal("convergence", solverStep["stoppedBy"]!.GetValue<string>());
        Assert.True(res["iterations"]!.GetValue<int>() < 400);
        Assert.Contains("stopAt          endTime;", File.ReadAllText(Path.Combine(t, "run", "system", "controlDict")));
        Assert.Equal(0.5, res["results"]!["summary"]!["K"]!.GetValue<double>());
        Assert.Contains(events, e => e["event"]!.GetValue<string>() == "progress");
        Assert.Contains("WM_PROJECT_DIR=" + foam, File.ReadAllText(Path.Combine(t, "run", "log.blockMesh")));

        // only high-aspect-ratio wall cells flagged: an informational note, no warning
        Exec(Path.Combine(foam, "bin", "checkMesh"), "#!/bin/sh\necho ' ***High aspect ratio cells found, Max aspect ratio: 1368.87, number of cells 40'\n" +
            "echo '    Max aspect ratio = 1368.874892 OK.'\necho 'Failed 1 mesh checks.'\n");
        var ar = await new OpenFoamRunner(foam, "python3").RunAsync(Path.Combine(t, "run3"), files, null, default);
        Assert.True(ar["ok"]!.GetValue<bool>());
        Assert.Null(ar["meshWarning"]);
        Assert.Contains("max 1369", ar["meshNote"]!.GetValue<string>());

        // a failing step stops the run and says which one
        Exec(Path.Combine(foam, "bin", "topoSet"), "#!/bin/sh\necho 'FOAM FATAL ERROR: no cellZone'\nexit 1\n");
        var bad = await new OpenFoamRunner(foam, "python3").RunAsync(Path.Combine(t, "run2"), files, null, default);
        Assert.False(bad["ok"]!.GetValue<bool>());
        Assert.StartsWith("topoSet failed", bad["msg"]!.GetValue<string>());
        Assert.Contains("no cellZone", bad["msg"]!.GetValue<string>());
    }

    /// <summary>The real OpenFOAM (EXHAUST_TUNER_OPENFOAM, or the bundled engines/openfoam): a small pipe case the
    /// generator writes, sent the way the page sends it, through the request the page uses.</summary>
    [Fact]
    public async Task Real_openfoam_runs_a_generated_case()
    {
        var paths = new AppPaths(appRoot: Repo.Root, dataRoot: Repo.Temp());
        var runner = new OpenFoamRunner(paths.OpenFoamDir, paths.PythonExe);
        if (!runner.Available)
        {   // CI sets REQUIRE_OPENFOAM=1 where it bundles the Windows build, so a missing OpenFOAM fails there
            Assert.True(Environment.GetEnvironmentVariable("REQUIRE_OPENFOAM") != "1", "OpenFOAM or Python not found (REQUIRE_OPENFOAM=1)");
            return;
        }
        var t = Repo.Temp();
        var design = "{\"name\": \"tube_pressure_ratio\", \"geometry\": {\"tube_diameter_mm\": 60, \"tube_length_mm\": 300, \"inlet\": {\"type\": \"plain\"}, " +
                     "\"mount\": {\"type\": \"free\"}, \"maf_plane_mm\": 200}, \"operating_point\": {\"pressure_ratio\": 1.01}, " +
                     "\"ambient\": {\"p_pa\": 101325, \"T_c\": 20}, \"mesh\": {\"level\": \"coarse\"}, " +
                     "\"solver\": {\"force\": \"incompressible\", \"max_iterations\": 300, \"write_interval\": 100}}";
        File.WriteAllText(Path.Combine(t, "design.json"), design);
        var psi = new ProcessStartInfo(paths.PythonExe) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var a in new[] { Path.Combine(Repo.Root, "cfd", "intake_cfd.py"), Path.Combine(t, "design.json"), Path.Combine(t, "gen") }) psi.ArgumentList.Add(a);
        using (var p = Process.Start(psi)!) { var o = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd(); p.WaitForExit(); Assert.True(p.ExitCode == 0, o); }
        var gen = Path.Combine(t, "gen");
        var files = new JsonArray(Directory.GetFiles(gen, "*", SearchOption.AllDirectories)
            .Select(f => (JsonNode)new JsonObject { ["name"] = Path.GetRelativePath(gen, f).Replace('\\', '/'), ["text"] = File.ReadAllText(f) }).ToArray());
        var d = new HostDispatcher(paths, new FakeUi());
        Assert.True(d.Info()["engines"]!["openfoam"]!.GetValue<bool>());
        var res = (JsonObject)(await d.DispatchAsync("runOpenFOAM", new JsonObject { ["name"] = "pipe", ["files"] = files }, null, default))!;
        Assert.True(res["ok"]!.GetValue<bool>(), res.ToJsonString());
        Assert.Equal("simpleFoam", res["solver"]!.GetValue<string>());
        Assert.Equal(300, res["iterations"]!.GetValue<int>());
        var s = res["results"]!["summary"]!;
        var k = s["K"]!.GetValue<double>(); var cd = s["Cd"]!.GetValue<double>();
        Assert.True(k is > 0.1 and < 2.0 && cd is > 0.4 and < 1.0, $"K {k}, Cd {cd}");
        Assert.Contains("tract_end", res["resultsText"]!.GetValue<string>());
    }
}
