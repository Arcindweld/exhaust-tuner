namespace ExhaustTuner.Core;

/// <summary>Where the program's own files are, where runs go, and where Fusion looks for add-ins.</summary>
public sealed class AppPaths
{
    /// <summary>Folder the program is installed in (holds web/, fusion-addin/, engines/).</summary>
    public string AppRoot { get; }

    /// <summary>Per-user data: %LOCALAPPDATA%\ExhaustTuner (runs, settings).</summary>
    public string DataRoot { get; }

    /// <summary>Fusion's add-in folder: %APPDATA%\Autodesk\Autodesk Fusion 360\API\AddIns.</summary>
    public string FusionAddInsRoot { get; }

    public AppPaths(string? appRoot = null, string? dataRoot = null, string? fusionAddInsRoot = null)
    {
        AppRoot = Path.GetFullPath(appRoot ?? AppContext.BaseDirectory);
        DataRoot = Path.GetFullPath(dataRoot ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ExhaustTuner"));
        FusionAddInsRoot = Path.GetFullPath(fusionAddInsRoot ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Autodesk", "Autodesk Fusion 360", "API", "AddIns"));
    }

    public string WebDir => Path.Combine(AppRoot, "web");
    public string PageFile => Path.Combine(WebDir, "index.html");
    public string AddInSourceDir => Path.Combine(AppRoot, "fusion-addin");
    public string EnginesDir => Path.Combine(AppRoot, "engines");
    public string RunsDir => Path.Combine(DataRoot, "runs");
    public string AddInTargetDir => Path.Combine(FusionAddInsRoot, "ExhaustTuner");

    /// <summary>OpenWAM solver. EXHAUST_TUNER_OPENWAM overrides (used by the tests and by developers).</summary>
    public string OpenWamExe =>
        Environment.GetEnvironmentVariable("EXHAUST_TUNER_OPENWAM") is { Length: > 0 } p ? p
        : Path.Combine(EnginesDir, "openwam", OperatingSystem.IsWindows() ? "OpenWAM.exe" : "OpenWAM");

    /// <summary>A new, unique folder for one run: runs\yyyyMMdd-HHmmss_name.</summary>
    public string NewRunDir(string name)
    {
        var safe = CaseFiles.SafeName(name);
        var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        var dir = Path.Combine(RunsDir, stamp + "_" + safe);
        for (var i = 2; Directory.Exists(dir); i++)
            dir = Path.Combine(RunsDir, stamp + "_" + safe + "_" + i);
        Directory.CreateDirectory(dir);
        return dir;
    }
}
