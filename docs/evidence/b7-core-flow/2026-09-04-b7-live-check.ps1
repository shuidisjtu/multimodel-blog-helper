param(
  [string]$BaseUrl = 'http://localhost:3000',
  [string]$AudioPath = ''
)

# Optional real-service smoke check for B7. This script is not the CI gate.
# It never prints OPENAI_API_KEY or any other secret.
$ErrorActionPreference = 'Stop'
$fails = 0

if ([string]::IsNullOrWhiteSpace($AudioPath)) {
  $AudioPath = Join-Path $PSScriptRoot '..\..\..\fixtures\audio-sample.mp3'
}
$AudioPath = (Resolve-Path -LiteralPath $AudioPath).Path

function Step([string]$Name, [scriptblock]$Body) {
  Write-Host "=== $Name ===" -ForegroundColor Cyan
  try {
    $result = & $Body
    if ($result -eq $true) {
      Write-Host '  PASS' -ForegroundColor Green
    } else {
      Write-Host '  FAIL' -ForegroundColor Red
      $script:fails++
    }
  } catch {
    Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    $script:fails++
  }
}

function Invoke-CheckedRequest([hashtable]$Parameters) {
  $response = Invoke-WebRequest @Parameters -SkipHttpErrorCheck
  [pscustomobject]@{
    Status = [int]$response.StatusCode
    Body = [string]$response.Content
    Headers = $response.Headers
  }
}

$key = 'b7-live-' + [guid]::NewGuid().ToString('N')
$jobId = $null

Step 'Upload fixture and receive 202' {
  $response = Invoke-CheckedRequest @{
    Uri = "$BaseUrl/api/v1/audio-jobs"
    Method = 'Post'
    Headers = @{ 'Idempotency-Key' = $key }
    Form = @{ file = Get-Item -LiteralPath $AudioPath }
  }
  $body = $response.Body | ConvertFrom-Json
  $script:jobId = [string]$body.data.id
  Write-Host "  status=$($response.Status) jobId=$($script:jobId)"
  $response.Status -eq 202 -and $body.data.status -eq 'queued' -and $script:jobId.Length -gt 0
}

Step 'Poll job to succeeded or failed' {
  if ([string]::IsNullOrWhiteSpace($script:jobId)) { return $false }
  $deadline = [DateTime]::UtcNow.AddMinutes(3)
  do {
    Start-Sleep -Milliseconds 500
    $response = Invoke-CheckedRequest @{
      Uri = "$BaseUrl/api/v1/audio-jobs/$($script:jobId)"
      Method = 'Get'
    }
    $body = $response.Body | ConvertFrom-Json
    $status = [string]$body.data.status
    Write-Host "  status=$status"
    if ($status -eq 'succeeded') {
      Write-Host "  summary=$($body.data.summary)"
      return $true
    }
    if ($status -eq 'failed') { return $false }
  } while ([DateTime]::UtcNow -lt $deadline)
  return $false
}

Step 'Download transcript' {
  if ([string]::IsNullOrWhiteSpace($script:jobId)) { return $false }
  $response = Invoke-CheckedRequest @{
    Uri = "$BaseUrl/api/v1/audio-jobs/$($script:jobId)/transcript"
    Method = 'Get'
  }
  Write-Host "  status=$($response.Status) transcriptLength=$($response.Body.Length)"
  $response.Status -eq 200 -and $response.Body.Length -gt 0
}

Step 'Query real weather' {
  $response = Invoke-CheckedRequest @{
    Uri = "$BaseUrl/api/v1/assistant/weather"
    Method = 'Post'
    ContentType = 'application/json'
    Body = (@{ location = 'Shanghai' } | ConvertTo-Json -Compress)
  }
  $body = $response.Body | ConvertFrom-Json
  Write-Host "  status=$($response.Status) location=$($body.data.location) tempC=$($body.data.tempC)"
  $response.Status -eq 200 -and $body.data.location.Length -gt 0
}

if ($fails -eq 0) {
  Write-Host 'ALL OPTIONAL LIVE SCENARIOS PASSED' -ForegroundColor Green
  exit 0
}
Write-Host "$fails OPTIONAL LIVE SCENARIO(S) FAILED" -ForegroundColor Red
exit 1
