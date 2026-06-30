<#
.SYNOPSIS
  Automated popup position verification for Claudicator

.PARAMETER Edition  "cli" or "web" (default: cli)
.PARAMETER TimeoutSec  seconds to wait for JSON output (default: 90)

.EXAMPLE
  powershell -File tools\verify-popup.ps1 -Edition cli
  powershell -File tools\verify-popup.ps1 -Edition web
#>
param(
  [ValidateSet('cli', 'web')]
  [string]$Edition = 'cli',
  [int]$TimeoutSec = 90
)

$ErrorActionPreference = 'SilentlyContinue'

$RepoRoot   = Split-Path $PSScriptRoot -Parent
$JsonPath   = "$env:TEMP\claudicator-verify.json"
$StarterPs1 = "$env:TEMP\claudicator-verify-start.ps1"
$AppTitle   = if ($Edition -eq 'web') { 'Claudicator' } else { 'Claudicator CLI' }

# ── Win32 P/Invoke ────────────────────────────────────────────────────────────
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
public static class Win32 {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string cls, string title);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
}
'@ -Language CSharp

function Get-WinRect([IntPtr]$h) {
  $r = New-Object RECT; [void][Win32]::GetWindowRect($h, [ref]$r); return $r
}

function Get-TaskbarRects {
  $list = @()
  $h = [Win32]::FindWindow('Shell_TrayWnd', $null)
  if ($h -ne [IntPtr]::Zero) { $list += [pscustomobject]@{Name='Shell_TrayWnd';Rect=(Get-WinRect $h)} }
  $a = [IntPtr]::Zero
  while ($true) {
    $h2 = [Win32]::FindWindowEx([IntPtr]::Zero, $a, 'Shell_SecondaryTrayWnd', $null)
    if ($h2 -eq [IntPtr]::Zero) { break }
    $list += [pscustomobject]@{Name='Shell_SecondaryTrayWnd';Rect=(Get-WinRect $h2)}
    $a = $h2
  }
  return $list
}

function Get-Overlap($a, $b) {
  $ox = [Math]::Max($a.Left,$b.Left); $oy = [Math]::Max($a.Top,$b.Top)
  $ox2=[Math]::Min($a.Right,$b.Right); $oy2=[Math]::Min($a.Bottom,$b.Bottom)
  if ($ox2 -le $ox -or $oy2 -le $oy) { return $null }
  return [pscustomobject]@{X=$ox;Y=$oy;W=($ox2-$ox);H=($oy2-$oy);Area=($ox2-$ox)*($oy2-$oy)}
}

# ── [1] Cleanup ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Claudicator Popup Verification ===" -ForegroundColor Cyan
Write-Host "Edition : $Edition"
Write-Host ""
Write-Host "[1/5] Stopping existing processes..." -ForegroundColor Gray

Get-Process -Name 'Claudicator*','electron','Electron' | Stop-Process -Force
$netLines = netstat -ano 2>$null | Select-String ':5173'
foreach ($l in $netLines) {
  if ($l -match '\s(\d+)$') { Stop-Process -Id ([int]$Matches[1]) -Force }
}
Start-Sleep -Milliseconds 600

# ── [2] Start dev via temp .cmd (avoids PowerShell npm.ps1 resolution issue) ─
Write-Host "[2/5] Starting dev server ($Edition-edition)..." -ForegroundColor Gray

$EditionDir = Join-Path $RepoRoot "$Edition-edition"
if (-not (Test-Path $EditionDir)) {
  Write-Host "ERROR: directory not found: $EditionDir" -ForegroundColor Red
  exit 2
}

Remove-Item $JsonPath, $StarterPs1 -Force

# Write a PS1 launcher so Japanese paths are handled correctly (cmd batch files
# corrupt Unicode paths when written in ASCII; PS1 files use UTF-8 natively).
$escapedDir = $EditionDir -replace "'", "''"
$ps1Content = "`$env:CLAUDICATOR_AUTO_VERIFY = '1'`nSet-Location '$escapedDir'`n& npm run dev"
[System.IO.File]::WriteAllText($StarterPs1, $ps1Content, [System.Text.Encoding]::UTF8)

$proc = Start-Process -FilePath 'powershell.exe' `
  -ArgumentList '-NoProfile', '-File', $StarterPs1 `
  -PassThru `
  -WindowStyle Normal

if (-not $proc) {
  Write-Host "ERROR: failed to start powershell.exe" -ForegroundColor Red
  exit 2
}
Write-Host "  powershell PID: $($proc.Id)"

# ── [3] Wait for JSON ─────────────────────────────────────────────────────────
Write-Host "[3/5] Waiting for diagnostics JSON (max ${TimeoutSec}s)..." -ForegroundColor Gray

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$json = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  if (Test-Path $JsonPath) {
    try { $json = Get-Content $JsonPath -Raw -Encoding UTF8 | ConvertFrom-Json; break } catch {}
  }
}

if (-not $json) {
  Write-Host "TIMEOUT: no JSON within ${TimeoutSec}s" -ForegroundColor Red
  taskkill /F /T /PID $proc.Id 2>$null
  Remove-Item $StarterPs1 -Force
  Get-Process -Name 'electron','Electron' | Stop-Process -Force
  Remove-Item env:CLAUDICATOR_AUTO_VERIFY
  exit 2
}
Write-Host "  JSON received: $JsonPath"

# ── [4] Win32 ground truth ────────────────────────────────────────────────────
Write-Host "[4/5] Reading Win32 window/taskbar rects..." -ForegroundColor Gray
Start-Sleep -Milliseconds 300

$appHwnd = [Win32]::FindWindow($null, $AppTitle)
$appRect = $null
if ($appHwnd -ne [IntPtr]::Zero) { $appRect = Get-WinRect $appHwnd }

$taskbars = Get-TaskbarRects

# ── [5] Report ────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Results ===" -ForegroundColor Cyan
Write-Host "Window title  : $($json.windowTitle)"
Write-Host ("Tray bounds   : x={0} y={1} w={2} h={3}" -f $json.tray.x,$json.tray.y,$json.tray.width,$json.tray.height)
Write-Host ("Display       : id={0}  scale={1}" -f $json.display.id,$json.display.scaleFactor)
Write-Host ("  bounds      : {0},{1},{2},{3}" -f $json.display.bounds.x,$json.display.bounds.y,$json.display.bounds.width,$json.display.bounds.height)
Write-Host ("  workArea    : {0},{1},{2},{3}" -f $json.display.workArea.x,$json.display.workArea.y,$json.display.workArea.width,$json.display.workArea.height)
Write-Host ("Calculated    : x={0} y={1}" -f $json.calculatedPos.x,$json.calculatedPos.y)
foreach ($s in $json.windowSamples) {
  $b = $s.bounds
  Write-Host ("Actual @{0,4}ms : x={1} y={2} w={3} h={4}" -f $s.at,$b.x,$b.y,$b.width,$b.height)
}
Write-Host ""
Write-Host "--- Win32 ---"
if ($appRect) {
  Write-Host ("App window    : L={0} T={1} R={2} B={3}" -f $appRect.Left,$appRect.Top,$appRect.Right,$appRect.Bottom)
} else {
  Write-Host "App window    : HWND not found (title='$AppTitle')" -ForegroundColor Yellow
}
Write-Host "Taskbar rects :"
if ($taskbars.Count -eq 0) {
  Write-Host "  (none)"
} else {
  foreach ($tb in $taskbars) {
    $r = $tb.Rect
    Write-Host ("  {0,-28}: L={1} T={2} R={3} B={4}" -f $tb.Name,$r.Left,$r.Top,$r.Right,$r.Bottom)
  }
}

# ── Verdict ───────────────────────────────────────────────────────────────────
Write-Host ""
$verdict = 'PASS'; $exitCode = 0

if (-not $appRect) {
  Write-Host "WARN: App HWND not found; falling back to Electron data" -ForegroundColor Yellow
  $last = $json.windowSamples | Select-Object -Last 1
  if ($last) {
    $winB = $last.bounds.y + $last.bounds.height
    $waB  = $json.display.workArea.y + $json.display.workArea.height
    if ($winB -gt $waB) {
      Write-Host ("FAIL (fallback): win bottom={0} > workArea bottom={1}  diff={2}px" -f $winB,$waB,($winB-$waB)) -ForegroundColor Red
      $verdict = 'FAIL'; $exitCode = 1
    }
  }
} else {
  foreach ($tb in $taskbars) {
    $ov = Get-Overlap $appRect $tb.Rect
    if ($ov) {
      Write-Host ("FAIL: overlap with {0}  x={1} y={2} w={3} h={4}  area={5}px" -f $tb.Name,$ov.X,$ov.Y,$ov.W,$ov.H,$ov.Area) -ForegroundColor Red
      $verdict = 'FAIL'; $exitCode = 1
    }
  }
  if ($verdict -eq 'PASS') { Write-Host "Overlap       : none" -ForegroundColor Green }
}

$col = if ($verdict -eq 'PASS') { 'Green' } else { 'Red' }
Write-Host ""
Write-Host "Verdict       : $verdict" -ForegroundColor $col

# ── Cleanup ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[5/5] Cleanup..." -ForegroundColor Gray
taskkill /F /T /PID $proc.Id 2>$null
Start-Sleep -Milliseconds 500
Get-Process -Name 'electron','Electron','Claudicator*' | Stop-Process -Force
Start-Sleep -Milliseconds 300

$rem = netstat -ano 2>$null | Select-String ':5173'
if ($rem) { Write-Host "  WARN: port 5173 still in use" -ForegroundColor Yellow; $rem | ForEach-Object { Write-Host "    $_" } }
else       { Write-Host "  Port 5173: clear" }

Remove-Item env:CLAUDICATOR_AUTO_VERIFY
Write-Host ""
exit $exitCode
