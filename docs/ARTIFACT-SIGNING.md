# Microsoft Artifact Signing — diseño de integración (plantilla)

**Fecha:** 2026-08-17 · **Estado:** DISEÑO — no activado. No se crearon recursos de Azure ni se autenticó nada.
**Fuentes:** documentación oficial de Microsoft Learn (Artifact Signing) y la acción `azure/artifact-signing-action` de GitHub Marketplace.

Este documento describe cómo reemplazar (o complementar) la firma con el certificado autofirmado actual por **Microsoft Artifact Signing** para la firma del instalador de Windows de InventarioPro desde CI/CD. Nada de lo descrito aquí está ejecutado; el workflow de ejemplo vive en `.github/workflows/desktop-signing.yml.template` (deshabilitado).

## 1. Qué es Artifact Signing

Servicio gestionado por Microsoft (antes "Azure Trusted Signing"; el rol se renombró a *Artifact Signing Certificate Profile Signer*). Firma archivos con certificados de código emitidos y rotados por Microsoft, sin que el PFX ni claves privadas vivan en el repositorio ni en la máquina del desarrollador. En el momento de esta redacción está en **public preview**.

## 2. Recursos y requisitos previos (los configura el propietario, manualmente, en Azure)

| Recurso | Detalle | Quién lo crea |
|---|---|---|
| **Cuenta de Artifact Signing** | Se crea en un **tenant de Microsoft Entra ID** y en una **región concreta** (el endpoint debe coincidir con la región: p. ej. `https://eus.codesigning.azure.net` para East US). Un mismatch región/endpoint causa `403 Forbidden` | Propietario, en Azure Portal |
| **Validación de identidad** | Se completa UNA validación de identidad de la organización (proceso de verificación de Microsoft, con documentación legal). Se necesita al menos una completada antes de firmar | Propietario (rol *Artifact Signing Identity Verifier*) |
| **Perfil de certificado** | `Public Trust` para distribución pública (nombre del editor visible) o `Private Trust` para uso interno. El perfil define el nombre del editor que verán los usuarios | Propietario |
| **Rol de firma** | Al identity (usuario, grupo o **service principal / app registration** de Azure AD que usará GitHub) se le asigna el rol **Artifact Signing Certificate Profile Signer** sobre el perfil. Sin este rol → 403 al firmar | Propietario (User Access Admin / Owner) |
| **App registration + Federated Credentials (OIDC)** | Un App Registration en el tenant; sobre él, una **credential federada** para GitHub Actions con los identificadores del repo (`repo:dueños/repo`, `environment` o `ref: refs/tags/v*`) | Propietario |

## 3. Autenticación GitHub Actions ↔ Azure (OIDC)

- En el workflow: `permissions: id-token: write` + `azure/login@v3` con:
  - `client-id` → secreto `AZURE_CLIENT_ID` (App Registration)
  - `tenant-id` → secreto `AZURE_TENANT_ID`
  - `subscription-id` → secreto `AZURE_SUBSCRIPTION_ID`
- El token OIDC se canjea por un token de Azure sin guardar secretos de cliente (nada de `client-secret` en GitHub).
- La credencial federada se restringe a `ref: refs/tags/v*` y/o al `environment: release` protegido → **un PR nunca puede firmar releases**.

## 4. Permisos mínimos del workflow

```yaml
permissions:
  id-token: write   # necesario para OIDC → Azure
  contents: read    # checkout
```
- La firma NO necesita `contents: write`; la publicación de la GitHub Release (paso aparte) sí, si se mantiene el release automático.
- El workflow completo debe ejecutarse en un `environment: release` protegido (aprobación manual + reviewers) y dispararse solo con `workflow_dispatch` (input obligatorio `release_tag`) o push de tags `v*`.

## 5. Secretos / variables requeridas (Settings → Secrets and variables → Actions)

| Secreto | Uso |
|---|---|
| `AZURE_CLIENT_ID` | Client ID del App Registration |
| `AZURE_TENANT_ID` | Tenant de Entra ID |
| `AZURE_SUBSCRIPTION_ID` | Suscripción que contiene la cuenta de Artifact Signing |
| Variables (no secretos) `AS_ENDPOINT`, `AS_SIGNING_ACCOUNT`, `AS_CERT_PROFILE` | Endpoint regional, nombre de cuenta y perfil (son identificadores, no credenciales) |

**Sin PFX, sin claves privadas, sin contraseñas en GitHub.** El `WIN_CSC_*` actual del workflow `desktop.yml` deja de usarse para el flujo firmado con Artifact Signing.

## 6. Acción de firma

```yaml
- name: Sign files with Artifact Signing
  uses: azure/artifact-signing-action@v2
  with:
    endpoint: ${{ vars.AS_ENDPOINT }}            # ej. https://eus.codesigning.azure.net/
    signing-account-name: ${{ vars.AS_SIGNING_ACCOUNT }}
    certificate-profile-name: ${{ vars.AS_CERT_PROFILE }}
    files-folder: ${{ github.workspace }}\desktop\dist\win-unpacked
    files-folder-filter: exe,dll
    files-folder-recurse: true
    file-digest: SHA256
    timestamp-rfc3161: http://timestamp.acs.microsoft.com
    timestamp-digest: SHA256
```

- **Runner:** solo Windows (`windows-2022`/`windows-2025`).
- **Timestamp:** los certificados de Artifact Signing tienen **validez de 3 días**; el timestamp RFC 3161 con `http://timestamp.acs.microsoft.com` es obligatorio para que la firma siga siendo válida después.
- **Instalador y ejecutables internos — ORDEN correcto (validado en el release gate):** ① construir binarios sin firmar (`build.sh --dir`); ② **firmar ANTES de empaquetar** los binarios del stack que electron-builder copia tal cual (`resources/stack` → schema-engine-windows.exe, etc.); ③ empaquetar NSIS (los binarios firmados quedan DENTRO del instalador); ④ firmar el instalador final; ⑤ verificar todas las firmas; ⑥ subir artifacts. Firmar `dist/win-unpacked` DESPUÉS del empaquetado no llega a los archivos embebidos.
- **Hook `sign` de electron-builder IMPLEMENTADO** (`desktop/scripts/sign-with-artifact-signing.js`): electron-builder lo invoca para **InventarioPro.exe, elevate.exe y el `__uninstaller`** durante el empaquetado, con Artifact Signing si `AS_ENDPOINT`/`AS_SIGNING_ACCOUNT`/`AS_CERT_PROFILE` están definidos, fallback al PFX autofirmado si `WIN_CSC_LINK` está definido, y sin firma si no hay credenciales. El instalador final se firma aparte (post-empaquetado) en el workflow. Pruebas: `desktop/test/sign-hook.test.js` (14 tests) + smoke PFX validado (NotSigned → Valid, thumb del cert local).

## 7. Validación posterior a la firma (en el mismo workflow)

```yaml
- name: Verificar firma tras sign
  shell: pwsh
  run: |
    $files = Get-ChildItem "desktop/dist/InventarioPro-Setup-*.exe","desktop/dist/win-unpacked/*.exe"
    foreach ($f in $files) {
      $sig = Get-AuthenticodeSignature $f.FullName
      if ($sig.Status -eq 'NotSigned' -or -not $sig.SignerCertificate) {
        throw "Sin firmar: $($f.Name) (Status=$($sig.Status))"
      }
      Write-Host "OK: $($f.Name) — $($sig.SignerCertificate.Subject)"
    }
```
- En un runner limpio sin raíces de confianza, `Status` puede aparecer como `UnknownError` aunque la firma sea correcta; lo que no puede aparecer es `NotSigned` o ausencia de `SignerCertificate`.
- **Hash de control:** comparar el SHA256 del artefacto firmado en CI con el de la descarga pública.

## 8. Comportamiento esperado de SmartScreen

- Con un perfil **Public Trust** + identidad validada, el editor aparece en "More info" y la fricción inicial es menor que con autofirmado.
- **SmartScreen igual puede advertir al principio**: la reputación se construye con el tiempo y el volumen de descargas limpias; una firma válida de Microsoft no la otorga automáticamente.
- La repetición de firmas consistentes del mismo editor + descargas sin incidentes mejoran la reputación progresivamente.

## 9. Plan de rotación y revocación

- **Rotación:** Microsoft renueva automáticamente los certificados (3 días de validez + timestamp). No hay rotación manual de claves.
- **Revocación:** una cuenta/perfil comprometido se revoca desde Azure Portal; todas las firmas posteriores con ese perfil quedan inválidas.
- **Verificación de expiración:** como la validez es corta, todo artefacto debe llevar timestamp; revisar `Get-AuthenticodeSignature` de cada artefacto publicado (expiración de la cadena, no del timestamp).

## 10. Pasos siguientes (los ejecuta el propietario; NO ejecutados)

1. Crear la cuenta de Artifact Signing en la región elegida y completar la validación de identidad.
2. Crear el perfil de certificado (Public Trust) y asignar el rol *Artifact Signing Certificate Profile Signer* al App Registration.
3. Crear el App Registration + Federated Credential para GitHub Actions (restringida a tags `v*` y/o environment protegido).
4. Agregar los secretos `AZURE_*` y variables `AS_*` al repositorio.
5. Crear el `environment: release` protegido (reviewers) en el repo.
6. Activar el template `.github/workflows/desktop-signing.yml.template` (renombrar a `.yml`, ajustar secretos, probar con un tag de prueba) y validar la firma resultante con `Get-AuthenticodeSignature`.

## 11. Costo

Artifact Signing se factura por uso (precio por firma / suscripción según el tier vigente en el momento del alta; en preview puede cambiar). Ver la página oficial de precios de Artifact Signing antes de adoptarlo. No se recomienda un EV únicamente para "evitar SmartScreen".
