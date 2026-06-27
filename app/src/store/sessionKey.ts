// Session-key helpers — the pure string-keying functions that map a
// (workspaceId, sessionId) pair to the canonical keys used across the store and
// the run/AI-edit channel registries.
//
// Extracted from useStore.ts as part of the streaming-logic decomposition
// (architect M3). These are pure functions with no store access, so this module
// imports nothing from useStore and cannot join the store import cycle. It is the
// dependency base the channel registry sits on. useStore.ts re-exports runKey and
// chatTurnKey so existing `import { runKey } from './useStore'` sites keep working.
import type { AiEditChannel } from './channelTypes';
import type { WorkflowSessionKey } from './storeState';

export function workflowSessionKeyId(sessionKey: WorkflowSessionKey): string {
  return `${sessionKey.workspaceId ?? ''}::${sessionKey.sessionId ?? ''}`;
}

export function runKey(
  workspaceId: string | null,
  sessionId: string | null,
): string {
  return workflowSessionKeyId({ workspaceId, sessionId });
}

export function chatTurnKey(sessionKey: string, messageId: string): string {
  return `${sessionKey}::chat::${messageId}`;
}

export function channelMatchesSession(
  ch: Pick<AiEditChannel, 'sessionKey' | 'workspaceId' | 'sessionId'>,
  workspaceId: string | null,
  sessionId: string | null,
): boolean {
  return ch.sessionKey === runKey(workspaceId, sessionId);
}
