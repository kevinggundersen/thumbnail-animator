; Force silent mode for auto-updates.
; electron-updater passes --updated on the command line, but UAC elevation
; can drop the /S flag, causing the install wizard to appear.
!include "FileFunc.nsh"

!macro customInit
  ClearErrors
  ${GetParameters} $R9
  ${GetOptions} $R9 "--updated" $R8
  ${IfNot} ${Errors}
    SetSilent silent
  ${EndIf}
!endmacro
