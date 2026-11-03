using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ExhaustTuner.Core;

/// <summary>Installs or updates the Exhaust Tuner add-in in Fusion's add-in folder.</summary>
public sealed class FusionAddIn
{
    /// <summary>The add-in's own files; anything else in the target folder (the user's notes, layouts) is left alone.</summary>
    public static readonly string[] Files = { "ExhaustTuner.py", "ExhaustTuner.manifest", "cadtools.py", "router.py", "templates.py", "native.py", "README.txt" };

    /// <summary>
    /// The Rust core the router loads when it is there (native.py falls back to Python without it). Copied when the
    /// bundle has it; a copy left in the add-in folder by an older install is removed when the bundle does not, so a
    /// stale library is never loaded.
    /// </summary>
    public static readonly string[] OptionalFiles = { "et_core.dll" };

    readonly AppPaths _paths;
    public FusionAddIn(AppPaths paths) { _paths = paths; }

    public static string? ManifestVersion(string dir)
    {
        var f = Path.Combine(dir, "ExhaustTuner.manifest");
        if (!File.Exists(f)) return null;
        var m = Regex.Match(File.ReadAllText(f), "\"version\"\\s*:\\s*\"([^\"]+)\"");
        return m.Success ? m.Groups[1].Value : null;
    }

    public JsonObject Status() => new()
    {
        ["bundled"] = ManifestVersion(_paths.AddInSourceDir),
        ["installed"] = ManifestVersion(_paths.AddInTargetDir),
        ["target"] = _paths.AddInTargetDir,
        ["fusionFolderExists"] = Directory.Exists(_paths.FusionAddInsRoot),
    };

    /// <summary>
    /// Copies the add-in files and writes palette.html from the bundled page, so the panel inside Fusion is the same
    /// version as this program. Fusion keeps a running add-in's code in memory: the user stops and runs it again
    /// (Utilities, Add-Ins) for the update to take effect.
    /// </summary>
    public JsonObject Install()
    {
        var src = _paths.AddInSourceDir;
        foreach (var f in Files)
            if (!File.Exists(Path.Combine(src, f))) throw new FileNotFoundException("The bundled add-in is incomplete: " + f + " missing in " + src);
        if (!File.Exists(_paths.PageFile)) throw new FileNotFoundException("The bundled page is missing: " + _paths.PageFile);
        var dst = _paths.AddInTargetDir;
        Directory.CreateDirectory(dst);
        var before = ManifestVersion(dst);
        foreach (var f in Files) File.Copy(Path.Combine(src, f), Path.Combine(dst, f), overwrite: true);
        foreach (var f in OptionalFiles)
        {
            var from = Path.Combine(src, f);
            var to = Path.Combine(dst, f);
            if (File.Exists(from)) File.Copy(from, to, overwrite: true);
            else if (File.Exists(to)) File.Delete(to);
        }
        File.WriteAllText(Path.Combine(dst, "palette.html"), PaletteBuilder.Build(File.ReadAllText(_paths.PageFile)));
        var after = ManifestVersion(dst);
        return new JsonObject
        {
            ["ok"] = true, ["folder"] = dst, ["from"] = before, ["to"] = after,
            ["msg"] = (before is null ? "Installed" : before == after ? "Reinstalled" : "Updated " + before + " to") + " the Exhaust Tuner add-in " + after +
                      " in " + dst + ". In Fusion: Utilities, Add-Ins, select Exhaust Tuner, Stop, then Run (or restart Fusion) to load it.",
        };
    }
}
