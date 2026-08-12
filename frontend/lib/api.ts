// =============================================================================
// lib/api.ts - cliente HTTP (axios)
// =============================================================================

import axios, { AxiosError, type AxiosInstance } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/**
 * Endpoints de /auth/ donde un 401 NO debe disparar el refresh de sesión:
 * son fallos de credenciales legítimos (login/register) o flujos que ya
 * gestionan su propio error. `/auth/me` queda FUERA de esta lista a
 * propósito: si el access token expiró, recargar la página debe refrescar
 * la sesión en vez de expulsar al usuario al login.
 */
const AUTH_NO_REFRESH = [
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/refresh',
  '/auth/resend-verification',
  '/auth/verify-email',
];

/**
 * Evento global que AuthProvider escucha para cerrar la sesión cuando el
 * refresh falla. NO usamos window.location aquí: recargar la página tras un
 * 401 monta AuthProvider de nuevo, que reintenta /auth/me, que vuelve a
 * fallar... y eso es un bucle infinito de recargas.
 */
export const SESSION_EXPIRED_EVENT = 'auth:session-expired';

function notifySessionExpired(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
}

/**
 Cliente axios con:
   - Base URL apuntando al backend.
   - withCredentials: las cookies httpOnly se envían en cada request.
   - Interceptor de respuesta: si recibe 401, intenta refresh una vez.
 */
export const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

/** Origen del backend (sin el prefijo /api), para resolver URLs relativas de archivos. */
export const API_ORIGIN: string = new URL(API_URL).origin;

/**
 * Convierte una URL de adjunto en una URL absoluta usable en <img>/<a>.
 * - Supabase ya devuelve URLs absolutas (firmadas): se usan tal cual.
 * - El provider local devuelve URLs relativas (/uploads/...): hay que
 *   prefijarlas con el ORIGEN del backend; si no, el navegador las resuelve
 *   contra el origen del frontend y dan 404 (imagen rota).
 */
export function resolveFileUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_ORIGIN}${url.startsWith('/') ? url : `/${url}`}`;
}

let isRefreshing = false;
let refreshSubscribers: Array<() => void> = [];

function onRefreshed(): void {
  refreshSubscribers.forEach((cb) => cb());
  refreshSubscribers = [];
}

function addRefreshSubscriber(cb: () => void): void {
  refreshSubscribers.push(cb);
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as
      | (typeof error.config & { _retry?: boolean })
      | undefined;

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !AUTH_NO_REFRESH.some((path) => originalRequest.url?.includes(path))
    ) {
      if (isRefreshing) {
        return new Promise((resolve) => {
          addRefreshSubscriber(() => {
            resolve(api(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        await axios.post(
          `${API_URL}/auth/refresh`,
          {},
          { withCredentials: true },
        );
        isRefreshing = false;
        onRefreshed();
        return api(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        refreshSubscribers = [];
        // Si el refresh falla, dejamos que el error se propague y avisamos a
        // AuthProvider para cerrar la sesión con navegación SPA. NO recargamos
        // la página: eso montaría AuthProvider otra vez → /auth/me 401 → refresh
        // falla → recarga → bucle infinito.
        notifySessionExpired();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

/**
 Extrae un mensaje de error legible de una respuesta del backend.
 */
export function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined;
    if (data?.message) {
      return Array.isArray(data.message) ? data.message[0] : data.message;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Error inesperado.';
}
