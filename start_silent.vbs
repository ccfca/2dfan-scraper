Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Dim scriptDir
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Dim nodePath
nodePath = "node"
If fso.FileExists("C:\\Program Files\\nodejs\\node.exe") Then
    nodePath = "C:\\Program Files\\nodejs\\node.exe"
End If
WshShell.Run "cmd /c set XDG_CONFIG_HOME=" & scriptDir & "\.config && cd /d \"" & scriptDir & "\" && start http://localhost:3456 && \"" & nodePath & "\" server.mjs", 0, False
