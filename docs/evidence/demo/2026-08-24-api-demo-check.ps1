# One-shot API demo verification (2026-08-24)
# Covers steps 3-7 of docs/evidence/demo/2026-08-24-api-demo-guide.md (plus a quick check on step 9).
# Prereqs: service running at http://localhost:3000 (npm run dev); PowerShell 7 (pwsh); no system proxy.
# Usage:  pwsh -NoProfile -ExecutionPolicy Bypass -File docs\evidence\demo\2026-08-24-api-demo-check.ps1

$ErrorActionPreference = 'Stop'
$base  = 'http://localhost:3000'
$root  = 'D:\ClaudeCodeProject\Multimodel_Blog_Helper'
$fails = 0

function Step([string]$name, [scriptblock]$body) {
  Write-Host "=== $name ===" -ForegroundColor Cyan
  try {
    $ok = & $body
  } catch {
    Write-Host "  ERR: $($_.Exception.Message)" -ForegroundColor Red
    $script:fails++
    return
  }
  if ($ok -eq $true) {
    Write-Host "  ==>> PASS" -ForegroundColor Green
  } else {
    Write-Host "  ==>> FAIL" -ForegroundColor Red
    $script:fails++
  }
}

Set-Location $root

# ---------- Step 3: idempotent replay (202 create -> 200 replayed: true, same id) ----------
$key = 'demo-check-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
Step 'Step 3: idempotent replay (202 -> 200 replayed: true, same id)' {
  $r1 = (curl.exe -s -X POST "$base/api/v1/audio-jobs" -H "Idempotency-Key: $key" -F "file=@fixtures/audio-sample.mp3;type=audio/mpeg") | ConvertFrom-Json
  $r2 = (curl.exe -s -X POST "$base/api/v1/audio-jobs" -H "Idempotency-Key: $key" -F "file=@fixtures/audio-sample.mp3;type=audio/mpeg") | ConvertFrom-Json
  Write-Host "  first replayed=$($r1.data.replayed)$("/$($r1.data.status)")  replay replayed=$($r2.data.replayed)$("/$($r2.data.status)")  sameId=$($r1.data.id -eq $r2.data.id)"
  $r1.data.replayed -eq $false -and $r2.data.replayed -eq $true -and $r1.data.id -eq $r2.data.id
}

# ---------- Step 4: idempotency conflict (same key + different content -> 409) ----------
$wavPath = Join-Path $root 'temp\demo-diff.wav'
Step 'Step 4: idempotency conflict (same key, different content -> 409 IDEMPOTENCY_CONFLICT)' {
  # Minimal valid RIFF/WAVE (whitelisted audio/wav; magic bytes and duration probe pass;
  # mirrors tests/unit/audio-upload.test.ts). Written whole by node since appended/write
  # operations on copied .mp3 files got denied in some environments.
  node -e "const b=Buffer.alloc(48);b.write('RIFF',0);b.writeUInt32LE(40,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4,40);require('fs').writeFileSync(process.argv[1],b)" $wavPath
  $r = (curl.exe -s -X POST "$base/api/v1/audio-jobs" -H "Idempotency-Key: $key" -F "file=@$wavPath;type=audio/wav") | ConvertFrom-Json
  Write-Host "  error.code=$($r.error.code)"
  $r.error.code -eq 'IDEMPOTENCY_CONFLICT'
}
Remove-Item $wavPath -Force -ErrorAction SilentlyContinue

# ---------- Step 5: invalid media type (text pretending mp3 -> 415) ----------
$fakePath = Join-Path $root 'temp\demo-fake.mp3'
Step 'Step 5: text file as mp3 (415 UNSUPPORTED_MEDIA_TYPE)' {
  'hello' | Out-File -Encoding ascii $fakePath -Force
  $r = (curl.exe -s -X POST "$base/api/v1/audio-jobs" -F "file=@$fakePath;type=audio/mpeg") | ConvertFrom-Json
  Write-Host "  error.code=$($r.error.code)"
  $r.error.code -eq 'UNSUPPORTED_MEDIA_TYPE'
}
Remove-Item $fakePath -Force -ErrorAction SilentlyContinue

# ---------- Step 6: nonexistent job -> 404 JOB_NOT_FOUND ----------
Step 'Step 6: nonexistent job (404 JOB_NOT_FOUND)' {
  $r = (curl.exe -s "$base/api/v1/audio-jobs/01234567-89ab-cdef-0123-456789abcdef") | ConvertFrom-Json
  Write-Host "  error.code=$($r.error.code)"
  $r.error.code -eq 'JOB_NOT_FOUND'
}

# ---------- Step 7: path traversal attempt -> 404 (defense active; no 500, no path leak) ----------
Step 'Step 7: path traversal (..%2F..%2Fetc%2Fpasswd -> 404)' {
  $r = (curl.exe -s "$base/api/v1/audio-jobs/..%2F..%2Fetc%2Fpasswd") | ConvertFrom-Json
  Write-Host "  error.code=$($r.error.code)"
  $r.error.code -eq 'JOB_NOT_FOUND'
}

# ---------- Step 9 quick check: transcript download (succeeded job -> 200 text) ----------
Step 'Step 9: transcript download (succeeded job -> 200 text)' {
  $text = curl.exe -s "$base/api/v1/audio-jobs/342fb592-9512-4072-84d7-ca2a909ebb56/transcript"
  Write-Host ("  text length=" + $text.Length)
  $text.Length -gt 0
}

Write-Host ""
if ($fails -eq 0) {
  Write-Host "ALL SCENARIOS PASSED" -ForegroundColor Green
  exit 0
} else {
  Write-Host "$fails SCENARIO(S) FAILED" -ForegroundColor Red
  exit 1
}
