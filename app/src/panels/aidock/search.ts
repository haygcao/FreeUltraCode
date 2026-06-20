import { summarizeAnswer } from '@/core/interaction';
import { cleanMessageText } from '@/components/ai/lib/messageText';
import type { Message } from '@/store/types';

export type SearchMatchSource = 'text' | 'interaction';

export interface SearchMatch {
  id: string;
  messageId: string;
  source: SearchMatchSource;
}

export function normalizeSearchQuery(value: string): string {
  return value.trim().toLowerCase();
}

export function previousUserText(messages: Message[], messageId: string): string {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index <= 0) return '';
  for (let i = index - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'user') return message.text.trim();
  }
  return '';
}

export function serializeConversation(messages: Message[]): string {
  return messages
    .filter((m) => !m.localOnly)
    .map((m) => {
      const role =
        m.role === 'user' ? '## 用户' : m.role === 'system' ? '## 系统' : '## 助手';
      return `${role}\n\n${m.text.trim()}`;
    })
    .join('\n\n---\n\n');
}

function interactionSearchText(message: Message): string {
  if (!message.interaction) return '';
  const parts = [message.interaction.prompt];
  if (message.interaction.options?.length) {
    parts.push(message.interaction.options.join(' '));
  }
  if (message.interactionAnswer) {
    parts.push(summarizeAnswer(message.interaction, message.interactionAnswer));
  }
  return parts.filter(Boolean).join('\n');
}

export function buildSearchMatches(messages: Message[], query: string): SearchMatch[] {
  if (!query) return [];

  const out: SearchMatch[] = [];
  const lowerQuery = query.toLowerCase();

  for (const message of messages) {
    const segments: Array<{ source: SearchMatchSource; text: string }> = [];
    const cleaned = cleanMessageText(message.text);
    if (cleaned.trim()) {
      segments.push({ source: 'text', text: cleaned });
    }
    const interactionText = interactionSearchText(message);
    if (interactionText) {
      segments.push({ source: 'interaction', text: interactionText });
    }

    for (const segment of segments) {
      const lowerText = segment.text.toLowerCase();
      let start = 0;
      let hitIndex = 0;

      while (start <= lowerText.length) {
        const found = lowerText.indexOf(lowerQuery, start);
        if (found === -1) break;
        out.push({
          id: `${message.id}:${segment.source}:${hitIndex}`,
          messageId: message.id,
          source: segment.source,
        });
        hitIndex += 1;
        start = found + Math.max(lowerQuery.length, 1);
      }
    }
  }

  return out;
}
