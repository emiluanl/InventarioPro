<#
.SYNOPSIS
    Test harness for scripts/verify-authenticode.ps1. No secrets involved.

.DESCRIPTION
    Runs success and failure cases against the verifier and asserts the
    expected exit codes. Exits non-zero if any case fails.

    Requires the local installer at desktop/dist and an unsigned sample at
    desktop/resources (both produced by the desktop build). Skip cases that
    reference missing files instead of failing (so the harness is usable
    before a build too), except the explicit MISSING-file case.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-verify-authenticode.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root      = Split-Path -Parent $PSScriptRoot
$verifier  = Join-Path $PSScriptRoot 'verify-authenticode.ps1'
$installer = Join-Path $root 'desktop\dist\InventarioPro-Setup-1.0.3.exe'
$unsigned  = Join-Path $root 'desktop\resources\backend\node_modules\@prisma\engines\schema-engine-windows.exe'
$nonPe     = Join-Path $root 'package.json'
$localThumb = '885634401FAD34FC52D7FC16A38955D682DF456C'   # self-signed InventarioPro cert

$pass = 0
$fail = 0

function Assert-Case {
    param(
        [string]$Name,
        [int]$ExpectedExit,
        [scriptblock]$Body
    )
    & $Body | Out-Null
    $actual = $LASTEXITCODE
    if ($actual -eq $ExpectedExit) {
        Write-Host "[PASS] $Name (exit=$actual)"
        $script:pass++
    } else {
        Write-Host "[FAIL] $Name (esperado=$ExpectedExit, real=$actual)"
        $script:fail++
    }
}

# --- Case 0: syntax check of the verifier itself ---------------------------
$tokens = $null; $errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($verifier, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count -eq 0) {
    Write-Host "[PASS] sintaxis del verificador (0 errores de parse)"
    $script:pass++
} else {
    Write-Host "[FAIL] sintaxis del verificador: $($errors.Count) errores"
    $errors | ForEach-Object { Write-Host "  $($_.Extent.Text) -> $($_.Message)" }
    $script:fail++
}

# --- Case 1: local installer, PFX mode (self-signed allowed, ts required) ---
if (Test-Path $installer) {
    Assert-Case 'Instalador local - modo PFX (Valid + timestamp, autofirmado permitido)' 0 {
        & $verifier -Path $installer -RequireTimestamp
    }
    Assert-Case 'Instalador local - ExpectedSubject wildcard' 0 {
        & $verifier -Path $installer -RequireTimestamp -ExpectedSubject '*CN=InventarioPro*'
    }
    Assert-Case 'Instalador local - ExpectedIssuer wildcard' 0 {
        & $verifier -Path $installer -RequireTimestamp -ExpectedIssuer '*CN=InventarioPro*'
    }
    Assert-Case 'Instalador local - ExpectedThumbprint coincide' 0 {
        & $verifier -Path $installer -RequireTimestamp -ExpectedThumbprint $localThumb
    }
    Assert-Case 'Instalador local - RejectThumbprint autofirmado FALLA' 1 {
        & $verifier -Path $installer -RequireTimestamp -RejectThumbprint $localThumb
    }
    Assert-Case 'Instalador local - RejectSelfSigned FALLA (modo Artifact Signing)' 1 {
        & $verifier -Path $installer -RequireTimestamp -RejectSelfSigned
    }
    Assert-Case 'Instalador local - ExpectedSubject incorrecto FALLA' 1 {
        & $verifier -Path $installer -RequireTimestamp -ExpectedSubject '*CN=NoExiste*'
    }
    Assert-Case 'Instalador local - ExpectedIssuer incorrecto FALLA' 1 {
        & $verifier -Path $installer -RequireTimestamp -ExpectedIssuer '*CN=NoExiste*'
    }
    Assert-Case 'Instalador local - ExpectedThumbprint incorrecto FALLA' 1 {
        & $verifier -Path $installer -RequireTimestamp -ExpectedThumbprint '0000000000000000000000000000000000000000'
    }
} else {
    Write-Host "[SKIP] instalador no presente ($installer) - casos del instalador omitidos"
}

# --- Case 2: unsigned sample file -------------------------------------------
if (Test-Path $unsigned) {
    Assert-Case 'Archivo sin firmar FALLA (Status != Valid)' 1 {
        & $verifier -Path $unsigned -RequireTimestamp
    }
} else {
    Write-Host "[SKIP] muestra sin firmar no presente ($unsigned) - caso omitido"
}

# --- Case 3: explicit failure cases -----------------------------------------
Assert-Case 'Archivo inexistente FALLA' 1 {
    & $verifier -Path 'C:\no-existe\inventariopro-setup.exe'
}
if (Test-Path $nonPe) {
    Assert-Case 'Archivo no-PE FALLA (sin cabecera MZ)' 1 {
        & $verifier -Path $nonPe
    }
}

# --- Summary -----------------------------------------------------------------
Write-Host ""
Write-Host "RESULTADO: $pass pasados, $fail fallidos"
if ($fail -gt 0) { exit 1 }
exit 0
