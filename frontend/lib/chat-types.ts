// =============================================================================
// Tipos compartidos del chat
// =============================================================================

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface ChatConversation {
  id: string;
  user_id: string;
  titulo: string | null;
  created_at: string;
  updated_at: string;
  _count?: { messages: number };
}

export interface SendMessageResponse {
  conversation_id: string;
  message: string;
  tool_calls?: string[];
}
