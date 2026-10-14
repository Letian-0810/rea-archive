$ErrorActionPreference = 'Stop'
$reaRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$env:RUNNER_TEMP -or !$env:GITHUB_REPOSITORY) { throw 'This check runs in GitHub Actions.' }
$reaCommit = (git rev-parse HEAD).Trim()
$reaFresh = Join-Path $env:RUNNER_TEMP ('rea-fresh-' + $env:GITHUB_RUN_ID)
$reaRestored = Join-Path $env:RUNNER_TEMP ('rea-recovered-' + $env:GITHUB_RUN_ID)
if ((Test-Path -LiteralPath $reaFresh) -or (Test-Path -LiteralPath $reaRestored)) { throw 'Verification destinations already exist.' }
git -c core.autocrlf=false clone --depth 1 ('https://github.com/' + $env:GITHUB_REPOSITORY + '.git') $reaFresh
if ($LASTEXITCODE -ne 0) { throw 'Fresh clone from user repository failed.' }
$reaFreshCommit = (git -C $reaFresh rev-parse HEAD).Trim()
if ($reaFreshCommit -ne $reaCommit) { throw 'Fresh clone does not match published backup commit.' }
try { & (Join-Path $reaFresh 'recovery/Restore-Local.ps1') -Destination $reaRestored }
catch {
  foreach ($reaLogName in @('offline-install.log', 'offline-build.log', 'native-artifact.log', 'mcp-server.stderr')) {
    $reaLogPath = Join-Path $reaRestored ('verification/' + $reaLogName)
    if (Test-Path -LiteralPath $reaLogPath) { Get-Content -LiteralPath $reaLogPath -Tail 100 | Write-Output }
  }
  throw
}
if ($LASTEXITCODE -ne 0) { throw 'Offline restore from fresh user repository clone failed.' }
$reaNode = Join-Path $reaRestored 'runtime/node.exe'
& $reaNode (Join-Path $reaFresh 'recovery/Verify-Local.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Fresh clone content identity verification failed.' }
$reaProof = Get-Content -Raw -LiteralPath (Join-Path $reaRestored 'verification/result.json') | ConvertFrom-Json
if (!$reaProof.passed) { throw 'Recovered functionality did not pass.' }
$reaProof.source = '<RESTORED_DIRECTORY>/source'
$reaReceipt = [ordered]@{
  passed = $true
  user_repository = $env:GITHUB_REPOSITORY
  published_backup_commit = $reaCommit
  verified_fresh_clone_commit = $reaFreshCommit
  restored_from_user_repository = $true
  dependency_install_offline = $true
  original_repository_used_during_recovery = $false
  workflow_run = ('https://github.com/' + $env:GITHUB_REPOSITORY + '/actions/runs/' + $env:GITHUB_RUN_ID)
  functional_result = $reaProof
}
$reaProofDirectory = Join-Path $reaRoot 'verification/github-restore'
[System.IO.Directory]::CreateDirectory($reaProofDirectory) | Out-Null
$reaReceipt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $reaProofDirectory 'result.json') -Encoding utf8
Copy-Item -LiteralPath (Join-Path $reaFresh 'verification/local-integrity.json') -Destination (Join-Path $reaProofDirectory 'content-integrity.json')
Write-Output 'Fresh user repository clone, offline installation, source build, and CLI/MCP checks passed.'
