# =============================================================================
# export-secret.ps1 — prepara los secretos de GitHub para el job de release.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File export-secret.ps1
#
# Imprime los valores a pegar en Settings → Secrets and variables → Actions:
#   WIN_CSC_BASE64       el pfx codificado en base64 (una sola línea).
#   WIN_CSC_KEY_PASSWORD la contraseña del pfx.
#
# Requiere haber generado el certificado antes (create-cert.ps1), que deja
# desktop/certs/inventariopro.pfx + desktop/certs/password.txt.
# =============================================================================
$ErrorActionPreference = 'Stop'

$pfx  = Join-Path $PSScriptRoot '..\certs\inventariopro.pfx'
$pass = Join-Path $PSScriptRoot '..\certs\password.txt'

if (-not (Test-Path $pfx)) {
  Write-Error "No existe $pfx. Generalo primero con create-cert.ps1."
  exit 1
}

$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path $pfx)))

Write-Host ""
Write-Host '--- WIN_CSC_BASE64 (pegar completo, una sola línea) ---'
Write-Host $b64
Write-Host ""

if (Test-Path $pass) {
  $password = (Get-Content $pass -Raw).Trim()
  Write-Host '--- WIN_CSC_KEY_PASSWORD ---'
  Write-Host $password
  Write-Host ""
} else {
  Write-Warning "No encontré ${pass}: definí WIN_CSC_KEY_PASSWORD a mano."
}
