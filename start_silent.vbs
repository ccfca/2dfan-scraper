Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Dim scriptDir
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
If Right(scriptDir, 1) <> "\" Then scriptDir = scriptDir & "\"
Dim nodePath
nodePath = "node"
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then
    nodePath = "C:\Program Files\nodejs\node.exe"
End If
Dim cmd
cmd = "cmd /c cd /d """ & scriptDir & """ && set XDG_CONFIG_HOME=" & scriptDir & ".config && start http://localhost:3456 && """ & nodePath & """ server.mjs"
WshShell.Run cmd, 0, False