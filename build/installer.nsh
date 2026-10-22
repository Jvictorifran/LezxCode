; Coloca o comando "lezx" no PATH do usuário (como o instalador do VS Code faz com o "code")
!macro customInstall
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\path.ps1" -Dir "$INSTDIR\resources"'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\path.ps1" -Dir "$INSTDIR\resources" -Remove'
!macroend
