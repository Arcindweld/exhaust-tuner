using System.Text;
using System.Text.Json.Nodes;

namespace ExhaustTuner.Core;

/// <summary>A file the page made (an OpenWAM .wam, an OpenFOAM dictionary, a README) or passed on (an STL the user
/// picked): text, or bytes when the page sent base64.</summary>
public sealed record CaseFile(string Name, string Text, bool Exec = false, byte[]? Data = null);

public static class CaseFiles
{
    /// <summary>Reads [{name, text, exec?}] or [{name, base64}] from the page's JSON.</summary>
    public static List<CaseFile> FromJson(JsonNode? files)
    {
        var list = new List<CaseFile>();
        if (files is not JsonArray arr) return list;
        foreach (var f in arr)
        {
            var name = f?["name"]?.GetValue<string>();
            if (string.IsNullOrEmpty(name)) continue;
            var b64 = f?["base64"]?.GetValue<string>();
            if (b64 is not null)
            {
                list.Add(new CaseFile(name, "", false, Convert.FromBase64String(b64)));
                continue;
            }
            var text = f?["text"]?.GetValue<string>();
            if (text is null) continue;
            var exec = f?["exec"] is JsonValue v && v.TryGetValue<bool>(out var b) && b;
            list.Add(new CaseFile(name, text, exec));
        }
        return list;
    }

    /// <summary>A file or folder name with nothing that could leave the folder or upset Windows.</summary>
    public static string SafeName(string name)
    {
        var bad = Path.GetInvalidFileNameChars().Concat(new[] { '/', '\\', ':', '*', '?', '"', '<', '>', '|' }).ToHashSet();
        var s = new string(name.Select(c => bad.Contains(c) || char.IsControl(c) ? '_' : c).ToArray()).Trim(' ', '.');
        return s.Length == 0 ? "case" : s.Length > 80 ? s[..80] : s;
    }

    /// <summary>
    /// The relative parts of a name the page gave (a CFD case uses "case/system/controlDict"). Empty parts, "." and ".."
    /// are dropped so nothing is written outside the chosen folder.
    /// </summary>
    public static string[] RelativeParts(string name) =>
        name.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Where(p => p != "." && p != "..").Select(SafeName).ToArray();

    /// <summary>
    /// Writes the files under <paramref name="folder"/>. Windows batch files and OpenWAM inputs get CRLF line ends
    /// (as the Fusion add-in writes them), everything else LF. Returns the relative names written.
    /// </summary>
    public static List<string> Write(string folder, IEnumerable<CaseFile> files)
    {
        var root = Path.GetFullPath(folder);
        Directory.CreateDirectory(root);
        var written = new List<string>();
        foreach (var f in files)
        {
            var parts = RelativeParts(f.Name);
            if (parts.Length == 0) continue;
            var path = Path.GetFullPath(Path.Combine(new[] { root }.Concat(parts).ToArray()));
            if (!path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                throw new InvalidOperationException("A file name tried to leave the case folder: " + f.Name);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            if (f.Data is not null)
            {   // bytes as they came (an STL): no line-end conversion
                File.WriteAllBytes(path, f.Data);
                written.Add(string.Join('/', parts));
                continue;
            }
            var lower = path.ToLowerInvariant();
            var nl = lower.EndsWith(".bat") || lower.EndsWith(".txt") || lower.EndsWith(".wam") ? "\r\n" : "\n";
            var text = f.Text.Replace("\r\n", "\n").Replace("\n", nl);
            File.WriteAllText(path, text, new UTF8Encoding(false));
            if (f.Exec && !OperatingSystem.IsWindows())
                File.SetUnixFileMode(path, File.GetUnixFileMode(path) | UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute);
            written.Add(string.Join('/', parts));
        }
        return written;
    }
}
