// =============================================================================
// Tests del DeepSeekClient — timeout por intento, presupuesto total y retry
// =============================================================================
// Verifica el contrato del cliente (fix de los bugs de retry):
//   1. Timeout POR INTENTO con AbortController independiente (un timeout en el
//      intento 1 no contamina el intento 2).
//   2. Presupuesto TOTAL: los reintentos nunca pueden excederlo.
//   3. Retry SOLO para errores de red transitorios y HTTP 5xx (una vez).
//   4. NO se reintentan 4xx (payload/key) ni timeouts — fallback inmediato.
//   5. Limpieza del timer con finally.
// =============================================================================

import { ServiceUnavailableException } from '@nestjs/common';
import { DeepSeekClient } from '../src/chat/DeepSeek/DeepSeek.client';
import { ChatCompletionRequest } from '../src/chat/DeepSeek/chat.types';

const originalFetch = globalThis.fetch;

function makeClient(overrides: Record<string, string> = {}): DeepSeekClient {
  const config = { get: (k: string) => overrides[k] } as never;
  return new DeepSeekClient(config);
}

function okResponse(body: unknown = { choices: [] }): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function httpError(status: number): Response {
  return { ok: false, status } as Response;
}

/** fetch que nunca resuelve: solo se libera cuando el AbortController aborta. */
function hangingFetch() {
  return jest.fn().mockImplementation(
    (_url: string, opts: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      }),
  );
}

describe('DeepSeekClient — timeout, presupuesto y retry', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    jest.useRealTimers();
    (globalThis as { fetch: unknown }).fetch = originalFetch;
  });

  it('responde en el primer intento sin reintentos', async () => {
    fetchMock.mockResolvedValue(okResponse());
    const client = makeClient({ DEEPSEEK_API_KEY: 'key' });

    await expect(client.chatCompletion({} as ChatCompletionRequest)).resolves.toEqual({
      choices: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reintenta una vez un HTTP 5xx y luego responde', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValueOnce(httpError(503)).mockResolvedValueOnce(okResponse());
    const client = makeClient({ DEEPSEEK_API_KEY: 'key' });

    const p = client.chatCompletion({} as ChatCompletionRequest);
    await jest.advanceTimersByTimeAsync(600); // backoff 500ms del intento 1
    await expect(p).resolves.toEqual({ choices: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('no reintenta un HTTP 4xx (payload o key mal)', async () => {
    fetchMock.mockResolvedValue(httpError(400));
    const client = makeClient({ DEEPSEEK_API_KEY: 'key' });

    await expect(client.chatCompletion({} as ChatCompletionRequest)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('timeout del intento: aborta con su propio controller y NO reintenta', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(hangingFetch());
    const client = makeClient({ DEEPSEEK_API_KEY: 'key', DEEPSEEK_TIMEOUT_MS: '50' });

    const p = client.chatCompletion({} as ChatCompletionRequest);
    // La aserción se adjunta ANTES de avanzar el reloj: cuando el abort dispara
    // la rejection, ya hay handler (si no, jest la cuenta como unhandled).
    const assertion = expect(p).rejects.toThrow(ServiceUnavailableException);
    await jest.advanceTimersByTimeAsync(60);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1); // el timeout no dispara retry
  });

  it('el presupuesto total impide el segundo intento si ya se consumió', async () => {
    jest.useFakeTimers();
    // 5xx inmediatos: el backoff (500ms) excede el presupuesto de 50ms.
    fetchMock.mockResolvedValue(httpError(503));
    const client = makeClient({
      DEEPSEEK_API_KEY: 'key',
      DEEPSEEK_TIMEOUT_MS: '100',
      DEEPSEEK_TOTAL_BUDGET_MS: '50',
    });

    const p = client.chatCompletion({} as ChatCompletionRequest);
    const assertion = expect(p).rejects.toThrow(ServiceUnavailableException);
    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reintenta un error de red transitorio y responde', async () => {
    jest.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce(okResponse());
    const client = makeClient({ DEEPSEEK_API_KEY: 'key' });

    const p = client.chatCompletion({} as ChatCompletionRequest);
    await jest.advanceTimersByTimeAsync(600);
    await expect(p).resolves.toEqual({ choices: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sin API key lanza el fallback sin tocar la red', async () => {
    const client = makeClient({});
    await expect(client.chatCompletion({} as ChatCompletionRequest)).rejects.toThrow(
      'no está configurado',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
