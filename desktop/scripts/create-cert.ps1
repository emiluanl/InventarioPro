# =============================================================================
# create-cert.ps1 - genera un certificado autofirmado de FIRMA DE CÓDIGO y lo
# exporta a desktop/certs/inventariopro.pfx para que electron-builder firme el
# instalador (WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD).
#
#   powershell -ExecutionPolicy Bypass -File scripts/create-cert.ps1
#
# ADVERTENCIA HONESTA:
#   Un certificado autofirmado NO elimina el aviso de SmartScreen para el
#   público: Windows muestra "Editor desconocido" y el aviso de reputación para
#   cualquier binario sin reputación. Para que la app se instale sin avisos en
#   tus máquinas hay que (1) firmar con este certificado y (2) instalarlo en el
#   almacén "Entidades de certificación raíz de confianza" de cada equipo
#   (instrucciones al final). Para distribución pública se necesita un
#   certificado OV/EV de una CA reconocida (DigiCert, Sectigo, …) y tiempo de
#   reputación.
# =============================================================================
$ErrorActionPreference = 'Stop'

$certDir  = Join-Path $PSScriptRoot '..\certs'
$pfxPath  = Join-Path $certDir 'inventariopro.pfx'
$passFile = Join-Path $certDir 'password.txt'

New-Item -ItemType Directory -Force -Path $certDir | Out-Null

# Contraseña aleatoria para el pfx (se guarda junto al certificado; NO
# commitees certs/ — está en .gitignore).
$password = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })

$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject 'CN=InventarioPro, O=InventarioPro, C=AR' `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -KeyExportPolicy Exportable `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears(3)

$secure = ConvertTo-SecureString -String $password -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $secure | Out-Null
Set-Content -Path $passFile -Value $password -NoNewline

Write-Host ""
Write-Host "Certificado creado:"
Write-Host "  Thumbprint : $($cert.Thumbprint)"
Write-Host "  Sujeto     : $($cert.Subject)"
Write-Host "  Expira     : $($cert.NotAfter)"
Write-Host "  PFX        : $pfxPath"
Write-Host ""
Write-Host "Ahora construye el instalador firmado:"
Write-Host "  cd desktop && npm run build:installer"
Write-Host ""
Write-Host "Para confiar en este certificado en TU máquina (quita el aviso"
Write-Host "'Editor desconocido'):"
Write-Host "  1. Ejecuta como Administrador:"
Write-Host "     powershell -ExecutionPolicy Bypass -Command ""Get-ChildItem Cert:\CurrentUser\My\$($cert.Thumbprint) | Export-Certificate -FilePath certs\selfsigned.cer -Force"""
Write-Host "  2. Importa certs\selfsigned.cer en 'Entidades de certificación raíz"
Write-Host "     de confianza' -> 'Equipo local' (certlm.msc)."
Write-Host ""
Write-Host "Para OTROS equipos, repite el paso 2 en cada uno (o distribuye el .cer)."
Write-Host "Para el PÚBLICO en general, un certificado autofirmado NO basta:"
Write-Host "necesitas un certificado de firma de código OV/EV de una CA y dejar"
Write-Host "que SmartScreen acumule reputación con descargas reales."
