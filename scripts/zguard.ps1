param(
  [int]$Port = 9224,
  [ValidateSet('bottom','minimize','hide')][string]$Mode = 'bottom'
)
$ErrorActionPreference = 'Continue'
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class ZG {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static List<IntPtr> WindowsOfPid(int target) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { int p; GetWindowThreadProcessId(h, out p); if (p == target && IsWindowVisible(h)) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
}
"@
$procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match "--remote-debugging-port=$Port(\s|$)" -and $_.CommandLine -notmatch '--type=' }
if (-not $procs) { Write-Output "NO_BROWSER_PID_FOR_PORT $Port"; exit 0 }
$HWND_BOTTOM = [IntPtr]1
$SWP_NOSIZE = 0x1; $SWP_NOMOVE = 0x2; $SWP_NOACTIVATE = 0x10
$fgBefore = [ZG]::GetForegroundWindow()
$result = @()
$shopHwnds = @()
foreach ($p in $procs) {
  foreach ($h in [ZG]::WindowsOfPid($p.ProcessId)) {
    $shopHwnds += $h
    $sb = New-Object System.Text.StringBuilder 512
    [void][ZG]::GetWindowText($h, $sb, 512)
    $ok = $false
    if ($Mode -eq 'bottom') { $ok = [ZG]::SetWindowPos($h, $HWND_BOTTOM, 0, 0, 0, 0, ($SWP_NOSIZE -bor $SWP_NOMOVE -bor $SWP_NOACTIVATE)) }
    elseif ($Mode -eq 'minimize') { $ok = [ZG]::ShowWindow($h, 6) }
    $result += [pscustomobject]@{ pid = $p.ProcessId; hwnd = $h.ToString(); mode = $Mode; ok = $ok; title = $sb.ToString() }
  }
}
$fgAfter = [ZG]::GetForegroundWindow()
# Only restore the pre-existing foreground window when the guard itself did not
# deliberately push it away. Restoring a shop window would re-raise the popup.
$fgBeforeWasShop = ($fgBefore -ne [IntPtr]::Zero) -and ($shopHwnds -contains $fgBefore)
if ($fgAfter -ne $fgBefore -and -not $fgBeforeWasShop) { [void][ZG]::SetForegroundWindow($fgBefore) }
Write-Output ("fg_before={0} fg_after={1} fg_before_was_shop={2} restored={3}" -f $fgBefore, $fgAfter, $fgBeforeWasShop, ([ZG]::GetForegroundWindow()))
$result | Format-Table -AutoSize | Out-String -Width 220
