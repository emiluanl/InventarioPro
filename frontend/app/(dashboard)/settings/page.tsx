'use client';

// =============================================================================
// Configuración de la cuenta: cambio de contraseña y eliminación de cuenta.
// =============================================================================

import { useState, type JSX } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { changePasswordSchema, type ChangePasswordInput } from '@/lib/validations/auth';
import { useAuth } from '@/hooks/use-auth';
import { extractErrorMessage } from '@/lib/api';
import { useLayoutMode, type LayoutMode } from '@/lib/layout-mode';
import { useTheme, type ThemeMode } from '@/lib/theme-mode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';

function LayoutModeSelect(): JSX.Element {
  const { mode, setMode } = useLayoutMode();
  return (
    <select
      value={mode}
      onChange={(e) => setMode(e.target.value as LayoutMode)}
      className="mt-1 w-full rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm"
    >
      <option value="auto">Automático (según pantalla)</option>
      <option value="mobile">Forzado móvil</option>
      <option value="desktop">Forzado escritorio</option>
    </select>
  );
}

function ThemeSelect(): JSX.Element {
  const { theme, setTheme, isLight } = useTheme();
  return (
    <select
      value={theme}
      onChange={(e) => setTheme(e.target.value as ThemeMode)}
      className="mt-1 w-full rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm"
    >
      <option value="dark">Oscuro (predeterminado)</option>
      <option value="light">Claro</option>
      {/* Con 'Sistema' activo, la opción muestra el resultado EFECTIVO que
          resolvió el SO (ej. '→ Oscuro'), igual que el badge de la cabecera. */}
      <option value="system">
        {theme === 'system'
          ? `Sistema (según el dispositivo) → ${isLight ? 'Claro' : 'Oscuro'}`
          : 'Sistema (según el dispositivo)'}
      </option>
    </select>
  );
}

export default function SettingsPage(): JSX.Element {
  const { user, changePassword, deleteAccount, logout } = useAuth();

  // --- Cambio de contraseña ---
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
  });

  const onSubmitPassword = async (data: ChangePasswordInput): Promise<void> => {
    setPwError(null);
    setPwSuccess(null);
    try {
      const msg = await changePassword(data);
      setPwSuccess(msg);
      reset();
      // El backend revocó TODAS las sesiones: volvemos al login para re-entrar.
      setTimeout(() => {
        void logout();
      }, 1800);
    } catch (err) {
      setPwError(extractErrorMessage(err));
    }
  };

  // --- Eliminación de cuenta (dos pasos para evitar accidentes) ---
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const onDelete = async (): Promise<void> => {
    setDeleteError(null);
    setDeleting(true);
    try {
      // El provider limpia la sesión y redirige a /login tras el éxito.
      await deleteAccount(deletePassword);
    } catch (err) {
      setDeleteError(extractErrorMessage(err));
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Configuración</h1>
        <p className="mt-1 text-sm text-gray-700">
          Cuenta: <span className="font-medium text-gray-900">{user?.email}</span>
        </p>
      </div>

      {/* --------------------------------------------------------------------- */}
      {/* VISTA (modo de layout)                                                */}
      {/* --------------------------------------------------------------------- */}
      <section className="rounded-lg border border-gray-200 bg-gray-100 p-6">
        <h2 className="text-lg font-semibold text-gray-900">Vista</h2>
        <p className="mt-1 text-sm text-gray-700">
          Elige el modo de layout. “Automático” se adapta al tamaño de la pantalla
          (móvil o escritorio); “Forzado móvil” usa la barra de navegación inferior y
          la vista compacta aunque estés en una pantalla grande; “Forzado escritorio”
          usa la cabecera superior y la tabla aunque estés en una pantalla chica.
        </p>

        <label className="mt-4 block max-w-xs">
          <span className="text-sm font-medium text-gray-800">Modo de vista</span>
          <LayoutModeSelect />
        </label>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* TEMA (oscuro / claro)                                                 */}
      {/* --------------------------------------------------------------------- */}
      <section className="rounded-lg border border-gray-200 bg-gray-100 p-6">
        <h2 className="text-lg font-semibold text-gray-900">Tema</h2>
        <p className="mt-1 text-sm text-gray-700">
          Elige la apariencia de la app. “Oscuro” es el tema predeterminado
          (interfaz oscura, industrial y de alto contraste); “Claro” usa
          superficies blancas y texto oscuro; “Sistema” sigue la preferencia
          del dispositivo y se actualiza en vivo si la cambias. La elección se
          guarda en este navegador.
        </p>

        <label className="mt-4 block max-w-xs">
          <span className="text-sm font-medium text-gray-800">Tema de la app</span>
          <ThemeSelect />
        </label>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* CAMBIO DE CONTRASEÑA                                                  */}
      {/* --------------------------------------------------------------------- */}
      <section className="rounded-lg border border-gray-200 bg-gray-100 p-6">
        <h2 className="text-lg font-semibold text-gray-900">Cambiar contraseña</h2>
        <p className="mt-1 text-sm text-gray-700">
          Al cambiarla se cerrarán todas tus sesiones (incluida la actual).
        </p>

        {pwSuccess && (
          <Alert variant="success" className="mt-4">
            {pwSuccess}
          </Alert>
        )}
        {pwError && (
          <Alert variant="error" className="mt-4">
            {pwError}
          </Alert>
        )}

        <form onSubmit={handleSubmit(onSubmitPassword)} className="mt-4 space-y-4">
          <div className="space-y-1">
            <Label htmlFor="current_password">Contraseña actual</Label>
            <Input
              id="current_password"
              type="password"
              autoComplete="current-password"
              {...register('current_password')}
              error={errors.current_password?.message}
            />
            {errors.current_password?.message && (
              <p className="mt-1 text-xs text-red-600">{errors.current_password.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="new_password">Nueva contraseña</Label>
            <Input
              id="new_password"
              type="password"
              autoComplete="new-password"
              {...register('new_password')}
              error={errors.new_password?.message}
            />
            <p className="text-xs text-gray-600">Mínimo 8 caracteres, con letras y números.</p>
            {errors.new_password?.message && (
              <p className="mt-1 text-xs text-red-600">{errors.new_password.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="confirm_password">Confirmar nueva contraseña</Label>
            <Input
              id="confirm_password"
              type="password"
              autoComplete="new-password"
              {...register('confirm_password')}
              error={errors.confirm_password?.message}
            />
            {errors.confirm_password?.message && (
              <p className="mt-1 text-xs text-red-600">{errors.confirm_password.message}</p>
            )}
          </div>

          <Button type="submit" isLoading={isSubmitting}>
            Cambiar contraseña
          </Button>
        </form>
      </section>

      {/* --------------------------------------------------------------------- */}
      {/* ELIMINACIÓN DE CUENTA                                                 */}
      {/* --------------------------------------------------------------------- */}
      <section className="rounded-lg border border-red-500/30 bg-red-500/10 p-6">
        <h2 className="text-lg font-semibold text-red-300">Zona de peligro</h2>
        <p className="mt-1 text-sm text-red-300/80">
          Eliminar tu cuenta borra de forma permanente tu usuario, productos, adjuntos,
          notificaciones y conversaciones. Esta acción no se puede deshacer.
        </p>

        {deleteError && (
          <Alert variant="error" className="mt-4">
            {deleteError}
          </Alert>
        )}

        {!confirmingDelete ? (
          <Button
            variant="danger"
            className="mt-4"
            onClick={() => setConfirmingDelete(true)}
          >
            Eliminar mi cuenta
          </Button>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="space-y-1">
              <Label htmlFor="delete_password">
                Confirma con tu contraseña para eliminar la cuenta
              </Label>
              <Input
                id="delete_password"
                type="password"
                autoComplete="current-password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <Button
                variant="danger"
                isLoading={deleting}
                disabled={!deletePassword}
                onClick={() => void onDelete()}
              >
                Confirmar eliminación definitiva
              </Button>
              <Button
                variant="secondary"
                disabled={deleting}
                onClick={() => {
                  setConfirmingDelete(false);
                  setDeletePassword('');
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
