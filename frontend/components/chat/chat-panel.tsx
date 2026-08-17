'use client';

import { useEffect, useRef, useState, type JSX } from 'react';

import {
  useConversations,
  useMessages,
  useSendMessage,
} from '@/hooks/use-chat';
import {
  ChatMessageBubble,
  ChatTypingIndicator,
} from './chat-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Logo } from '@/components/ui/logo';

interface ChatPanelProps {
  onClose: () => void;
}

export function ChatPanel({ onClose }: ChatPanelProps): JSX.Element {
  const { data: conversations, isLoading: conversationsLoading } = useConversations();
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);

  // Mientras no se elija una conversación explícitamente, usamos la más
  // reciente (la primera de la lista). Derivar en el render (en vez de un
  // useEffect con setState) cumple react-hooks/set-state-in-effect.
  const activeConversationId = conversationId ?? conversations?.[0]?.id;

  const { data: messages, isLoading } = useMessages(activeConversationId);
  const send = useSendMessage();

  const [input, setInput] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll al último mensaje.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, send.isPending]);

  const onSend = async (): Promise<void> => {
    const trimmed = input.trim();
    if (!trimmed || send.isPending) return;
    setInput('');
    try {
      await send.mutateAsync({ conversationId: activeConversationId, message: trimmed });
    } catch {
      // El error ya se muestra en send.error
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void onSend();
    }
  };

  return (
    // w-[min(92vw,380px)]: en móvil el panel nunca desborda el ancho del
    // teléfono (380px fijos desbordaban en pantallas < 400px).
    <div className="elev-3 fixed bottom-24 right-4 z-50 flex h-[min(560px,calc(100dvh-7rem))] w-[min(92vw,380px)] flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] sm:right-6">
      {/* Header */}
      <header className="flex items-center justify-between rounded-t-2xl border-b border-[var(--border)] bg-accent-600 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Logo variant="symbol" symbolClassName="h-6 w-6" />
          <div>
            <h2 className="text-sm font-semibold">Asistente InventarioPro</h2>
            <p className="text-xs opacity-80">Pregúntame sobre tus productos</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 hover:bg-accent-700"
          aria-label="Cerrar chat"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      {/* Mensajes */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* Mientras cargan las conversaciones (o los mensajes de la activa). */}
        {((conversationsLoading && !activeConversationId) ||
          (isLoading && activeConversationId)) && (
          <p className="text-center text-xs text-[var(--text-muted)]">Cargando mensajes…</p>
        )}

        {/* Sin conversaciones cargadas aún no aplica: el saludo solo cuando
            sabemos que no hay ninguna, o cuando la activa está vacía. */}
        {(!conversationsLoading && !activeConversationId) ||
          (messages && messages.length === 0) ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-[var(--text-secondary)]">
            <p className="font-medium">¡Hola! Soy tu asistente.</p>
            <p className="mt-1 text-xs">
              Prueba: "¿Qué compré en enero?" o "Registra una licuadora Oster que compré ayer por $150".
            </p>
          </div>
        ) : null}

        {messages?.map((m) => (
          <ChatMessageBubble key={m.id} message={m} />
        ))}

        {send.isPending && <ChatTypingIndicator />}

        {send.isError && (
          <Alert variant="error">{send.error.message}</Alert>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSend();
        }}
        className="flex items-center gap-2 border-t border-[var(--border)] p-3"
      >
        <Input
          placeholder="Escribe un mensaje…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={send.isPending}
        />
        <Button type="submit" isLoading={send.isPending} disabled={!input.trim()}>
          Enviar
        </Button>
      </form>

      {conversations && conversations.length > 1 && (
        <button
          type="button"
          onClick={() => setConversationId(undefined)}
          className="min-h-11 border-t border-[var(--border)] px-3 py-1.5 text-center text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"
        >
          + Nueva conversación
        </button>
      )}
    </div>
  );
}
