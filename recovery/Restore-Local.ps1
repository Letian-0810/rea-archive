[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Destination)

$ErrorActionPreference = 'Stop'
$reaBundleRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$reaDestination = [System.IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $reaDestination) { throw 'Destination must not exist; recovery never overwrites an existing directory.' }
$reaManifest = Get-Content -Raw -LiteralPath (Join-Path $reaBundleRoot 'provenance\archives.json') | ConvertFrom-Json
foreach ($reaArtifact in $reaManifest.artifacts) {
  $reaInput = Join-Path $reaBundleRoot $reaArtifact.file
  $reaActual = (Get-FileHash -LiteralPath $reaInput -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($reaActual -ne $reaArtifact.sha256) { throw ('Archive checksum mismatch: ' + $reaArtifact.file) }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Formats.Tar
function Expand-ReaZip {
  param([string]$Archive, [string]$Target, [bool]$StripRoot)
  [System.IO.Directory]::CreateDirectory($Target) | Out-Null
  $reaAllowedRoot = [System.IO.Path]::GetFullPath($Target) + [System.IO.Path]::DirectorySeparatorChar
  $reaZip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    $reaPrefix = if ($StripRoot) { $reaZip.Entries[0].FullName.Split('/')[0] + '/' } else { '' }
    foreach ($reaEntry in $reaZip.Entries) {
      if ($StripRoot -and !$reaEntry.FullName.StartsWith($reaPrefix)) { throw 'Archive has multiple roots.' }
      $reaRelative = $reaEntry.FullName.Substring($reaPrefix.Length)
      if (!$reaRelative) { continue }
      $reaOutput = [System.IO.Path]::GetFullPath((Join-Path $Target $reaRelative))
      if (!$reaOutput.StartsWith($reaAllowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path escapes destination.' }
      if ($reaEntry.FullName.EndsWith('/')) { [System.IO.Directory]::CreateDirectory($reaOutput) | Out-Null }
      else {
        [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($reaOutput)) | Out-Null
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($reaEntry, $reaOutput, $false)
      }
    }
  } finally { $reaZip.Dispose() }
}

function Expand-ReaPortableTar {
  param([string]$Archive, [string]$Target, [bool]$StripRoot, [bool]$SkipPosixFixtures)
  [System.IO.Directory]::CreateDirectory($Target) | Out-Null
  $reaAllowedRoot = [System.IO.Path]::GetFullPath($Target) + [System.IO.Path]::DirectorySeparatorChar
  $reaInput = [System.IO.File]::OpenRead($Archive)
  $reaGzip = [System.IO.Compression.GZipStream]::new($reaInput, [System.IO.Compression.CompressionMode]::Decompress)
  $reaTar = [System.Formats.Tar.TarReader]::new($reaGzip)
  try {
    while ($null -ne ($reaEntry = $reaTar.GetNextEntry())) {
      $reaRelative = $reaEntry.Name
      if ($StripRoot) {
        $reaSlash = $reaRelative.IndexOf('/')
        if ($reaSlash -lt 0) { continue }
        $reaRelative = $reaRelative.Substring($reaSlash + 1)
      }
      if (!$reaRelative) { continue }
      if ($SkipPosixFixtures -and ($reaRelative -eq 'tests/integration/' -or $reaRelative.StartsWith('tests/integration/'))) { continue }
      $reaOutput = [System.IO.Path]::GetFullPath((Join-Path $Target $reaRelative))
      if (!$reaOutput.StartsWith($reaAllowedRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Tar entry escapes destination.' }
      if ($reaEntry.EntryType -eq [System.Formats.Tar.TarEntryType]::Directory) {
        [System.IO.Directory]::CreateDirectory($reaOutput) | Out-Null
      } elseif ($reaEntry.EntryType -eq [System.Formats.Tar.TarEntryType]::RegularFile -or $reaEntry.EntryType -eq [System.Formats.Tar.TarEntryType]::V7RegularFile) {
        [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($reaOutput)) | Out-Null
        $reaOutputStream = [System.IO.File]::Create($reaOutput)
        try { if ($null -ne $reaEntry.DataStream) { $reaEntry.DataStream.CopyTo($reaOutputStream) } }
        finally { $reaOutputStream.Dispose() }
      } else { throw ('Unsupported tar entry outside preserved POSIX fixture tree: ' + $reaRelative) }
    }
  } finally { $reaTar.Dispose(); $reaGzip.Dispose(); $reaInput.Dispose() }
}

New-Item -ItemType Directory -Path $reaDestination | Out-Null
$reaLogs = Join-Path $reaDestination 'verification'
New-Item -ItemType Directory -Path $reaLogs | Out-Null
foreach ($reaArtifact in $reaManifest.artifacts | Where-Object { $_.stage -eq 'source' }) {
  $reaInput = Join-Path $reaBundleRoot $reaArtifact.file
  $reaOutput = Join-Path $reaDestination $reaArtifact.target
  if ($reaArtifact.format -eq 'zip') { Expand-ReaZip $reaInput $reaOutput ([bool]$reaArtifact.stripRoot) }
  else {
    Expand-ReaPortableTar $reaInput $reaOutput ([bool]$reaArtifact.stripRoot) ([bool]$reaArtifact.excludeOnWindows)
  }
}

$reaSource = Join-Path $reaDestination 'source'
$reaNodeRoot = Join-Path $reaDestination 'runtime'
$reaNode = Join-Path $reaNodeRoot 'node.exe'
$reaNpm = Join-Path $reaDestination 'npm\bin\npm-cli.js'
$env:PATH = $reaNodeRoot + ';' + $env:PATH
$env:HUSKY = '0'
$env:TURBO_TELEMETRY_DISABLED = '1'
$env:npm_config_offline = 'true'
$env:npm_config_audit = 'false'
$env:npm_config_fund = 'false'
$env:npm_config_update_notifier = 'false'
& $reaNode (Join-Path $PSScriptRoot 'Apply-Patches.mjs') $reaSource
if ($LASTEXITCODE -ne 0) { throw 'Local compatibility patch verification failed.' }
Push-Location $reaSource
try {
  & $reaNode $reaNpm ci --offline --ignore-scripts --cache (Join-Path $reaBundleRoot 'npm-cache') --no-audit --no-fund *> (Join-Path $reaLogs 'offline-install.log')
  if ($LASTEXITCODE -ne 0) { throw ('Offline install failed; see ' + (Join-Path $reaLogs 'offline-install.log')) }
  foreach ($reaArtifact in $reaManifest.artifacts | Where-Object { $_.stage -eq 'after-install' }) {
    $reaOutput = Join-Path $reaDestination $reaArtifact.target
    Expand-ReaPortableTar (Join-Path $reaBundleRoot $reaArtifact.file) $reaOutput $false $false
  }
  & $reaNode $reaNpm run build:cached *> (Join-Path $reaLogs 'offline-build.log')
  if ($LASTEXITCODE -ne 0) { throw ('Offline build failed; see ' + (Join-Path $reaLogs 'offline-build.log')) }
  & $reaNode scripts/verify-windows-native-artifact.mjs *> (Join-Path $reaLogs 'native-artifact.log')
  if ($LASTEXITCODE -ne 0) { throw 'Windows native artifact verification failed.' }
  & $reaNode (Join-Path $PSScriptRoot 'Verify-Recovered.mjs') $reaDestination
  if ($LASTEXITCODE -ne 0) { throw 'Recovered CLI/MCP functional verification failed.' }
} finally { Pop-Location }
Write-Output ('Recovered and verified locally: ' + $reaDestination)
