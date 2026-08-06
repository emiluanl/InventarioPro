'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';

import { registerSchema, type RegisterInput } from '@/lib/validations/auth';
import { useAuth } from '@/hooks/use-auth';
import { extractErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';

export default function RegisterPage(): JSX.Element {
  const { register: registerUser } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterInput): Promise<void> => {
    setServerError(null);
    try {
      await registerUser(data);
    } catch (err) {
      setServerError(extractErrorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Crear cuenta</h1>
        <p className="mt-1 text-sm text-gray-600">
          Empieza a registrar tus productos y garantías.
        </p>
      </div>

      {serverError && <Alert variant="error">{serverError}</Alert>}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="nombre">Nombre</Label>
          <Input
            id="nombre"
            autoComplete="name"
            {...register('nombre')}
            error={errors.nombre?.message}
          />
        </div>

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
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            {...register('password')}
            error={errors.password?.message}
          />
          <p className="text-xs text-gray-500">
            Mínimo 8 caracteres, con letras y números.
          </p>
        </div>

        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          Crear cuenta
        </Button>
      </form>

      <p className="text-center text-sm text-gray-600">
        ¿Ya tienes cuenta?{' '}
        <Link href="/login" className="font-medium text-accent-600 hover:text-accent-700">
          Inicia sesión
        </Link>
      </p>
    </div>
  );
}
