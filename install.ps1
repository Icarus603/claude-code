# install.ps1 — One-shot PowerShell installer for `ccb` (Claude Code by Icarus603).
#
# Windows counterpart to install.sh. Layout mirrors the XDG idea but uses
# Windows-native locations:
#   %LOCALAPPDATA%\Programs\ccb\versions\<version>.exe   ← actual binary
#   %LOCALAPPDATA%\Programs\ccb\bin\ccb.exe              ← copy of current
#
# A copy (not a symlink) is used because creating symlinks on Windows
# requires either Administrator or Developer Mode — neither of which we
# want to demand from a one-line installer. The versions/ directory still
# preserves prior installs so you can roll back manually.
#
# PATH is updated automatically — the installer writes HKCU\Environment\Path
# (user-scope, no admin rights) and patches the current process so the user
# can run `ccb` immediately in the same window. Zero manual steps.
#
# Usage (PowerShell):
#   irm https://raw.githubusercontent.com/Icarus603/claude-code/main/install.ps1 | iex
#
#   # Pin a version:
#   $env:CCB_VERSION='v26.4.24'; irm https://raw.githubusercontent.com/Icarus603/claude-code/main/install.ps1 | iex
#
#   # Custom install root:
#   $env:CCB_PREFIX='C:\Tools\ccb'; irm https://raw.githubusercontent.com/Icarus603/claude-code/main/install.ps1 | iex

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo = 'Icarus603/claude-code'
$RequestedVersion = if ($env:CCB_VERSION) { $env:CCB_VERSION } else { 'latest' }

# Default install location: %LOCALAPPDATA%\Programs (matches VS Code, gh, etc.).
$Prefix = if ($env:CCB_PREFIX) { $env:CCB_PREFIX } else { Join-Path $env:LOCALAPPDATA 'Programs\ccb' }
$BinDir = Join-Path $Prefix 'bin'
$VersionsDir = Join-Path $Prefix 'versions'

function Write-Log   { param($m) Write-Host $m -ForegroundColor Blue }
function Write-Ok    { param($m) Write-Host "[OK] $m" -ForegroundColor Green }
function Write-Warn2 { param($m) Write-Host "[!]  $m" -ForegroundColor Yellow }
function Write-Fatal {
  param($m)
  Write-Host "error: $m" -ForegroundColor Red
  exit 1
}

# ----- platform detection ----------------------------------------------------

function Get-Platform {
  $arch = $env:PROCESSOR_ARCHITECTURE
  # On 32-bit PowerShell running under WoW64 the env var lies. Prefer the
  # native one when available.
  if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }

  switch ($arch) {
    'AMD64' { return 'windows-x64' }
    'ARM64' {
      Write-Fatal 'windows-arm64 is unsupported (Bun has no compile target for it).'
    }
    default {
      Write-Fatal "Unsupported architecture: $arch"
    }
  }
}

# ----- version resolution ----------------------------------------------------

function Resolve-Version {
  if ($RequestedVersion -ne 'latest') { return $RequestedVersion }

  # Hit GitHub's latest-release redirect; the resolved tag lives at the end of
  # the redirect chain (.../releases/tag/v26.4.24). The "final URI" lives in
  # different places depending on the runtime, so we try multiple sources.
  #
  # Multi-path fallback (in order):
  #   1. RequestMessage.RequestUri  — PowerShell 7+ / .NET Core. Available
  #      after Invoke-WebRequest follows redirects.
  #   2. BaseResponse.ResponseUri   — PowerShell 5.1 / .NET Framework. The
  #      legacy property; RequestMessage may be $null on Win PowerShell.
  #   3. Headers.Location           — when redirect is NOT followed
  #      (-MaximumRedirection 0). Single hop; if GitHub adds another
  #      302 in the chain, this needs a manual second request.
  #
  # The previous single-source code (RequestMessage only) silently failed on
  # Windows PowerShell 5.1 because RequestMessage is null there — the whole
  # install fell over with a vague .AbsoluteUri-of-null exception.
  function Get-FinalUriFromResponse {
    param($response)
    # Path 1: PS 7+ / .NET Core
    try {
      $u = $response.BaseResponse.RequestMessage.RequestUri.AbsoluteUri
      if ($u) { return $u }
    } catch { }
    # Path 2: PS 5.1 / .NET Framework legacy
    try {
      $u = $response.BaseResponse.ResponseUri.AbsoluteUri
      if ($u) { return $u }
    } catch { }
    return $null
  }

  $url = "https://github.com/$Repo/releases/latest"

  # First try: follow redirects normally and grab the resolved URI.
  try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -MaximumRedirection 5
    $finalUri = Get-FinalUriFromResponse $resp
    if ($finalUri) {
      $tag = ($finalUri -split '/')[-1]
      if ($tag -and $tag -ne 'latest') { return $tag }
    }
  } catch {
    # Some configurations (corp proxies, restrictive .NET TLS) fail the
    # redirect-follow path. Fall through to the manual Location-header
    # path below before giving up.
  }

  # Second try: don't follow redirects; read the 302 Location header directly.
  # This works even when redirect-following fails, as long as the first hop
  # is reachable.
  try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -MaximumRedirection 0 -ErrorAction Stop
  } catch {
    # Invoke-WebRequest with -MaximumRedirection 0 throws on a 3xx response.
    # The response is attached to the exception.
    $resp = $_.Exception.Response
  }
  if ($resp) {
    # Header access shape depends on the runtime / response type:
    #   PS 7 HttpResponseMessage:  Headers.Location is a Uri property
    #   PS 5.1 HttpWebResponse:    Headers["Location"] indexer returns string
    #   Invoke-WebRequest result:  Headers["Location"] returns string[]
    # Try each shape in order, take whatever resolves first.
    $location = $null

    # Path A: HttpResponseMessage.Headers.Location (PS 7 exception path)
    try {
      $loc = $resp.Headers.Location
      if ($loc) {
        if ($loc -is [System.Uri]) { $location = $loc.AbsoluteUri }
        else { $location = $loc.ToString() }
      }
    } catch { }

    # Path B: indexer access — works for WebHeaderCollection (PS 5.1) and
    # IDictionary<string,string[]> (Invoke-WebRequest .Headers in PS 7).
    if (-not $location) {
      try {
        $loc = $resp.Headers['Location']
        if ($loc) {
          if ($loc -is [array]) { $loc = $loc[0] }
          $location = "$loc"
        }
      } catch { }
    }

    if ($location) {
      $tag = ($location -split '/')[-1]
      if ($tag -and $tag -ne 'latest') { return $tag }
    }
  }

  Write-Fatal "Could not resolve latest version. Try: `$env:CCB_VERSION='vX.Y.Z'"
}

# ----- download helpers ------------------------------------------------------

function Get-DownloadUrl {
  param($version, $platform)
  return "https://github.com/$Repo/releases/download/$version/ccb-$platform.exe"
}

function Invoke-Download {
  param($url, $dest)
  Write-Log "Downloading $url"
  # ProgressPreference='SilentlyContinue' makes Invoke-WebRequest ~10x faster
  # by skipping the live progress bar (well-known PowerShell quirk).
  $oldPref = $ProgressPreference
  $ProgressPreference = 'SilentlyContinue'
  try {
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
  } finally {
    $ProgressPreference = $oldPref
  }
}

# Returns $true on success, $false if the file isn't there. Used for
# optional sidecar files (.sha256).
function Invoke-DownloadQuiet {
  param($url, $dest)
  $oldPref = $ProgressPreference
  $ProgressPreference = 'SilentlyContinue'
  try {
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -ErrorAction Stop | Out-Null
    return $true
  } catch {
    return $false
  } finally {
    $ProgressPreference = $oldPref
  }
}

# ----- PATH management -------------------------------------------------------

# Adds $dir to user-scope PATH (HKCU\Environment\Path) if not already present.
# No admin rights required. Also patches the current process so `ccb` works
# immediately in this same window without restarting PowerShell.
#
# Returns $true if a new entry was added, $false if it was already there.
function Add-ToUserPath {
  param($dir)

  # Read raw user PATH so we don't corrupt entries like %USERPROFILE%.
  # [Environment]::GetEnvironmentVariable with target=User reads from
  # HKCU\Environment unexpanded (REG_EXPAND_SZ-preserving).
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($null -eq $current) { $current = '' }

  # Case-insensitive, trim trailing backslashes for comparison.
  $needle = $dir.TrimEnd('\')
  $alreadyPresent = $false
  foreach ($e in ($current -split ';' | Where-Object { $_ -ne '' })) {
    if ($e.TrimEnd('\') -ieq $needle) {
      $alreadyPresent = $true
      break
    }
  }

  # Always patch the current process — even if user PATH already has it,
  # this PowerShell session may have started before that entry existed.
  if (-not ($env:Path -split ';' | Where-Object { $_.TrimEnd('\') -ieq $needle })) {
    $env:Path = "$env:Path;$dir"
  }

  if ($alreadyPresent) { return $false }

  $newPath = if ($current) { "$current;$dir" } else { $dir }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  return $true
}

# Keep at most this many binaries under VersionsDir after install.
# Matches in-app `VERSION_RETENTION_COUNT` (packages/updater/src/
# nativeInstaller/installer.ts:74). Two = current + one prior for
# rollback.
$Script:KeepVersions = 2

# Delete older binaries from VersionsDir, retaining the just-installed
# one plus enough prior entries to total $KeepVersions. Sort newest
# first by LastWriteTime; skip $KeepVersions files, remove the rest.
# The just-installed path is always protected via -KeepPath.
function Invoke-PruneOldVersions {
  param([Parameter(Mandatory=$true)][string]$KeepPath)

  $dir = Split-Path -Parent $KeepPath
  if (-not (Test-Path -LiteralPath $dir)) { return }

  $entries = Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending
  if (-not $entries) { return }

  $kept = 0
  foreach ($entry in $entries) {
    # Skip transient install artifacts (.partial download, .sha256 sidecar)
    # — they shouldn't count as kept slots and shouldn't be deleted as
    # "old versions". Mirrors install.sh prune_old_versions logic.
    if ($entry.Name -like '*.partial' -or $entry.Name -like '*.sha256') {
      continue
    }
    if ($entry.FullName -ieq $KeepPath) {
      $kept++
      continue
    }
    if ($kept -lt $Script:KeepVersions) {
      $kept++
      continue
    }
    try {
      Remove-Item -LiteralPath $entry.FullName -Force -ErrorAction Stop
      Write-Host "  pruned    -> $($entry.Name)" -ForegroundColor DarkGray
    } catch { }
  }
}

# ----- shim install (Windows file-lock-aware) --------------------------------

# Copy $source over $shim. If $shim is already in use by a running ccb.exe,
# rename it out of the way first (Windows allows renaming a running PE; it
# only blocks delete/overwrite). On copy failure, roll back so the user is
# never left without a working executable.
#
# Also opportunistically prunes leftover *.old.* files from previous installs.
# Those linger when the running ccb.exe holds them open at copy-time; once
# the process exits they become deletable, so we clean them on the next run.
function Install-Shim {
  param(
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$Shim
  )

  # Clean up any stale .old.* leftovers from previous installs first.
  # Safe to ignore failures — a still-running ccb keeps its own .old.* file
  # locked, but we'll catch it next time.
  $shimDir = Split-Path -Parent $Shim
  $shimBase = Split-Path -Leaf $Shim
  Get-ChildItem -LiteralPath $shimDir -Filter "$shimBase.old.*" -ErrorAction SilentlyContinue |
    ForEach-Object {
      try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop }
      catch { }  # still in use — try again on the next install
    }

  if (-not (Test-Path -LiteralPath $Shim)) {
    # Fresh install: nothing to rename, just copy.
    Copy-Item -Force -Path $Source -Destination $Shim
    return
  }

  # Same content? Skip the copy entirely.
  try {
    $srcLen = (Get-Item -LiteralPath $Source).Length
    $dstLen = (Get-Item -LiteralPath $Shim).Length
    if ($srcLen -eq $dstLen) {
      $srcHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Source).Hash
      $dstHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Shim).Hash
      if ($srcHash -eq $dstHash) {
        return
      }
    }
  } catch {
    # If hashing fails for any reason, fall through to the rename-and-copy path.
  }

  # Rename existing shim out of the way (works even when it's running).
  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $oldShim = "$Shim.old.$stamp"
  Rename-Item -LiteralPath $Shim -NewName (Split-Path -Leaf $oldShim) -ErrorAction Stop

  try {
    Copy-Item -Force -Path $Source -Destination $Shim -ErrorAction Stop
  } catch {
    # Copy failed — restore the old shim so the user still has a working ccb.
    $copyError = $_
    try {
      Rename-Item -LiteralPath $oldShim -NewName (Split-Path -Leaf $Shim) -ErrorAction Stop
    } catch {
      Write-Fatal "Failed to install shim AND failed to restore previous shim: copy: $copyError ; restore: $_"
    }
    throw $copyError
  }

  # Best-effort cleanup of the just-renamed file. If a running ccb holds it
  # open, the next install will pick it up via the prune block above.
  try { Remove-Item -LiteralPath $oldShim -Force -ErrorAction Stop } catch { }
}

# ----- main ------------------------------------------------------------------

function Main {
  $platform = Get-Platform
  $version = Resolve-Version
  $url = Get-DownloadUrl $version $platform

  $versionedPath = Join-Path $VersionsDir "$version.exe"
  $shimPath = Join-Path $BinDir 'ccb.exe'

  Write-Log "Installing ccb $version for $platform"
  Write-Log "  binary  -> $versionedPath"
  Write-Log "  shim    -> $shimPath"

  New-Item -ItemType Directory -Force -Path $VersionsDir | Out-Null
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

  # Download to .partial then rename — avoids a half-written binary if the
  # network drops mid-download.
  $tmp = "$versionedPath.partial"
  Invoke-Download $url $tmp

  # Verify SHA256 if a sibling .sha256 was published.
  $shaUrl = "$url.sha256"
  $shaTmp = "$tmp.sha256"
  if (Invoke-DownloadQuiet $shaUrl $shaTmp) {
    $expected = (Get-Content $shaTmp -First 1).Trim().Split(' ')[0]
    $actual = (Get-FileHash -Algorithm SHA256 -Path $tmp).Hash.ToLower()
    if ($expected.ToLower() -ne $actual) {
      Remove-Item $tmp, $shaTmp -ErrorAction SilentlyContinue
      Write-Fatal "checksum mismatch: expected $expected, got $actual"
    }
    Remove-Item $shaTmp -ErrorAction SilentlyContinue
    Write-Ok 'checksum verified'
  } else {
    Write-Warn2 'no .sha256 published for this release — skipping content verify'
  }

  Move-Item -Force -Path $tmp -Destination $versionedPath

  # Copy to shim location. We use a copy (not a symlink) because Windows
  # symlinks require admin or Developer Mode.
  #
  # The naive `Copy-Item -Force` fails when ccb.exe is currently running
  # (`正由另一进程使用，因此该进程无法访问此文件` / "The process cannot access
  # the file because it is being used by another process"). Windows lets you
  # *rename* a running .exe but not delete or overwrite it.
  #
  # So: if the shim already exists, rename it out of the way first, then
  # copy. If the copy fails, roll back by renaming the old file back.
  # Mirrors packages/updater/src/nativeInstaller/installer.ts updateSymlink
  # Windows branch (lines ~658-700).
  Install-Shim $versionedPath $shimPath

  Write-Ok "Installed: $shimPath"
  try { & $shimPath --version } catch { }

  # Mirror in-app `cleanupOldVersions` retention (VERSION_RETENTION_COUNT
  # = 2 in packages/updater/src/nativeInstaller/installer.ts): keep the
  # two newest binaries (this install + one prior for rollback), delete
  # the rest. The just-installed path is always protected.
  Invoke-PruneOldVersions -KeepPath $versionedPath

  $pathAdded = Add-ToUserPath $BinDir
  if ($pathAdded) {
    Write-Ok "Added $BinDir to user PATH (auto)"
  } else {
    Write-Ok "PATH already configured"
  }

  Write-Host ''
  Write-Host 'Done. You can run `ccb` right now in this window:' -ForegroundColor Green
  Write-Host '  ccb              # interactive REPL'
  Write-Host '  ccb --help       # full command reference'
  Write-Host ''
  Write-Host "Upgrade:   irm https://raw.githubusercontent.com/$Repo/main/install.ps1 | iex" -ForegroundColor DarkGray
  Write-Host "Uninstall: Remove-Item -Recurse -Force '$Prefix'" -ForegroundColor DarkGray
}

Main
