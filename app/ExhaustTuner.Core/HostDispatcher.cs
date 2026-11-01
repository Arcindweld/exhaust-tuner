using System.Text.Json.Nodes;

namespace ExhaustTuner.Core;

/// <summary>What the dispatcher needs from the window (dialogs, opening folders). The desktop app implements it with WPF.</summary>
public interface IHostUi
{
    /// <summary>Asks for a folder; null when the user cancels.</summary>
    string? PickFolder(string title);
    /// <summary>Asks where to save one file; null when the user cancels.</summary>
    string? PickSaveFile(string title, string suggestedName);
    void OpenFolder(string path);
    /// <summary>The page's colour theme, so the window frame can match it. Optional: does nothing by default.</summary>
    void SetTheme(bool dark) { }
    /// <summary>Opens the browser developer tools. Optional: does nothing by default.</summary>
    void OpenDevTools() { }
}

/// <summary>
/// Handles the page's requests: {id, action, data} in, a JSON result out (and progress events while it runs).
/// Kept free of WPF/WebView2 so the tests run it directly on any OS.
/// </summary>
public sealed class HostDispatcher
{
    public const string Version = "0.1.0";
    readonly AppPaths _paths;
    readonly IHostUi _ui;
    // folders the user picked when saving: "openFolder" opens these and anything under the runs folder, nothing else
    readonly HashSet<string> _chosen = new(StringComparer.OrdinalIgnoreCase);

    static bool IsUnder(string path, string root)
    {
        var r = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return path.Equals(r, StringComparison.OrdinalIgnoreCase) || path.StartsWith(r + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }

    public HostDispatcher(AppPaths paths, IHostUi ui) { _paths = paths; _ui = ui; }

    public JsonObject Info()
    {
        var wam = new OpenWamRunner(_paths.OpenWamExe);
        return new JsonObject
        {
            ["app"] = "Exhaust Tuner", ["version"] = Version,
            ["engines"] = new JsonObject
            {
                ["openwam"] = wam.Available,
                ["openfoam"] = new OpenFoamRunner(_paths.OpenFoamDir, _paths.PythonExe).Available,
                ["enginesim"] = new EngineSimRunner(_paths.EngineSimDir).Available,
            },
            ["runsFolder"] = _paths.RunsDir,
            ["licenses"] = Path.Combine(_paths.AppRoot, "licenses"),
            ["fusionAddIn"] = new FusionAddIn(_paths).Status(),
        };
    }

    public async Task<JsonNode?> DispatchAsync(string action, JsonNode? data, Action<JsonObject>? onEvent, CancellationToken ct)
    {
        switch (action)
        {
            case "hostInfo":
                return Info();

            case "runOpenWAM":
            {
                var files = CaseFiles.FromJson(data?["files"]);
                var name = data?["name"]?.GetValue<string>() ?? "openwam";
                var dir = _paths.NewRunDir(name);
                onEvent?.Invoke(new JsonObject { ["event"] = "folder", ["folder"] = dir });
                var results = await new OpenWamRunner(_paths.OpenWamExe).RunAsync(dir, files, onEvent, ct);
                return OpenWamRunner.ToJson(dir, results);
            }

            case "runOpenFOAM":
            {
                var files = CaseFiles.FromJson(data?["files"]);
                if (files.Count == 0) throw new ArgumentException("No case files.");
                var name = data?["name"]?.GetValue<string>() ?? "openfoam";
                var dir = _paths.NewRunDir(name);
                onEvent?.Invoke(new JsonObject { ["event"] = "folder", ["folder"] = dir });
                return await new OpenFoamRunner(_paths.OpenFoamDir, _paths.PythonExe).RunAsync(dir, files, onEvent, ct);
            }

            case "runEngineSim":
            {
                var text = data?["text"]?.GetValue<string>() ?? throw new ArgumentException("No engine file.");
                var fname = data?["filename"]?.GetValue<string>() ?? "engine.mr";
                var rpms = (data?["rpms"] as JsonArray)?.Select(n => n!.GetValue<double>()).Where(r => r > 0).ToList() ?? new List<double>();
                var secs = data?["seconds"]?.GetValue<double>() ?? 6.0;
                var gain = data?["gain"]?.GetValue<double>() ?? 0.35;
                var dir = _paths.NewRunDir(Path.GetFileNameWithoutExtension(fname));
                return await new EngineSimRunner(_paths.EngineSimDir).RunAsync(dir, fname, text, rpms, secs, gain, onEvent, ct);
            }

            case "saveFiles":
            {
                var files = CaseFiles.FromJson(data?["files"]);
                if (files.Count == 0) return new JsonObject { ["ok"] = false, ["msg"] = "Nothing to save." };
                var folder = _ui.PickFolder(data?["title"]?.GetValue<string>() ?? "Choose a folder");
                if (folder is null) return new JsonObject { ["ok"] = false, ["msg"] = "Not saved." };
                var sub = data?["folder"]?.GetValue<string>();
                if (!string.IsNullOrEmpty(sub)) folder = Path.Combine(folder, CaseFiles.SafeName(sub));
                var written = CaseFiles.Write(folder, files);
                _chosen.Add(Path.GetFullPath(folder));
                return new JsonObject
                {
                    ["ok"] = true, ["path"] = folder, ["files"] = new JsonArray(written.Select(w => (JsonNode)w).ToArray()),
                    ["msg"] = "Saved " + written.Count + " files in " + folder + ".",
                };
            }

            case "saveText":
            {
                var name = CaseFiles.SafeName(data?["filename"]?.GetValue<string>() ?? "file.txt");
                var text = data?["text"]?.GetValue<string>();
                if (text is null) return new JsonObject { ["ok"] = false, ["msg"] = "Nothing to save." };
                var path = _ui.PickSaveFile(data?["title"]?.GetValue<string>() ?? "Save", name);
                if (path is null) return new JsonObject { ["ok"] = false, ["msg"] = "Not saved." };
                File.WriteAllText(path, text, new System.Text.UTF8Encoding(false));
                if (Path.GetDirectoryName(Path.GetFullPath(path)) is { } saved) _chosen.Add(saved);
                return new JsonObject { ["ok"] = true, ["path"] = path, ["msg"] = "Saved " + path + "." };
            }

            case "openFolder":
            {
                var p = data?["path"]?.GetValue<string>();
                if (string.IsNullOrEmpty(p) || !Directory.Exists(p)) return new JsonObject { ["ok"] = false, ["msg"] = "No such folder." };
                // only folders the program made (under the runs folder) or the user chose when saving are opened
                var full = Path.GetFullPath(p);
                if (!IsUnder(full, _paths.RunsDir) && !_chosen.Contains(full))
                    return new JsonObject { ["ok"] = false, ["msg"] = "The page can open the runs folder and folders you saved into, not other folders." };
                _ui.OpenFolder(full);
                return new JsonObject { ["ok"] = true, ["path"] = full };
            }

            case "openRunsFolder":
                // the program's menu lives in the page: the runs folder is made on first use, then opened
                Directory.CreateDirectory(_paths.RunsDir);
                _ui.OpenFolder(_paths.RunsDir);
                return new JsonObject { ["ok"] = true, ["path"] = _paths.RunsDir };

            case "uiTheme":
                _ui.SetTheme(data?["dark"]?.GetValue<bool>() ?? false);
                return new JsonObject { ["ok"] = true };

            case "devTools":
                _ui.OpenDevTools();
                return new JsonObject { ["ok"] = true };

            case "fusionAddInStatus":
                return new FusionAddIn(_paths).Status();

            case "installFusionAddIn":
                return new FusionAddIn(_paths).Install();

            default:
                throw new InvalidOperationException("Unknown request: " + action);
        }
    }
}
