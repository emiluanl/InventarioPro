'use client';

import { cn } from '@/lib/utils';
import type { ChatMessage as Msg } from '@/lib/chat-types';

interface ChatMessageBubbleProps {
  message: Msg;
}

export function ChatMessageBubble({ message }: ChatMessageBubbleProps): JSX.Element {
  const isUser = message.role === 'user';
  return (
    <div
      className={cn(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
          isUser
            ? 'bg-accent-600 text-white rounded-br-sm'
            : 'bg-gray-100 text-gray-900 rounded-bl-sm',
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
      <div className="inline-flex items-center gap-1 rounded-2xl bg-gray-100 px-3 py-2 text-sm text-gray-600">
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: number }): JSX.Element {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}
