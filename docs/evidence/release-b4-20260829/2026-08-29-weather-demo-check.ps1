param(
  [ValidateSet('normal', 'timeout')]
  [string]$Mode = 'normal'
)

$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:3000'
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$fails = 0

function Invoke-Weather([string]$location) {
  $payload = @{ location = $location } | ConvertTo-Json -Compress
  $requestFile = [System.IO.Path]::GetTempFileName()
  try {
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($requestFile, $payload, $utf8WithoutBom)
    $curlData = "@$requestFile"
    $raw = (& curl.exe -sS -i -X POST "$base/api/v1/assistant/weather" `
      -H 'Content-Type: application/json' `
      --data-binary $curlData | Out-String)
    if ($LASTEXITCODE -ne 0) { throw "curl.exe failed with exit code $LASTEXITCODE" }
  } finally {
    Remove-Item -LiteralPath $requestFile -Force -ErrorAction SilentlyContinue
  }
  $separatorLength = 4
  $separator = $raw.IndexOf("`r`n`r`n")
  if ($separator -lt 0) {
    $separator = $raw.IndexOf("`n`n")
    $separatorLength = 2
  }
  if ($separator -lt 0) { throw 'response has no HTTP/body separator' }
  $headers = $raw.Substring(0, $separator)
  $body = $raw.Substring($separator + $separatorLength).Trim()
  $status = [int]([regex]::Match($headers, 'HTTP/\S+\s+(\d+)').Groups[1].Value)
  $requestId = [regex]::Match($headers, '(?im)^X-Request-Id:\s*(.+)$').Groups[1].Value.Trim()
  return @{ status = $status; requestId = $requestId; headers = $headers; body = $body; json = ($body | ConvertFrom-Json) }
}

function Step([string]$name, [scriptblock]$body) {
  Write-Host "=== $name ===" -ForegroundColor Cyan
  try {
    if (& $body) { Write-Host '  ==>> PASS' -ForegroundColor Green }
    else { Write-Host '  ==>> FAIL' -ForegroundColor Red; $script:fails++ }
  } catch {
    Write-Host "  ERR: $($_.Exception.Message)" -ForegroundColor Red
    $script:fails++
  }
}

Set-Location $root

if ($Mode -eq 'normal') {
  Step 'Real wttr success: Shanghai -> 200 Weather envelope' {
    $r = Invoke-Weather 'Shanghai'
    Write-Host "  HTTP=$($r.status) X-Request-Id=$($r.requestId) body=$($r.body)"
    $r.status -eq 200 -and $r.requestId -eq [string]$r.json.requestId `
      -and $r.json.data.location -is [string] `
      -and $r.json.data.description -is [string] `
      -and $r.json.data.tempC -is [double] `
      -and $r.json.data.location.Length -gt 0 `
      -and $r.json.data.description.Length -gt 0 `
      -and $r.body -notmatch 'current_condition|nearest_area|weatherDesc'
  }

  Step 'Real wttr invalid location -> 422 stable error' {
    $r = Invoke-Weather 'this-location-does-not-exist-zzzz-987654'
    Write-Host "  HTTP=$($r.status) X-Request-Id=$($r.requestId) body=$($r.body)"
    $r.status -eq 422 -and $r.requestId -eq [string]$r.json.requestId `
      -and $r.json.error.code -eq 'INVALID_LOCATION' `
      -and $r.json.error.message -eq 'Invalid location' `
      -and $r.body -notmatch 'location not found|wttr.in|stack|Error'
  }
} else {
  Step 'Real wttr timeout: WEATHER_TIMEOUT_MS=1 -> 503 stable error' {
    $r = Invoke-Weather 'Shanghai'
    Write-Host "  HTTP=$($r.status) X-Request-Id=$($r.requestId) body=$($r.body)"
    $r.status -eq 503 -and $r.requestId -eq [string]$r.json.requestId `
      -and $r.json.error.code -eq 'WEATHER_UNAVAILABLE' `
      -and $r.json.error.message -eq 'Weather service is unavailable' `
      -and $r.body -notmatch 'wttr.in|Abort|timeout|stack|Error'
  }
}

Write-Host ''
if ($fails -eq 0) { Write-Host 'ALL SCENARIOS PASSED' -ForegroundColor Green; exit 0 }
Write-Host "$fails SCENARIO(S) FAILED" -ForegroundColor Red
exit 1
