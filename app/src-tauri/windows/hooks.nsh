; hive: a newer installer runs the old uninstaller in place ("uninstall.exe _?=<dir>") when you
; install over an older version. Tauri's uninstaller then believes hive is being removed for good:
; it unpins hive from the taskbar and Start and deletes its shortcuts. A real uninstall (Settings →
; Apps) always runs from a temporary copy of uninstall.exe, so running from the install folder
; itself means "being upgraded" — treat it like the auto-updater's /UPDATE and keep everything.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $EXEDIR == $INSTDIR
    StrCpy $UpdateMode 1
  ${EndIf}
!macroend
