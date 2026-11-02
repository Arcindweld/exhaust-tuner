using System.IO;
using System.Windows;
using System.Windows.Threading;
using ExhaustTuner.Core;

namespace ExhaustTuner.Desktop;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        // which version started last, as which process, from which folder: after an update this shows the installer
        // opened the new version again (the Windows build checks it), and it helps when something looks out of date
        try { StartRecord.PreviousVersion = StartRecord.Write(new AppPaths(), HostDispatcher.Version); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        DispatcherUnhandledException += (_, ev) =>
        {
            MessageBox.Show(ev.Exception.Message, "Exhaust Tuner", MessageBoxButton.OK, MessageBoxImage.Error);
            ev.Handled = true;
        };
        base.OnStartup(e);
    }
}
