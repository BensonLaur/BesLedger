param([Parameter(Mandatory=$true)][string]$JavaDirectory)
$ErrorActionPreference = 'Stop'
$signingDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../private/signing'))
$keytool = Join-Path $JavaDirectory 'bin/keytool.exe'
if (!(Test-Path -LiteralPath $keytool)) { throw '找不到指定 JDK 的 keytool' }
New-Item -ItemType Directory -Force -Path $signingDirectory | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $signingDirectory /inheritance:r /grant:r ('{0}:(OI)(CI)F' -f $identity) 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw '签名目录保护失败' }
$keystore = Join-Path $signingDirectory 'besledger-release.jks'
$credentialPath = Join-Path $signingDirectory 'credential.clixml'
if ((Test-Path -LiteralPath $keystore) -or (Test-Path -LiteralPath $credentialPath)) { throw '签名材料已存在，禁止覆盖；请复用现有签名' }
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$password = [Convert]::ToBase64String($bytes)
$secure = ConvertTo-SecureString $password -AsPlainText -Force
$credential = New-Object Management.Automation.PSCredential('besledger-release', $secure)
$credential | Export-Clixml -LiteralPath $credentialPath
$passwordFile = Join-Path $signingDirectory 'password-once.txt'
try {
    [IO.File]::WriteAllText($passwordFile, $password, (New-Object Text.UTF8Encoding $false))
    & $keytool -genkeypair -alias besledger-release -keystore $keystore -storetype JKS -keyalg RSA -keysize 3072 -validity 10000 -sigalg SHA256withRSA -dname 'CN=BesLedger, OU=Personal Apps, O=BensonLaur, C=CN' -storepass:file $passwordFile -keypass:file $passwordFile
    if ($LASTEXITCODE -ne 0) { throw '发布签名生成失败，保留材料供检查，不自动重建' }
    & $keytool -exportcert -rfc -alias besledger-release -keystore $keystore -storepass:file $passwordFile -file (Join-Path $signingDirectory 'release-certificate.crt')
    if ($LASTEXITCODE -ne 0) { throw '签名证书导出失败' }
    Write-Output '专用发布签名已生成；口令通过 Windows DPAPI 保护，未输出。'
} finally {
    if (Test-Path -LiteralPath $passwordFile) { Remove-Item -LiteralPath $passwordFile }
    $password = $null
    [Array]::Clear($bytes, 0, $bytes.Length)
}
