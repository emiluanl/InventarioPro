// =============================================================================
// Preload - puente seguro entre la web (localhost:3010) y Electron.
// La app web no necesita APIs nativas: solo exponemos versión/plataforma por
// si el frontend quiere mostrarlas. contextIsolation está activo.
// =============================================================================

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  version: process.env.npm_package_version || require('./package.json').version,
  platform: process.platform,
});
