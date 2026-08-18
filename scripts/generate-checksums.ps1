<#
.SYNOPSIS
    Generate a deterministic SHA-256 checksums.txt for build artifacts.

.DESCRIPTION
    Takes an explicit list of files (or controlled folders) and writes one
    line per file: "SHA256 (relative-path) = hash". Fails (exit code != 0)
    if a required file is missing. Paths in the output are relative to
    -BaseDir (when provided) or the file name only, so no absolute paths
    are written. Files are sorted by relative path (ordinal, case-insensitive)
    for stable, reproducible output. No secrets, temp files or extra content
    are included: only the given artifacts.

.PARAMETER Path
    One or more entries: literal files (must exist, else FAIL), wildcard
    globs (must match at least one file), or directories (expanded
    recursively to *.exe, *.dll).

.PARAMETER Output
    Destination file (e.g. desktop/dist/checksums.txt). Created UTF-8
    without BOM.

.PARAMETER BaseDir
    Optional base directory to make output paths relative to.

.EXAMPLE
    .\scripts\generate-checksums.ps1 -Path desktop\dist\InventarioPro-Setup-1.0.3.exe `
        -Output desktop\dist\checksums.txt -BaseDir desktop\dist
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$Path,

    [Parameter(Mandatory = $true)]
    [string]$Output,

    [string]$BaseDir
)

$ErrorActionPreference = 'Stop'
$script:failures = 0

function Get-RelativePath {
    param([string]$Base, [string]$File)
    $baseFull = [IO.Path]::GetFullPath($Base).TrimEnd('\') + '\'
    $fileFull = [IO.Path]::GetFullPath($File)
    if ($fileFull.StartsWith($baseFull, [StringComparison]::OrdinalIgnoreCase)) {
        return $fileFull.Substring($baseFull.Length)
    }
    return [IO.Path]::GetFileName($fileFull)
}

# ---------------------------------------------------------------------------
# Resolve inputs to an explicit, ordered list of existing files
# ---------------------------------------------------------------------------
$files = New-Object System.Collections.Generic.List[string]

# Accept -Path as an array, comma-separated single token (bash interop), or
# repeated -Path flags: split each entry on commas and ignore empties.
$entries = New-Object System.Collections.Generic.List[string]
foreach ($e in $Path) {
    foreach ($part in ($e -split ',') | Where-Object { $_ }) {
        $entries.Add($part.Trim())
    }
}

foreach ($entry in $entries) {
    if ($entry -match '[*?]') {
        # Wildcard glob: must match at least one file.
        $hits = @(Get-ChildItem -Path $entry -File -ErrorAction SilentlyContinue)
        if ($hits.Count -eq 0) {
            Write-Host "FAIL: sin coincidencias para $entry"
            $script:failures++
            continue
        }
        $hits | ForEach-Object { $files.Add($_.FullName) }
    } elseif (Test-Path -LiteralPath $entry -PathType Container) {
        # Controlled folder: expand to PE files recursively.
        Get-ChildItem -LiteralPath $entry -Recurse -File -Include *.exe, *.dll |
            ForEach-Object { $files.Add($_.FullName) }
    } elseif (Test-Path -LiteralPath $entry -PathType Leaf) {
        $files.Add((Resolve-Path -LiteralPath $entry).Path)
    } else {
        Write-Host "FAIL: archivo obligatorio no encontrado: $entry"
        $script:failures++
    }
}

if ($script:failures -gt 0) {
    Write-Host "RESULTADO: FAILED - archivos obligatorios faltantes."
    exit 1
}
if ($files.Count -eq 0) {
    Write-Host "FAIL: no hay archivos para generar checksums."
    exit 1
}

# ---------------------------------------------------------------------------
# Hash, sort by relative path (stable), write deterministic output
# ---------------------------------------------------------------------------
$lines = New-Object System.Collections.Generic.List[string]
foreach ($f in $files) {
    $hash = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower()
    $rel  = Get-RelativePath -Base $BaseDir -File $f
    $lines.Add("SHA256 ($rel) = $hash")
}

$sorted = $lines.ToArray()
[Array]::Sort($sorted, [System.StringComparer]::OrdinalIgnoreCase)
[IO.File]::WriteAllLines([IO.Path]::GetFullPath($Output), $sorted, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "checksums.txt generado: $Output"
$sorted | ForEach-Object { Write-Host $_ }
exit 0
