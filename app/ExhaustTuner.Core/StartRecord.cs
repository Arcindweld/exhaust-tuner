namespace ExhaustTuner.Core;

/// <summary>
/// last-start.txt in the data folder: which version started last, as which process, when, from which folder (one per
/// line). The desktop program writes it as it starts and adds a "page loaded" line once the page is up. The Windows
/// build checks it after an update, and the version it held before this start tells the updater that an update was
/// just installed (Updater, Status "updated").
/// </summary>
public static class StartRecord
{
    public const string FileName = "last-start.txt";

    /// <summary>The version the previous start recorded, read before this start overwrites it (set by the program).</summary>
    public static string? PreviousVersion { get; set; }

    /// <summary>Records this start and returns the version the previous one recorded (null if none).</summary>
    public static string? Write(AppPaths paths, string version)
    {
        var f = Path.Combine(paths.DataRoot, FileName);
        string? prev = null;
        try { if (File.Exists(f)) prev = File.ReadLines(f).FirstOrDefault()?.Trim(); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        Directory.CreateDirectory(paths.DataRoot);
        File.WriteAllText(f, string.Join("\n", version, Environment.ProcessId, DateTime.UtcNow.ToString("o"), AppContext.BaseDirectory) + "\n");
        return string.IsNullOrEmpty(prev) ? null : prev;
    }
}
