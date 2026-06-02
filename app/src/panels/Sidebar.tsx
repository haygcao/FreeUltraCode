import { useState, useCallback, useEffect, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import StatusIndicator, { type StatusTone } from '@/components/StatusIndicator';
import {
  sessionLiveStatus,
  useStore,
  workflowDeleteProtectionReason,
  workflowSessionKeyId,
  type WorkflowDeleteProtectionReason,
} from '@/store/useStore';
import type { Session } from '@/store/types';
import type { WorkspaceSummary } from '@/store/history/types';
import type { Locale } from '@/lib/i18n';
import { useResizableWidth } from '@/lib/useResizableWidth';
import { t } from '@/lib/i18n';
import SettingsModal from './SettingsModal';

/**
 * CONTRACT: default export, no props. Left session rail.
 *
 * Top  : primary action — "+ New Workflow".
 * Bottom: session history list, sourced from the store; clicking switches the
 *         active session context.
 *
 * Mirrors design.html §06 "Left · 会话栏".
 */

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
  if (sameDay) return hhmm;
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
}

const WORKFLOW_HISTORY_PAGE_SIZE = 10;
const MAX_WORKFLOW_RENAME_LENGTH = 80;

function clampPercent(percent: number | null | undefined): number | null {
  if (percent == null || !Number.isFinite(percent)) return null;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

function runningProgressLabel(
  locale: Locale,
  percent: number | null | undefined,
): string {
  const clamped = clampPercent(percent);
  if (clamped == null) {
    return locale === 'en-US'
      ? 'Running, progress unknown'
      : '正在运行，进度未知';
  }
  return locale === 'en-US'
    ? `Running, progress ${clamped}%`
    : `正在运行，进度 ${clamped}%`;
}

function historyStatusLabel(
  locale: Locale,
  status: StatusTone | null,
  percent: number | null | undefined,
): string | undefined {
  if (!status) return undefined;
  if (status === 'running') return runningProgressLabel(locale, percent);
  if (status === 'thinking') return t(locale, 'sidebar.thinking');
  if (status === 'unrun') return t(locale, 'sidebar.unrun');
  if (status === 'success') return t(locale, 'sidebar.completed');
  return t(locale, 'sidebar.failed');
}

function historyStatusTone(
  session: Pick<Session, 'isWorkflow' | 'runStatus'>,
  liveStatus: ReturnType<typeof sessionLiveStatus>,
): StatusTone | null {
  if (liveStatus === 'running') return 'running';
  if (liveStatus === 'aiEditing') return 'thinking';
  if (session.runStatus === 'success') return 'success';
  if (
    session.runStatus === 'error' ||
    session.runStatus === 'interrupted'
  ) {
    return 'failed';
  }
  return session.isWorkflow ? 'unrun' : null;
}

function deleteProtectionLabel(
  locale: Locale,
  reason: WorkflowDeleteProtectionReason,
): string | null {
  if (reason === 'running') return t(locale, 'sidebar.deleteBlockedRunning');
  if (reason === 'aiEditing') return t(locale, 'sidebar.deleteBlockedAiEditing');
  return null;
}

function historySessionForProtection(
  sessionId: string,
  workspaceId: string | null,
  sessions: Session[],
  sessionTree: Record<string, Session[]>,
  fallbackIsWorkflow: boolean,
): Pick<Session, 'id' | 'isWorkflow'> {
  const source = workspaceId ? sessionTree[workspaceId] ?? sessions : sessions;
  return (
    source.find((session) => session.id === sessionId) ?? {
      id: sessionId,
      isWorkflow: fallbackIsWorkflow,
    }
  );
}

function sessionMatchesSearch(
  session: Session,
  workspace: Pick<WorkspaceSummary, 'name' | 'path'> | undefined,
  query: string,
): boolean {
  if (!query) return true;

  return [session.title, session.preview, workspace?.name, workspace?.path].some(
    (value) => value?.toLowerCase().includes(query) ?? false,
  );
}

export default function Sidebar() {
  const locale = useStore((s) => s.locale);
  const sessions = useStore((s) => s.sessions);
  const historyReady = useStore((s) => s.historyReady);
  const workspaces = useStore((s) => s.workspaces);
  const sessionTree = useStore((s) => s.sessionTree);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const runningSessions = useStore((s) => s.runningSessions);
  const runningSessionProgress = useStore((s) => s.runningSessionProgress);
  const aiEditingSessions = useStore((s) => s.aiEditingSessions);
  const newWorkflow = useStore((s) => s.newWorkflow);
  const newSimpleWorkflow = useStore((s) => s.newSimpleWorkflow);
  const importWorkflow = useStore((s) => s.importWorkflow);
  const selectSession = useStore((s) => s.selectSession);
  const deleteSession = useStore((s) => s.deleteSession);
  const renameWorkflowSession = useStore((s) => s.renameWorkflowSession);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceLimits, setWorkspaceLimits] = useState<Record<string, number>>({});
  const [flatLimit, setFlatLimit] = useState(WORKFLOW_HISTORY_PAGE_SIZE);
  const [searchQuery, setSearchQuery] = useState('');

  // ── Context menu for session deletion ────────────────────────────────────
  type MenuState =
    | null
    | {
        x: number;
        y: number;
        sessionId: string;
        workspaceId: string | null;
        title: string;
        isWorkflow: boolean;
      };

  const [menu, setMenu] = useState<MenuState>(null);
  const [renaming, setRenaming] = useState<{
    sessionId: string;
    workspaceId: string | null;
    originalTitle: string;
  } | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSaving, setRenameSaving] = useState(false);

  const menuDeleteProtectionReason = useMemo(() => {
    if (!menu) return null;
    const targetWorkspaceId = menu.workspaceId ?? activeWorkspaceId ?? null;
    const session = historySessionForProtection(
      menu.sessionId,
      targetWorkspaceId,
      sessions,
      sessionTree,
      menu.isWorkflow,
    );
    return workflowDeleteProtectionReason(session, targetWorkspaceId, {
      runningSessions,
      aiEditingSessions,
    });
  }, [
    activeWorkspaceId,
    aiEditingSessions,
    menu,
    runningSessions,
    sessions,
    sessionTree,
  ]);

  const onSessionContextMenu = useCallback(
    (
      event: React.MouseEvent,
      sessionId: string,
      workspaceId: string | null,
      title: string,
      isWorkflow: boolean,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const aside = event.currentTarget.closest('aside');
      if (!aside) return;
      const rect = aside.getBoundingClientRect();
      setMenu({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        sessionId,
        workspaceId,
        title,
        isWorkflow,
      });
    },
    [],
  );

  const handleDelete = useCallback(() => {
    if (!menu) return;
    const targetSessionId = menu.sessionId;
    const targetWorkspaceMenuId = menu.workspaceId;
    const targetTitle = menu.title;
    const targetIsWorkflow = menu.isWorkflow;
    const state = useStore.getState();
    const targetWorkspaceId =
      targetWorkspaceMenuId ?? state.activeWorkspaceId ?? null;
    const session = historySessionForProtection(
      targetSessionId,
      targetWorkspaceId,
      state.sessions,
      state.sessionTree,
      targetIsWorkflow,
    );
    const protectionReason = workflowDeleteProtectionReason(
      session,
      targetWorkspaceId,
      state,
    );
    const protectionMessage = deleteProtectionLabel(locale, protectionReason);
    if (protectionMessage) {
      window.alert(protectionMessage);
      setMenu(null);
      return;
    }

    const confirmed = window.confirm(
      t(locale, 'sidebar.deleteConfirm').replace('{title}', targetTitle),
    );
    if (confirmed) {
      deleteSession(targetSessionId, targetWorkspaceMenuId ?? undefined);
      if (
        renaming?.sessionId === targetSessionId &&
        renaming.workspaceId === targetWorkspaceMenuId
      ) {
        setRenaming(null);
        setRenameDraft('');
        setRenameError(null);
        setRenameSaving(false);
      }
    }
    setMenu(null);
  }, [menu, locale, deleteSession, renaming]);

  const handleStartRename = useCallback(() => {
    if (!menu?.isWorkflow) return;
    setRenaming({
      sessionId: menu.sessionId,
      workspaceId: menu.workspaceId,
      originalTitle: menu.title,
    });
    setRenameDraft(menu.title);
    setRenameError(null);
    setRenameSaving(false);
    setMenu(null);
  }, [menu]);

  const cancelRename = useCallback(() => {
    if (renameSaving) return;
    setRenaming(null);
    setRenameDraft('');
    setRenameError(null);
  }, [renameSaving]);

  const saveRename = useCallback(
    async (
      session: Session,
      workspaceId: string | null,
      siblingSessions: Session[],
    ) => {
      if (
        !renaming ||
        renameSaving ||
        renaming.sessionId !== session.id ||
        renaming.workspaceId !== workspaceId
      ) {
        return;
      }

      const trimmed = renameDraft.trim();
      if (!trimmed) {
        setRenameError(t(locale, 'sidebar.renameErrorEmpty'));
        return;
      }
      if (trimmed.length > MAX_WORKFLOW_RENAME_LENGTH) {
        setRenameError(t(locale, 'sidebar.renameErrorTooLong'));
        return;
      }
      if (trimmed === renaming.originalTitle.trim()) {
        cancelRename();
        return;
      }
      const duplicate = siblingSessions.some(
        (item) =>
          item.id !== session.id &&
          item.isWorkflow &&
          item.title.trim() === trimmed,
      );
      if (duplicate) {
        setRenameError(t(locale, 'sidebar.renameErrorDuplicate'));
        return;
      }

      setRenameSaving(true);
      setRenameError(null);
      try {
        await renameWorkflowSession(session.id, workspaceId, trimmed);
        setRenaming(null);
        setRenameDraft('');
      } catch {
        setRenameError(t(locale, 'sidebar.renameErrorSave'));
      } finally {
        setRenameSaving(false);
      }
    },
    [
      cancelRename,
      locale,
      renameDraft,
      renameSaving,
      renameWorkflowSession,
      renaming,
    ],
  );

  /** Close the context menu on Escape. */
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const loadMoreWorkspace = useCallback((workspaceId: string) => {
    setWorkspaceLimits((prev) => ({
      ...prev,
      [workspaceId]:
        (prev[workspaceId] ?? WORKFLOW_HISTORY_PAGE_SIZE) +
        WORKFLOW_HISTORY_PAGE_SIZE,
    }));
  }, []);

  const loadMoreFlat = useCallback(() => {
    setFlatLimit((prev) => prev + WORKFLOW_HISTORY_PAGE_SIZE);
  }, []);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  const totalTreeSessions = useMemo(
    () =>
      workspaces.reduce(
        (count, workspace) =>
          count + (sessionTree[workspace.id]?.length ?? 0),
        0,
      ),
    [sessionTree, workspaces],
  );

  const hasHistory =
    workspaces.length > 0 ? totalTreeSessions > 0 : sessions.length > 0;
  const showHistorySearch = !historyReady || hasHistory;
  const isHistoryEmpty = historyReady && !hasHistory;

  useEffect(() => {
    if (isHistoryEmpty && searchQuery.length > 0) {
      setSearchQuery('');
    }
  }, [isHistoryEmpty, searchQuery.length]);

  const filteredWorkspaces = useMemo(
    () =>
      workspaces
        .map((workspace) => {
          const list = sessionTree[workspace.id] ?? [];
          return {
            workspace,
            sessions: normalizedQuery
              ? list.filter((session) =>
                  sessionMatchesSearch(session, workspace, normalizedQuery),
                )
              : list,
          };
        })
        .filter((group) => !normalizedQuery || group.sessions.length > 0),
    [normalizedQuery, sessionTree, workspaces],
  );

  const filteredFlatSessions = useMemo(
    () =>
      normalizedQuery
        ? sessions.filter((session) =>
            sessionMatchesSearch(session, undefined, normalizedQuery),
          )
        : sessions,
    [normalizedQuery, sessions],
  );

  const totalMatchedSessions =
    workspaces.length > 0
      ? filteredWorkspaces.reduce(
          (count, group) => count + group.sessions.length,
          0,
        )
      : filteredFlatSessions.length;

  const firstSearchMatch = useMemo(() => {
    if (!isSearching) return null;
    if (workspaces.length > 0) {
      const firstGroup = filteredWorkspaces.find(
        (group) => group.sessions.length > 0,
      );
      const firstSession = firstGroup?.sessions[0];
      return firstGroup && firstSession
        ? { sessionId: firstSession.id, workspaceId: firstGroup.workspace.id }
        : null;
    }

    const firstSession = filteredFlatSessions[0];
    return firstSession
      ? { sessionId: firstSession.id, workspaceId: undefined }
      : null;
  }, [filteredFlatSessions, filteredWorkspaces, isSearching, workspaces.length]);

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (searchQuery.length > 0) {
          setSearchQuery('');
        } else {
          event.currentTarget.blur();
        }
        return;
      }

      if (event.key === 'Enter' && firstSearchMatch) {
        event.preventDefault();
        selectSession(firstSearchMatch.sessionId, firstSearchMatch.workspaceId);
      }
    },
    [firstSearchMatch, searchQuery.length, selectSession],
  );

  const { width, onResizeStart } = useResizableWidth({
    storageKey: 'openworkflow.sidebarWidth.v1',
    defaultWidth: 240,
    min: 180,
    max: 480,
    edge: 'right',
  });

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-r border-border bg-panel"
      style={{ width }}
    >
      {/* Resize handle — right edge, drag horizontally. */}
      <div
        onMouseDown={onResizeStart}
        title={t(locale, 'common.resizeWidth')}
        className="group absolute -right-1 top-0 bottom-0 z-20 flex w-2 cursor-col-resize items-center justify-center"
      >
        <div className="h-full w-0.5 bg-transparent transition-colors group-hover:bg-accent/40" />
      </div>

      {/* Brand */}
      <div className="flex items-center gap-2 border-b border-border-soft px-4 py-3.5">
        <span className="text-accent-2">◆</span>
        <span className="text-sm font-semibold tracking-tight text-fg">
          OpenWorkflows
        </span>
      </div>

      {/* Primary actions */}
      <div className="flex flex-col gap-2 px-3 pt-3 pb-2.5">
        <button
          type="button"
          onClick={newWorkflow}
          className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="text-base leading-none">＋</span>
          {t(locale, 'sidebar.newWorkflow')}
        </button>
        <button
          type="button"
          onClick={newSimpleWorkflow}
          className="flex items-center gap-2 rounded-md border border-border bg-panel-2 px-3 py-2 text-sm font-medium text-fg-dim transition-colors hover:border-accent hover:bg-border-soft hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="text-base leading-none">＋</span>
          {t(locale, 'sidebar.newSimpleWorkflow')}
        </button>
        <button
          type="button"
          onClick={() => importWorkflow(t(locale, 'sidebar.importWorkflowTitle'))}
          title={t(locale, 'sidebar.importWorkflowTitle')}
          className="flex items-center gap-2 rounded-md border border-border bg-panel-2 px-3 py-2 text-sm font-medium text-fg-dim transition-colors hover:border-accent hover:bg-border-soft hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="text-base leading-none" aria-hidden>⤒</span>
          {t(locale, 'sidebar.importWorkflow')}
        </button>
      </div>

      {/* Session history */}
      <div className="flex min-h-0 flex-1 flex-col px-2 pb-3">
        <div className="px-2 pb-1.5 pt-0 text-[11px] font-medium uppercase tracking-wider text-fg-faint">
          {t(locale, 'sidebar.history')}
        </div>
        {showHistorySearch && (
          <div className="px-2 pb-2">
            <div className="relative">
              <Search
                size={13}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-faint"
              />
              <input
                type="search"
                aria-label={t(locale, 'sidebar.searchPlaceholder')}
                value={searchQuery}
                disabled={!historyReady}
                placeholder={
                  historyReady
                    ? t(locale, 'sidebar.searchPlaceholder')
                    : t(locale, 'sidebar.searchLoading')
                }
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                spellCheck={false}
                className="h-8 w-full min-w-0 appearance-none rounded-md border border-border bg-bg pl-7 pr-7 text-xs text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-accent disabled:cursor-wait disabled:opacity-60"
              />
              {searchQuery.length > 0 && (
                <button
                  type="button"
                  aria-label={t(locale, 'sidebar.searchClear')}
                  title={t(locale, 'sidebar.searchClear')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-fg-faint transition-colors hover:bg-border-soft hover:text-fg"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!historyReady ? (
            <div
              role="status"
              aria-live="polite"
              className="px-2 py-3 text-xs text-fg-faint"
            >
              <div className="flex items-center gap-2 text-fg-dim">
                <span
                  aria-hidden="true"
                  className="h-3 w-3 animate-spin rounded-full border border-border border-t-accent"
                />
                <span>{t(locale, 'sidebar.searchLoading')}</span>
              </div>
            </div>
          ) : isHistoryEmpty ? (
            <div
              role="status"
              aria-live="polite"
              className="px-2 py-3 text-xs text-fg-faint"
            >
              {t(locale, 'sidebar.emptySessions')}
            </div>
          ) : isSearching && totalMatchedSessions === 0 ? (
            <div
              role="status"
              aria-live="polite"
              className="px-2 py-3 text-xs text-fg-faint"
            >
              <div className="text-fg-dim">
                {t(locale, 'sidebar.searchNoResults')}
              </div>
              <div className="mt-1">
                {t(locale, 'sidebar.searchNoResultsHint')}
              </div>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="mt-2 rounded-md border border-border px-2 py-1 text-xs text-fg-dim transition-colors hover:border-accent hover:text-accent"
              >
                {t(locale, 'sidebar.searchClear')}
              </button>
            </div>
          ) : workspaces.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {filteredWorkspaces.map(({ workspace, sessions: list }) => {
                const fullList = sessionTree[workspace.id] ?? [];
                const visibleList = isSearching
                  ? list
                  : list.slice(
                      0,
                      workspaceLimits[workspace.id] ??
                        WORKFLOW_HISTORY_PAGE_SIZE,
                    );
                return (
                  <li key={workspace.id} className="flex flex-col gap-1">
                    <div className="px-2 py-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-fg">
                        <span className="text-accent-2">▾</span>
                        <span className="min-w-0 flex-1 truncate" title={workspace.path}>
                          {workspace.name}
                        </span>
                        <span className="font-mono text-[10px] text-fg-faint">
                          {workspace.sessionCount}
                        </span>
                      </div>
                      {workspace.path && (
                        <div className="truncate pl-4 font-mono text-[9px] text-fg-faint">
                          {workspace.path}
                        </div>
                      )}
                    </div>
                    {list.length === 0 ? (
                      <div className="px-6 py-1 text-xs text-fg-faint">
                        {t(locale, 'sidebar.emptySessions')}
                      </div>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {visibleList.map((session) => {
                          const active =
                            session.id === activeSessionId &&
                            workspace.id === activeWorkspaceId;
                          const sessionKey = {
                            workspaceId: workspace.id,
                            sessionId: session.id,
                          };
                          const liveStatus = sessionLiveStatus(
                            sessionKey,
                            { runningSessions, aiEditingSessions },
                          );
                          const status = historyStatusTone(session, liveStatus);
                          const runProgress =
                            runningSessionProgress[workflowSessionKeyId(sessionKey)];
                          const statusLabel = historyStatusLabel(
                            locale,
                            status,
                            runProgress?.percent,
                          );
                          const isRenaming =
                            renaming?.sessionId === session.id &&
                            renaming.workspaceId === workspace.id;
                          return (
                            <li key={`${workspace.id}:${session.id}`}>
                              {isRenaming ? (
                                <div
                                  onContextMenu={(e) =>
                                    onSessionContextMenu(
                                      e,
                                      session.id,
                                      workspace.id,
                                      session.title,
                                      session.isWorkflow,
                                    )
                                  }
                                  className={
                                    'group flex w-full flex-col items-start gap-1 rounded-md px-2 py-1.5 text-left transition-colors ' +
                                    (active
                                      ? 'bg-panel-2 text-fg'
                                      : 'text-fg-dim hover:bg-border-soft hover:text-fg')
                                  }
                                >
                                  <span className="grid w-full grid-cols-[auto_minmax(0,1fr)_var(--owf-status-slot-size)] items-center gap-1.5">
                                    <span
                                      className={
                                        'rounded border px-1 font-mono text-[9px] leading-4 ' +
                                        (session.isWorkflow
                                          ? session.simple
                                            ? 'border-accent-3/50 text-accent-3'
                                            : 'border-accent-2/50 text-accent-2'
                                          : 'border-border text-fg-faint')
                                      }
                                    >
                                      {session.isWorkflow
                                        ? session.simple
                                          ? 'SW'
                                          : 'WF'
                                        : 'CHAT'}
                                    </span>
                                    <input
                                      autoFocus
                                      aria-label={t(locale, 'sidebar.renameSession')}
                                      value={renameDraft}
                                      disabled={renameSaving}
                                      onChange={(e) => {
                                        setRenameDraft(e.target.value);
                                        setRenameError(null);
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          void saveRename(
                                            session,
                                            workspace.id,
                                            fullList,
                                          );
                                        }
                                        if (e.key === 'Escape') {
                                          e.preventDefault();
                                          cancelRename();
                                        }
                                      }}
                                      className="min-w-0 rounded border border-border bg-bg px-1.5 py-0.5 text-sm text-fg outline-none transition-colors focus:border-accent disabled:cursor-wait disabled:opacity-60"
                                    />
                                    <StatusIndicator
                                      label={statusLabel}
                                      tone={status}
                                    />
                                  </span>
                                  <span className="flex w-full items-center gap-1 pl-10">
                                    <button
                                      type="button"
                                      disabled={renameSaving}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void saveRename(
                                          session,
                                          workspace.id,
                                          fullList,
                                        );
                                      }}
                                      className="rounded border border-accent/40 bg-accent/15 px-2 py-0.5 text-[11px] text-accent transition-colors hover:bg-accent/25 disabled:cursor-wait disabled:opacity-60"
                                    >
                                      {t(locale, 'sidebar.renameSave')}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={renameSaving}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        cancelRename();
                                      }}
                                      className="rounded border border-border px-2 py-0.5 text-[11px] text-fg-faint transition-colors hover:border-accent hover:text-accent disabled:cursor-wait disabled:opacity-60"
                                    >
                                      {t(locale, 'sidebar.renameCancel')}
                                    </button>
                                  </span>
                                  {renameError && (
                                    <span className="pl-10 text-[11px] leading-snug text-rose-300">
                                      {renameError}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => selectSession(session.id, workspace.id)}
                                  onContextMenu={(e) =>
                                    onSessionContextMenu(
                                      e,
                                      session.id,
                                      workspace.id,
                                      session.title,
                                      session.isWorkflow,
                                    )
                                  }
                                  className={
                                    'group flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors ' +
                                    (active
                                      ? 'bg-panel-2 text-fg'
                                      : 'text-fg-dim hover:bg-border-soft hover:text-fg') +
                                    ' disabled:cursor-not-allowed disabled:opacity-50'
                                  }
                                >
                                  <span className="grid w-full grid-cols-[auto_minmax(0,1fr)_var(--owf-status-slot-size)] items-center gap-1.5">
                                    <span
                                      className={
                                        'rounded border px-1 font-mono text-[9px] leading-4 ' +
                                        (session.isWorkflow
                                          ? session.simple
                                            ? 'border-accent-3/50 text-accent-3'
                                            : 'border-accent-2/50 text-accent-2'
                                          : 'border-border text-fg-faint')
                                      }
                                    >
                                      {session.isWorkflow
                                        ? session.simple
                                          ? 'SW'
                                          : 'WF'
                                        : 'CHAT'}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-sm">
                                      {session.title}
                                    </span>
                                    <StatusIndicator
                                      label={statusLabel}
                                      tone={status}
                                    />
                                  </span>
                                  <span className="flex w-full items-center gap-1 pl-10 font-mono text-[10px] text-fg-faint">
                                    <span>{formatTime(session.updatedAt ?? session.createdAt)}</span>
                                    {session.preview && (
                                      <span className="min-w-0 flex-1 truncate">
                                        {session.preview}
                                      </span>
                                    )}
                                  </span>
                                </button>
                              )}
                            </li>
                          );
                        })}
                        {!isSearching &&
                          fullList.length >
                            (workspaceLimits[workspace.id] ??
                              WORKFLOW_HISTORY_PAGE_SIZE) && (
                            <li className="px-2 py-1">
                              <button
                                type="button"
                                onClick={() => loadMoreWorkspace(workspace.id)}
                                className="w-full rounded-md px-2 py-1.5 text-left text-sm text-fg-dim transition-colors hover:bg-border-soft hover:text-fg"
                              >
                                {t(locale, 'sidebar.loadMore')}
                              </button>
                            </li>
                          )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {filteredFlatSessions
                .slice(0, isSearching ? filteredFlatSessions.length : flatLimit)
                .map((session) => {
                  const active = session.id === activeSessionId;
                  const sessionKey = { workspaceId: null, sessionId: session.id };
                  const liveStatus = sessionLiveStatus(
                    sessionKey,
                    { runningSessions, aiEditingSessions },
                  );
                  const status = historyStatusTone(session, liveStatus);
                  const runProgress =
                    runningSessionProgress[workflowSessionKeyId(sessionKey)];
                  const statusLabel = historyStatusLabel(
                    locale,
                    status,
                    runProgress?.percent,
                  );
                  const isRenaming =
                    renaming?.sessionId === session.id &&
                    renaming.workspaceId === null;
                  return (
                    <li key={`flat:${session.id}`}>
                    {isRenaming ? (
                      <div
                        onContextMenu={(e) =>
                          onSessionContextMenu(
                            e,
                            session.id,
                            null,
                            session.title,
                            session.isWorkflow,
                          )
                        }
                        className={
                          'group flex w-full flex-col items-start gap-1 rounded-md px-2 py-1.5 text-left transition-colors ' +
                          (active
                            ? 'bg-panel-2 text-fg'
                            : 'text-fg-dim hover:bg-border-soft hover:text-fg')
                        }
                      >
                        <span className="grid w-full grid-cols-[auto_minmax(0,1fr)_var(--owf-status-slot-size)] items-center gap-1.5">
                          <span
                            className={
                              'text-[10px] leading-none ' +
                              (active ? 'text-accent-2' : 'text-fg-faint')
                            }
                          >
                            ●
                          </span>
                          <input
                            autoFocus
                            aria-label={t(locale, 'sidebar.renameSession')}
                            value={renameDraft}
                            disabled={renameSaving}
                            onChange={(e) => {
                              setRenameDraft(e.target.value);
                              setRenameError(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void saveRename(session, null, sessions);
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelRename();
                              }
                            }}
                            className="min-w-0 rounded border border-border bg-bg px-1.5 py-0.5 text-sm text-fg outline-none transition-colors focus:border-accent disabled:cursor-wait disabled:opacity-60"
                          />
                          <StatusIndicator label={statusLabel} tone={status} />
                        </span>
                        <span className="flex w-full items-center gap-1 pl-3.5">
                          <button
                            type="button"
                            disabled={renameSaving}
                            onClick={(e) => {
                              e.stopPropagation();
                              void saveRename(session, null, sessions);
                            }}
                            className="rounded border border-accent/40 bg-accent/15 px-2 py-0.5 text-[11px] text-accent transition-colors hover:bg-accent/25 disabled:cursor-wait disabled:opacity-60"
                          >
                            {t(locale, 'sidebar.renameSave')}
                          </button>
                          <button
                            type="button"
                            disabled={renameSaving}
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelRename();
                            }}
                            className="rounded border border-border px-2 py-0.5 text-[11px] text-fg-faint transition-colors hover:border-accent hover:text-accent disabled:cursor-wait disabled:opacity-60"
                          >
                            {t(locale, 'sidebar.renameCancel')}
                          </button>
                        </span>
                        {renameError && (
                          <span className="pl-3.5 text-[11px] leading-snug text-rose-300">
                            {renameError}
                          </span>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => selectSession(session.id)}
                        onContextMenu={(e) =>
                          onSessionContextMenu(
                            e,
                            session.id,
                            null,
                            session.title,
                            session.isWorkflow,
                          )
                        }
                        className={
                          'group flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors ' +
                          (active
                            ? 'bg-panel-2 text-fg'
                            : 'text-fg-dim hover:bg-border-soft hover:text-fg') +
                          ' disabled:cursor-not-allowed disabled:opacity-50'
                        }
                      >
                        <span className="grid w-full grid-cols-[auto_minmax(0,1fr)_var(--owf-status-slot-size)] items-center gap-1.5">
                          <span
                            className={
                              'text-[10px] leading-none ' +
                              (active ? 'text-accent-2' : 'text-fg-faint')
                            }
                          >
                            ●
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {session.title}
                          </span>
                          <StatusIndicator label={statusLabel} tone={status} />
                        </span>
                        <span className="pl-3.5 font-mono text-[10px] text-fg-faint">
                          {formatTime(session.createdAt)}
                        </span>
                      </button>
                    )}
                    </li>
                  );
                })}
              {!isSearching && sessions.length > flatLimit && (
                <li className="px-2 py-1">
                  <button
                    type="button"
                    onClick={loadMoreFlat}
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm text-fg-dim transition-colors hover:bg-border-soft hover:text-fg"
                  >
                    {t(locale, 'sidebar.loadMore')}
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      <div className="border-t border-border-soft p-3">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title={t(locale, 'settings.openHint')}
          className="flex w-full items-center gap-2 rounded-md border border-border bg-panel-2 px-3 py-2 text-sm text-fg-dim transition-colors hover:border-accent hover:bg-border-soft hover:text-fg"
        >
          <span className="text-base leading-none text-accent">⚙</span>
          <span>{t(locale, 'settings.open')}</span>
        </button>
      </div>

      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} />
      )}

      {menu && (
        <SessionContextMenu
          x={menu.x}
          y={menu.y}
          locale={locale}
          canRename={menu.isWorkflow}
          deleteDisabledReason={deleteProtectionLabel(
            locale,
            menuDeleteProtectionReason,
          )}
          onRename={handleStartRename}
          onDelete={handleDelete}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}

/**
 * Right-click context menu for a session entry.
 * Positioned relative to the Sidebar so it stays inside the rail.
 */
function SessionContextMenu({
  x,
  y,
  locale,
  canRename,
  deleteDisabledReason,
  onRename,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  locale: Locale;
  canRename: boolean;
  deleteDisabledReason: string | null;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Backdrop catches the next click anywhere and dismisses the menu. */}
      <div
        className="fixed inset-0 z-30"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="absolute z-40 min-w-[140px] overflow-hidden rounded-md border border-border bg-panel shadow-2xl"
        style={{ left: x, top: y }}
      >
        {canRename && (
          <button
            type="button"
            onClick={onRename}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-dim transition-colors hover:bg-panel-2 hover:text-fg"
          >
            <span className="text-fg-faint">✎</span>
            <span>{t(locale, 'sidebar.renameSession')}</span>
          </button>
        )}
        <button
          type="button"
          disabled={deleteDisabledReason != null}
          title={deleteDisabledReason ?? undefined}
          onClick={onDelete}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-dim transition-colors hover:bg-panel-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-fg-dim"
        >
          <span className="text-fg-faint">🗑</span>
          <span>{t(locale, 'sidebar.deleteSession')}</span>
        </button>
      </div>
    </>
  );
}
