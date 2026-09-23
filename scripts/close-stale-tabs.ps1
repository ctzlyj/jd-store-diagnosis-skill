$ErrorActionPreference = "Continue"
Add-Type @"
using System; using System.Runtime.InteropServices;
public class FG { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }
"@
$fg0 = [FG]::GetForegroundWindow()
& powershell -NoProfile -ExecutionPolicy Bypass -File $PSScriptRoot\zguard.ps1 -Port 9224 | Out-Null
$list = Invoke-RestMethod -Uri 'http://127.0.0.1:9224/json/list' -TimeoutSec 6
$pages = $list | Where-Object { $_.type -eq 'page' }
Write-Output ("before: pages={0} fg={1}" -f $pages.Count, $fg0)
# 保留最后一个作为落地面，关闭其余任务遗留标签
$keep = $pages[-1]
foreach ($p in $pages) {
  if ($p.id -eq $keep.id) { continue }
  try {
    $r = Invoke-RestMethod -Uri ("http://127.0.0.1:9224/json/close/" + $p.id) -TimeoutSec 6
    Write-Output ("closed: " + $p.title + " -> " + $r)
  } catch { Write-Output ("close failed: " + $p.title + " : " + $_.Exception.Message) }
}
Start-Sleep -Milliseconds 500
& powershell -NoProfile -ExecutionPolicy Bypass -File $PSScriptRoot\zguard.ps1 -Port 9224 | Out-Null
$list2 = Invoke-RestMethod -Uri 'http://127.0.0.1:9224/json/list' -TimeoutSec 6
$pages2 = $list2 | Where-Object { $_.type -eq 'page' }
$fg1 = [FG]::GetForegroundWindow()
Write-Output ("after: pages={0} fg={1} focus_changed={2}" -f $pages2.Count, $fg1, ($fg1 -ne $fg0))
$pages2 | Select-Object title, url | Format-Table -AutoSize
