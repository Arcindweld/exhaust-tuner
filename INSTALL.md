# Installing Exhaust Tuner

Exhaust Tuner is a Windows program: the calculator in its own window, with the solvers (OpenWAM, Engine Simulator,
OpenFOAM) built in, plus the add-in for Autodesk Fusion. One installer sets up all of it.

**Download:** [ExhaustTuner-Setup.exe](https://github.com/Arcindweld/exhaust-tuner/releases/latest/download/ExhaustTuner-Setup.exe)
(this link always gets the newest version, about 50 MB).

You need Windows 10 or 11 (64-bit). You don't need administrator rights, and you don't need Python, .NET or anything
else installed first.

## Install

1. **Open the downloaded file** (`ExhaustTuner-Setup.exe`, usually in Downloads).
2. **If Windows shows "Windows protected your PC":** click **More info**, then **Run anyway**. The installer isn't
   code-signed, so Windows doesn't recognise the publisher. This happens once per download.
3. **Choose the options and click Install.** Both are ticked by default:
   - *Install the Exhaust Tuner add-in into Autodesk Fusion.* Leave it ticked if you use Fusion. Untick it if you don't;
     you can add it later from the program.
   - *Put a shortcut on the desktop.*
4. **Click Finish.** The program opens.

The first install can take a minute longer if Windows needs Microsoft's WebView2 component, which shows the
program's window. The installer downloads it for you, so stay online for the first install.

## The Fusion add-in

- **Fusion is closed during the install:** nothing more to do. The add-in starts by itself the next time you open
  Fusion.
- **Fusion is open during the install:** close Fusion and open it again.
- **Where it is in Fusion:** Solid tab > Create panel > **Exhaust Tuner Panel** (the full calculator, docked on the
  right) and the calculator dialog.
- **Adding it later, or fixing it:** in Exhaust Tuner, open the program menu (top right) and choose
  **Install or update the Fusion add-in**, then restart Fusion. **Fusion add-in status** shows the installed version.
- **Stopping it from loading:** in Fusion, Utilities > Add-Ins (Shift+S) > Add-Ins tab > Exhaust Tuner, then untick
  **Run on Startup**.

On a Mac, the program doesn't run, but the add-in does. `fusion-addin/README.txt` explains how to add it in Fusion
by hand.

## Updates

Exhaust Tuner updates itself. A few seconds after it starts, and every 6 hours after that, it checks for a new version
and downloads it in the background. When an update is ready, the menu button gets a dot. Choose
**Restart and update**: the program closes, installs the new version (the Fusion add-in included) and opens again.
Your runs and settings are kept. An update waits until any run in progress has finished.

## Where things go

| What | Where |
| --- | --- |
| The program | `%LOCALAPPDATA%\Programs\Exhaust Tuner` |
| Your runs (OpenWAM, OpenFOAM, Engine Simulator) | `%LOCALAPPDATA%\ExhaustTuner\runs`: program menu > **Open the runs folder**, or Start menu > Exhaust Tuner runs folder |
| The Fusion add-in | `%APPDATA%\Autodesk\Autodesk Fusion 360\API\AddIns\ExhaustTuner` |
| Licences of the bundled programs | Start menu > Exhaust Tuner licences |

## Uninstall

Windows Settings > Apps > Installed apps > **Exhaust Tuner** > Uninstall. This removes the program. Your runs folder
and the Fusion add-in stay. To remove the add-in too, first untick Run on Startup in Fusion (see above), then delete its
folder (listed in the table).

## If something goes wrong

- **The window opens blank or not at all:** run the installer again while online. It reinstalls WebView2 if
  that's missing.
- **"This copy of the program was not set up by the installer":** the program was started from a copied folder.
  Install it with `ExhaustTuner-Setup.exe` so it can update itself.
- **The add-in isn't in Fusion:** restart Fusion. If it still isn't there, use **Install or update the Fusion add-in**
  from the program menu, then check Utilities > Add-Ins (Shift+S) in Fusion: Exhaust Tuner should be listed and
  running.
- **No OpenFOAM runs offered:** that build didn't include OpenFOAM. The page then only offers the case download.
  A later update brings it back.
- **The download link gives an old version:** reload the page. The link always points to the newest release on the
  [releases page](https://github.com/Arcindweld/exhaust-tuner/releases).
