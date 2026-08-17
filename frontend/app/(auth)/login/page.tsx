'use client';

import { Suspense, useState, type JSX } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { loginSchema, type LoginInput } from '@/lib/validations/auth';
import { useAuth } from '@/hooks/use-auth';
import { extractErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { Logo } from '@/components/ui/logo';

function LoginForm(): JSX.Element {
  const { login } = useAuth();
  const params = useSearchParams();
  const justRegistered = params?.get('registered') === 'true';

  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginInput): Promise<void> => {
    setServerError(null);
    try {
      await login(data);
    } catch (err) {
      setServerError(extractErrorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <Logo className="mb-2" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Inicia sesión</h1>
        <p className="mt-1 text-sm text-gray-700">
          Accede a tu inventario personal.
        </p>
      </div>

      {justRegistered && (
        <Alert variant="success">
          Cuenta creada. Revisa tu email para verificarla y luego inicia sesión.
        </Alert>
      )}

      {serverError && <Alert variant="error">{serverError}</Alert>}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="tu@email.com"
            {...register('email')}
            error={errors.email?.message}
          />
        </div>

        <div className="space-y-1">
          <div className="flex justify-between">
            <Label htmlFor="password">Contraseña</Label>
            <Link
              href="/forgot-password"
              className="text-sm text-accent-400 hover:text-accent-300"
            >
              ¿La olvidaste?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register('password')}
            error={errors.password?.message}
          />
        </div>

        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          Entrar
        </Button>
      </form>

      <p className="text-center text-sm text-gray-700">
        ¿No tienes cuenta?{' '}
        <Link href="/register" className="font-medium text-accent-400 hover:text-accent-300">
          Regístrate
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage(): JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Logo symbolClassName="h-12 w-12" />
          <h1 className="text-2xl font-semibold text-gray-900">Inicia sesión</h1>
          <p className="text-sm text-gray-700">Cargando…</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
