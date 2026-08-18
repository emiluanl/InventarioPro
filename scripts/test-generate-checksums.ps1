<#
.SYNOPSIS
    Self-contained test harness for scripts/generate-checksums.ps1.

.DESCRIPTION
    Works WITHOUT secrets, PFX, Azure or real build artifacts:
      - creates an isolated temp folder with fake files of known content;
      - runs generate-checksums.ps1 and asserts the expected SHA-256 lines;
      - checks deterministic output (two identical runs);
      - mutates a file and checks the hash changes;
      - removes a required file and checks the script exits 1 (the expected
        failure is captured and validated, so it does NOT fail the job);
      - asserts no absolute paths leak into checksums.txt;
      - always removes the temp folder, even on failure.

    Compatible with Windows PowerShell 5.1 and PowerShell 7 (ASCII only).

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-generate-checksums.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$gen  = Join-Path $PSScriptRoot 'generate-checksums.ps1'
$pass = 0
$fail = 0

function Assert-True {
    param([string]$Name, [bool]$Cond, [string]$Detail = '')
    if ($Cond) {
        Write-Host "[PASS] $Name"
        $script:pass++
    } else {
        Write-Host "[FAIL] $Name $Detail"
        $script:fail++
    }
}

$tmp = Join-Path $env:TEMP ("checksumtest-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path (Join-Path $tmp 'nested') | Out-Null
$out   = Join-Path $tmp 'checksums.txt'
$alpha = Join-Path $tmp 'alpha.txt'
$beta  = Join-Path $tmp 'beta.bin'
$delta = Join-Path $tmp 'nested\delta.txt'

$expected = @{
    'alpha.txt'        = '5603656fbbb6ac46a9af6c05ff3c7f5af591c2fc2d287abf39f224ab04cc7fa3'
    'beta.bin'         = 'e5cabc942ad9ac86f3885a1946202d1b5426edf39a42bf415483663ed8f3331d'
    'nested\delta.txt' = '39bf127c67d7bb06b0ef9316880c8df084f27eb52dfa65e50748dcff4856ab15'
}

try {
    [IO.File]::WriteAllText($alpha, "alpha-content-42`n")
    [IO.File]::WriteAllText($beta, "beta-content-7`n")
    [IO.File]::WriteAllText($delta, "delta-content-99`n")

    # -----------------------------------------------------------------------
    # 1) Generation: exit 0, expected hashes, relative paths only, stable order
    # -----------------------------------------------------------------------
    & $gen -Path "$alpha,$beta,$delta" -Output $out -BaseDir $tmp | Out-Null
    Assert-True 'generate exit 0' ($LASTEXITCODE -eq 0)

    $lines = [IO.File]::ReadAllLines($out)
    Assert-True '3 lineas en checksums.txt' ($lines.Count -eq 3)

    $leaks = @($lines | Where-Object { $_ -match [regex]::Escape($tmp) })
    Assert-True 'sin rutas absolutas en checksums.txt' ($leaks.Count -eq 0)

    foreach ($rel in $expected.Keys) {
        $want = "SHA256 ($rel) = $($expected[$rel])"
        Assert-True "hash esperado: $rel" ($lines -contains $want)
    }

    $orderOk = ($lines[0] -match 'alpha\.txt') -and ($lines[1] -match 'beta\.bin') -and ($lines[2] -match 'nested\\delta\.txt')
    Assert-True 'orden estable (alpha, beta, nested\delta)' $orderOk

    # -----------------------------------------------------------------------
    # 2) Determinism: two identical runs produce byte-identical checksums.txt
    # -----------------------------------------------------------------------
    $bytes1 = [IO.File]::ReadAllBytes($out)
    & $gen -Path "$alpha,$beta,$delta" -Output $out -BaseDir $tmp | Out-Null
    $bytes2 = [IO.File]::ReadAllBytes($out)
    $same = ($bytes1.Length -eq $bytes2.Length)
    if ($same) {
        for ($i = 0; $i -lt $bytes1.Length; $i++) {
            if ($bytes1[$i] -ne $bytes2[$i]) { $same = $false; break }
        }
    }
    Assert-True 'determinista (2 corridas identicas)' $same

    # -----------------------------------------------------------------------
    # 3) Change detection: mutating a file changes its hash line
    # -----------------------------------------------------------------------
    [IO.File]::WriteAllText($alpha, 'alpha-content-42-mutated')
    & $gen -Path "$alpha,$beta,$delta" -Output $out -BaseDir $tmp | Out-Null
    $lines2 = [IO.File]::ReadAllLines($out)
    $oldLine = "SHA256 (alpha.txt) = $($expected['alpha.txt'])"
    $newLines = @($lines2 | Where-Object { $_ -like 'SHA256 (alpha.txt) = *' })
    Assert-True 'hash cambia al modificar un archivo' `
        (($lines2 -notcontains $oldLine) -and $newLines.Count -eq 1 -and $newLines[0] -ne $oldLine)

    # -----------------------------------------------------------------------
    # 4) Required file missing -> script exits 1 (expected failure, captured)
    # -----------------------------------------------------------------------
    & $gen -Path (Join-Path $tmp 'no-such-file.exe') -Output $out | Out-Null
    Assert-True 'archivo obligatorio faltante -> exit 1 (fallo esperado capturado)' ($LASTEXITCODE -eq 1)

} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "RESULTADO: $pass pasados, $fail fallidos"
if ($fail -gt 0) { exit 1 }
exit 0
