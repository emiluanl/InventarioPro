'use client';

import { useState, type JSX } from 'react';
import { cn } from '@/lib/utils';

import { ChatPanel } from './chat-panel';

export function ChatWidget(): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);

  return (
    <>
      {open && <ChatPanel onClose={() => setOpen(false)} />}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Abrir chat con asistente"
        className={cn(
          'fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-accent-600 text-white shadow-lg transition hover:bg-accent-700 sm:right-6',
          'focus:outline-none focus:ring-4 focus:ring-accent-300',
        )}
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>
    </>
  );
}
