$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Repository = if ($env:WEAVE_REPOSITORY) {
  $env:WEAVE_REPOSITORY
} else {
  "akshat-OwO/weave"
}
$RequestedVersion = if ($env:WEAVE_VERSION) {
  $env:WEAVE_VERSION
} else {
  "latest"
}
$InstallDirectory = if ($env:WEAVE_INSTALL_DIR) {
  $env:WEAVE_INSTALL_DIR
} else {
  Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "Weave\bin"
}
$InstallPath = Join-Path $InstallDirectory "weave.exe"
$QemuPackage = "SoftwareFreedomConservancy.QEMU"
$Headers = @{
  Accept = "application/vnd.github+json"
  "User-Agent" = "weave-installer"
}

function Stop-WeaveInstall {
  param([Parameter(Mandatory = $true)][string]$Message)

  throw "weave: $Message"
}

function ConvertTo-WeaveVersion {
  param(
    [Parameter(Mandatory = $true)][string]$Value,
    [Parameter(Mandatory = $true)][string]$Description
  )

  $normalized = $Value.TrimStart("v")
  if ($normalized -notmatch "^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$") {
    Stop-WeaveInstall "$Description '$Value' is not a stable semantic version"
  }

  [Version]::Parse($normalized)
}

function Read-WeaveVersion {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Description
  )

  $output = (& $Path --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $output -notmatch "^weave v(?<version>.+)$") {
    Stop-WeaveInstall "could not read the $Description version from $Path"
  }

  ConvertTo-WeaveVersion -Value $Matches.version -Description $Description
}

function Get-WeaveArchitecture {
  $architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture
  switch ($architecture) {
    "X64" {
      @{
        Asset = "x64"
        Qemu = "x86_64"
      }
      break
    }
    "Arm64" {
      @{
        Asset = "arm64"
        Qemu = "aarch64"
      }
      break
    }
    default {
      Stop-WeaveInstall "unsupported Windows architecture: $architecture"
    }
  }
}

function Add-WeaveUserPath {
  param([Parameter(Mandatory = $true)][string]$Directory)

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $entries = if ([string]::IsNullOrWhiteSpace($userPath)) {
    @()
  } else {
    $userPath.Split(";", [StringSplitOptions]::RemoveEmptyEntries)
  }
  if ($entries -notcontains $Directory) {
    $updatedPath = (@($entries) + $Directory) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $updatedPath, "User")
  }

  $processEntries = $env:Path.Split(";", [StringSplitOptions]::RemoveEmptyEntries)
  if ($processEntries -notcontains $Directory) {
    $env:Path = "$Directory;$env:Path"
  }
}

function Find-WeaveQemu {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string]$Variable
  )

  $configuredPaths = @(
    [Environment]::GetEnvironmentVariable($Variable, "Process"),
    [Environment]::GetEnvironmentVariable($Variable, "User")
  )
  foreach ($configuredPath in $configuredPaths) {
    if (
      -not [string]::IsNullOrWhiteSpace($configuredPath) -and
      (Test-Path -LiteralPath $configuredPath -PathType Leaf)
    ) {
      return (Resolve-Path -LiteralPath $configuredPath).Path
    }
  }

  $command = Get-Command $Executable -CommandType Application -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }

  $candidates = @(
    (Join-Path $env:ProgramFiles "qemu\$Executable"),
    (Join-Path $env:LOCALAPPDATA "Programs\qemu\$Executable")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  $null
}

function Install-WeaveQemu {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string]$Variable
  )

  $qemuPath = Find-WeaveQemu -Executable $Executable -Variable $Variable
  if ($null -eq $qemuPath) {
    if ($null -eq (Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue)) {
      Stop-WeaveInstall "QEMU is missing and WinGet is unavailable. Install App Installer, then rerun this command."
    }

    Write-Host "Installing QEMU for isolated Windows virtual machines..."
    & winget.exe install `
      --exact `
      --id $QemuPackage `
      --silent `
      --accept-package-agreements `
      --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
      Stop-WeaveInstall "WinGet could not install QEMU (exit code $LASTEXITCODE)"
    }

    $qemuPath = Find-WeaveQemu -Executable $Executable -Variable $Variable
    if ($null -eq $qemuPath) {
      Stop-WeaveInstall "QEMU was installed but $Executable could not be located"
    }
  }

  & $qemuPath --version *> $null
  if ($LASTEXITCODE -ne 0) {
    Stop-WeaveInstall "QEMU at $qemuPath failed its version check"
  }

  [Environment]::SetEnvironmentVariable($Variable, $qemuPath, "User")
  Set-Item -Path "Env:$Variable" -Value $qemuPath
  Write-Host "Configured $Variable=$qemuPath"
}

$architecture = Get-WeaveArchitecture
$assetName = "weave-bun-windows-$($architecture.Asset).exe"
$qemuExecutable = "qemu-system-$($architecture.Qemu).exe"
$qemuVariable = "QEMU_SYSTEM_$($architecture.Qemu.ToUpperInvariant())"
$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) "weave-install-$([guid]::NewGuid())"

try {
  New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

  if ($RequestedVersion -eq "latest") {
    Write-Host "Checking the latest Weave release..."
    $release = Invoke-RestMethod `
      -Headers $Headers `
      -Uri "https://api.github.com/repos/$Repository/releases/latest"
    $releaseTag = [string]$release.tag_name
  } else {
    $releaseTag = $RequestedVersion
  }
  $releaseVersion = ConvertTo-WeaveVersion `
    -Value $releaseTag `
    -Description "release version"
  $releaseTag = "v$releaseVersion"

  $installedVersion = if (Test-Path -LiteralPath $InstallPath -PathType Leaf) {
    Read-WeaveVersion -Path $InstallPath -Description "installed Weave"
  } else {
    $null
  }
  $downloadPath = $null

  if ($null -eq $installedVersion -or $installedVersion -lt $releaseVersion) {
    $releaseBase = "https://github.com/$Repository/releases/download/$releaseTag"
    $assetUrl = if ($env:WEAVE_DOWNLOAD_URL) {
      $env:WEAVE_DOWNLOAD_URL
    } else {
      "$releaseBase/$assetName"
    }
    $downloadPath = Join-Path $temporaryDirectory $assetName
    $checksumsPath = Join-Path $temporaryDirectory "checksums.txt"

    Write-Host "Downloading Weave $releaseVersion for windows/$($architecture.Asset)..."
    Invoke-WebRequest `
      -Headers $Headers `
      -OutFile $downloadPath `
      -Uri $assetUrl `
      -UseBasicParsing
    Invoke-WebRequest `
      -Headers $Headers `
      -OutFile $checksumsPath `
      -Uri "$releaseBase/checksums.txt" `
      -UseBasicParsing

    $escapedAsset = [Regex]::Escape($assetName)
    $checksumText = Get-Content -LiteralPath $checksumsPath -Raw
    $checksumMatch = [Regex]::Match(
      $checksumText,
      "(?m)^(?<hash>[a-fA-F0-9]{64})\s+\*?(?:.*[/\\])?$escapedAsset\s*$"
    )
    if (-not $checksumMatch.Success) {
      Stop-WeaveInstall "checksums.txt does not contain $assetName"
    }
    $actualChecksum = (Get-FileHash -Algorithm SHA256 -LiteralPath $downloadPath).Hash
    if ($actualChecksum -ne $checksumMatch.Groups["hash"].Value) {
      Stop-WeaveInstall "checksum verification failed for $assetName"
    }

    $downloadedVersion = Read-WeaveVersion `
      -Path $downloadPath `
      -Description "downloaded Weave"
    if ($downloadedVersion -ne $releaseVersion) {
      Stop-WeaveInstall "downloaded Weave reported $downloadedVersion instead of $releaseVersion"
    }
  } elseif ($installedVersion -eq $releaseVersion) {
    Write-Host "Weave $installedVersion is already up to date at $InstallPath"
  } else {
    Write-Host "Installed Weave $installedVersion is newer than release $releaseVersion; leaving it unchanged."
  }

  Install-WeaveQemu -Executable $qemuExecutable -Variable $qemuVariable
  if ($null -ne $downloadPath) {
    New-Item -ItemType Directory -Force -Path $InstallDirectory | Out-Null
    $stagePath = Join-Path $InstallDirectory ".weave-install-$([guid]::NewGuid()).exe"
    Copy-Item -LiteralPath $downloadPath -Destination $stagePath
    Move-Item -Force -LiteralPath $stagePath -Destination $InstallPath
    Write-Host "Weave $releaseVersion was installed to $InstallPath"
  }
  Add-WeaveUserPath -Directory $InstallDirectory
  & $InstallPath --version
  Write-Host "Run 'weave --help' to get started. New terminals will inherit the updated PATH."
} finally {
  if (Test-Path -LiteralPath $temporaryDirectory) {
    Remove-Item -Force -Recurse -LiteralPath $temporaryDirectory
  }
}
