param(
  [string]$ReleaseNotes = "Bug fixes and improvements."
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$tauriConfigPath = Join-Path $projectRoot "src-tauri\tauri.conf.json"
$tauriConfig = Get-Content $tauriConfigPath -Raw | ConvertFrom-Json
$version = $tauriConfig.version
$tag = "v$version"
$keyPath = Join-Path $env:LOCALAPPDATA "Realty Cockpit\updater.key"

if (-not (Test-Path $keyPath -PathType Leaf)) {
  throw "The updater signing key is missing at $keyPath. Do not generate a replacement for an existing release channel."
}

$bundleRoot = Join-Path $projectRoot "src-tauri\target\release\bundle"
$nsisPath = Join-Path $bundleRoot "nsis\Realty Cockpit_${version}_x64-setup.exe"
$msiPath = Join-Path $bundleRoot "msi\Realty Cockpit_${version}_x64_en-US.msi"
$nsisSignaturePath = "$nsisPath.sig"
$msiSignaturePath = "$msiPath.sig"
$releaseDirectory = Join-Path $projectRoot "src-tauri\target\release\updater-assets-$version"

if (Test-Path $releaseDirectory) {
  throw "The output directory already exists: $releaseDirectory. Move or rename it before preparing this release."
}

$oldSigningKey = $env:TAURI_SIGNING_PRIVATE_KEY
$oldSigningPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
Push-Location $projectRoot
try {
  $env:TAURI_SIGNING_PRIVATE_KEY = $keyPath
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
  npm run tauri build
  if ($LASTEXITCODE -ne 0) {
    throw "Tauri build failed with exit code $LASTEXITCODE."
  }
} finally {
  $env:TAURI_SIGNING_PRIVATE_KEY = $oldSigningKey
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $oldSigningPassword
  Pop-Location
}

foreach ($requiredFile in @($nsisPath, $msiPath, $nsisSignaturePath, $msiSignaturePath)) {
  if (-not (Test-Path $requiredFile -PathType Leaf)) {
    throw "Expected updater artifact was not produced: $requiredFile"
  }
}

New-Item -ItemType Directory -Path $releaseDirectory | Out-Null
Copy-Item @($nsisPath, $msiPath, $nsisSignaturePath, $msiSignaturePath) -Destination $releaseDirectory

$githubInstallerName = (Split-Path $nsisPath -Leaf) -replace " ", "."
$manifest = [ordered]@{
  version = $version
  notes = $ReleaseNotes
  pub_date = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = (Get-Content $nsisSignaturePath -Raw).Trim()
      url = "https://github.com/mumi08843-maker/realty-cockpit/releases/download/$tag/$githubInstallerName"
    }
  }
}

$manifestJson = $manifest | ConvertTo-Json -Depth 6
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
  (Join-Path $releaseDirectory "latest.json"),
  $manifestJson,
  $utf8WithoutBom
)

Write-Host "Release assets prepared in: $releaseDirectory"
Write-Host "Create a GitHub release tagged $tag and upload every file in that folder."
Write-Host "The updater signing key was used locally and was not copied into the release folder."
Get-ChildItem $releaseDirectory | Select-Object Name, Length
