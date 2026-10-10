# curlui one-line installer for Windows.
#
#   irm https://raw.githubusercontent.com/holihur/curlui/main/install.ps1 | iex
#
# Environment overrides:
#   CURLUI_VERSION      install a specific tag (e.g. v1.3.0)
#   CURLUI_INSTALL_DIR  target directory (default: %LOCALAPPDATA%\curlui)
$ErrorActionPreference = "Stop"

$repo = "holihur/curlui"

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64") {
    "arm64"
} elseif ([Environment]::Is64BitOperatingSystem) {
    "amd64"
} else {
    throw "unsupported architecture (32-bit Windows)"
}

$version = $env:CURLUI_VERSION
if (-not $version) {
    Write-Host "Resolving the latest release ..."
    $release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
    $version = $release.tag_name
}
if (-not $version) { throw "could not determine the latest version (set CURLUI_VERSION)" }

$asset = "curlui_${version}_windows_${arch}.exe"
$url = "https://github.com/$repo/releases/download/$version/$asset"

$dir = if ($env:CURLUI_INSTALL_DIR) { $env:CURLUI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "curlui" }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$dest = Join-Path $dir "curlui.exe"

Write-Host "Downloading $asset ..."
Invoke-WebRequest -Uri $url -OutFile $dest

Write-Host ""
Write-Host "  curlui $version installed to $dest"
Write-Host ""

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$dir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$dir", "User")
    Write-Host "  note: added $dir to your user PATH (restart your terminal to use it)"
    Write-Host ""
}

try { & $dest -version } catch {}
Write-Host "Run it with:  curlui -addr :8080   then open http://localhost:8080"
