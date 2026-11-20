Unicode True
RequestExecutionLevel user
SetCompressor /SOLID lzma
Name "OpenWeb"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\OpenWeb"
BrandingText "OpenWeb ${VERSION}"

!include "MUI2.nsh"
!define MUI_ABORTWARNING
!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\OpenWeb.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Lancer OpenWeb"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "French"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1036 "ProductName" "OpenWeb"
VIAddVersionKey /LANG=1036 "FileDescription" "Programme d’installation OpenWeb"
VIAddVersionKey /LANG=1036 "FileVersion" "${VERSION}"

!macro StopIfRunning
  FindWindow $0 "Chrome_WidgetWin_1" "OpenWeb"
  StrCmp $0 0 noMain
  MessageBox MB_OK|MB_ICONEXCLAMATION "Ferme OpenWeb avant de continuer." /SD IDOK
  SetErrorLevel 2
  Abort
  noMain:
  FindWindow $0 "Chrome_WidgetWin_1" "OpenWeb · Navigation privée"
  StrCmp $0 0 finished
  MessageBox MB_OK|MB_ICONEXCLAMATION "Ferme les fenêtres OpenWeb avant de continuer." /SD IDOK
  SetErrorLevel 2
  Abort
  finished:
!macroend

Function .onInit
  SetShellVarContext current
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\OpenWeb"
  !insertmacro StopIfRunning
FunctionEnd

Function un.onInit
  SetShellVarContext current
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\OpenWeb"
  !insertmacro StopIfRunning
FunctionEnd

Section "OpenWeb"
  SetOutPath "$INSTDIR"
  SetOverwrite try
  ClearErrors
  File /r "${APP_DIR}\*"
  IfErrors 0 installed
    MessageBox MB_OK|MB_ICONSTOP "Certains fichiers sont encore utilisés. Ferme OpenWeb puis relance l’installation." /SD IDOK
    SetErrorLevel 2
    Abort
  installed:
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\OpenWeb"
  CreateShortcut "$SMPROGRAMS\OpenWeb\OpenWeb.lnk" "$INSTDIR\OpenWeb.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenWeb" "DisplayName" "OpenWeb"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenWeb" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenWeb" "Publisher" "OpenWeb"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenWeb" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenWeb" "DisplayIcon" "$INSTDIR\OpenWeb.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenWeb" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenWeb" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenWeb" "NoRepair" 1
SectionEnd

Section "Uninstall"
  !include "${REMOVE_SCRIPT}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\OpenWeb\OpenWeb.lnk"
  RMDir "$SMPROGRAMS\OpenWeb"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenWeb"
SectionEnd
