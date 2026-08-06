'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { api, extractErrorMessage } from '@/lib/api';
import type {
  ChatMessage,
  ChatConversation,
  SendMessageResponse,
} from '@/lib/chat-types';

const CHAT_KEY = ['chat'] as const;

export function useConversations() {
  return useQuery({
    queryKey: [...CHAT_KEY, 'conversations'],
    queryFn: async () => {
      const { data } = await api.get<ChatConversation[]>('/chat/conversations');
      return data;
    },
  });
}

export function useMessages(conversationId: string | undefined) {
  return useQuery({
    queryKey: [...CHAT_KEY, 'messages', conversationId],
    queryFn: async () => {
      const { data } = await api.get<ChatMessage[]>(
        `/chat/conversations/${conversationId}/messages`,
      );
      return data;
    },
    enabled: !!conversationId,
    staleTime: 30 * 1000,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation<
    SendMessageResponse,
    Error,
    { conversationId?: string; message: string }
  >({
    mutationFn: async ({ conversationId, message }) => {
      try {
        const { data } = await api.post<SendMessageResponse>('/chat/message', {
          conversation_id: conversationId,
          message,
        });
        return data;
      } catch (err) {
        throw new Error(extractErrorMessage(err));
      }
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: [...CHAT_KEY, 'conversations'] });
      void qc.invalidateQueries({
        queryKey: [...CHAT_KEY, 'messages', data.conversation_id],
      });
    },
  });
}
