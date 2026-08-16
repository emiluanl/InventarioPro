# InventarioPro Desktop

Aplicación de escritorio (Electron) con el stack completo embebido: backend
NestJS + frontend Next.js standalone + SQLite (migraciones en el primer
arranque). Se distribuye como instalador NSIS firmado, publicado en
**GitHub Releases** automáticamente con cada tag `v*` (workflow
[`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml)).

## Releases e instaladores

- Cada tag `v1.x.y` dispara el workflow `desktop-release`: build → smoke
  test headless → instalador NSIS **firmado** → verificación de firma →
  **GitHub Release** con el `.exe` y su `checksums.txt`.
- El instalador incluye toda la UI actual (layout móvil/escritorio, tema
  Oscuro/Claro/Sistema, reduced-motion, badges interactivos).
- Requiere los secrets `WIN_CSC_BASE64` / `WIN_CSC_KEY_PASSWORD` en GitHub
  (Settings → Secrets → Actions) para firmar.

## Verificación del instalador

Antes de instalar, verifica **firma** e **integridad**:

```powershell
# 1. Firma Authenticode (Status debe ser "Valid" o al menos tener firmante;
#    en máquinas sin el certificado en raíces de confianza da UnknownError,
#    lo cual es esperado — lo que NO debe ser es NotSigned):
Get-AuthenticodeSignature .\InventarioPro-Setup-1.0.1.exe |
  Format-List Status, StatusMessage, SignerCertificate

# 2. Hash SHA256 — debe coincidir con el checksums.txt de la Release:
Get-FileHash .\InventarioPro-Setup-1.0.1.exe -Algorithm SHA256
# (Linux/macOS:  sha256sum InventarioPro-Setup-1.0.1.exe)
```

El `checksums.txt` de cada Release contiene la línea:

```
SHA256 (InventarioPro-Setup-<versión>.exe) = <hash>
```

> ⚠️ El certificado de firma es **autofirmado** (CN=InventarioPro,
> O=InventarioPro, C=AR) con sello de tiempo de DigiCert: la firma sigue
> siendo válida aunque el certificado expire. El hash SHA256 es la garantía
> real de integridad: cada Release publica su checksum junto al instalador.

## Build y smoke test local

```bash
cd desktop
npm ci
bash scripts/build.sh --installer   # dist/InventarioPro-Setup-*.exe (+ checksums.txt)
bash scripts/smoke-test.sh          # app empaquetada: migraciones → STACK_READY → flujo funcional
```

`build.sh` compila backend + frontend desde sus fuentes, reconstruye
`better-sqlite3` para el ABI de Electron y empaqueta. El CI lo hace en
`windows-2022` (VS 17): `better-sqlite3` no publica prebuild para Node 20 y
el `windows-latest` actual trae VS 18, que `node-gyp` 10.x no puede usar.

## Primer arranque

La app crea su base SQLite en `%APPDATA%/inventariopro-desktop/dev.db`
(migraciones automáticas) y sirve el stack en `127.0.0.1:3001` (API) y
`:3010` (frontend). El primer arranque tras instalar puede tardar más de 60s
(antivirus escaneando el stack recién escrito); si la app reporta "El stack
no arrancó a tiempo", ciérrala y vuelve a abrirla: el segundo arranque es
inmediato.
