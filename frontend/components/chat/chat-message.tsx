'use client';

import type { JSX } from 'react';

import { cn } from '@/lib/utils';
import type { ChatMessage as Msg } from '@/lib/chat-types';

interface ChatMessageBubbleProps {
  message: Msg;
}

export function ChatMessageBubble({ message }: ChatMessageBubbleProps): JSX.Element {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
          isUser
            ? 'rounded-br-sm bg-accent-600 text-white'
            : 'rounded-bl-sm border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)]',
        )}
      >
        {message.content}
      </div>
    </div>
  );
}

export function ChatTypingIndicator(): JSX.Element {
  return (
    <div className="flex justify-start">
      <div className="inline-flex items-center gap-1.5 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm">
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
        <span className="sr-only">El asistente está escribiendo</span>
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: number }): JSX.Element {
  return (
    <span
      // animate-bounce se desactiva globalmente con prefers-reduced-motion.
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-400"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}
