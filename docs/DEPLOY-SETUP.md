# Guía de activación del deploy automatizado (staging + producción)

Guía paso a paso para dejar operativo el workflow
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), que hace
`git pull` + `docker compose up -d --build` en el servidor vía SSH.

> **Resumen del flujo** (detalles en [DEPLOYMENT.md](../DEPLOYMENT.md)):
> el workflow despliega a `staging` o `production`, cada uno con sus propios
> secrets (`STAGING_*` y `DEPLOY_*`). Se dispara manualmente eligiendo el
> entorno, o automáticamente al pushear a `main` (producción).

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
git clone https://github.com/emiluanl/InventarioPro-2.0.git ~/InventarioPro-staging
cd ~/InventarioPro-staging

# Copia el ejemplo y rellena TODAS las variables (ver tabla abajo).
cp backend/.env.example .env.prod
nano .env.prod
```

> ⚠️ El `.env.prod` **nunca se sube a git** (está en `.gitignore`). Es local
> al servidor. Si usas staging y producción, cada servidor tiene el suyo.

### 1.5. Variables mínimas del `.env.prod`

El compose exige estas (`:?required`):

| Variable | Ejemplo | Notas |
|---|---|---|
| `POSTGRES_USER` | `inventariopro` | usuario de la BD |
| `POSTGRES_PASSWORD` | `genera-una-fuerte` | `openssl rand -base64 24` |
| `JWT_ACCESS_SECRET` | `genera-una-fuerte` | firma de tokens |
| `APP_BASE_URL` | `https://app.tudominio.com` | base de los enlaces de email |
| `CORS_ORIGIN` | `https://app.tudominio.com` | exacto, sin barra final |

Y las opcionales según el stack (con su default):

| Variable | Default | Notas |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | vacías | si `STORAGE_PROVIDER=supabase` |
| `STORAGE_PROVIDER` | `supabase` | o `local` (guardar en disco del servidor) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_PORT` | vacíos | para envío real de emails |
| `DEEPSEEK_API_KEY` | vacío | chat con IA |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | vacíos | notificaciones push |
| `TZ` | `UTC` | zona horaria de backups/cron |
| `FRONTEND_DOMAIN` | `inventariopro.example.com` | para Caddy |

### 1.6. Primer arranque manual (validar el servidor)

```bash
cd ~/InventarioPro-staging
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
# Espera ~30s y verifica:
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
curl -s http://localhost:3001/api/health
```

Debe responder `{"status":"ok","db":"up","redis":"up",...}`. Si el servidor
tiene dominio, Caddy levanta HTTPS solo; si no, la API queda en el puerto 3001
y el frontend en el 3000 (para pruebas internas basta).

> ✅ Si este arranque manual funciona, el workflow hará exactamente lo mismo
> de forma automática.

---

## 2. Configurar los secrets en GitHub

Todo se hace desde el navegador (o con `gh secret set` si tienes la CLI
autenticada con permisos de admin):

```
https://github.com/emiluanl/InventarioPro-2.0/settings/secrets/actions
```

Pulsa **"New repository secret"** por cada uno:

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

> **Variables vs Secrets**: los valores que NO son credenciales (rutas) se
> configuran en `Settings → Secrets and variables → Actions → Variables`,
> no como secrets (los secrets se ocultan en los logs).

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

El push a `main` dispara el workflow automáticamente. Dos opciones:

- **Inmediato**: haz el primer `git push` de la rama actual.
- **Controlando cuándo**: elige `main` como `Deployment branches` en el
  environment de producción (paso 4), y el push automático pasará por la
  aprobación.

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
- [ ] Primer push a `main` desplegó a producción
