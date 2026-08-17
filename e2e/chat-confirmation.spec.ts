// =============================================================================
// e2e: ciclo consultivo REAL de crear_producto (deduplicación con confirmación)
// =============================================================================
// Cubre las tools separadas de punta a punta, SIN API key real (el backend e2e
// apunta DEEPSEEK_API_BASE al mock local e2e/mock-deepseek.cjs; cualquier
// llamada real a DeepSeek haría fallar el flujo, que solo funciona con el mock):
//
//   Turno 1: el usuario dice que compró NUEVAMENTE una licuadora (duplicado).
//            El mock llama crear_producto → el backend detecta el duplicado y
//            devuelve needs_confirmation con un confirmation_id REAL (opaco,
//            generado por el backend) y SIN IDs internos de productos.
//   Turno 2 "sí": el mock lee del historial (tool result materializado) el
//            confirmation_id real y llama SOLO confirmar_creacion_producto.
//            El producto se crea UNA vez, con los argumentos originales.
//   Reconfirma: el mock reenvía el MISMO id → el backend lo rechaza
//            (idempotente: no puede crear una segunda vez).
//
// Y la variante de cancelación (usuario distinto, estado aislado):
//   Turno 2 "no": el mock llama cancelar_creacion_producto → no se crea nada.
//   Reconfirma con el mismo id → rechazado.
//
// Las aserciones de BD usan pg (resuelto desde el node_modules del backend,
// igual que global-setup) contra la BD e2e dedicada.
// =============================================================================

import { createRequire } from 'node:module';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { API_URL, BACKEND_DIR, DATABASE_URL } from './env';
import { login, randomEmail, registerAndVerify } from './helpers';

const requireFromBackend = createRequire(join(BACKEND_DIR, 'package.json'));
const { Client } = requireFromBackend('pg');

const NOMBRE = 'Licuadora Oster';
const FECHA = '2026-08-15';
const TRIGGER_MSG = `Compré nuevamente una ${NOMBRE} el ${FECHA} por 150 USD`;

async function queryDatabase<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    const { rows } = await client.query(sql, params);
    return rows as T[];
  } finally {
    await client.end();
  }
}

/** Crea el producto duplicado por API (la sesión del navegador ya está logueada). */
async function createDuplicate(page: import('@playwright/test').Page) {
  const res = await page.request.post(`${API_URL}/products`, {
    data: {
      nombre: NOMBRE,
      fecha_compra: FECHA,
      tipo_compra: 'FISICO',
      precio: 150,
      moneda: 'USD',
      estado: 'NUEVO',
    },
  });
  expect(res.ok(), `crear duplicado falló: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function openChatAndSend(page: import('@playwright/test').Page, message: string) {
  // El chat puede quedar abierto del turno anterior: solo se abre si no está.
  const input = page.getByPlaceholder('Escribe un mensaje…');
  if (!(await input.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Abrir chat con asistente' }).click();
  }
  await input.fill(message);
  await page.getByRole('button', { name: 'Enviar' }).click();
}

/** ID del usuario logueado (para filtrar conteos por usuario: los tests corren en paralelo). */
async function currentUserId(page: import('@playwright/test').Page): Promise<string> {
  const me = await page.request.get(`${API_URL}/auth/me`);
  expect(me.ok(), `auth/me falló: ${me.status()}`).toBeTruthy();
  return (await me.json()).id as string;
}

async function countProductsInDb(userId: string): Promise<number> {
  const rows = await queryDatabase<{ n: string }>(
    'SELECT count(*) AS n FROM products WHERE user_id = $1 AND nombre = $2 AND deleted_at IS NULL',
    [userId, NOMBRE],
  );
  return Number(rows[0].n);
}

test('chat consultivo: duplicado → confirmar_creacion_producto con el id REAL → crea UNA vez (idempotente)', async ({
  page,
  request,
}) => {
  const email = randomEmail('chatconf');
  await registerAndVerify(request, email);
  await login(page, email);
  const userId = await currentUserId(page);
  await createDuplicate(page);

  // --- Turno 1: el usuario reporta la compra duplicada ---
  await openChatAndSend(page, TRIGGER_MSG);
  await expect(page.getByText('¿La creo igual?')).toBeVisible({ timeout: 20_000 });

  // El backend persistió el needs_confirmation REAL (auditoría) sin IDs internos.
  const conversations = await (await page.request.get(`${API_URL}/chat/conversations`)).json();
  const conversationId = conversations[0].id as string;
  const audit = await queryDatabase<{ function_result: string }>(
    `SELECT function_result FROM chat_messages
     WHERE conversation_id = $1 AND function_call IS NOT NULL
       AND function_result LIKE '%needs_confirmation%'
     ORDER BY created_at DESC LIMIT 1`,
    [conversationId],
  );
  expect(audit.length).toBe(1);
  const needs = JSON.parse(audit[0].function_result);
  expect(needs.needs_confirmation).toBe(true);
  expect(needs.confirmation_id).toMatch(/^[0-9a-f-]{36}$/);
  // La lista de similares NO expone el id interno del producto al LLM.
  expect(needs.similar[0]).not.toHaveProperty('id');
  expect(JSON.stringify(needs)).not.toContain('"id"');

  // --- Turno 2: el usuario confirma desde la interfaz ---
  await openChatAndSend(page, 'sí');
  await expect(page.getByText('Listo, la creé.')).toBeVisible({ timeout: 20_000 });

  // Creado EXACTAMENTE una vez, con los datos originales (2 en total: el
  // duplicado preexistente + la nueva creación).
  expect(await countProductsInDb(userId)).toBe(2);

  // --- Aparece en la interfaz (dashboard) ---
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: NOMBRE })).toHaveCount(2);

  // --- Idempotencia: el MISMO confirmation_id no puede crear una segunda vez ---
  const retry = await page.request.post(`${API_URL}/chat/message`, {
    data: { conversation_id: conversationId, message: 'confirma nuevamente' },
  });
  expect(retry.ok()).toBeTruthy();
  const body = await retry.json();
  expect(body.message).toBe('No pude crear el producto.');
  expect(await countProductsInDb(userId)).toBe(2);
});

test('chat consultivo: duplicado → cancelar_creacion_producto → NO crea (y el id queda inservible)', async ({
  page,
  request,
}) => {
  const email = randomEmail('chatcancel');
  await registerAndVerify(request, email);
  await login(page, email);
  const userId = await currentUserId(page);
  await createDuplicate(page);

  // --- Turno 1: duplicado detectado, la IA pregunta ---
  await openChatAndSend(page, TRIGGER_MSG);
  await expect(page.getByText('¿La creo igual?')).toBeVisible({ timeout: 20_000 });

  // --- Turno 2: el usuario rechaza ---
  await openChatAndSend(page, 'no');
  await expect(page.getByText('No se creó el producto.')).toBeVisible({ timeout: 20_000 });

  // No se creó nada (solo existe el duplicado preexistente).
  expect(await countProductsInDb(userId)).toBe(1);

  // --- Reconfirmar con el mismo id → rechazado ---
  const conversations = await (await page.request.get(`${API_URL}/chat/conversations`)).json();
  const conversationId = conversations[0].id as string;
  const retry = await page.request.post(`${API_URL}/chat/message`, {
    data: { conversation_id: conversationId, message: 'confirma nuevamente' },
  });
  expect(retry.ok()).toBeTruthy();
  const body = await retry.json();
  expect(body.message).toBe('No pude crear el producto.');
  expect(await countProductsInDb(userId)).toBe(1);
});
