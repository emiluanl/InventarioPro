// =============================================================================
// ChatPanel - tests del panel del asistente
// =============================================================================
// Los hooks de React Query (useConversations, useMessages, useSendMessage) se
// mockean para controlar cada estado: vacío, con historial, envío, error y
// cierre. No se toca la red ni el backend.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/hooks/use-chat', () => ({
  useConversations: vi.fn(),
  useMessages: vi.fn(),
  useSendMessage: vi.fn(),
}));

import {
  useConversations,
  useMessages,
  useSendMessage,
} from '@/hooks/use-chat';
import { ChatPanel } from './chat-panel';
import type { ChatConversation, ChatMessage } from '@/lib/chat-types';

const mockConversations = vi.mocked(useConversations);
const mockMessages = vi.mocked(useMessages);
const mockSend = vi.mocked(useSendMessage);

const conversation: ChatConversation = {
  id: 'c1',
  user_id: 'u1',
  titulo: null,
  created_at: '2024-01-15T00:00:00.000Z',
  updated_at: '2024-01-15T00:00:00.000Z',
};

const history: ChatMessage[] = [
  {
    id: 'm1',
    conversation_id: 'c1',
    role: 'assistant',
    content: 'Hola, ¿en qué te ayudo?',
    created_at: '2024-01-15T00:00:00.000Z',
  },
  {
    id: 'm2',
    conversation_id: 'c1',
    role: 'user',
    content: '¿Cuántos productos tengo?',
    created_at: '2024-01-15T00:00:01.000Z',
  },
];

const mutateAsync = vi.fn().mockResolvedValue({ conversation_id: 'c1', message: 'ok' });

function mockSendState(overrides: Record<string, unknown> = {}): void {
  mockSend.mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    mutateAsync,
    ...overrides,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendState();
});

describe('ChatPanel', () => {
  it('muestra el estado de carga mientras llegan los mensajes', () => {
    mockConversations.mockReturnValue({ data: undefined, isLoading: true } as never);
    mockMessages.mockReturnValue({ data: undefined, isLoading: true } as never);

    render(<ChatPanel onClose={() => undefined} />);
    expect(screen.getByText('Cargando mensajes…')).toBeInTheDocument();
  });

  it('muestra el saludo y el botón deshabilitado sin conversaciones', () => {
    mockConversations.mockReturnValue({ data: [] } as never);
    mockMessages.mockReturnValue({ data: [], isLoading: false } as never);

    render(<ChatPanel onClose={() => undefined} />);
    expect(screen.getByText('¡Hola! Soy tu asistente.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
  });

  it('abre la conversación más reciente y muestra su historial', async () => {
    mockConversations.mockReturnValue({ data: [conversation] } as never);
    mockMessages.mockReturnValue({ data: history, isLoading: false } as never);

    render(<ChatPanel onClose={() => undefined} />);

    // El panel abre automáticamente la última conversación.
    await waitFor(() => expect(mockMessages).toHaveBeenCalledWith('c1'));
    expect(screen.getByText('Hola, ¿en qué te ayudo?')).toBeInTheDocument();
    expect(screen.getByText('¿Cuántos productos tengo?')).toBeInTheDocument();
  });

  it('envía el mensaje al hacer click en Enviar y limpia el input', async () => {
    mockConversations.mockReturnValue({ data: [] } as never);
    mockMessages.mockReturnValue({ data: [], isLoading: false } as never);
    const user = userEvent.setup();

    render(<ChatPanel onClose={() => undefined} />);

    await user.type(screen.getByPlaceholderText('Escribe un mensaje…'), 'hola');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(mutateAsync).toHaveBeenCalledWith({ conversationId: undefined, message: 'hola' });
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Escribe un mensaje…')).toHaveValue(''),
    );
  });

  it('muestra el error del envío en un alert', () => {
    mockConversations.mockReturnValue({ data: [] } as never);
    mockMessages.mockReturnValue({ data: [], isLoading: false } as never);
    mockSendState({
      isError: true,
      error: new Error('El servicio de IA no está configurado.'),
    });

    render(<ChatPanel onClose={() => undefined} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'El servicio de IA no está configurado.',
    );
  });

  it('cierra el panel al pulsar el botón de cerrar', async () => {
    mockConversations.mockReturnValue({ data: [] } as never);
    mockMessages.mockReturnValue({ data: [], isLoading: false } as never);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<ChatPanel onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Cerrar chat' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
