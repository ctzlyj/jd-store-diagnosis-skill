param(
  [int]$Port = 9224,
  [int]$Seconds = 300,
  [int]$IntervalMs = 150,
  [string]$StopFile = ''
)
$ErrorActionPreference = 'Continue'
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class ZL {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  public static List<IntPtr> WindowsOfPids(int[] pids) {
    var set = new HashSet<int>();
    for (int i = 0; i < pids.Length; i++) set.Add(pids[i]);
    var list = new List<IntPtr>();
    EnumWindows((h, l) => {
      int p; GetWindowThreadProcessId(h, out p);
      if (set.Contains(p) && IsWindowVisible(h)) list.Add(h);
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@
function Get-ShopPids {
  @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match ("--remote-debugging-port=$Port(\s|$)") -and $_.CommandLine -notmatch '--type=' } |
    ForEach-Object { [int]$_.ProcessId })
}
$HWND_BOTTOM = [IntPtr]1
$FLAGS = 0x1 -bor 0x2 -bor 0x10   # NOSIZE | NOMOVE | NOACTIVATE
$deadline = (Get-Date).AddSeconds($Seconds)
$pushes = 0
$rescues = 0
$pids = Get-ShopPids
$lastRefresh = Get-Date
while ((Get-Date) -lt $deadline) {
  if ($StopFile -and (Test-Path -LiteralPath $StopFile)) { break }
  if (((Get-Date) - $lastRefresh).TotalSeconds -gt 10) { $pids = Get-ShopPids; $lastRefresh = Get-Date }
  if ($pids.Count -gt 0) {
    $wins = @([ZL]::WindowsOfPids($pids))
    if ($wins.Count -gt 0) {
      $fg = [ZL]::GetForegroundWindow()
      $fgWasShop = $wins -contains $fg
      foreach ($h in $wins) { if ([ZL]::SetWindowPos($h, $HWND_BOTTOM, 0, 0, 0, 0, $FLAGS)) { $pushes++ } }
      if ($fgWasShop) { $rescues++ }
    }
  }
  Start-Sleep -Milliseconds $IntervalMs
}
Write-Output "guard_loop_done pushes=$pushes shop_was_foreground_ticks=$rescues seconds=$Seconds"
