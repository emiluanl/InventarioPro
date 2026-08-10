import { redirect } from 'next/navigation';

/**
 * Página raíz: la app no tiene landing propia, así que redirigimos al
 * dashboard. El AuthProvider (use-auth) reenvía a /login a los usuarios
 * sin sesión.
 */
export default function IndexPage(): never {
  redirect('/dashboard');
}
