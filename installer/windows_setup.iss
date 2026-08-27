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

; v0.9.332 — Editions-fähig: Defaults bauen das volle GPS Studio. Der
; CI-Geotagger-Build überschreibt AppName/AppExeName/AppId/SourceDirName/
; OutputBaseFilename per /D… (gleiche .iss, kein Klon).
#ifndef AppName
  #define AppName "Reisezoom GPS Studio"
#endif
#ifndef AppExeName
  #define AppExeName "ReisezoomGPSStudio.exe"
#endif
; AppId — EINDEUTIGE GUID je Edition, NIE ÄNDERN (sonst findet ein Update die
; alte Installation nicht). Studio + Geotagger haben BEWUSST verschiedene IDs,
; damit beide parallel installierbar sind.
#ifndef AppId
  #define AppId "{{F8C7E2A1-9B4D-4E5F-A6B7-1234567890AB}"
#endif
; PyInstaller-Output-Ordner unter dist\ (Studio: ReisezoomGPSStudio).
#ifndef SourceDirName
  #define SourceDirName "ReisezoomGPSStudio"
#endif
; Fixer Setup-Filename (Download-Buttons zeigen drauf).
#ifndef OutputBaseFilename
  #define OutputBaseFilename "ReisezoomGPSStudio-windows-setup"
#endif

; .rzproj-Dateizuordnung (27.08.2026, Beta-Tester aus Spanien): Er hatte sie
; von Hand angelegt, damit ein Doppelklick auf eine Projektdatei das Programm
; öffnet — das kann man von niemandem erwarten. NUR das Studio meldet den Typ
; an; der Geotagger-Build nutzt dieselbe .iss und erzeugt gar keine Projekte.
#ifndef RegisterRzproj
  #if AppExeName == "ReisezoomGPSStudio.exe"
    #define RegisterRzproj
  #endif
#endif
#define RzprojProgId "ReisezoomGPSStudio.Project"

#define AppPublisher   "Reisezoom (Marc Arzt)"
#define AppURL         "https://reisezoom.com/reisezoom-gps-studio/"

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
OutputBaseFilename={#OutputBaseFilename}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\assets\icon.ico
; Wenn icon.ico nicht existiert (z.B. lokaler Build ohne Assets), wird der
; Setup mit Default-Icon gebaut — kein Error.
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}
#ifdef RegisterRzproj
ChangesAssociations=yes
#endif
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
Source: "..\dist\{#SourceDirName}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

#ifdef RegisterRzproj
[Registry]
; Endung → ProgId. `uninsdeletevalue` räumt nur den eigenen Wert weg; hat
; inzwischen ein anderes Programm die Endung übernommen, bleibt dessen Eintrag.
Root: HKA; Subkey: "Software\Classes\.rzproj"; ValueType: string; ValueName: ""; ValueData: "{#RzprojProgId}"; Flags: uninsdeletevalue
; ProgId → Anzeigename, Symbol und Öffnen-Befehl. Das "%1" ist der Kern der
; Sache: OHNE das bekommt die Anwendung beim Doppelklick keinen Pfad und
; startet leer — genau die Meldung, die uns hierher geführt hat.
Root: HKA; Subkey: "Software\Classes\{#RzprojProgId}"; ValueType: string; ValueName: ""; ValueData: "Reisezoom GPS Studio project"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\{#RzprojProgId}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#AppExeName},0"
Root: HKA; Subkey: "Software\Classes\{#RzprojProgId}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""
; „Öffnen mit" führt die Anwendung auch dann auf, wenn jemand die Endung
; später einem anderen Programm zuweist.
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExeName}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExeName}\SupportedTypes"; ValueType: string; ValueName: ".rzproj"; ValueData: ""
#endif

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
