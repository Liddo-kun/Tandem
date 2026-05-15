param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Name,

  [string]$Device = "192.168.1.85:36567",

  [ValidateSet("aarch64", "armv7", "i686", "x86_64")]
  [string]$Target = "aarch64"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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
$backupBuildGradle = Join-Path $workDir "build.gradle.kts"
$backupStringsXml = Join-Path $workDir "strings.xml"

function Invoke-LoggedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$LogPath,

    [Parameter(Mandatory = $true)]
    [scriptblock]$Command
  )

  & $Command *> $LogPath
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE. See log: $LogPath"
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
    Invoke-LoggedCommand -LogPath $initLog -Command { bun run tauri android init --ci }
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
  Require-AndroidProject
  Copy-Item -LiteralPath $buildGradle -Destination $backupBuildGradle -Force
  Copy-Item -LiteralPath $stringsXml -Destination $backupStringsXml -Force

  try {
    Set-VariantMetadata

    "Building $appName ($packageId); log: $buildLog"
    Push-Location $scriptDir
    try {
      Invoke-LoggedCommand -LogPath $buildLog -Command { bun run tauri android build --apk --debug --target $Target }
    }
    finally {
      Pop-Location
    }

    if (-not (Test-Path -LiteralPath $sourceApk)) {
      throw "Build finished but APK was not found: $sourceApk"
    }

    Copy-Item -LiteralPath $sourceApk -Destination $renamedApk -Force
    "Created APK: $renamedApk"

    "Installing on $Device"
    adb -s $Device install -r $renamedApk
    if ($LASTEXITCODE -ne 0) {
      throw "adb install failed with exit code $LASTEXITCODE"
    }

    adb -s $Device shell pm path $packageId
    if ($LASTEXITCODE -ne 0) {
      throw "Installed package verification failed for $packageId"
    }
  }
  finally {
    if ((Test-Path -LiteralPath $backupBuildGradle) -and (Test-Path -LiteralPath $backupStringsXml)) {
      Copy-Item -LiteralPath $backupBuildGradle -Destination $buildGradle -Force
      Copy-Item -LiteralPath $backupStringsXml -Destination $stringsXml -Force
      "Restored generated Android metadata files."
    }
  }
}
catch {
  [Console]::Error.WriteLine("Y700 variant install failed: $($_.Exception.Message)")
  [Console]::Error.WriteLine("Build log: $buildLog")
  exit 1
}

"Installed $appName as $packageId"
"Build log: $buildLog"
