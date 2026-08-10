// =============================================================================
// ChatMessageBubble + ChatTypingIndicator - tests de la UI de mensajes
// =============================================================================

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ChatMessageBubble, ChatTypingIndicator } from './chat-message';
import type { ChatMessage } from '@/lib/chat-types';

function makeMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: 'm1',
    conversation_id: 'c1',
    role,
    content,
    created_at: '2024-01-15T00:00:00.000Z',
  };
}

describe('ChatMessageBubble', () => {
  it('muestra el contenido del mensaje', () => {
    render(<ChatMessageBubble message={makeMessage('assistant', 'Hola, ¿en qué te ayudo?')} />);
    expect(screen.getByText('Hola, ¿en qué te ayudo?')).toBeInTheDocument();
  });

  it('alinea a la derecha los mensajes del usuario', () => {
    const { container } = render(<ChatMessageBubble message={makeMessage('user', '¿Cuántos productos tengo?')} />);
    expect(container.querySelector('.justify-end')).not.toBeNull();
    expect(screen.getByText('¿Cuántos productos tengo?')).toBeInTheDocument();
  });

  it('alinea a la izquierda los mensajes del asistente', () => {
    const { container } = render(<ChatMessageBubble message={makeMessage('assistant', 'Tienes 3 productos.')} />);
    expect(container.querySelector('.justify-start')).not.toBeNull();
    expect(container.querySelector('.justify-end')).toBeNull();
  });
});

describe('ChatTypingIndicator', () => {
  it('muestra los 3 puntos del indicador de escritura', () => {
    const { container } = render(<ChatTypingIndicator />);
    // Los 3 puntos son spans animados (sin texto accesible).
    expect(container.querySelectorAll('span.animate-bounce')).toHaveLength(3);
  });
});
