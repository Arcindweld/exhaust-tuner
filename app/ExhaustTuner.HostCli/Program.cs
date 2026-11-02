// The desktop program's request handling without the window: one JSON message per line on stdin
// ({id, action, data}), replies and progress events one per line on stdout. The browser tests drive the real
// page through it, and it can run the solvers from a script. Dialogs: EXHAUST_TUNER_PICK_FOLDER answers folder
// and save prompts (unset = the user cancelled). Updates, for the tests only (the desktop program has no such
// switches): EXHAUST_TUNER_UPDATE_API points the update check at a stand-in for api.github.com,
// EXHAUST_TUNER_UPDATE_REPO names the repository, EXHAUST_TUNER_UPDATE_DRYRUN=1 prints the installer command
// instead of starting it, EXHAUST_TUNER_UPDATE_PREVIOUS plays the version the last start recorded (the desktop
// program reads it from last-start.txt).
using System.Diagnostics;
using ExhaustTuner.Core;

var appRoot = Environment.GetEnvironmentVariable("EXHAUST_TUNER_APPROOT");
var dataRoot = Environment.GetEnvironmentVariable("EXHAUST_TUNER_DATA");
var fusionRoot = Environment.GetEnvironmentVariable("EXHAUST_TUNER_FUSION_ADDINS");
var paths = new AppPaths(appRoot, dataRoot, fusionRoot);
static string? Env(string k) => Environment.GetEnvironmentVariable(k) is { Length: > 0 } v ? v : null;
Action<ProcessStartInfo>? launch = Env("EXHAUST_TUNER_UPDATE_DRYRUN") == "1"
    ? psi => Console.Error.WriteLine("update installer (not started): " + psi.FileName + " " + psi.Arguments) : null;
var updater = new Updater(paths, HostDispatcher.Version, api: Env("EXHAUST_TUNER_UPDATE_API"), repo: Env("EXHAUST_TUNER_UPDATE_REPO"), launch: launch,
                          previousVersion: Env("EXHAUST_TUNER_UPDATE_PREVIOUS"));
if (args.Contains("--info")) { Console.WriteLine(new HostDispatcher(paths, new CliUi(), updater).Info().ToJsonString()); return 0; }
if (args.Contains("--bridge")) { Console.Write(MessageRouter.BridgeScript()); return 0; }
if (args.Contains("--install-addin"))
{   // the installer calls this when "Install the Fusion add-in" is ticked
    try { Console.WriteLine(new FusionAddIn(paths).Install()["msg"]); return 0; }
    catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
}
var outLock = new object();
var router = new MessageRouter(new HostDispatcher(paths, new CliUi(), updater), json => { lock (outLock) { Console.Out.WriteLine(json); Console.Out.Flush(); } });
var running = new List<Task>();
string? line;
while ((line = Console.In.ReadLine()) != null)
{
    if (line.Trim().Length == 0) continue;
    running.Add(router.HandleAsync(line));
}
await Task.WhenAll(running);
return 0;

sealed class CliUi : IHostUi
{
    static string? Folder => Environment.GetEnvironmentVariable("EXHAUST_TUNER_PICK_FOLDER") is { Length: > 0 } f ? f : null;
    public string? PickFolder(string title) => Folder;
    public string? PickSaveFile(string title, string suggestedName) => Folder is null ? null : Path.Combine(Folder, suggestedName);
    public void OpenFolder(string path) { Console.Error.WriteLine("open folder: " + path); }
    public void Quit() { Console.Error.WriteLine("quit requested (an update is installing)"); }
}
