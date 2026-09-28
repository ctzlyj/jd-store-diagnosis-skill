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

# 切店场景：目标调试端口可能被「另一家店铺」的浏览器占着。
# 旧逻辑只清理同名 profile，切店时新实例绑定端口失败，就绪检查却命中旧实例，
# 导致后续采集全部打到上一家店（跨店数据泄漏）。必须连端口占用者一起清掉。
$portHolders = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -match "--remote-debugging-port=$Port" -and $_.CommandLine -notmatch '--type=' }
foreach ($proc in $portHolders) {
  Write-Output "closing port holder pid $($proc.ProcessId)"
  & taskkill /PID $proc.ProcessId 2>&1 | Out-Null
}
if ($portHolders) {
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    $still = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
      Where-Object { $_.CommandLine -match "--remote-debugging-port=$Port" }
    if (-not $still) { break }
    Start-Sleep -Milliseconds 500
  }
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

# 就绪后再核验一次：端口上的浏览器必须确实是本次请求的 profile（防跨店数据泄漏的最后一道闸）
$mine = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like "*$ShopProfile*" -and $_.CommandLine -match "--remote-debugging-port=$Port" -and $_.CommandLine -notmatch '--type=' }
if (-not $mine) {
  throw "CDP on port $Port is NOT the requested profile '$ShopProfile'; aborting to avoid cross-store data leak"
}
Write-Output "profile verified: $ShopProfile owns port $Port"
