'use client';

import { useState, type JSX } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';

import { forgotPasswordSchema, type ForgotPasswordInput } from '@/lib/validations/auth';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';

export default function ForgotPasswordPage(): JSX.Element {
  const { forgotPassword } = useAuth();
  const [success, setSuccess] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordInput): Promise<void> => {
    setServerError(null);
    setSuccess(null);
    try {
      const message = await forgotPassword(data);
      setSuccess(message);
    } catch (err) {
      setServerError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Recuperar contraseña</h1>
        <p className="mt-1 text-sm text-gray-700">
          Te enviaremos un enlace para restablecerla.
        </p>
      </div>

      {success && <Alert variant="success">{success}</Alert>}
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

        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          Enviar enlace
        </Button>
      </form>

      <p className="text-center text-sm text-gray-700">
        <Link href="/login" className="font-medium text-accent-400 hover:text-accent-300">
          Volver a iniciar sesión
        </Link>
      </p>
    </div>
  );
}
