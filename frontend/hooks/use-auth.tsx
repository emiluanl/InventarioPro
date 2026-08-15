'use client';

// =============================================================================
// AuthProvider + useAuth
// =============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import { api, extractErrorMessage, SESSION_EXPIRED_EVENT } from '@/lib/api';
import type {
  LoginInput,
  RegisterInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  ChangePasswordInput,
} from '@/lib/validations/auth';

export interface AuthUser {
  id: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  forgotPassword: (input: ForgotPasswordInput) => Promise<string>;
  resetPassword: (input: ResetPasswordInput) => Promise<string>;
  resendVerificationEmail: (input: ForgotPasswordInput) => Promise<string>;
  changePassword: (input: ChangePasswordInput) => Promise<string>;
  deleteAccount: (password: string) => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const PUBLIC_ROUTES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
];

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  // El caché de React Query NO debe sobrevivir un cambio de sesión: las claves
  // de productos no incluyen el usuario, así que un resultado cacheado (vacío
  // o de OTRA cuenta) se mostraría al siguiente usuario durante el staleTime
  // (60s) sin refetch. Se limpia al entrar, al salir y si la sesión muere.
  const clearQueryCache = useCallback((): void => {
    queryClient.clear();
  }, [queryClient]);

  // Cargar sesión al arrancar
  useEffect(() => {
    const loadSession = async (): Promise<void> => {
      try {
        const { data } = await api.get<AuthUser>('/auth/me');
        setUser(data);
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };
    void loadSession();
  }, []);

  // Proteger rutas del dashboard
  useEffect(() => {
    if (isLoading) return;

    const isPublic = PUBLIC_ROUTES.some((r) => pathname?.startsWith(r));
    if (!user && !isPublic) {
      router.replace('/login');
    } else if (user && isPublic) {
      router.replace('/dashboard');
    }
  }, [user, isLoading, pathname, router]);

  // Sesión expirada/revocada (el interceptor de api.ts emite este evento cuando
  // el refresh falla). Cerramos la sesión con router.replace (navegación SPA,
  // SIN recargar la página): recargar aquí reintentaría /auth/me y volvería a
  // fallar, creando un bucle infinito de recargas.
  //
  // Ojo: /auth/me dispara el refresh también sin sesión previa (para restaurar
  // la sesión de quien tiene el refresh cookie válido), así que el evento llega
  // a visitantes anónimos en rutas públicas (login, register, verify-email…).
  // Ahí NO redirigimos: expulsaría de /register o rompería el enlace de
  // verificación de /verify-email. El redirect solo aplica en rutas protegidas.
  useEffect(() => {
    const onSessionExpired = (): void => {
      setUser(null);
      clearQueryCache();
      const isPublic = PUBLIC_ROUTES.some((r) => pathname?.startsWith(r));
      if (!isPublic) {
        router.replace('/login');
      }
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  }, [router, pathname, clearQueryCache]);

  const login = useCallback(
    async (input: LoginInput): Promise<void> => {
      const { data } = await api.post<AuthUser>('/auth/login', input);
      clearQueryCache();
      setUser(data);
      router.replace('/dashboard');
    },
    [router, clearQueryCache],
  );

  const register = useCallback(
    async (input: RegisterInput): Promise<void> => {
      await api.post('/auth/register', input);
      // Tras registrarse, vamos a login para que el usuario entre con sus credenciales.
      router.replace('/login?registered=true');
    },
    [router],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      // Aunque falle, limpiamos el estado local.
    }
    clearQueryCache();
    setUser(null);
    router.replace('/login');
  }, [router, clearQueryCache]);

  const forgotPassword = useCallback(
    async (input: ForgotPasswordInput): Promise<string> => {
      try {
        const { data } = await api.post<{ message: string }>(
          '/auth/forgot-password',
          input,
        );
        return data.message;
      } catch (err) {
        throw new Error(extractErrorMessage(err));
      }
    },
    [],
  );

  const resetPassword = useCallback(
    async (input: ResetPasswordInput): Promise<string> => {
      try {
        // confirm_password es solo validación de UI; el backend (whitelist
        // estricta) rechazaría la propiedad extra.
        const { confirm_password: _confirm, ...payload } = input;
        const { data } = await api.post<{ message: string }>(
          '/auth/reset-password',
          payload,
        );
        return data.message;
      } catch (err) {
        throw new Error(extractErrorMessage(err));
      }
    },
    [],
  );

  const resendVerificationEmail = useCallback(
    async (input: ForgotPasswordInput): Promise<string> => {
      try {
        const { data } = await api.post<{ message: string }>(
          '/auth/resend-verification',
          input,
        );
        return data.message;
      } catch (err) {
        throw new Error(extractErrorMessage(err));
      }
    },
    [],
  );

  const changePassword = useCallback(
    async (input: ChangePasswordInput): Promise<string> => {
      try {
        // confirm_password es solo validación de UI; el backend (whitelist
        // estricta) rechazaría la propiedad extra.
        const { confirm_password: _confirm, ...payload } = input;
        const { data } = await api.post<{ message: string }>(
          '/auth/change-password',
          payload,
        );
        return data.message;
      } catch (err) {
        throw new Error(extractErrorMessage(err));
      }
    },
    [],
  );

  const deleteAccount = useCallback(
    async (password: string): Promise<string> => {
      try {
        const { data } = await api.delete<{ message: string }>('/auth/account', {
          data: { password },
        });
        clearQueryCache();
        setUser(null);
        router.replace('/login');
        return data.message;
      } catch (err) {
        throw new Error(extractErrorMessage(err));
      }
    },
    [router, clearQueryCache],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      login,
      register,
      logout,
      forgotPassword,
      resetPassword,
      resendVerificationEmail,
      changePassword,
      deleteAccount,
    }),
    [
      user,
      isLoading,
      login,
      register,
      logout,
      forgotPassword,
      resetPassword,
      resendVerificationEmail,
      changePassword,
      deleteAccount,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  }
  return ctx;
}
