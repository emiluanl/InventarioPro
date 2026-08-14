'use client';

import { Suspense, useState, type JSX } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

import { resetPasswordSchema, type ResetPasswordInput } from '@/lib/validations/auth';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';

function ResetPasswordForm(): JSX.Element {
  const params = useSearchParams();
  const router = useRouter();
  const { resetPassword } = useAuth();
  const token = params?.get('token') ?? '';

  const [success, setSuccess] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token },
  });

  const onSubmit = async (data: ResetPasswordInput): Promise<void> => {
    setServerError(null);
    setSuccess(null);
    try {
      const message = await resetPassword(data);
      setSuccess(message);
      // Tras unos segundos, redirige a login.
      setTimeout(() => router.replace('/login'), 2500);
    } catch (err) {
      setServerError((err as Error).message);
    }
  };

  if (!token) {
    return (
      <Alert variant="error">
        Falta el token de recuperación. Abre el enlace del email o{' '}
        <Link href="/forgot-password" className="underline">
          solicítalo de nuevo
        </Link>
        .
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Nueva contraseña</h1>
        <p className="mt-1 text-sm text-gray-700">Elige una contraseña nueva.</p>
      </div>

      {success && <Alert variant="success">{success}</Alert>}
      {serverError && <Alert variant="error">{serverError}</Alert>}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <input type="hidden" {...register('token')} />

        <div className="space-y-1">
          <Label htmlFor="new_password">Nueva contraseña</Label>
          <Input
            id="new_password"
            type="password"
            autoComplete="new-password"
            {...register('new_password')}
            error={errors.new_password?.message}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="confirm_password">Confirma la contraseña</Label>
          <Input
            id="confirm_password"
            type="password"
            autoComplete="new-password"
            {...register('confirm_password')}
            error={errors.confirm_password?.message}
          />
        </div>

        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          Cambiar contraseña
        </Button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage(): JSX.Element {
  return (
    <Suspense fallback={<div>Cargando…</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
