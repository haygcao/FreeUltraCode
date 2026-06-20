import type { StoreState } from '@/store/useStore';

type ChatTitleState = Pick<
  StoreState,
  | 'activeSessionId'
  | 'activeWorkspaceId'
  | 'sessions'
  | 'sessionTree'
  | 'workflow'
>;

export function activeChatTitle(state: ChatTitleState): string {
  const activeSessionId = state.activeSessionId;
  if (!activeSessionId) return state.workflow.meta?.name ?? '';

  const activeSession = state.activeWorkspaceId
    ? (state.sessionTree[state.activeWorkspaceId]?.find(
        (session) => session.id === activeSessionId,
      ) ??
      state.sessions.find(
        (session) =>
          session.id === activeSessionId &&
          (session.workspaceId == null ||
            session.workspaceId === state.activeWorkspaceId),
      ))
    : state.sessions.find((session) => session.id === activeSessionId);

  return activeSession?.title?.trim() || state.workflow.meta?.name || '';
}

export function formatMessageTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ts));
}
