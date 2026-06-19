; ====================================================================
; Reisezoom GPS Studio — Inno Setup Script
; ====================================================================
;
; Erzeugt einen klassischen Windows-Installer (Setup.exe), der:
;  - In %ProgramFiles%\Reisezoom GPS Studio\ installiert
;  - Start-Menü-Shortcut + optional Desktop-Shortcut anlegt
;  - Sauberen Uninstaller in der Systemsteuerung registriert
;  - Updates erkennt (gleiche AppId → bestehende Installation wird ersetzt)
;
; Warum überhaupt ein Installer statt ZIP?
;  → Windows markiert Dateien aus ZIPs mit "Mark of the Web" (MotW), was
;    DLL-Loading blockiert (siehe Bug-Report von Beta-Tester, v0.4.0). Bei einem
;    Inno-Installer trägt nur die Setup.exe selbst die Quarantäne — die
;    danach installierten DLLs sind sauber und laden ohne PowerShell-
;    Unblock-Tricks.
;
; Bau-Aufruf (in CI):
;   iscc /DAppVersion=0.4.1 installer\windows_setup.iss
;
; Lokales Testen auf Mac/Linux NICHT möglich — Inno Setup ist Windows-only.
; ====================================================================

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define AppName        "Reisezoom GPS Studio"
#define AppPublisher   "Reisezoom (Marc Arzt)"
#define AppURL         "https://reisezoom.com/reisezoom-gps-studio/"
#define AppExeName     "ReisezoomGPSStudio.exe"
; AppId — EINDEUTIGE GUID, NIE ÄNDERN.
; Updates funktionieren nur korrekt wenn AppId zwischen Versionen identisch
; bleibt — Inno findet so die alte Installation und ersetzt sie sauber.
; Generiert mit: New-Guid | % { $_.Guid }
#define AppId          "{{F8C7E2A1-9B4D-4E5F-A6B7-1234567890AB}"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
; Hinweis: DisableDirPage ist bewusst NICHT gesetzt → Inno-Default `auto`. Das
; zeigt die Ordner-Auswahl (Laufwerk/Pfad/Ordner) bei einer NEUINSTALLATION und
; blendet sie beim UPDATE aus (behält automatisch den vorhandenen Installationsort).
; Genau dieses Verhalten ist gewünscht (Marc 2026-06-19).
DisableProgramGroupPage=yes
LicenseFile=
; Privilegien:
;   - lowest = installiert pro User in %LOCALAPPDATA% (kein Admin nötig)
;   - admin  = installiert systemweit in %ProgramFiles% (Admin-Prompt)
;   - We use admin (besser für Standard-Pfade) mit Fallback auf lowest
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog commandline
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
OutputDir=..\dist
; WICHTIG: fixer Filename — Shortlinks `s.reisezoom.com/gps-studio-win`
; zeigen exakt auf diese Datei. Bei Workflow-Änderungen Convention behalten.
OutputBaseFilename=ReisezoomGPSStudio-windows-setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\assets\icon.ico
; Wenn icon.ico nicht existiert (z.B. lokaler Build ohne Assets), wird der
; Setup mit Default-Icon gebaut — kein Error.
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#AppName}
VersionInfoCompany={#AppPublisher}
VersionInfoCopyright=© 2026 Reisezoom
; KEINE Code-Signatur — wir haben keinen EV-Cert. SmartScreen zeigt beim
; ersten Mal "Unbekannter Herausgeber" → User klickt "Weitere Informationen
; → Trotzdem ausführen". Ist Standard für kleine Indie-Apps.
; (SignTool-Direktive bewusst weggelassen statt SignTool=; Inno Setup
; akzeptiert keinen leeren Wert.)

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Source = relativ zur .iss-Datei, also `installer\` als Working-Directory.
; Im CI wird der Workflow so aufgerufen, dass `dist\ReisezoomGPSStudio\`
; (PyInstaller-Output) der Source ist — drum gehen wir `..\dist\...`.
Source: "..\dist\ReisezoomGPSStudio\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; PyInstaller-Bundle hinterlässt manchmal __pycache__ und temporäre Files —
; mit dem Recurse-Flag werden die beim Uninstall mit gelöscht.
Type: filesandordirs; Name: "{app}"
