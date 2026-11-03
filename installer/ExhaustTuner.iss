; Exhaust Tuner installer (Inno Setup 6). Built by .github/workflows/windows.yml from the staged folder:
;   iscc /DAppVersion=0.1.<run number> /DStage=..\stage installer\ExhaustTuner.iss
; Per-user install (no administrator rights needed): %LOCALAPPDATA%\Programs\Exhaust Tuner.
; One page before it installs: the two choices (Fusion add-in, desktop shortcut, both on). No install-for-whom
; question, no licence screen (the licences are installed and on the Start menu), no folder or ready page.
; The program is rust/ (ExhaustTuner.exe, the window, and exhaust-tuner-host.exe); up to the C# program's last
; release it was app/ (.NET), whose files an update removes ([InstallDelete]).
; Updates: the program runs a newer installer itself (rust/et_host/src/updater.rs) with
;   /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /CURRENTUSER /RELAUNCH=1 /WAITPID=<its process id>
; Setup then waits for that process to end (InitializeSetup), installs into the same folder with the same tasks
; (UsePreviousAppDir / UsePreviousTasks, both on by default) and starts the program again ([Run], RelaunchAfterUpdate).
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef Stage
  #define Stage "..\stage"
#endif

[Setup]
AppId={{6C0B7E2A-4F7D-4B6E-9C1E-2A1D5E7F3B10}
AppName=Exhaust Tuner
AppVersion={#AppVersion}
AppPublisher=Arcindweld
AppPublisherURL=https://github.com/Arcindweld/exhaust-tuner
DefaultDirName={autopf}\Exhaust Tuner
DefaultGroupName=Exhaust Tuner
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline
DisableDirPage=yes
DisableReadyPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=ExhaustTuner-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
SetupIconFile=..\app\ExhaustTuner.Desktop\exhaust.ico
UninstallDisplayIcon={app}\ExhaustTuner.exe
WizardStyle=modern

[Tasks]
Name: "addin"; Description: "Install the Exhaust Tuner add-in into Autodesk Fusion (it starts with Fusion)"; Flags: checkedonce
Name: "desktopicon"; Description: "Put a shortcut on the desktop"; Flags: checkedonce

[InstallDelete]
; the Python 3.13 earlier releases bundled for the CFD case scripts (engines\python): the program now generates 3-D
; cases and writes the report itself (in Rust), so nothing uses it
Type: filesandordirs; Name: "{app}\engines\python"
; the C# program's own files (its .NET runtime and libraries), left by an install of it: the Rust program is two
; .exe files and needs none of them. Only the top of the program folder; the rest of engines\ is untouched.
Type: files; Name: "{app}\*.dll"
Type: files; Name: "{app}\*.deps.json"
Type: files; Name: "{app}\*.runtimeconfig.json"
Type: files; Name: "{app}\*.pdb"
Type: files; Name: "{app}\createdump.exe"
Type: filesandordirs; Name: "{app}\cs"
Type: filesandordirs; Name: "{app}\de"
Type: filesandordirs; Name: "{app}\es"
Type: filesandordirs; Name: "{app}\fr"
Type: filesandordirs; Name: "{app}\it"
Type: filesandordirs; Name: "{app}\ja"
Type: filesandordirs; Name: "{app}\ko"
Type: filesandordirs; Name: "{app}\pl"
Type: filesandordirs; Name: "{app}\pt-BR"
Type: filesandordirs; Name: "{app}\ru"
Type: filesandordirs; Name: "{app}\tr"
Type: filesandordirs; Name: "{app}\zh-Hans"
Type: filesandordirs; Name: "{app}\zh-Hant"

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Stage}\..\webview2\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: NeedsWebView2

[Icons]
Name: "{group}\Exhaust Tuner"; Filename: "{app}\ExhaustTuner.exe"
Name: "{group}\Exhaust Tuner runs folder"; Filename: "{localappdata}\ExhaustTuner\runs"
Name: "{group}\Exhaust Tuner licences"; Filename: "{app}\licenses\NOTICE.txt"
Name: "{group}\{cm:UninstallProgram,Exhaust Tuner}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Exhaust Tuner"; Filename: "{app}\ExhaustTuner.exe"; Tasks: desktopicon

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Installing Microsoft Edge WebView2 Runtime..."; Check: NeedsWebView2; Flags: waituntilterminated
Filename: "{app}\exhaust-tuner-host.exe"; Parameters: "--install-addin"; StatusMsg: "Installing the Fusion add-in..."; Tasks: addin; Flags: runhidden waituntilterminated
Filename: "{app}\ExhaustTuner.exe"; Description: "{cm:LaunchProgram,Exhaust Tuner}"; Flags: nowait postinstall skipifsilent
; after an update the program started (silent, so the entry above is skipped), open it again as the user who ran it
Filename: "{app}\ExhaustTuner.exe"; Flags: nowait runasoriginaluser; Check: RelaunchAfterUpdate

[Code]
function OpenProcess(dwDesiredAccess: Cardinal; bInheritHandle: Integer; dwProcessId: Cardinal): THandle;
  external 'OpenProcess@kernel32.dll stdcall';
function WaitForSingleObject(hHandle: THandle; dwMilliseconds: Cardinal): Cardinal;
  external 'WaitForSingleObject@kernel32.dll stdcall';
function CloseHandle(hObject: THandle): Integer;
  external 'CloseHandle@kernel32.dll stdcall';

const
  SYNCHRONIZE = $00100000;

// An update started by the program passes /WAITPID=<its process id>: wait (up to a minute) until it has closed, so
// none of its files is in use when they are replaced.
function InitializeSetup: Boolean;
var Pid: Integer; H: THandle;
begin
  Result := True;
  Pid := StrToIntDef(ExpandConstant('{param:waitpid|0}'), 0);
  if Pid > 0 then begin
    H := OpenProcess(SYNCHRONIZE, 0, Pid);
    if H <> 0 then begin
      WaitForSingleObject(H, 60000);
      CloseHandle(H);
    end;
  end;
end;

function RelaunchAfterUpdate: Boolean;
begin
  Result := ExpandConstant('{param:relaunch|0}') = '1';
end;

// WebView2 Evergreen Runtime registration (Microsoft's documented detection keys)
function WebView2Version(Root: Integer; Key: String): String;
var V: String;
begin
  if RegQueryStringValue(Root, Key, 'pv', V) then Result := V else Result := '';
end;

function NeedsWebView2: Boolean;
var V: String;
begin
  V := WebView2Version(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}');
  if (V = '') or (V = '0.0.0.0') then
    V := WebView2Version(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}');
  Result := (V = '') or (V = '0.0.0.0');
end;
