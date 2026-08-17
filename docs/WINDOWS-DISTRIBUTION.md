# Distribución en Windows — firma y SmartScreen

**Fecha:** 2026-08-17 · **Versión de referencia:** 1.0.3 (release candidate)

Este documento describe el estado real de la firma del instalador de InventarioPro para Windows, qué significa para los usuarios finales y las alternativas disponibles.

## 1. Certificado actual: autofirmado

El instalador se firma con un certificado propio del proyecto (`desktop/certs/inventariopro.pfx`, creado con `desktop/scripts/create-cert.ps1`):

| Propiedad | Valor |
|---|---|
| Subject | `CN=InventarioPro, O=InventarioPro, C=AR` |
| Issuer | `CN=InventarioPro, O=InventarioPro, C=AR` (mismo → autofirmado) |
| Thumbprint | `885634401FAD34FC52D7FC16A38955D682DF456C` |
| Validez | 2026-08-14 → 2029-08-14 |
| Timestamp | DigiCert SHA256 RSA4096 Timestamp Responder (presente, real) |

### Qué significa

- **Firma criptográficamente válida:** sí. `Get-AuthenticodeSignature` devuelve `Status = Valid` en la máquina donde el certificado está instalado en el almacén de confianza local. El archivo no fue alterado después de firmarlo y el timestamp de DigiCert fija la hora de firma.
- **Confianza pública:** no. Al ser autofirmado, la cadena de confianza no conecta con una CA pública. En otras máquinas Windows, SmartScreen puede mostrar **"Windows protected your PC"** / **"More info → Run anyway"** o la advertencia de **"unrecognized app"** la primera vez que se descarga.
- **Adecuado para:** desarrollo, pruebas internas, entornos controlados y distribución manual donde se instruye a los usuarios a aceptar la advertencia una vez.

### Puntos clave sobre firma y SmartScreen

- **Una firma válida no elimina la reputación negativa o desconocida.** SmartScreen combina la identidad del editor, el hash del archivo y el historial de descargas/reputación del ejecutable.
- La reputación se construye con el tiempo y con volúmenes de descargas limpias; empieza "desconocida", no "confiable".
- **Cada release debe firmarse** con el mismo editor para acumular reputación de forma coherente.
- **Modificar el archivo después de firmarlo invalida o degrada la firma** (el hash ya no coincide). Verificar siempre con `Get-AuthenticodeSignature` el artefacto final que se publica.
- Un certificado autofirmado **no debe describirse como listo para distribución pública general**.

## 2. Alternativas comparadas

| Opción | Costo | Confianza | SmartScreen | Notas |
|---|---|---|---|---|
| **1. Autofirmado (actual)** | Gratis (generado local) | Solo local, por máquina | Advertencia en cada máquina nueva | Suficiente para pruebas/entornos controlados; no apto para distribución pública general |
| **2. Certificado OV de CA pública** (p. ej. DigiCert, Sectigo, SSL.com) | ~100–400 USD/año (aprox., varía) | Cadena pública verificable | Muestra el editor; **aún puede advertir al principio** | El nombre del editor aparece en "More info"; la reputación mejora con descargas limpias. No exige nada de hardware |
| **3. Microsoft Artifact Signing** | Incluido en planes de CI/CD de Microsoft (Azure DevOps / GitHub Actions con flujo apropiado) | Identidad validada por Microsoft | Menor fricción; reputación progresiva | Pensado para automatizar releases en pipelines; la clave vive gestionada en la nube, no en el repo |
| **4. Microsoft Store** | Tarifa de cuenta de desarrollador (una vez) | Firma de Microsoft, máxima confianza | Fricción mínima (App Installer) | Otro modelo de publicación: distribución por la Store, no por instalador directo |

> **No** se recomienda comprar un certificado EV únicamente para "evitar SmartScreen". Un EV mejora la confianza de la cadena y muestra el editor, pero no es un bypass garantizado de SmartScreen; la reputación sigue dependiendo del historial.

## 3. Recomendación

- Mantener el autofirmado para **builds de prueba y QA interno**.
- Para la **primera distribución pública** de 1.0.3: firmar con un **certificado OV de una CA pública** (o adoptar **Microsoft Artifact Signing** si se automatiza por CI/CD) y documentar la advertencia inicial de SmartScreen a los usuarios.
- Verificar siempre el artefacto final:
  ```powershell
  Get-AuthenticodeSignature <ruta-del-instalador>
  ```
  - `Valid` + CA pública → apto para distribución pública.
  - `Valid` + autofirmado → técnicamente empaquetado; **no** apto para distribución pública sin reconocer el riesgo.
  - `NotSigned` / `HashMismatch` / `UnknownError` → no publicar.
