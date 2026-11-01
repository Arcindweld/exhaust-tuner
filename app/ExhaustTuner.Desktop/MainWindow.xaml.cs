using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
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

    // The page's surface colours (web/index.html --bg and --ink), so the frame, the start-up screen and the page meet
    // without a seam or a white flash. The page reports its theme through the "uiTheme" request.
    static readonly Color DarkBg = Color.FromRgb(0x10, 0x16, 0x1B), DarkInk = Color.FromRgb(0xE6, 0xEC, 0xF0), DarkMuted = Color.FromRgb(0x90, 0xA0, 0xAA);
    static readonly Color LightBg = Color.FromRgb(0xE6, 0xEB, 0xEE), LightInk = Color.FromRgb(0x0F, 0x16, 0x1B), LightMuted = Color.FromRgb(0x52, 0x60, 0x6A);
    bool _dark = SystemPrefersDark();

    public MainWindow()
    {
        InitializeComponent();
        ApplyColours();
        SourceInitialized += (_, _) => ApplyFrame();
        Loaded += async (_, _) => await StartAsync();
        KeyDown += (_, e) =>
        {
            if (e.Key == Key.F5) Web.Reload();
            if (e.Key == Key.F12) Web.CoreWebView2?.OpenDevToolsWindow();
        };
    }

    /// <summary>Windows' app theme (Settings, Personalisation, Colours): AppsUseLightTheme = 0 means dark.</summary>
    static bool SystemPrefersDark()
    {
        try
        {
            using var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return k?.GetValue("AppsUseLightTheme") is int v && v == 0;
        }
        catch { return false; }
    }

    void ApplyColours()
    {
        var bg = _dark ? DarkBg : LightBg;
        Background = new SolidColorBrush(bg);
        Splash.Background = new SolidColorBrush(bg);
        Status.Foreground = new SolidColorBrush(_dark ? DarkMuted : LightMuted);
        Web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(bg.R, bg.G, bg.B);
    }

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    const int DwmUseImmersiveDarkMode = 20, DwmUseImmersiveDarkModeOld = 19, DwmCaptionColor = 35, DwmTextColor = 36;
    static int ColorRef(Color c) => c.R | (c.G << 8) | (c.B << 16);

    /// <summary>Dark or light title bar (Windows 10 and 11) in the page's own colour (Windows 11; earlier versions ignore it).</summary>
    void ApplyFrame()
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd == IntPtr.Zero) return;
        int on = _dark ? 1 : 0;
        if (DwmSetWindowAttribute(hwnd, DwmUseImmersiveDarkMode, ref on, sizeof(int)) != 0)
            DwmSetWindowAttribute(hwnd, DwmUseImmersiveDarkModeOld, ref on, sizeof(int));
        int caption = ColorRef(_dark ? DarkBg : LightBg), text = ColorRef(_dark ? DarkInk : LightInk);
        DwmSetWindowAttribute(hwnd, DwmCaptionColor, ref caption, sizeof(int));
        DwmSetWindowAttribute(hwnd, DwmTextColor, ref text, sizeof(int));
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
        core.NavigationCompleted += (_, e) =>
        {
            if (e.IsSuccess) Splash.Visibility = Visibility.Collapsed;
            else Status.Text = "The calculator page did not load (" + e.WebErrorStatus + "). Press F5 to try again.";
            // the start record (App.xaml.cs) gets the outcome: the Windows build checks that the installed window loads the page
            try { File.AppendAllText(Path.Combine(_paths.DataRoot, "last-start.txt"), (e.IsSuccess ? "page loaded " : "page failed " + e.WebErrorStatus + " ") + DateTime.UtcNow.ToString("o") + "\n"); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        };
        // app.html is index.html wrapped in a full document at build time (web/make_palette.py, as for the Fusion palette),
        // so the page renders in standards mode; a development folder without it falls back to the bare page
        var start = File.Exists(Path.Combine(_paths.WebDir, "app.html")) ? "app.html" : "index.html";
        core.Navigate("https://" + Host + "/" + start);
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

    public void SetTheme(bool dark) => Dispatcher.Invoke(() =>
    {
        if (dark == _dark) return;
        _dark = dark;
        ApplyColours();
        ApplyFrame();
    });

    public void OpenDevTools() => Dispatcher.Invoke(() => Web.CoreWebView2?.OpenDevToolsWindow());

    /// <summary>An update's installer has started and waits for this process to end: close shortly, once the reply
    /// has reached the page.</summary>
    public void Quit() => Dispatcher.InvokeAsync(async () =>
    {
        Status.Text = "Installing the update…";
        await Task.Delay(600);
        Application.Current.Shutdown();
    });
}
