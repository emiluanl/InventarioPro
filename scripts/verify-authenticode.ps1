<#
.SYNOPSIS
    Verify Authenticode signatures of PE files (exe/dll) with Get-AuthenticodeSignature.

.DESCRIPTION
    Checks each file and fails (exit code != 0) if:
      - the file does not exist;
      - the file is not a valid PE (missing MZ header);
      - Status is not Valid;
      - a timestamp is required (RequireTimestamp) and TimeStamperCertificate is absent;
      - ExpectedThumbprint is set and the signer thumbprint does not match;
      - RejectThumbprint contains the signer thumbprint (e.g. the local self-signed cert);
      - ExpectedSubject is set and Subject does not match (wildcards supported via -like);
      - ExpectedIssuer is set and Issuer does not match (wildcards supported via -like);
      - RejectSelfSigned is set and Subject equals Issuer (self-signed heuristic).

    Two intended modes:
      - Local PFX / QA:  -RequireTimestamp (self-signed cert is ALLOWED).
      - Artifact Signing CI: -RequireTimestamp -RejectSelfSigned
        -RejectThumbprint "<local-self-signed-thumb>" and optionally
        -ExpectedSubject/-ExpectedIssuer for the public editor cert.

    NOTE: a valid local PFX signature does NOT prove Artifact Signing works.

.PARAMETER Path
    One or more file paths. Directories are expanded recursively to *.exe, *.dll.

.EXAMPLE
    .\scripts\verify-authenticode.ps1 -Path desktop\dist\InventarioPro-Setup-1.0.3.exe -RequireTimestamp

.EXAMPLE
    .\scripts\verify-authenticode.ps1 -Path $exes -RequireTimestamp -RejectSelfSigned `
        -RejectThumbprint "885634401FAD34FC52D7FC16A38955D682DF456C" `
        -ExpectedSubject "*CN=Editor Publico*"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, ValueFromPipeline = $true, ValueFromPipelineByPropertyName = $true)]
    [Alias('FullName')]
    [string[]]$Path,

    [string]$ExpectedSubject,
    [string]$ExpectedIssuer,
    [string]$ExpectedThumbprint,
    [string[]]$RejectThumbprint,
    [switch]$RequireTimestamp,
    [switch]$RejectSelfSigned
)

$ErrorActionPreference = 'Stop'
$script:failures = 0

function Write-Fail {
    param([string]$Message)
    Write-Host "  FAIL: $Message"
    $script:failures++
}

# ---------------------------------------------------------------------------
# Resolve inputs (files, or directories expanded recursively to PE files)
# ---------------------------------------------------------------------------
$resolved = New-Object System.Collections.Generic.List[string]
foreach ($p in $Path) {
    $item = Get-Item -LiteralPath $p -ErrorAction SilentlyContinue
    if (-not $item) {
        Write-Host "MISSING: $p"
        $script:failures++
        continue
    }
    if ($item.PSIsContainer) {
        Get-ChildItem -LiteralPath $p -Recurse -Include *.exe, *.dll -File |
            ForEach-Object { $resolved.Add($_.FullName) }
    } else {
        $resolved.Add($item.FullName)
    }
}

if ($resolved.Count -eq 0) {
    Write-Host "FAIL: no hay archivos que verificar."
    exit 1
}

# ---------------------------------------------------------------------------
# Per-file verification
# ---------------------------------------------------------------------------
foreach ($file in $resolved) {
    Write-Host "== $file"

    # 1) Valid PE (MZ header)
    try {
        $stream = [System.IO.File]::OpenRead($file)
        try {
            $buf = New-Object byte[] 2
            [void]$stream.Read($buf, 0, 2)
            if (-not ($buf[0] -eq 0x4D -and $buf[1] -eq 0x5A)) {
                Write-Fail "no es un PE valido (falta cabecera MZ)"
                continue
            }
        } finally {
            $stream.Dispose()
        }
    } catch {
        Write-Fail "no se pudo leer el archivo: $($_.Exception.Message)"
        continue
    }

    # 2) Authenticode signature
    $sig = Get-AuthenticodeSignature -LiteralPath $file
    $cert = $sig.SignerCertificate

    if ($sig.Status -ne 'Valid') {
        Write-Fail "Status=$($sig.Status) ($($sig.StatusMessage))"
    }
    if (-not $cert) {
        Write-Fail "sin certificado de firma"
    }

    # 3) Timestamp
    $hasTs = $null -ne $sig.TimeStamperCertificate
    if ($RequireTimestamp -and -not $hasTs) {
        Write-Fail "falta timestamp (TimeStamperCertificate ausente)"
    }

    # 4) ExpectedThumbprint
    if ($ExpectedThumbprint -and $cert -and $cert.Thumbprint -ne $ExpectedThumbprint) {
        Write-Fail "Thumbprint=$($cert.Thumbprint) no coincide con ExpectedThumbprint=$ExpectedThumbprint"
    }

    # 5) RejectThumbprint
    if ($cert -and $cert.Thumbprint -in $RejectThumbprint) {
        Write-Fail "Thumbprint=$($cert.Thumbprint) esta en RejectThumbprint (certificado rechazado)"
    }

    # 6) ExpectedSubject / ExpectedIssuer
    if ($ExpectedSubject -and $cert -and $cert.Subject -notlike $ExpectedSubject) {
        Write-Fail "Subject=$($cert.Subject) no coincide con ExpectedSubject=$ExpectedSubject"
    }
    if ($ExpectedIssuer -and $cert -and $cert.Issuer -notlike $ExpectedIssuer) {
        Write-Fail "Issuer=$($cert.Issuer) no coincide con ExpectedIssuer=$ExpectedIssuer"
    }

    # 7) RejectSelfSigned
    if ($RejectSelfSigned -and $cert -and $cert.Subject -eq $cert.Issuer) {
        Write-Fail "certificado autofirmado detectado (Subject == Issuer)"
    }

    # Report per file
    Write-Host "  Status     : $($sig.Status)"
    if ($cert) {
        Write-Host "  Subject    : $($cert.Subject)"
        Write-Host "  Issuer     : $($cert.Issuer)"
        Write-Host "  Thumbprint : $($cert.Thumbprint)"
        Write-Host "  Expira     : $($cert.NotAfter.ToString('yyyy-MM-dd HH:mm'))"
    } else {
        Write-Host "  Subject    : (sin certificado)"
    }
    Write-Host "  Timestamp  : $(if ($hasTs) { $sig.TimeStamperCertificate.Subject } else { 'NO' })"
}

# ---------------------------------------------------------------------------
# Summary + exit code
# ---------------------------------------------------------------------------
Write-Host ""
if ($script:failures -gt 0) {
    Write-Host "RESULTADO: FAILED ($($script:failures) error(es))"
    exit 1
}
Write-Host "RESULTADO: OK (todos los archivos verificados)"
exit 0
