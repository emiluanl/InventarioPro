'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { api, extractErrorMessage } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';

type VerifyState = 'loading' | 'success' | 'error';

function VerifyEmailForm(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const token = params?.get('token') ?? null;
  const { resendVerificationEmail } = useAuth();

  const [state, setState] = useState<VerifyState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [resendEmail, setResendEmail] = useState<string>('');
  const [resendResult, setResendResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [resending, setResending] = useState<boolean>(false);

  // El token es de UN SOLO USO: en desarrollo React StrictMode ejecuta los
  // efectos dos veces, y una segunda llamada fallaría con "inválido o expirado"
  // pisando el resultado de la primera. Este ref garantiza una única llamada.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const verify = async (): Promise<void> => {
      if (!token) {
        setState('error');
        setError(
          'El enlace de verificación no incluye un token. Abre el enlace completo del email.',
        );
        return;
      }
      try {
        await api.post('/auth/verify-email', { token });
        setState('success');
      } catch (err) {
        setState('error');
        setError(extractErrorMessage(err));
      }
    };

    void verify();
  }, [token]);

  if (state === 'loading') {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-2xl font-semibold text-gray-900">Verificando tu email…</h1>
        <p className="text-sm text-gray-600">Estamos confirmando tu cuenta. Un momento.</p>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-gray-900">¡Email verificado!</h1>
        <Alert variant="success">
          Tu cuenta está activa. Ya puedes iniciar sesión con tu email y contraseña.
        </Alert>
        <Button className="w-full" onClick={() => router.push('/login')}>
          Ir a iniciar sesión
        </Button>
      </div>
    );
  }

  const onResend = async (): Promise<void> => {
    const email = resendEmail.trim();
    if (!email || resending) return;
    setResendResult(null);
    setResending(true);
    try {
      const msg = await resendVerificationEmail({ email });
      setResendResult({ ok: true, msg });
    } catch (err) {
      setResendResult({ ok: false, msg: (err as Error).message });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">No pudimos verificar tu email</h1>
      <Alert variant="error">
        {error ?? 'El enlace de verificación es inválido o expiró.'}
      </Alert>
      <p className="text-sm text-gray-600">
        El enlace es válido por 24 horas. Si expiró, puedes pedir uno nuevo
        escribiendo tu email abajo.
      </p>

      <div className="space-y-3 rounded-md border border-gray-200 p-4">
        <p className="text-sm font-medium text-gray-700">Reenviar enlace de verificación</p>
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="tu@email.com"
            value={resendEmail}
            onChange={(e) => setResendEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void onResend();
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void onResend()}
            isLoading={resending}
            disabled={!resendEmail.trim()}
          >
            Reenviar
          </Button>
        </div>
        {resendResult && (
          <Alert variant={resendResult.ok ? 'success' : 'error'}>{resendResult.msg}</Alert>
        )}
      </div>

      <Button variant="ghost" className="w-full" onClick={() => router.push('/login')}>
        Volver a iniciar sesión
      </Button>
    </div>
  );
}

export default function VerifyEmailPage(): JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="space-y-4 text-center">
          <h1 className="text-2xl font-semibold text-gray-900">Cargando…</h1>
        </div>
      }
    >
      <VerifyEmailForm />
    </Suspense>
  );
}
