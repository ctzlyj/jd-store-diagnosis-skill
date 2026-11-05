param(
  [Parameter(Mandatory = $true)][string]$Shop,
  [string]$Root = '',
  [int]$MinPort = 9300,
  [int]$MaxPort = 9399,
  [switch]$Login,
  [switch]$Release
)

# POP店铺诊断：店铺专用浏览器启动器
# - 每家店一个独立 Profile（默认 用户目录\JD-Shop-Browsers\<店铺>）
# - 端口自动从 9300-9399 选空闲，不与维护人机器或采销机器的其他会话冲突
# - 首次使用：-Login 打开可见窗口引导登录商智/京准通一次，之后长期复用
# - 日常使用：默认隐藏后台（headless），绝不碰采销正在用的工作浏览器
# - -Release 任务结束后释放该店铺浏览器

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if (-not $Root) { $Root = Join-Path $env:USERPROFILE 'JD-Shop-Browsers' }
$profileDir = Join-Path $Root $Shop
$chromeCandidates = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$chrome = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'CHROME_NOT_FOUND：未找到 Google Chrome，请先安装 Chrome（自检命令：python -X utf8 scripts/doctor.py）' }

function Stop-ShopChrome {
  $running = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -like "*$profileDir*" -and $_.CommandLine -notmatch '--type=' }
  foreach ($proc in $running) {
    try { $null = & taskkill /PID $proc.ProcessId 2>&1 } catch { }
  }
  if ($running) {
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
      $left = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
        Where-Object { $_.CommandLine -like "*$profileDir*" }
      if (-not $left) { break }
      Start-Sleep -Milliseconds 500
    }
    Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
      Where-Object { $_.CommandLine -like "*$profileDir*" } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}

if ($Release) {
  Stop-ShopChrome
  Write-Output ([pscustomobject]@{ released = $true; shop = $Shop; profile = $profileDir } | ConvertTo-Json)
  exit 0
}

New-Item $profileDir -ItemType Directory -Force | Out-Null
Stop-ShopChrome

$port = $null
foreach ($candidate in ($MinPort..$MaxPort)) {
  $client = New-Object Net.Sockets.TcpClient
  try { $client.Connect('127.0.0.1', $candidate); $client.Close() } catch { $port = $candidate; break }
  finally { if ($client.Connected) { $client.Close() } }
}
if (-not $port) { throw "NO_FREE_PORT：$MinPort-$MaxPort 都被占用，换一个端口区间（-MinPort/-MaxPort）重试" }

$args = @(
  ('--user-data-dir="' + $profileDir + '"'),
  '--profile-directory=Default',
  '--no-first-run',
  '--no-default-browser-check',
  "--remote-debugging-port=$port",
  '--remote-debugging-address=127.0.0.1',
  '--remote-allow-origins=*'
)
if (-not $Login) { $args = @('--headless=new') + $args }
Start-Process -FilePath $chrome -ArgumentList $args -WindowStyle Hidden

$ready = $false
$deadline = (Get-Date).AddSeconds(40)
while ((Get-Date) -lt $deadline) {
  try { $null = Invoke-RestMethod "http://127.0.0.1:$port/json/version" -TimeoutSec 3; $ready = $true; break } catch { Start-Sleep -Milliseconds 600 }
}
if (-not $ready) { throw "CDP_NOT_READY：浏览器在端口 $port 未就绪" }

function Test-LoggedIn([string]$url) {
  try {
    $null = Invoke-RestMethod -Method Put "http://127.0.0.1:$port/json/new?$url" -TimeoutSec 8
  } catch { $null = Invoke-RestMethod -Method Get "http://127.0.0.1:$port/json/new?$url" -TimeoutSec 8 }
  $tab = $null
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $tabs = Invoke-RestMethod "http://127.0.0.1:$port/json/list" -TimeoutSec 5
    $tab = $tabs | Where-Object { $_.url -like '*jdsz.jd.com*' -or $_.url -like '*jzt.jd.com*' -or $_.url -like '*passport*' -or $_.url -like '*ssa.jd.com*' -or $_.url -like '*login*' } | Select-Object -First 1
    if ($tab) { break }
  }
  if (-not $tab) { return $false }
  $final = [string]$tab.url
  if ($final -match 'passport|ssa\.jd\.com|login') { return $false }
  return $final -like '*jdsz.jd.com*' -or $final -like '*jzt.jd.com*'
}

$jdszUrl = 'https://jdsz.jd.com/szweb/view/index/home.html'
$jztUrl = 'https://jzt.jd.com/report/index.html'

if ($Login) {
  Write-Output "== 首次登录引导 =="
  Write-Output "已打开「店铺专用浏览器」窗口（Profile：$profileDir）"
  Write-Output "请在窗口里完成 2 步："
  Write-Output "  1. 用该店铺的京麦账号登录商智（jdsz.jd.com）"
  Write-Output "  2. 再打开 https://jzt.jd.com 确认京准通也是登录态（同一账号一般自动带过）"
  Write-Output "登录完成后窗口会自动检测并提示；之后日常诊断全部后台运行，不再需要登录。"
  Write-Output "（只动这个专用窗口，不会碰你正在用的浏览器）"
  $ok = $false
  $deadline = (Get-Date).AddMinutes(10)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    $ok = Test-LoggedIn $jdszUrl
    if ($ok) { break }
  }
  if ($ok) {
    Stop-ShopChrome
    Write-Output ([pscustomobject]@{ shop = $Shop; loggedIn = $true; profile = $profileDir; note = '登录成功，已关闭引导窗口；以后直接正常运行本脚本即可后台复用' } | ConvertTo-Json)
  } else {
    Write-Output ([pscustomobject]@{ shop = $Shop; loggedIn = $false; profile = $profileDir; note = '10分钟内未检测到登录；完成登录后重新运行 -Login，或检查账号权限' } | ConvertTo-Json)
    exit 2
  }
  exit 0
}

$loggedIn = Test-LoggedIn $jdszUrl
$result = [pscustomobject]@{
  shop = $Shop
  cdp = "http://127.0.0.1:$port"
  profile = $profileDir
  loggedIn = $loggedIn
  next = if ($loggedIn) {
    "已就绪。后续采集命令前执行：`$env:SHOP_CDP='http://127.0.0.1:$port'；任务结束后执行 -Release 释放"
  } else {
    "该店铺 Profile 尚未登录商智/京准通。先执行：powershell -File scripts/shop-browser.ps1 -Shop $Shop -Login 完成一次登录（窗口会引导），之后长期复用"
  }
}
Write-Output ($result | ConvertTo-Json)
