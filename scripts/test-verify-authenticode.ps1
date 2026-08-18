<#
.SYNOPSIS
    Self-contained test harness for scripts/verify-authenticode.ps1.

.DESCRIPTION
    Runs success and failure cases against the verifier and asserts the
    expected exit codes. Works WITHOUT Azure, Artifact Signing, a real PFX,
    secrets or external accounts:    - A minimal valid PE is generated on the fly (no external tools).
    - An ephemeral self-signed code-signing cert is created in memory and
      exported to a temp PFX (random password, never echoed); it is NOT
      installed in any certificate store.
    - If signtool.exe is found, the sample PE is signed and the full
      signed/unsigned/subject/thumbprint/timestamp/reject cases run.
      Positive ephemeral cases use -AllowUnknownError because a self-signed
      cert outside the trust roots yields Status=UnknownError on a clean
      machine; strict Status=Valid cases run against the local installer
      when the desktop build artifacts are present.
    - Cases that need the desktop build artifacts are skipped if the
      artifacts are absent (fresh checkout before a build).

    The ephemeral cert and all temp files are removed afterwards. Nothing
    private is written to the repository.

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

# --- Helpers for the self-contained section ----------------------------------

function New-SamplePE {
    # Generates a REAL, minimal PE (a tiny .NET console exe) using the C#
    # compiler that ships with Windows (Add-Type -> csc.exe). Guaranteed to be
    # a valid PE for signtool and Get-AuthenticodeSignature. Returns $true on
    # success. No external tools, no network, no secrets.
    param([string]$Path)
    try {
        Add-Type -TypeDefinition 'public class EphemeralSampleProg { public static void Main() {} }' `
            -OutputAssembly $Path -OutputType ConsoleApplication -ErrorAction Stop
        return (Test-Path -LiteralPath $Path)
    } catch {
        return $false
    }
}

function New-EphemeralSigningCert {
    # In-memory self-signed code-signing cert, exported to a temp PFX.
    # Returns the X509Certificate2 on success, $null on failure.
    param([string]$PfxPath, [string]$Password, [string]$SubjectName)
    try {
        $subject = New-Object System.Security.Cryptography.X509Certificates.X500DistinguishedName($SubjectName)
        $rsa = [System.Security.Cryptography.RSA]::Create(2048)
        $req = New-Object System.Security.Cryptography.X509Certificates.CertificateRequest(
            $subject, $rsa,
            [System.Security.Cryptography.HashAlgorithmName]::SHA256,
            [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $oidCol = New-Object System.Security.Cryptography.OidCollection
        $oidCol.Add((New-Object System.Security.Cryptography.Oid('1.3.6.1.5.5.7.3.3'))) | Out-Null
        $req.CertificateExtensions.Add(
            (New-Object System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension($oidCol, $true))) | Out-Null
        $req.CertificateExtensions.Add(
            (New-Object System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension($true, $false, 0, $true))) | Out-Null
        $req.CertificateExtensions.Add(
            (New-Object System.Security.Cryptography.X509Certificates.X509KeyUsageExtension(
                [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature, $true))) | Out-Null
        $cert = $req.CreateSelfSigned([DateTimeOffset]::Now.AddMinutes(-5), [DateTimeOffset]::Now.AddYears(1))
        [IO.File]::WriteAllBytes($PfxPath, $cert.Export(
            [System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $Password))
        return $cert
    } catch {
        return $null
    }
}

function Find-Signtool {
    # Non-recursive, O(1): newest SDK version dir then x64. Avoids a full
    # recursive walk over the Windows Kits tree (very slow on some machines).
    foreach ($r in @('C:\Program Files (x86)\Windows Kits\10\bin', 'C:\Program Files\Windows Kits\10\bin')) {
        if (Test-Path $r) {
            $ver = Get-ChildItem $r -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -match '^\d+\.' } |
                Sort-Object Name -Descending | Select-Object -First 1
            if ($ver) {
                $cand = Join-Path $ver.FullName 'x64\signtool.exe'
                if (Test-Path $cand) { return $cand }
            }
        }
    }
    return (Get-Command signtool.exe -ErrorAction SilentlyContinue).Source
}

# =============================================================================
# Case 0: syntax check of the verifier itself
# =============================================================================
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

# =============================================================================
# Self-contained section: real .NET PE + ephemeral cert + signtool
# =============================================================================
$tmpDir = Join-Path $env:TEMP ("autover-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$pePath      = Join-Path $tmpDir 'sample.exe'
$peUnsigned  = Join-Path $tmpDir 'unsigned.exe'
$nonPeFile   = Join-Path $tmpDir 'readme.txt'
$pfxPath     = Join-Path $tmpDir 'ephemeral.pfx'
$pfxPass     = 'Ephem!' + [guid]::NewGuid().ToString('N') + 'x9'
$certSubject = 'CN=Ephemeral Test Cert, O=InventarioPro Test, C=AR'
$ephemeralCert = $null

try {
    $peOk = New-SamplePE -Path $pePath
    [IO.File]::WriteAllText($nonPeFile, 'not a PE file')

    if ($peOk) {
        Copy-Item -LiteralPath $pePath -Destination $peUnsigned -Force
        Assert-Case 'PE real SIN firmar FALLA (Status != Valid)' 1 {
            & $verifier -Path $peUnsigned
        }

        $ephemeralCert = New-EphemeralSigningCert -PfxPath $pfxPath -Password $pfxPass -SubjectName $certSubject
        if ($ephemeralCert) {
            $thumb = $ephemeralCert.Thumbprint
            $signtool = Find-Signtool
            if ($signtool) {
                # Sign WITHOUT timestamp (no external network): TimeStamperCertificate stays null.
                & $signtool sign /f $pfxPath /p $pfxPass /fd SHA256 $pePath | Out-Null
                $signOk = ($LASTEXITCODE -eq 0)

                if (-not $signOk) {
                    Write-Host "[SKIP] signtool no firmo la muestra ($LASTEXITCODE) - casos firmados omitidos"
                } else {
                    # Self-signed cert outside the trust roots => UnknownError on a
                    # clean machine. Positive cases use -AllowUnknownError; the
                    # strict Status=Valid path is covered by the installer cases
                    # when the local build artifacts are present.
                    Assert-Case 'PE firmado valido (efimero, AllowUnknownError + identidad) PASS' 0 {
                        & $verifier -Path $pePath -AllowUnknownError -ExpectedSubject '*CN=Ephemeral Test Cert*'
                    }
                    Assert-Case 'PE firmado + AllowUnknownError SIN identidad esperada FALLA' 1 {
                        & $verifier -Path $pePath -AllowUnknownError
                    }
                    Assert-Case 'PE firmado + RequireTimestamp FALLA (timestamp ausente)' 1 {
                        & $verifier -Path $pePath -RequireTimestamp -AllowUnknownError -ExpectedSubject '*CN=Ephemeral Test Cert*'
                    }
                    Assert-Case 'PE firmado + ExpectedSubject correcto PASS' 0 {
                        & $verifier -Path $pePath -AllowUnknownError -ExpectedSubject '*CN=Ephemeral Test Cert*'
                    }
                    Assert-Case 'PE firmado + ExpectedSubject incorrecto FALLA' 1 {
                        & $verifier -Path $pePath -AllowUnknownError -ExpectedSubject '*CN=NoExiste*'
                    }
                    Assert-Case 'PE firmado + ExpectedThumbprint correcto PASS' 0 {
                        & $verifier -Path $pePath -AllowUnknownError -ExpectedThumbprint $thumb
                    }
                    Assert-Case 'PE firmado + ExpectedThumbprint incorrecto FALLA' 1 {
                        & $verifier -Path $pePath -AllowUnknownError -ExpectedThumbprint '0000000000000000000000000000000000000000'
                    }
                    Assert-Case 'PE firmado + RejectThumbprint del propio cert FALLA' 1 {
                        & $verifier -Path $pePath -RejectThumbprint $thumb
                    }
                    Assert-Case 'PE firmado + RejectSelfSigned FALLA (Subject == Issuer)' 1 {
                        & $verifier -Path $pePath -RejectSelfSigned
                    }
                    Assert-Case 'PE firmado sin -AllowUnknownError FALLA (UnknownError no tolerado)' 1 {
                        & $verifier -Path $pePath
                    }

                    # Sanitized errors: no output may contain the ephemeral password.
                    $out = & $verifier -Path $pePath -RequireTimestamp 2>&1 | Out-String
                    if ($out -match [regex]::Escape($pfxPass)) {
                        Write-Host "[FAIL] salida del verificador contiene la contrasena efimera (no sanitizada)"
                        $script:fail++
                    } else {
                        Write-Host "[PASS] mensajes de error sanitizados (sin contrasena efimera en la salida)"
                        $script:pass++
                    }
                }
            } else {
                Write-Host "[SKIP] signtool no disponible - casos firmados omitidos"
            }
        } else {
            Write-Host "[SKIP] no se pudo crear el cert efimero - casos firmados omitidos"
        }

        Assert-Case 'Archivo no-PE FALLA (sin cabecera MZ)' 1 {
            & $verifier -Path $nonPeFile
        }
    } else {
        Write-Host "[SKIP] no se pudo generar el PE real (.NET) - seccion autocontenida omitida"
    }

    Assert-Case 'Archivo inexistente FALLA' 1 {
        & $verifier -Path (Join-Path $tmpDir 'no-such-file.exe')
    }

} finally {
    # Ephemeral cert was never installed in a store; just drop the temp files.
    Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

# =============================================================================
# Optional cases using desktop build artifacts (SKIP when absent)
# =============================================================================
if (Test-Path $installer) {
    Assert-Case 'Instalador local - modo PFX (Valid + timestamp, autofirmado permitido)' 0 {
        & $verifier -Path $installer -RequireTimestamp
    }
    Assert-Case 'Instalador local - ExpectedSubject wildcard' 0 {
        & $verifier -Path $installer -RequireTimestamp -ExpectedSubject '*CN=InventarioPro*'
    }
    Assert-Case 'Instalador local - RejectThumbprint autofirmado FALLA' 1 {
        & $verifier -Path $installer -RequireTimestamp -RejectThumbprint $localThumb
    }
    Assert-Case 'Instalador local - RejectSelfSigned FALLA (modo Artifact Signing)' 1 {
        & $verifier -Path $installer -RequireTimestamp -RejectSelfSigned
    }
} else {
    Write-Host "[SKIP] instalador no presente ($installer) - casos del instalador omitidos"
}

if (Test-Path $unsigned) {
    Assert-Case 'Archivo sin firmar (stack) FALLA' 1 {
        & $verifier -Path $unsigned -RequireTimestamp
    }
} else {
    Write-Host "[SKIP] muestra sin firmar no presente ($unsigned) - caso omitido"
}

# =============================================================================
# Summary
# =============================================================================
Write-Host ""
Write-Host "RESULTADO: $pass pasados, $fail fallidos"
if ($fail -gt 0) { exit 1 }
exit 0
