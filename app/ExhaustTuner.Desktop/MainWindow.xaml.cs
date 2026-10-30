using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Input;
using ExhaustTuner.Core;
using Microsoft.Web.WebView2.Core;

namespace ExhaustTuner.Desktop;

public partial class MainWindow : Window, IHostUi
{
    // The page is served from the install folder under this host name, so it has a normal https origin
    // (browser storage works, file:// restrictions do not apply).
    const string Host = "app.exhaust-tuner";
    readonly AppPaths _paths = new();
    HostDispatcher? _dispatcher;
    MessageRouter? _router;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += async (_, _) => await StartAsync();
        KeyDown += (_, e) =>
        {
            if (e.Key == Key.F5) Web.Reload();
            if (e.Key == Key.F12) Web.CoreWebView2?.OpenDevToolsWindow();
        };
    }

    async Task StartAsync()
    {
        if (!File.Exists(_paths.PageFile))
        {
            Status.Text = "The calculator page is missing: " + _paths.PageFile;
            return;
        }
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(_paths.DataRoot, "WebView2"));
            await Web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            Status.Text = "Microsoft Edge WebView2 Runtime is not installed.";
            MessageBox.Show(this, "This program shows the calculator with Microsoft Edge WebView2, which is not installed on this PC.\n\n" +
                "Install the Evergreen WebView2 Runtime from Microsoft (go.microsoft.com/fwlink/p/?LinkId=2124703), then start Exhaust Tuner again.",
                "Exhaust Tuner", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        var core = Web.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping(Host, _paths.WebDir, CoreWebView2HostResourceAccessKind.DenyCors);
        core.Settings.AreDevToolsEnabled = true;
        core.Settings.IsStatusBarEnabled = false;
        _dispatcher = new HostDispatcher(_paths, this);
        _router = new MessageRouter(_dispatcher, json => Dispatcher.Invoke(() => core.PostWebMessageAsJson(json)));
        await core.AddScriptToExecuteOnDocumentCreatedAsync(MessageRouter.BridgeScript());
        core.WebMessageReceived += (_, e) =>
        {
            // only the bundled page may drive the solvers
            if (!e.Source.StartsWith("https://" + Host + "/", StringComparison.OrdinalIgnoreCase)) return;
            var json = e.WebMessageAsJson;
            _ = Task.Run(() => _router.HandleAsync(json));
        };
        // links to outside pages (sources, part catalogues) open in the normal browser
        core.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
        core.NavigationStarting += (_, e) =>
        {
            if (e.Uri.StartsWith("https://" + Host + "/", StringComparison.OrdinalIgnoreCase) || e.Uri.StartsWith("about:")) return;
            e.Cancel = true; OpenExternal(e.Uri);
        };
        core.Navigate("https://" + Host + "/index.html");
        var info = _dispatcher.Info();
        Status.Text = "OpenWAM " + (info["engines"]!["openwam"]!.GetValue<bool>() ? "ready" : "not found") +
                      " · runs in " + _paths.RunsDir;
    }

    static void OpenExternal(string uri)
    {
        if (uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
            Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
    }

    // ---- IHostUi
    public string? PickFolder(string title) => Dispatcher.Invoke(() =>
    {
        var d = new Microsoft.Win32.OpenFolderDialog { Title = title, Multiselect = false };
        return d.ShowDialog(this) == true ? d.FolderName : null;
    });

    public string? PickSaveFile(string title, string suggestedName) => Dispatcher.Invoke(() =>
    {
        var ext = Path.GetExtension(suggestedName);
        var d = new Microsoft.Win32.SaveFileDialog { Title = title, FileName = suggestedName,
            Filter = (ext.Length > 1 ? ext[1..].ToUpperInvariant() + " file|*" + ext + "|" : "") + "All files|*.*" };
        return d.ShowDialog(this) == true ? d.FileName : null;
    });

    public void OpenFolder(string path) => Process.Start(new ProcessStartInfo("explorer.exe", "\"" + path + "\"") { UseShellExecute = true });

    // ---- menu
    void OpenRuns_Click(object s, RoutedEventArgs e) { Directory.CreateDirectory(_paths.RunsDir); OpenFolder(_paths.RunsDir); }
    void Exit_Click(object s, RoutedEventArgs e) => Close();
    void Reload_Click(object s, RoutedEventArgs e) => Web.Reload();
    void DevTools_Click(object s, RoutedEventArgs e) => Web.CoreWebView2?.OpenDevToolsWindow();

    void InstallAddIn_Click(object s, RoutedEventArgs e)
    {
        try
        {
            var r = new FusionAddIn(_paths).Install();
            MessageBox.Show(this, r["msg"]!.GetValue<string>(), "Fusion add-in", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "Fusion add-in", MessageBoxButton.OK, MessageBoxImage.Error); }
    }

    void AddInStatus_Click(object s, RoutedEventArgs e)
    {
        var st = new FusionAddIn(_paths).Status();
        var inst = st["installed"]?.GetValue<string>();
        var bund = st["bundled"]?.GetValue<string>();
        MessageBox.Show(this,
            "Bundled with this program: " + (bund ?? "?") + "\nInstalled in Fusion: " + (inst ?? "not installed") +
            "\nFolder: " + st["target"]!.GetValue<string>() +
            (inst != null && inst != bund ? "\n\nUse Fusion > Install or update to bring it to " + bund + "." : ""),
            "Fusion add-in", MessageBoxButton.OK, MessageBoxImage.Information);
    }

    void About_Click(object s, RoutedEventArgs e)
    {
        var lic = Path.Combine(_paths.AppRoot, "licenses");
        var sb = new StringBuilder();
        sb.AppendLine("Exhaust Tuner " + HostDispatcher.Version);
        sb.AppendLine();
        sb.AppendLine("Bundled engines (separate programs, each under its own licence):");
        sb.AppendLine("• OpenWAM 2.2, CMT-Motores Térmicos, Universitat Politècnica de València. GPL-3.0. Source: github.com/CMT-UPV/OpenWAM");
        sb.AppendLine("• OpenFOAM (ESI-OpenCFD), when installed with this program. GPL-3.0.");
        sb.AppendLine("• Engine Simulator, Ange Yaghi (Arcindweld fork with the 1-D exhaust). MIT.");
        sb.AppendLine();
        sb.AppendLine("Licence texts: " + lic);
        MessageBox.Show(this, sb.ToString(), "Engines and licences", MessageBoxButton.OK, MessageBoxImage.Information);
    }
}
