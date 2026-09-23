param(
  [Parameter(Mandatory = $true)]
  [string]$ShopProfile,
  [int]$Port = 9224,
  [string]$WebCliExtension = '',
  [string]$Chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
)
$ErrorActionPreference = 'Stop'

$running = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like "*$ShopProfile*" -and $_.CommandLine -notmatch '--type=' }
if ($running) {
  foreach ($proc in $running) {
    Write-Output "closing pid $($proc.ProcessId)"
    & taskkill /PID $proc.ProcessId 2>&1 | Out-Null
  }
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    $still = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like "*$ShopProfile*" }
    if (-not $still) { break }
    Start-Sleep -Milliseconds 500
  }
  $left = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like "*$ShopProfile*" }
  if ($left) { throw "shop chrome still running; aborting launch to avoid profile lock" }
  Write-Output 'closed'
}

$chromeArgs = @(
  "--user-data-dir=$ShopProfile",
  '--profile-directory=Default',
  '--no-first-run',
  '--no-default-browser-check',
  "--remote-debugging-port=$Port",
  '--remote-debugging-address=127.0.0.1',
  '--remote-allow-origins=*',
  '--restore-last-session',
  "--load-extension=$WebCliExtension"
)
Start-Process -FilePath $Chrome -ArgumentList $chromeArgs | Out-Null

$ready = $false
$deadline = (Get-Date).AddSeconds(40)
while ((Get-Date) -lt $deadline) {
  try {
    $v = Invoke-RestMethod "http://127.0.0.1:$Port/json/version" -TimeoutSec 5
    $ready = $true
    Write-Output "cdp ready: $($v.Browser)"
    break
  } catch { Start-Sleep -Milliseconds 800 }
}
if (-not $ready) { throw "CDP endpoint not ready on port $Port" }

$targets = Invoke-RestMethod "http://127.0.0.1:$Port/json/list" -TimeoutSec 10
foreach ($t in $targets) { Write-Output ("target type={0} title={1} url={2}" -f $t.type, $t.title, $t.url) }
