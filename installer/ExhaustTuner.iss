; Exhaust Tuner installer (Inno Setup 6). Built by .github/workflows/windows.yml from the staged folder:
;   iscc /DAppVersion=0.1.0 /DStage=..\stage installer\ExhaustTuner.iss
; Per-user install (no administrator rights needed): %LOCALAPPDATA%\Programs\Exhaust Tuner.
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
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=ExhaustTuner-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
SetupIconFile=..\app\ExhaustTuner.Desktop\exhaust.ico
UninstallDisplayIcon={app}\ExhaustTuner.exe
WizardStyle=modern
InfoBeforeFile={#Stage}\licenses\NOTICE.txt

[Tasks]
Name: "addin"; Description: "Install the Exhaust Tuner add-in into Autodesk Fusion"; Flags: checkedonce
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Stage}\..\webview2\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: NeedsWebView2

[Icons]
Name: "{group}\Exhaust Tuner"; Filename: "{app}\ExhaustTuner.exe"
Name: "{group}\Exhaust Tuner runs folder"; Filename: "{localappdata}\ExhaustTuner\runs"
Name: "{group}\{cm:UninstallProgram,Exhaust Tuner}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Exhaust Tuner"; Filename: "{app}\ExhaustTuner.exe"; Tasks: desktopicon

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Installing Microsoft Edge WebView2 Runtime..."; Check: NeedsWebView2; Flags: waituntilterminated
Filename: "{app}\exhaust-tuner-host.exe"; Parameters: "--install-addin"; StatusMsg: "Installing the Fusion add-in..."; Tasks: addin; Flags: runhidden waituntilterminated
Filename: "{app}\ExhaustTuner.exe"; Description: "{cm:LaunchProgram,Exhaust Tuner}"; Flags: nowait postinstall skipifsilent

[Code]
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
