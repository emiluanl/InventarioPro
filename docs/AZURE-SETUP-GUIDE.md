# Guía de configuración manual — Microsoft Artifact Signing para InventarioPro

**Fecha:** 2026-08-17 · **Estado:** documentación de referencia — **nada de esto se ejecutó**.
**Fuente:** documentación oficial de Microsoft Learn (Artifact Signing / quickstart, CLI reference) y `azure/artifact-signing-action`.

Esta guía la ejecuta **Emiliano (el propietario)** manualmente. Ningún paso crea recursos automáticamente desde el repo; el workflow de firma vive desactivado en `.github/workflows/desktop-signing.yml.template` hasta que estos recursos existan.

> ⚠️ **Convención:** todo valor entre `<ángulos>` es un placeholder que debes reemplazar. Los valores con `ej.` son ejemplos de formato, no valores sugeridos. **No pegues secretos ni valores reales en el chat.**

---

## 0. Prerrequisitos

| Requisito | Cómo verificarlo |
|---|---|
| Suscripción de Azure **de pago** (Artifact Signing no funciona con trial) | `az account show` |
| Tenant de Microsoft Entra ID | `az account show -o json` → campo `tenantId` |
| Azure CLI ≥ 2.75.0 | `az version` |
| Cuenta de GitHub con acceso de admin al repo `emiluanl/InventarioPro` | — |

Restricciones geográficas (Public Trust): organizaciones en US, Canadá, UE, UK, Australia, Nueva Zelanda, Japón, Corea del Sur, Singapur, Suiza, Noruega e Israel; desarrolladores individuales solo US o Canadá. Estas restricciones **no** aplican a Private Trust.

## 1. Login y contexto

```bash
az login
az account set -s "<SUBSCRIPTION_ID>"          # la suscripción de pago
az account show -o json | grep tenantId        # anota el TENANT_ID
```

## 2. Registrar el resource provider y la extensión CLI

```bash
az provider register --namespace "Microsoft.CodeSigning"
az provider show --namespace "Microsoft.CodeSigning" --query "registrationState"   # → "Registered"
az extension add --name artifact-signing        # si no está instalada
```

## 3. Resource group y cuenta de Artifact Signing

El **endpoint debe coincidir con la región** (mismatch → `403 Forbidden`). Regiones soportadas (todas las variantes existen):

| Región | Endpoint |
|---|---|
| East US | `https://eus.codesigning.azure.net` |
| West Europe | `https://weu.codesigning.azure.net` |
| North Europe | `https://neu.codesigning.azure.net` |
| Brazil South | `https://brs.codesigning.azure.net` |
| … (tabla completa en el quickstart oficial) | … |

```bash
az group create --name "<RESOURCE_GROUP>" --location "<REGION>"     # ej. eastus
az artifact-signing create -n "<AS_ACCOUNT>" -l "<REGION>" -g "<RESOURCE_GROUP>" --sku Basic
az artifact-signing show -g "<RESOURCE_GROUP>" -n "<AS_ACCOUNT>"    # verificar
```

Reglas de nombre de la cuenta: 3–24 caracteres alfanuméricos, único global, empieza con letra, termina en letra/número, sin guiones consecutivos (p. ej. `inventariopro` + sufijo corto).

**Anota:** `AS_ENDPOINT = https://<region>.codesigning.azure.net` (el valor que usará el workflow).

## 4. Validación de identidad (SOLO Azure Portal — no hay CLI)

1. En el portal, asigna a tu usuario el rol **Artifact Signing Identity Verifier** sobre la cuenta recién creada:
   ```bash
   az role assignment create --assignee "<TU_USER_OBJECT_ID>" \
     --role "Artifact Signing Identity Verifier" \
     --scope "/subscriptions/<SUBSCRIPTION_ID>/resourceGroups/<RESOURCE_GROUP>/providers/Microsoft.CodeSigning/codeSigningAccounts/<AS_ACCOUNT>"
   ```
   (El rol *Reader* a nivel de suscripción también se requiere; el tutorial oficial lo indica.)
2. Portal → cuenta de Artifact Signing → **Identity validations** → **New identity** → `Organization` (o `Individual`) → `Public`.
3. Completa el formulario con los datos legales **exactos** que deben figurar en el certificado (razón social, web de la entidad, emails primario/secundario del dominio de la entidad, dirección, nombre/apellido del representante tal como figuran en el documento oficial).
4. El estado pasa `In Progress` → `Action Required` (verificación de email y, si aplica, documentos; **1–20 días hábiles**) → `Completed`.

> El `identity-validation-id` (GUID) que se genera se usa en el paso 5. La validación de identidad es **única por suscripción** y se comparte entre todas las cuentas de Artifact Signing de esa suscripción.

## 5. Perfil de certificado Public Trust

```bash
az artifact-signing certificate-profile create \
  -g "<RESOURCE_GROUP>" \
  --account-name "<AS_ACCOUNT>" \
  -n "<AS_CERT_PROFILE>" \
  --profile-type PublicTrust \
  --identity-validation-id "<IDENTITY_VALIDATION_ID>"
```

Verifica:

```bash
az artifact-signing certificate-profile show -g "<RESOURCE_GROUP>" --account-name "<AS_ACCOUNT>" -n "<AS_CERT_PROFILE>"
```

**Anota el ID de recurso del perfil** (se usa en el paso 7):

```
/subscriptions/<SUBSCRIPTION_ID>/resourceGroups/<RESOURCE_GROUP>/providers/Microsoft.CodeSigning/codeSigningAccounts/<AS_ACCOUNT>/certificateProfiles/<AS_CERT_PROFILE>
```

## 6. App Registration + federated credential OIDC para GitHub Actions

```bash
# 6.1 Crear el App Registration (sin client-secret: la auth es OIDC)
az ad app create --display-name "<APP_NAME>"        # ej. inventariopro-github-actions
```

Anota el `appId` del resultado → será `<CLIENT_ID>`.

```bash
# 6.2 Credencial federada restringida al environment 'release' (recomendado)
az ad app federated-credential credential add --id "<CLIENT_ID>" --parameters '{
  "name": "github-actions-release",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:emiluanl/InventarioPro:environment:release",
  "description": "OIDC GitHub Actions -> Azure, environment release de InventarioPro",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

> Alternativa (más amplia): `"subject": "repo:emiluanl/InventarioPro:ref:refs/tags/v*"` — restringe la firma a push de tags `v*`. Puedes crear ambas credenciales y decidir después; el template está preparado para el environment.

Verifica:

```bash
az ad app federated-credential credential list --id "<CLIENT_ID>"
```

## 7. Rol de firma sobre el perfil

```bash
az role assignment create --assignee "<CLIENT_ID>" \
  --role "Artifact Signing Certificate Profile Signer" \
  --scope "/subscriptions/<SUBSCRIPTION_ID>/resourceGroups/<RESOURCE_GROUP>/providers/Microsoft.CodeSigning/codeSigningAccounts/<AS_ACCOUNT>/certificateProfiles/<AS_CERT_PROFILE>"
```

> Sin este rol → `403 Forbidden` al firmar. La propagación del rol puede tardar unos minutos.

## 8. GitHub: environment protegido `release`

1. Repo → **Settings → Environments → New environment** → nombre: `release`.
2. **Protection rules**:
   - **Required reviewers**: agrega tu usuario (o un team).
   - **Deployment branches**: *Selected branches* → patrón de tag `v*` (y/o `main` si quieres permitir el modo test manual desde main; el `workflow_dispatch` de prueba suele correr desde `main`).
3. Guarda.

## 9. GitHub: secrets y variables

Repo → **Settings → Secrets and variables → Actions → Environments → `release`**:

| Tipo | Nombre | Valor |
|---|---|---|
| Secret | `AZURE_CLIENT_ID` | `<CLIENT_ID>` (appId del paso 6) |
| Secret | `AZURE_TENANT_ID` | `<TENANT_ID>` (paso 1) |
| Secret | `AZURE_SUBSCRIPTION_ID` | `<SUBSCRIPTION_ID>` |
| Variable | `AS_ENDPOINT` | `https://<region>.codesigning.azure.net` (paso 3) |
| Variable | `AS_SIGNING_ACCOUNT` | `<AS_ACCOUNT>` |
| Variable | `AS_CERT_PROFILE` | `<AS_CERT_PROFILE>` |

**No se necesita PFX, clave privada ni contraseña.** Los secrets solo los lee el job del environment `release`.

## 10. Prueba (modo test, sin tags ni release)

1. Renombra el template: `.github/workflows/desktop-signing.yml.template` → `.github/workflows/desktop-signing.yml`.
2. Confirma que el trigger `workflow_dispatch` está activo (los tags `v*` siguen comentados).
3. **Actions → desktop-signing → Run workflow** (desde `main`).
4. Criterios de aprobación del primer run:
   - Job de firma EXIT=0;
   - log de verificación: `OK: <archivo> | Subject=<editor Public Trust> | ts=True` para **instalador + todos los exes internos**;
   - ningún archivo con el thumbprint del cert autofirmado local (`8856…45C`);
   - `checksums.txt` subido junto al instalador (`InventarioPro-Setup-firmado`);
   - sin tags ni GitHub Release creados.

Si el run falla con `403`: revisa (en este orden) región/endpoint, rol `Certificate Profile Signer` propagado, y el subject de la federated credential.

## 11. Auditoría de lo creado

```bash
az artifact-signing show   -g "<RESOURCE_GROUP>" -n "<AS_ACCOUNT>"
az artifact-signing certificate-profile show -g "<RESOURCE_GROUP>" --account-name "<AS_ACCOUNT>" -n "<AS_CERT_PROFILE>"
az role assignment list --assignee "<CLIENT_ID>" --scope "<CERT_PROFILE_RESOURCE_ID>" -o table
```

## 12. Costo y rotación

- SKU **Basic** vs **Premium**: precio **por firma** (consulta la página de precios de Artifact Signing; no se fijan cifras aquí).
- Los certificados de Artifact Signing rotan cada **3 días**: el timestamp RFC 3161 (`http://timestamp.acs.microsoft.com`) en el workflow es **obligatorio** para que las firmas sigan siendo válidas después de la rotación.
- Revocación: el perfil se puede desactivar desde el portal; una vez firmado y con timestamp, revocar el perfil no invalida las firmas ya emitidas (depende del hash/editor para reputación de SmartScreen).

## 13. Rollback

- Si algo falla en el modo test: borra la credencial federada (`az ad app federated-credential credential delete --id "<CLIENT_ID>" --federated-credential-id "<NAME>"`), corrige y repite — nada del repo cambió (el workflow sigue en `.template` hasta que pase el test).
- Para volver al flujo actual (PFX autofirmado para builds internos), basta con no definir `AS_*`: el hook `sign` hace fallback a `WIN_CSC_LINK` y el workflow `desktop.yml` sigue operando como hoy.
