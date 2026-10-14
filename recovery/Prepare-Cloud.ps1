$ErrorActionPreference = 'Stop'
$reaRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$env:RUNNER_TEMP) { throw 'This preparation script runs in GitHub Actions.' }
node (Join-Path $PSScriptRoot 'Fetch-Archive.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Artifact preservation failed.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Expand-ReaRootZip([string]$Archive, [string]$Target) {
  [System.IO.Directory]::CreateDirectory($Target) | Out-Null
  $reaAllowed = [System.IO.Path]::GetFullPath($Target) + [System.IO.Path]::DirectorySeparatorChar
  $reaZip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    $reaPrefix = $reaZip.Entries[0].FullName.Split('/')[0] + '/'
    foreach ($reaEntry in $reaZip.Entries) {
      if (!$reaEntry.FullName.StartsWith($reaPrefix)) { throw 'Archive root mismatch.' }
      $reaRelative = $reaEntry.FullName.Substring($reaPrefix.Length)
      if (!$reaRelative) { continue }
      $reaOutput = [System.IO.Path]::GetFullPath((Join-Path $Target $reaRelative))
      if (!$reaOutput.StartsWith($reaAllowed, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path outside target.' }
      if ($reaEntry.FullName.EndsWith('/')) { [System.IO.Directory]::CreateDirectory($reaOutput) | Out-Null }
      else {
        [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($reaOutput)) | Out-Null
        if (!(Test-Path -LiteralPath $reaOutput)) { [System.IO.Compression.ZipFileExtensions]::ExtractToFile($reaEntry, $reaOutput, $false) }
      }
    }
  } finally { $reaZip.Dispose() }
}
$reaSourceZip = Join-Path $reaRoot 'archives/rea-source-96e7c22a9cc917448ed080e11cde4dacd2a2d70a.zip'
Expand-ReaRootZip $reaSourceZip (Join-Path $reaRoot 'REA')
$reaTree = Get-Content -Raw -LiteralPath (Join-Path $reaRoot 'provenance/upstream-tree.json') | ConvertFrom-Json
$reaChecked = 0
foreach ($reaEntry in $reaTree.tree | Where-Object { $_.type -eq 'blob' }) {
  $reaFile = Join-Path (Join-Path $reaRoot 'REA') $reaEntry.path
  $reaBytes = [System.IO.File]::ReadAllBytes($reaFile)
  $reaHeader = [System.Text.Encoding]::UTF8.GetBytes(('blob ' + $reaBytes.Length + [char]0))
  $reaSha = [System.Security.Cryptography.SHA1]::HashData([byte[]]($reaHeader + $reaBytes))
  $reaIdentity = [Convert]::ToHexString($reaSha).ToLowerInvariant()
  if ($reaIdentity -ne $reaEntry.sha -and $reaEntry.path.EndsWith('.cmd')) {
    $reaBytes = [System.Text.Encoding]::UTF8.GetBytes([System.Text.Encoding]::UTF8.GetString($reaBytes).Replace("`r`n", "`n"))
    $reaHeader = [System.Text.Encoding]::UTF8.GetBytes(('blob ' + $reaBytes.Length + [char]0))
    $reaIdentity = [Convert]::ToHexString([System.Security.Cryptography.SHA1]::HashData([byte[]]($reaHeader + $reaBytes))).ToLowerInvariant()
  }
  if ($reaIdentity -ne $reaEntry.sha) { throw ('Source identity mismatch: ' + $reaEntry.path) }
  $reaChecked++
}
if ($reaChecked -ne 3722) { throw 'Source file count mismatch.' }
$reaTools = Join-Path $env:RUNNER_TEMP 'rea-portable-tools'
[System.IO.Directory]::CreateDirectory($reaTools) | Out-Null
$reaNodeDir = Join-Path $reaTools 'node'
$reaNpmDir = Join-Path $reaTools 'npm'
Expand-ReaRootZip (Join-Path $reaRoot 'runtimes/node-v24.18.0-win-x64.zip') $reaNodeDir
[System.IO.Directory]::CreateDirectory($reaNpmDir) | Out-Null
tar -xzf (Join-Path $reaRoot 'runtimes/npm-11.16.0.tgz') -C $reaNpmDir --strip-components=1
if ($LASTEXITCODE -ne 0) { throw 'npm extraction failed.' }
$reaCacheSource = Join-Path $env:RUNNER_TEMP 'rea-cache-source'
Expand-ReaRootZip $reaSourceZip $reaCacheSource
$env:PATH = $reaNodeDir + ';' + $env:PATH
$env:HUSKY = '0'
$env:npm_config_audit = 'false'
$env:npm_config_fund = 'false'
$env:npm_config_update_notifier = 'false'
Push-Location $reaCacheSource
try {
  & (Join-Path $reaNodeDir 'node.exe') (Join-Path $reaNpmDir 'bin/npm-cli.js') ci --ignore-scripts --cache (Join-Path $reaRoot 'npm-cache') --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Preparing fixed dependency cache failed.' }
} finally { Pop-Location }
& (Join-Path $reaNodeDir 'node.exe') (Join-Path $PSScriptRoot 'Verify-Local.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Local artifact content verification failed.' }
Write-Output ('Preserved source files: ' + $reaChecked)
