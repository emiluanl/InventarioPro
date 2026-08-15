// =============================================================================
// e2e: chat con function calling (mock de DeepSeek)
// =============================================================================
// El backend e2e apunta DEEPSEEK_API_BASE al mock local (e2e/mock-deepseek.cjs).
// Este test cubre el ciclo COMPLETO de function calling sin API key real:
//   1. El usuario pregunta cuántos productos tiene.
//   2. La "IA" (mock) decide llamar a buscar_productos.
//   3. El backend ejecuta la tool contra su BD (filtrada por user_id).
//   4. El mock formula la respuesta con el conteo REAL del resultado.
//   5. La conversación queda persistida.
//
// Las preguntas fuera del guion (p. ej. "¿Qué compré en agosto?") hacen que el
// mock devuelva 401 → el backend degrada al fallback amable (cubierto por
// full-flow.spec.ts).
// =============================================================================

import { expect, test } from '@playwright/test';

import { API_URL } from './env';
import { login, randomEmail, registerAndVerify } from './helpers';

test('chat: la IA (mock) cuenta los productos del usuario vía function calling', async ({
  page,
  request,
}) => {
  const email = randomEmail('chatmock');
  await registerAndVerify(request, email);
  await login(page, email);

  // Inventario: 2 productos, creados por API con la sesión del navegador.
  const mk = (nombre: string, categoria: string, fecha: string, precio: number) =>
    page.request.post(`${API_URL}/products`, {
      data: {
        nombre,
        categoria_id: categoria,
        fecha_compra: fecha,
        tipo_compra: 'FISICO',
        precio,
        moneda: 'USD',
        estado: 'NUEVO',
      },
    });
  const p1 = await mk('Licuadora Oster', 'system-electrodomésticos', '2026-08-15', 150);
  expect(p1.ok(), `crear producto 1 falló: ${p1.status()} ${await p1.text()}`).toBeTruthy();
  const p2 = await mk('Notebook Dell', 'system-electrónica', '2026-07-10', 1200);
  expect(p2.ok(), `crear producto 2 falló: ${p2.status()} ${await p2.text()}`).toBeTruthy();

  // --- Pregunta por la UI ---
  await page.getByRole('button', { name: 'Abrir chat con asistente' }).click();
  await page.getByPlaceholder('Escribe un mensaje…').fill('¿Cuántos productos tengo en mi inventario?');
  await page.getByRole('button', { name: 'Enviar' }).click();

  // El mock responde con el conteo REAL (salió de buscar_productos del backend).
  await expect(page.getByText('Tienes 2 productos en tu inventario.')).toBeVisible({
    timeout: 20_000,
  });

  // --- La conversación persiste al cerrar y reabrir el chat ---
  await page.getByRole('button', { name: 'Cerrar chat' }).click();
  await page.getByRole('button', { name: 'Abrir chat con asistente' }).click();
  await expect(page.getByText('¿Cuántos productos tengo en mi inventario?')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('Tienes 2 productos en tu inventario.')).toBeVisible();

  // --- Server-side: la respuesta de /chat/message reporta la tool ejecutada ---
  const conversations = await (await page.request.get(`${API_URL}/chat/conversations`)).json();
  const conversationId = conversations[0].id as string;

  const res = await page.request.post(`${API_URL}/chat/message`, {
    data: { conversation_id: conversationId, message: '¿Cuántos productos tengo?' },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.tool_calls).toContain('buscar_productos');
  expect(body.message).toBe('Tienes 2 productos en tu inventario.');
});
