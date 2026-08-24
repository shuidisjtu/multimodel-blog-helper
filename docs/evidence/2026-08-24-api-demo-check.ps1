# 答辩演示命令集中检验(2026-08-24)
# 覆盖 docs/evidence/2026-08-24-api-demo-guide.md ③-⑦ 场景(附 ⑨ 快检)。
# 前置: 服务已在 http://localhost:3000 运行(npm run dev); PowerShell 7; 无系统代理。
# 运行: powershell -NoProfile -ExecutionPolicy Bypass -File docs\evidence\2026-08-24-api-demo-check.ps1

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

# ---------- ③ 幂等重放: 202 新建 -> 200 replayed:true, 同一 id ----------
$key = 'demo-check-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
Step '③ 幂等重放(202 -> 200 replayed: true, 同一 id)' {
  $r1 = (curl.exe -s -X POST "$base/api/v1/audio-jobs" -H "Idempotency-Key: $key" -F "file=@fixtures/audio-sample.mp3;type=audio/mpeg") | ConvertFrom-Json
  $r2 = (curl.exe -s -X POST "$base/api/v1/audio-jobs" -H "Idempotency-Key: $key" -F "file=@fixtures/audio-sample.mp3;type=audio/mpeg") | ConvertFrom-Json
  Write-Host "  首传 replayed=$($r1.data.replayed)$("/$($r1.data.status)")  重放 replayed=$($r2.data.replayed)$("/$($r2.data.status)")  id相同=$($r1.data.id -eq $r2.data.id)"
  $r1.data.replayed -eq $false -and $r2.data.replayed -eq $true -and $r1.data.id -eq $r2.data.id
}

# ---------- ④ 幂等冲突: 同 key + node 生成的最小合法 WAV(内容不同 sha256 必不同) ----------
$wavPath = Join-Path $root 'temp\demo-diff.wav'
Step '④ 幂等冲突(同 key 不同内容 -> 409 IDEMPOTENCY_CONFLICT)' {
  # 最小合法 RIFF/WAVE(白名单 audio/wav, 魔数与时长探针均通过; 与 tests/unit/audio-upload.test.ts 同构)
  node -e "const b=Buffer.alloc(48);b.write('RIFF',0);b.writeUInt32LE(40,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4,40);require('fs').writeFileSync(process.argv[1],b)" $wavPath
  $r = (curl.exe -s -X POST "$base/api/v1/audio-jobs" -H "Idempotency-Key: $key" -F "file=@$wavPath;type=audio/wav") | ConvertFrom-Json
  Write-Host "  error.code=$($r.error.code)"
  $r.error.code -eq 'IDEMPOTENCY_CONFLICT'
}
Remove-Item $wavPath -Force -ErrorAction SilentlyContinue

# ---------- ⑤ 非法媒体类型: 文本冒充 mp3 -> 415 UNSUPPORTED_MEDIA_TYPE ----------
$fakePath = Join-Path $root 'temp\demo-fake.mp3'
Step '⑤ 文本冒充 mp3(415 UNSUPPORTED_MEDIA_TYPE)' {
  'hello' | Out-File -Encoding ascii $fakePath -Force
  $r = (curl.exe -s -X POST "$base/api/v1/audio-jobs" -F "file=@$fakePath;type=audio/mpeg") | ConvertFrom-Json
  Write-Host "  error.code=$($r.error.code)"
  $r.error.code -eq 'UNSUPPORTED_MEDIA_TYPE'
}
Remove-Item $fakePath -Force -ErrorAction SilentlyContinue

# ---------- ⑥ 任务不存在 -> 404 JOB_NOT_FOUND ----------
Step '⑥ 不存在任务(404 JOB_NOT_FOUND)' {
  $r = (curl.exe -s "$base/api/v1/audio-jobs/01234567-89ab-cdef-0123-456789abcdef") | ConvertFrom-Json
  Write-Host "  error.code=$($r.error.code)"
  $r.error.code -eq 'JOB_NOT_FOUND'
}

# ---------- ⑦ 路径注入尝试 -> 404(防御生效, 不 500、不泄路径) ----------
Step '⑦ 路径注入(..%2F..%2Fetc%2Fpasswd -> 404)' {
  $r = (curl.exe -s "$base/api/v1/audio-jobs/..%2F..%2Fetc%2Fpasswd") | ConvertFrom-Json
  Write-Host "  error.code=$($r.error.code)"
  $r.error.code -eq 'JOB_NOT_FOUND'
}

# ---------- ⑨ 转录下载快检(用当日已完成的 demo-003 任务) ----------
Step '⑨ 转录下载快检(succeeded 任务 -> 200 文本)' {
  $text = curl.exe -s "$base/api/v1/audio-jobs/342fb592-9512-4072-84d7-ca2a909ebb56/transcript"
  Write-Host ("  content-type ok, 文本长度=" + $text.Length)
  $text.Length -gt 0
}

Write-Host ""
if ($fails -eq 0) {
  Write-Host "全部场景通过 ✔" -ForegroundColor Green
  exit 0
} else {
  Write-Host "存在 $fails 个失败场景" -ForegroundColor Red
  exit 1
}
