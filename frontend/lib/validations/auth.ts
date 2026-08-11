// =============================================================================
// Schemas zod compartidos (auth)
// =============================================================================

import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Email inválido.'),
  password: z.string().min(1, 'La contraseña es obligatoria.'),
});

export const registerSchema = z
  .object({
    email: z.string().email('Email inválido.'),
    password: z
      .string()
      .min(8, 'Mínimo 8 caracteres.')
      .regex(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/, 'Debe incluir letras y números.'),
    nombre: z.string().min(1, 'El nombre es obligatorio.').max(120),
  });

export const forgotPasswordSchema = z.object({
  email: z.string().email('Email inválido.'),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20, 'Token inválido.'),
    new_password: z
      .string()
      .min(8, 'Mínimo 8 caracteres.')
      .regex(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/, 'Debe incluir letras y números.'),
    confirm_password: z.string(),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirm_password'],
  });

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'La contraseña actual es obligatoria.'),
    new_password: z
      .string()
      .min(8, 'Mínimo 8 caracteres.')
      .regex(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/, 'Debe incluir letras y números.'),
    confirm_password: z.string(),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirm_password'],
  });

export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Debes confirmar con tu contraseña.'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
