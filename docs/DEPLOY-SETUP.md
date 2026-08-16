# Guía de activación del deploy automatizado (staging + producción)

Guía paso a paso para dejar operativo el workflow
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), que hace
`git pull` + `docker compose up -d --build` en el servidor vía SSH.

> **Resumen del flujo** (detalles en [DEPLOYMENT.md](../DEPLOYMENT.md)):
> el workflow despliega a `staging` o `production`, cada uno con sus propios
> secrets (`STAGING_*` y `DEPLOY_*`). Hoy se dispara **solo manualmente**
> eligiendo el entorno (el push a `main` está desactivado temporalmente,
> ver §5); cuando se reactive, el push a `main` desplegará a producción.

---

## 0. Prerrequisitos

- Repo alojado en GitHub con el workflow `deploy.yml` en `main`.
- **Dos servidores** (o uno para empezar con staging): VPS/máquina con
  **Docker Engine** (no Docker Desktop) y acceso **SSH**.
- Un dominio (opcional pero recomendado) para HTTPS con Caddy.

> 💡 Si solo tienes un servidor, empieza por **staging**: crea el entorno,
> valida el workflow completo, y recién después configura producción con el
> mismo procedimiento.

---

## 1. Crear el servidor de staging

### 1.1. Provisionar el servidor

El proveedor puede ser cualquiera (DigitalOcean, Hetzner, Vultr, Oracle Free,
una máquina local de la LAN…). Requisitos:

- Ubuntu/Debian reciente (o cualquier distro con Docker).
- **SSH habilitado** y un usuario con `sudo` (p. ej. `deploy`).

### 1.2. Instalar Docker

```bash
# En el servidor, con el usuario con sudo:
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # para usar docker sin sudo
# Cierra y vuelve a entrar (o ejecuta: newgrp docker)
```

Verifica:

```bash
docker --version && docker compose version
```

### 1.3. Preparar la clave SSH para el deploy

El workflow necesita una **clave privada PEM sin passphrase** para entrar al
servidor. Genera un par dedicado **en tu máquina local**:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/inventariopro_deploy -C "github-actions" -N ""
```

Instala la **pública** en el servidor (como el usuario de deploy, no root):

```bash
ssh-copy-id -i ~/.ssh/inventariopro_deploy.pub deploy@<IP_STAGING>
# Verifica el login sin contraseña:
ssh -i ~/.ssh/inventariopro_deploy deploy@<IP_STAGING> 'echo OK'
```

> 🔒 El contenido de `~/.ssh/inventariopro_deploy` (la **privada**) es el
> valor del secret `STAGING_SSH_KEY`. Guárdala en un gestor de contraseñas;
> nunca la subas a git.

### 1.4. Clonar el repo y crear el `.env.prod`

```bash
ssh -i ~/.ssh/inventariopro_deploy deploy@<IP_STAGING>
git clone https://github.com/emiluanl/InventarioPro.git ~/InventarioPro-staging
cd ~/InventarioPro-staging

# El .env.prod mezcla las variables del backend + las del compose (Postgres,
# Redis, dominio público). La plantilla raíz .env.prod.example (commiteada,
# SIN secretos) cubre ambas: cópiala y completa los valores reales.
cp .env.prod.example .env.prod
nano .env.prod
```

> ⚠️ `.env.prod.example` incluye TODAS las variables que el compose exige
> (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `PUBLIC_API_URL`,
> `CORS_ORIGIN`, `JWT_ACCESS_SECRET`, `APP_BASE_URL`) con placeholders
> (`genera-con-openssl-rand-...`): **reemplaza cada placeholder** antes de
> arrancar o el primer `docker compose up` falla. El `.env.prod` **nunca se
> sube a git** (está en `.gitignore`); es local al servidor. Si usas staging
> y producción, cada servidor tiene el suyo (no compartas secretos entre
> ambos).

### 1.5. Variables mínimas del `.env.prod`

El compose exige estas (`:?required` en `docker-compose.prod.yml`):

| Variable | Ejemplo | Notas |
|---|---|---|
| `POSTGRES_USER` | `inventariopro` | usuario de la BD (ya en `.env.prod.example`) |
| `POSTGRES_PASSWORD` | `genera-una-fuerte` | `openssl rand -base64 24` (ya en `.env.prod.example`) |
| `REDIS_PASSWORD` | `genera-una-fuerte` | Redis arranca con `--requirepass`; misma clave en backend y healthcheck |
| `JWT_ACCESS_SECRET` | `genera-una-fuerte` | firma de tokens (`openssl rand -hex 32`) |
| `APP_BASE_URL` | `https://app.tudominio.com` | base de los enlaces de email |
| `CORS_ORIGIN` | `https://app.tudominio.com` | exacto, sin barra final |
| `PUBLIC_API_URL` | `https://app.tudominio.com/api` | se inlinea en el bundle del frontend (build-time) |

> Todas estas variables (y las opcionales de abajo) ya están en la plantilla
> raíz `.env.prod.example`; solo falta completarlas con valores reales.

Y las opcionales según el stack (con su default):

| Variable | Default | Notas |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | vacías | si `STORAGE_PROVIDER=supabase` |
| `STORAGE_PROVIDER` | `supabase` (default del compose) | `local` = guardar en disco del servidor (**despliegue actual**) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_PORT` | vacíos | para envío real de emails |
| `DEEPSEEK_API_KEY` | vacío | chat con IA |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | vacíos | notificaciones push |
| `TZ` | `UTC` | zona horaria de backups/cron |
| `FRONTEND_DOMAIN` | `inventariopro.example.com` | para Caddy |

> Las variables de **backups y monitoreo** (`BACKUP_SCHEDULE`, `BACKUP_KEEP_DAYS`,
> `BACKUP_PING_URL`, `MONITOR_PING_URL`, `RCLONE_REMOTE`, `MONITOR_WEBHOOK_URL`…)
> se documentan en DEPLOYMENT.md §7-§8; todas ya vienen en `.env.prod.example`.

### 1.6. Primer arranque manual (validar el servidor)

```bash
cd ~/InventarioPro-staging
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# Espera ~30s y verifica:
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
# El backend es INTERNO (sin puerto publicado): su health se mira desde
# dentro del contenedor, igual que hace su healthcheck:
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend \
  node -e "fetch('http://localhost:3001/api/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j)))"
```

Debe responder `{"status":"ok","db":"up","redis":"up",...}`. ⚠️ El backend
NO publica puerto (red interna de docker); solo están publicados el
**frontend en :3000** y **Caddy en 80/443**. Sin dominio, la API solo se
prueba dentro del contenedor (como arriba) o con `docker inspect --format
'{{.State.Health.Status}}' inventariopro-backend`. Con dominio, Caddy levanta
HTTPS solo y la API queda en `https://tu-dominio/api`.

> ✅ Si este arranque manual funciona, el workflow hará exactamente lo mismo
> de forma automática.

### 1.7. Runbook completo — crear staging y probar el primer deploy (copiar y pegar)

> ⚡ **Automatizado:** todo esta sección (clave SSH, Docker, clon, `.env.prod`
> con secretos aleatorios, primer arranque y verificación) se ejecuta en un
> comando con [`scripts/setup-staging.sh`](../scripts/setup-staging.sh):
> `npm run setup:staging -- <IP_STAGING>`. Opciones: `-u/--user` (default
> `deploy`), `-d/--domain` (default `localhost`), `-s/--setup-secrets` (configura
> además los `STAGING_*` en GitHub si tenés `gh` autenticado). Lo que sigue es
> la misma secuencia a mano, para entender cada paso.

Secuencia única, de cero a primer deploy funcionando. Reemplaza `<IP_STAGING>`
(y las credenciales entre `<...>`) antes de ejecutar. Genera contraseñas
**distintas** para staging y producción.

**1. Máquina local — clave SSH del deploy:**

```bash
ssh-keygen -t ed25519 -f ~/.ssh/inventariopro_deploy -C "github-actions" -N ""
ssh-copy-id -i ~/.ssh/inventariopro_deploy.pub deploy@<IP_STAGING>
ssh -i ~/.ssh/inventariopro_deploy deploy@<IP_STAGING> 'echo OK'   # debe decir OK
```

**2. En el servidor — Docker Engine + repo:**

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" && newgrp docker
docker --version && docker compose version

git clone https://github.com/emiluanl/InventarioPro.git ~/InventarioPro-staging
cd ~/InventarioPro-staging
```

**3. En el servidor — `.env.prod` desde la plantilla** (reemplaza cada
placeholder `genera-...` / `tu-...`):

```bash
cp .env.prod.example .env.prod
openssl rand -hex 32   # usa el resultado en JWT_ACCESS_SECRET
openssl rand -hex 24   # usa el resultado en POSTGRES_PASSWORD
openssl rand -hex 24   # y otro distinto en REDIS_PASSWORD
nano .env.prod
# ⚠️ Sin dominio real: FRONTEND_DOMAIN=localhost  → Caddy sirve HTTP en :80
#    sin intentar Let's Encrypt. Con dominio: FRONTEND_DOMAIN=staging.tudominio.com
```

**4. En el servidor — primer arranque manual** (exactamente lo que el
workflow hará vía SSH):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# Espera ~30-60s y verifica:
docker compose -f docker-compose.prod.yml --env-file .env.prod ps

docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend \
  node -e "fetch('http://localhost:3001/api/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j)))"
# Debe responder {"status":"ok","db":"up","redis":"up",...}

curl -s -o /dev/null -w "frontend: %{http_code}\n" http://localhost:3000/login   # 200
curl -s -o /dev/null -w "caddy:    %{http_code}\n" http://localhost/login        # 200
```

**5. Probar el deploy AUTOMATIZADO a staging** (tras configurar los secrets
de §2):

1. Navegador → **Actions** → **Deploy** → **Run workflow** → environment:
   `staging`.
2. El workflow repite el paso 4 por SSH: `git pull` + `docker compose up -d
   --build` y verifica el health del backend (falla con `::error::` si no
   quedó `healthy`).
3. Al terminar, confirma en el servidor que el health sigue OK con el mismo
   `exec backend node -e fetch(...)` del paso 4.

> ✅ Con el paso 4 funcionando y el workflow verde contra `staging`, ya puedes
> repetir §1.7 y §2 para **producción** (`DEPLOY_*`) — cambiando `FRONTEND_DOMAIN`
> al dominio real y `DEPLOY_DIR` a `/opt/inventariopro` si ese es el directorio.

---

## 2. Configurar los secrets en GitHub

Se configura en **Settings → Secrets and variables → Actions** del repo:

```
https://github.com/emiluanl/InventarioPro/settings/secrets/actions
```

**Opción A — navegador:** pulsa **"New repository secret"** por cada secret
de la tabla de abajo. El valor de la clave SSH es el **contenido COMPLETO**
del archivo privado (con las líneas `-----BEGIN OPENSSH PRIVATE KEY-----` y
`-----END ...-----` incluidas).

**Opción B — CLI** (`gh secret set`, si tienes `gh` autenticado con permisos
de admin):

```bash
gh secret set STAGING_HOST    --body "<IP_STAGING>"
gh secret set STAGING_USER    --body "deploy"
gh secret set STAGING_SSH_KEY < ~/.ssh/inventariopro_deploy   # archivo, no string
gh secret set STAGING_PORT    --body "22"                     # solo si no es 22
# Para producción: repetir con DEPLOY_HOST / DEPLOY_USER / DEPLOY_SSH_KEY / DEPLOY_PORT
```

### Secrets de STAGING

| Secret | Valor |
|---|---|
| `STAGING_HOST` | IP o dominio del servidor de staging |
| `STAGING_USER` | usuario SSH (p. ej. `deploy`) |
| `STAGING_SSH_KEY` | contenido COMPLETO de `~/.ssh/inventariopro_deploy` (privada PEM) |

Opcionales:
| Secret/Variable | Valor |
|---|---|
| `STAGING_PORT` (secret) | puerto SSH, si no es 22 |
| `STAGING_DIR` (**variable**, no secret) | ruta del repo, si no es `~/InventarioPro-staging` |

### Secrets de PRODUCCIÓN

| Secret | Valor |
|---|---|
| `DEPLOY_HOST` | IP o dominio del servidor de producción |
| `DEPLOY_USER` | usuario SSH |
| `DEPLOY_SSH_KEY` | clave privada PEM del deploy a producción |

Opcionales: `DEPLOY_PORT`, `DEPLOY_DIR` (variable, default `~/InventarioPro`).

> ⚠️ El servidor de producción actual tiene el repo en **`/opt/inventariopro`**
> (ver DEPLOYMENT.md §9 y §12): define `DEPLOY_DIR=/opt/inventariopro` como
> variable, o el workflow hará el `git pull` en `~/InventarioPro` y levantará
> un stack duplicado.

> **Variables vs Secrets**: los valores que NO son credenciales (rutas) se
> configuran en `Settings → Secrets and variables → Actions → Variables`,
> no como secrets (los secrets se ocultan en los logs).
>
> ℹ️ En la misma página viven los secrets de los OTROS workflows del repo
> (p. ej. `WIN_CSC_BASE64` / `WIN_CSC_KEY_PASSWORD`, que firman el
> instalador del desktop, ver `.github/workflows/desktop.yml`). No borres
> los que no sean de deploy.

---

## 3. Probar el deploy en staging

1. Ve a **Actions** → **Deploy** → **Run workflow**.
2. En el desplegable **Environment**, elige `staging`.
3. Lanza el job y observa los pasos:
   - `Resolver configuración del entorno` → mapea a los secrets `STAGING_*`.
   - `Validar secrets configurados` → falla con mensaje claro si falta alguno.
   - `Desplegar vía SSH` → hace `git pull` + `docker compose up -d --build`
     y verifica el healthcheck del backend.
4. Cuando termine, confirma en el servidor:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod ps
   ```

> 🔁 Si el job falla, el paso `Validar secrets` o el log del SSH te dirán
> exactamente qué falta. Los errores típicos: clave PEM con passphrase,
> usuario sin permisos de Docker, o `.env.prod` incompleto.

---

## 4. (Opcional) Proteger producción con environments

Para exigir aprobación manual antes de tocar prod:

1. `Settings → Environments → New environment` → crea `production` (y
   `staging` si quieres).
2. En `production` → **Required reviewers** → añade tu usuario.
3. En `Deployment branches` → deja `main`.

Con esto, el job que usa `environment: production` quedará en espera de tu
aprobación antes de ejecutar el SSH.

---

## 5. Activar el deploy automático

> 🔕 **Estado actual (16-08-2026)**: los secrets `DEPLOY_*` / `STAGING_*` aún
> NO están configurados en GitHub, y el trigger de push a `main` sigue
> **desactivado** en `.github/workflows/deploy.yml` para que el CI no falle
> en cada push con secrets ausentes.

Reactivar el trigger (una vez configurados los secrets y validado staging):

1. Abre `.github/workflows/deploy.yml` y busca el bloque comentado del header
   ("El trigger automático de push a main está DESACTIVADO...").
2. Añade `push` dentro del bloque `on:` existente:

   ```yaml
   on:
     workflow_dispatch:
       inputs:
         environment: ...
     push:              # ← lo que hay que añadir
       branches: [main]
   ```

3. Commit y push:

   ```bash
   git add .github/workflows/deploy.yml
   git commit -m "CI: activa el deploy automático por push a main"
   git push
   ```

4. Verifica: en la pestaña **Actions** debe aparecer un run de **Deploy**
   (entorno `production`) en cada push a `main`. Si `Validar secrets` pasa y
   el SSH despliega y deja el backend `healthy`, quedó activo.

Para controlar cuándo despliega: elige `main` como **Deployment branches**
en el environment de `production` (paso 4) y el push automático pasará por
la aprobación de revisores antes del SSH.

---

## 6. Troubleshooting rápido

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Faltan secrets para el entorno elegido` | Secrets con nombre distinto | Revisa la tabla de §2 (mayúsculas exactas) |
| `Permission denied (publickey)` | Clave PEM incorrecta o con passphrase | Regenera sin passphrase, reinstala la pública |
| `docker: permission denied` | Usuario no está en el grupo docker | `sudo usermod -aG docker $USER` + relogin |
| Compose falla con `required` | Faltan variables del `.env.prod` | Rellena las de §1.5 |
| Job pasa pero backend no healthy | Imagen vieja o BD con migraciones | `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build` manual |

---

## 7. Resumen de verificación

- [ ] Servidor staging con Docker y SSH funcionando
- [ ] `git clone` + `.env.prod` completo + primer `up` manual OK
- [ ] Clave SSH del deploy generada e instalada
- [ ] Secrets `STAGING_HOST/USER/SSH_KEY` en GitHub
- [ ] Workflow lanzado a `staging` con éxito
- [ ] (Opcional) Environments con revisores para producción
- [ ] Secrets `DEPLOY_HOST/USER/SSH_KEY` configurados
- [ ] Trigger automático reactivado (§5) — el push a `main` dispara Deploy
- [ ] Primer push a `main` desplegó a producción
