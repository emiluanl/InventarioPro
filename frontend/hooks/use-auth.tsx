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
  type ReactNode,
} from 'react';
import { useRouter, usePathname } from 'next/navigation';

import { api, extractErrorMessage } from '@/lib/api';
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

  const login = useCallback(
    async (input: LoginInput): Promise<void> => {
      const { data } = await api.post<AuthUser>('/auth/login', input);
      setUser(data);
      router.replace('/dashboard');
    },
    [router],
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
    setUser(null);
    router.replace('/login');
  }, [router]);

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
        const { data } = await api.post<{ message: string }>(
          '/auth/reset-password',
          input,
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
        setUser(null);
        router.replace('/login');
        return data.message;
      } catch (err) {
        throw new Error(extractErrorMessage(err));
      }
    },
    [router],
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
