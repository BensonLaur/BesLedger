param([Parameter(Mandatory=$true)][string]$JavaDirectory, [Parameter(Mandatory=$true)][string]$SdkDirectory)
$ErrorActionPreference = 'Stop'
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$signingDirectory = Join-Path $projectDirectory 'private/signing'
$oldVariables = @{}
$names = @('JAVA_HOME','ANDROID_HOME','ANDROID_SDK_ROOT','BESLEDGER_KEYSTORE','BESLEDGER_STORE_PASSWORD','BESLEDGER_KEY_PASSWORD','GRADLE_USER_HOME')
foreach ($name in $names) { $oldVariables[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $credential = Import-Clixml -LiteralPath (Join-Path $signingDirectory 'credential.clixml')
    $env:JAVA_HOME = (Resolve-Path -LiteralPath $JavaDirectory).Path
    $env:ANDROID_HOME = (Resolve-Path -LiteralPath $SdkDirectory).Path
    $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    $env:GRADLE_USER_HOME = Join-Path $projectDirectory '.tools/gradle-cache'
    $env:BESLEDGER_KEYSTORE = Join-Path $signingDirectory 'besledger-release.jks'
    $env:BESLEDGER_STORE_PASSWORD = $credential.GetNetworkCredential().Password
    $env:BESLEDGER_KEY_PASSWORD = $env:BESLEDGER_STORE_PASSWORD
    Push-Location $projectDirectory
    try {
        & npm.cmd run android:sync
        if ($LASTEXITCODE -ne 0) { throw 'Android Web 资源构建失败' }
        & ./android/gradlew.bat -p android --no-daemon assembleRelease
        if ($LASTEXITCODE -ne 0) { throw 'Android 发布构建失败' }
        New-Item -ItemType Directory -Force artifacts | Out-Null
        Copy-Item -LiteralPath android/app/build/outputs/apk/release/app-release.apk -Destination artifacts/BesLedger-0.1.0-release.apk
        & "$env:ANDROID_HOME/build-tools/36.0.0/apksigner.bat" verify --verbose --print-certs artifacts/BesLedger-0.1.0-release.apk
        if ($LASTEXITCODE -ne 0) { throw 'APK 签名校验失败' }
        Get-FileHash artifacts/BesLedger-0.1.0-release.apk -Algorithm SHA256
    } finally { Pop-Location }
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $oldVariables[$name], 'Process') }
}
