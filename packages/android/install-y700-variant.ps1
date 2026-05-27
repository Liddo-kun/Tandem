param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Name,

  [string]$Device = "192.168.1.85:36567",

  [ValidateSet("aarch64", "armv7", "i686", "x86_64")]
  [string]$Target = "aarch64",

  [ValidateRange(0, 600)]
  [int]$DeviceRetrySeconds = 45,

  [ValidateRange(1, 60)]
  [int]$DeviceRetryDelaySeconds = 3,

  [ValidateRange(0, 7200)]
  [int]$NoOutputTimeoutSeconds = 600,

  [ValidateRange(5, 300)]
  [int]$ProgressIntervalSeconds = 20
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$deviceSpecified = $PSBoundParameters.ContainsKey("Device")

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$buildGradle = Join-Path $scriptDir "src-tauri/gen/android/app/build.gradle.kts"
$stringsXml = Join-Path $scriptDir "src-tauri/gen/android/app/src/main/res/values/strings.xml"
$apkDir = Join-Path $scriptDir "src-tauri/gen/android/app/build/outputs/apk/universal/debug"
$sourceApk = Join-Path $apkDir "app-universal-debug.apk"

$variantName = $Name.Trim()
if ($variantName.Length -eq 0) {
  throw "-Name must not be empty."
}

$packageSegments = @(
  [regex]::Split($variantName.ToLowerInvariant(), "[^a-z0-9]+") |
    Where-Object { $_.Length -gt 0 } |
    ForEach-Object {
      if ($_ -match "^[a-z]") { $_ }
      else { "v$_" }
    }
)

if ($packageSegments.Count -eq 0) {
  throw "-Name must contain at least one ASCII letter or digit."
}

$appName = "OpenCode $variantName"
$packageId = "ai.opencode.android.$($packageSegments -join '.')"
$apkSlug = $packageSegments -join "-"
$renamedApk = Join-Path $apkDir "opencode-$apkSlug-y700-debug.apk"
$workDir = Join-Path ([IO.Path]::GetTempPath()) "opencode-y700-$([guid]::NewGuid().ToString('N'))"
$buildLog = Join-Path $workDir "android-build.log"
$restoreLog = Join-Path $workDir "android-restore.log"
$backupBuildGradle = Join-Path $workDir "build.gradle.kts"
$backupStringsXml = Join-Path $workDir "strings.xml"

function Stop-ProcessTree {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId
  )

  if ($IsWindows) {
    & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
    return
  }

  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Format-Command {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(Mandatory = $true)]
    [string[]]$ArgumentList
  )

  @($FilePath) + $ArgumentList | ForEach-Object {
    if ($_ -match '[\s"]') {
      '"' + ($_.Replace('"', '\"')) + '"'
    }
    else {
      $_
    }
  } | Join-String -Separator " "
}

function Invoke-LoggedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$LogPath,

    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(Mandatory = $true)]
    [string[]]$ArgumentList
  )

  $started = Get-Date
  $commandDisplay = Format-Command -FilePath $FilePath -ArgumentList $ArgumentList
  [Console]::WriteLine("Running: $commandDisplay")
  [Console]::WriteLine("Writing full output to: $LogPath")

  $logParent = Split-Path -Parent $LogPath
  if ($logParent) {
    New-Item -ItemType Directory -Path $logParent -Force | Out-Null
  }

  if (Test-Path -LiteralPath $LogPath) {
    Remove-Item -LiteralPath $LogPath -Force
  }

  $progressPattern = [regex]::new(
    "(?i)(^\s*(\$|error|failed|exception|warning|building|built|compiling|finished|installing|success|created apk|restored|generated|info using|\[incubating\]|deprecated gradle|problems report)|apk|assemble)"
  )
  $commandState = @{ LogOffset = 0L }
  $lastOutput = Get-Date
  $lastNotice = Get-Date

  function Write-NewProgressLines {
    if (-not (Test-Path -LiteralPath $LogPath)) {
      return
    }

    $stream = $null
    $reader = $null
    try {
      $stream = [System.IO.File]::Open($LogPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
      if ($commandState.LogOffset -gt $stream.Length) {
        $commandState.LogOffset = 0L
      }
      $stream.Seek($commandState.LogOffset, [System.IO.SeekOrigin]::Begin) | Out-Null
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true, 4096, $true)

      while (-not $reader.EndOfStream) {
        $line = $reader.ReadLine()
        if ($null -ne $line -and $progressPattern.IsMatch($line)) {
          [Console]::WriteLine($line)
        }
      }

      $commandState.LogOffset = $stream.Position
    }
    catch {
      return
    }
    finally {
      if ($reader) { $reader.Dispose() }
      if ($stream) { $stream.Dispose() }
    }
  }

  $process = [System.Diagnostics.Process]::new()
  $process = $null

  try {
    $process = Start-Process `
      -FilePath $env:ComSpec `
      -ArgumentList @("/d", "/c", "$commandDisplay > `"$LogPath`" 2>&1") `
      -NoNewWindow `
      -PassThru

    while (-not $process.WaitForExit(1000)) {
      Write-NewProgressLines

      if (Test-Path -LiteralPath $LogPath) {
        $logItem = Get-Item -LiteralPath $LogPath
        if ($logItem.Length -gt 0 -and $logItem.LastWriteTime -gt $lastOutput) {
          $lastOutput = $logItem.LastWriteTime
        }
      }

      if ($NoOutputTimeoutSeconds -gt 0) {
        $idleSeconds = ((Get-Date) - $lastOutput).TotalSeconds
        if ($idleSeconds -ge $NoOutputTimeoutSeconds) {
          Stop-ProcessTree -ProcessId $process.Id
          throw "Command produced no output for $NoOutputTimeoutSeconds seconds and was stopped. See log: $LogPath"
        }
      }

      $noticeSeconds = ((Get-Date) - $lastNotice).TotalSeconds
      if ($noticeSeconds -ge $ProgressIntervalSeconds) {
        $elapsedSeconds = [math]::Round(((Get-Date) - $started).TotalSeconds)
        [Console]::WriteLine("Still running after ${elapsedSeconds}s. Full log: $LogPath")
        $lastNotice = Get-Date
      }
    }

    Write-NewProgressLines
    if ($process.ExitCode -ne 0) {
      if (Test-Path -LiteralPath $LogPath) {
        [Console]::Error.WriteLine("Last 40 log lines:")
        Get-Content -LiteralPath $LogPath -Tail 40 | ForEach-Object { [Console]::Error.WriteLine($_) }
      }
      throw "Command failed with exit code $($process.ExitCode). See log: $LogPath"
    }

    $elapsed = (Get-Date) - $started
    [Console]::WriteLine("Command finished in $([math]::Round($elapsed.TotalSeconds, 1))s. Full log: $LogPath")
  }
  finally {
    if ($process -and -not $process.HasExited) {
      Stop-ProcessTree -ProcessId $process.Id
    }

    if ($process) {
      $process.Dispose()
    }
  }
}

function Get-ConnectedDevices {
  @(adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\sdevice$" } | ForEach-Object {
    ($_ -split "\s+")[0]
  })
}

function Resolve-Device {
  param(
    [string]$Requested,
    [bool]$Strict
  )

  $deadline = (Get-Date).AddSeconds($DeviceRetrySeconds)
  $attempt = 0

  while ($true) {
    $attempt++
    adb start-server 2>$null | Out-Null

    if ($Requested) {
      $state = adb -s $Requested get-state 2>$null
      if ($LASTEXITCODE -eq 0 -and $state -eq "device") {
        return $Requested
      }

      if ($Strict -and (Get-Date) -ge $deadline) {
        throw "Device '$Requested' is not connected after $DeviceRetrySeconds seconds. Run 'adb devices' and pass -Device <serial>."
      }
    }

    $devices = @(Get-ConnectedDevices)
    if ($devices.Count -eq 1 -and -not $Strict) {
      if ($Requested -and $Requested -ne $devices[0]) {
        [Console]::WriteLine("Configured device '$Requested' is unavailable. Using connected device '$($devices[0])'.")
      }
      return $devices[0]
    }

    if ($devices.Count -gt 1) {
      throw "Multiple Android devices found: $($devices -join ', '). Pass -Device <serial>."
    }

    if ((Get-Date) -ge $deadline) {
      if ($Strict) {
        throw "Device '$Requested' is not connected after $DeviceRetrySeconds seconds. Run 'adb devices' and pass -Device <serial>."
      }
      throw "No connected Android devices found after $DeviceRetrySeconds seconds. Connect the Y700 or pass -Device <serial>."
    }

    [Console]::WriteLine("Waiting for Android device ($attempt). Retrying in $DeviceRetryDelaySeconds seconds...")
    Start-Sleep -Seconds $DeviceRetryDelaySeconds
  }
}

function Require-AndroidProject {
  if ((Test-Path -LiteralPath $buildGradle) -and (Test-Path -LiteralPath $stringsXml)) {
    return
  }

  $initLog = Join-Path $workDir "android-init.log"
  "Generated Android project missing. Running tauri android init; log: $initLog"
  Push-Location $scriptDir
  try {
    Invoke-LoggedCommand -LogPath $initLog -FilePath "bun" -ArgumentList @("run", "tauri", "android", "init", "--ci")
  }
  finally {
    Pop-Location
  }

  if (-not (Test-Path -LiteralPath $buildGradle)) {
    throw "Missing generated file after init: $buildGradle"
  }

  if (-not (Test-Path -LiteralPath $stringsXml)) {
    throw "Missing generated file after init: $stringsXml"
  }
}

function Set-VariantMetadata {
  $applicationIdRegex = [regex]::new('applicationId\s*=\s*"[^"]+"')
  $buildGradleText = [IO.File]::ReadAllText($buildGradle)
  if (-not $applicationIdRegex.IsMatch($buildGradleText)) {
    throw "Could not find applicationId in $buildGradle"
  }

  [IO.File]::WriteAllText(
    $buildGradle,
    $applicationIdRegex.Replace($buildGradleText, "applicationId = `"$packageId`"", 1)
  )

  $stringsText = [IO.File]::ReadAllText($stringsXml)
  $appNameRegex = [regex]::new('<string name="app_name">[^<]*</string>')
  $activityTitleRegex = [regex]::new('<string name="main_activity_title">[^<]*</string>')
  if (-not $appNameRegex.IsMatch($stringsText)) {
    throw "Could not find app_name in $stringsXml"
  }

  if (-not $activityTitleRegex.IsMatch($stringsText)) {
    throw "Could not find main_activity_title in $stringsXml"
  }

  $escapedAppName = [System.Security.SecurityElement]::Escape($appName)
  [IO.File]::WriteAllText(
    $stringsXml,
    $activityTitleRegex.Replace(
      $appNameRegex.Replace($stringsText, "<string name=`"app_name`">$escapedAppName</string>", 1),
      "<string name=`"main_activity_title`">$escapedAppName</string>",
      1
    )
  )
}

try {
  New-Item -ItemType Directory -Path $workDir | Out-Null
  $resolvedDevice = Resolve-Device -Requested $Device -Strict $deviceSpecified
  Require-AndroidProject
  Copy-Item -LiteralPath $buildGradle -Destination $backupBuildGradle -Force
  Copy-Item -LiteralPath $stringsXml -Destination $backupStringsXml -Force

  try {
    Set-VariantMetadata

    "Building $appName ($packageId); log: $buildLog"
    Push-Location $scriptDir
    try {
      $env:OPENCODE_ANDROID_VARIANT = "1"
      Invoke-LoggedCommand -LogPath $buildLog -FilePath "bun" -ArgumentList @("run", "tauri", "android", "build", "--apk", "--debug", "--target", $Target)
    }
    finally {
      Remove-Item Env:\OPENCODE_ANDROID_VARIANT -ErrorAction SilentlyContinue
      Pop-Location
    }

    if (-not (Test-Path -LiteralPath $sourceApk)) {
      throw "Build finished but APK was not found: $sourceApk"
    }

    Copy-Item -LiteralPath $sourceApk -Destination $renamedApk -Force
    "Created APK: $renamedApk"

    "Installing on $resolvedDevice"
    adb -s $resolvedDevice install -r $renamedApk
    if ($LASTEXITCODE -ne 0) {
      throw "adb install failed with exit code $LASTEXITCODE"
    }

    adb -s $resolvedDevice shell pm path $packageId
    if ($LASTEXITCODE -ne 0) {
      throw "Installed package verification failed for $packageId"
    }
  }
  finally {
    if ((Test-Path -LiteralPath $backupBuildGradle) -and (Test-Path -LiteralPath $backupStringsXml)) {
      Copy-Item -LiteralPath $backupBuildGradle -Destination $buildGradle -Force
      Copy-Item -LiteralPath $backupStringsXml -Destination $stringsXml -Force
      Push-Location $scriptDir
      try {
        try {
          Invoke-LoggedCommand -LogPath $restoreLog -FilePath "bun" -ArgumentList @("run", "patch-android-generated.ts")
        }
        catch {
          [Console]::Error.WriteLine("Warning: restored generated Android metadata backups, but post-restore patching failed: $($_.Exception.Message)")
          [Console]::Error.WriteLine("Restore log: $restoreLog")
        }
      }
      finally {
        Pop-Location
      }
      "Restored generated Android metadata files."
    }
  }
}
catch {
  [Console]::Error.WriteLine("Y700 variant install failed: $($_.Exception.Message)")
  [Console]::Error.WriteLine("Build log: $buildLog")
  exit 1
}

[Console]::WriteLine("Installed $appName as $packageId")
[Console]::WriteLine("Build log: $buildLog")
exit 0
