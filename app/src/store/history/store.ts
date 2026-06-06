import type { IRGraph } from '@/core/ir';
import { loadComposer } from '@/lib/composerStorage';
import { FUC_STORAGE_KEY } from '@/lib/persist';
import { tauriAvailable } from '@/lib/tauri';
import type { Message } from '@/store/types';
import {
  deriveWorkspaceId,
  normalizeWorkspaceIdentityPath,
  workspaceLeafName,
} from './paths';
import {
  HISTORY_SCHEMA_VERSION,
  UNASSIGNED_WORKSPACE_ID,
  type HistoryConfig,
  type SessionCreateInput,
  type SessionPatch,
  type SessionRecord,
  type SessionSummary,
  type WorkspaceRecord,
  type WorkspaceSummary,
  type WorkspaceUpsertInput,
} from './types';

export interface HistoryStore {
  ready(): Promise<void>;
  rootPath(): Promise<string>;

  getConfig(): Promise<HistoryConfig>;
  patchConfig(patch: Partial<HistoryConfig>): Promise<HistoryConfig>;

  listWorkspaces(): Promise<WorkspaceSummary[]>;
  getWorkspace(id: string): Promise<WorkspaceRecord | null>;
  resolveWorkspaceByPath(path: string): Promise<WorkspaceRecord>;
  renameWorkspace(id: string, name: string): Promise<WorkspaceRecord>;
  deleteWorkspace(id: string, soft?: boolean): Promise<void>;

  listSessions(workspaceId: string): Promise<SessionSummary[]>;
  getSession(
    workspaceId: string,
    sessionId: string,
  ): Promise<SessionRecord | null>;
  createSession(input: SessionCreateInput): Promise<SessionRecord>;
  updateSession(
    workspaceId: string,
    sessionId: string,
    patch: SessionPatch,
  ): Promise<SessionRecord>;
  deleteSession(
    workspaceId: string,
    sessionId: string,
    soft?: boolean,
  ): Promise<void>;

  appendMessage(
    workspaceId: string,
    sessionId: string,
    msg: Message,
  ): Promise<void>;
  setSessionWorkflow(
    workspaceId: string,
    sessionId: string,
    ir: IRGraph,
  ): Promise<void>;
}

const CONFIG_PATH = 'config.json';
const WORKSPACES_INDEX = 'workspaces/index.json';
const FALLBACK_PREFIX = 'freeultracode.history.v1:';

let writeQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

async function command<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const invoke = await getInvoke();
  return invoke<T>(name, args);
}

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

function localGet(key: string): string | null {
  if (!hasLocalStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function localSet(key: string, value: string): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* non-fatal */
  }
}

function localRemove(key: string): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* non-fatal */
  }
}

async function readJson<T>(relPath: string): Promise<T | null> {
  const raw = tauriAvailable()
    ? await command<string | null>('history_read_json', { relPath })
    : localGet(FALLBACK_PREFIX + relPath);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(relPath: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value, null, 2);
  if (tauriAvailable()) {
    await command<void>('history_write_json', { relPath, json });
    return;
  }
  localSet(FALLBACK_PREFIX + relPath, json);
}

async function removePath(relPath: string, soft = true): Promise<void> {
  if (tauriAvailable()) {
    await command<void>('history_remove', { relPath, soft });
    return;
  }
  localRemove(FALLBACK_PREFIX + relPath);
}

function now(): number {
  return Date.now();
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `s_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function normalizePath(input: string): string {
  return normalizeWorkspaceIdentityPath(input);
}

async function workspaceIdForPath(path: string): Promise<string> {
  const normalized = normalizePath(path);
  if (!normalized) return UNASSIGNED_WORKSPACE_ID;
  return deriveWorkspaceId(normalized);
}

function workspaceName(path: string): string {
  const normalized = normalizePath(path);
  if (!normalized) return '未指定工作区';
  return workspaceLeafName(normalized) || '未指定工作区';
}

function workspaceMetaPath(id: string): string {
  return `workspaces/${id}/meta.json`;
}

function sessionIndexPath(workspaceId: string): string {
  return `workspaces/${workspaceId}/sessions/index.json`;
}

function sessionPath(workspaceId: string, sessionId: string): string {
  return `workspaces/${workspaceId}/sessions/${sessionId}.json`;
}

function preview(messages: Message[]): string | undefined {
  const text = messages[messages.length - 1]?.text?.trim();
  if (!text) return undefined;
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

const AUTO_TITLE_PLACEHOLDERS = new Set([
  '新会话',
  'New Session',
  '未命名会话',
  'Untitled Session',
  'Sesion sin titulo',
  'Session sans titre',
  'Безымянная сессия',
  'جلسة بلا عنوان',
  'शीर्षक रहित सत्र',
  '無題のセッション',
  'Sessao sem titulo',
  'Unbenannte Sitzung',
  '제목 없는 세션',
  '新建工作流',
  'New Workflow',
  '未命名工作流',
  '未命名的工作流',
  'Untitled Workflow',
  'Untitled workflow',
  'untitled',
]);

export function isAutoTitlePlaceholder(title?: string | null): boolean {
  const compact = title?.trim();
  return !compact || AUTO_TITLE_PLACEHOLDERS.has(compact);
}

export function titleFromText(text: string, fallback = '未命名会话'): string {
  const compact = text.trim().replace(/\s+/g, ' ');
  if (!compact) return fallback;
  return compact.length > 36 ? `${compact.slice(0, 36)}...` : compact;
}

function titleFromMessages(messages: Message[], fallback = '未命名会话'): string {
  const user = messages.find((m) => m.role === 'user' && m.text.trim());
  if (!user) return fallback;
  return titleFromText(user.text, fallback);
}

function workspaceSummary(record: WorkspaceRecord): WorkspaceSummary {
  return {
    id: record.id,
    path: record.path,
    name: record.name,
    updatedAt: record.updatedAt,
    sessionCount: record.sessionCount,
    lastActiveSessionId: record.lastActiveSessionId,
  };
}

function sessionSummary(record: SessionRecord): SessionSummary {
  const runStatus = record.meta?.runStatus;
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    title: record.title,
    isWorkflow: record.isWorkflow,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    preview: preview(record.messages),
    messageCount: record.messages.length,
    ...(record.workflow?.meta?.simple ? { simple: true } : {}),
    ...(runStatus ? { runStatus } : {}),
    ...(record.meta?.favorite === true ? { favorite: true } : {}),
    ...(record.meta?.scheduledTask
      ? { scheduledTask: record.meta.scheduledTask }
      : {}),
  };
}

async function readConfigInternal(): Promise<HistoryConfig | null> {
  return readJson<HistoryConfig>(CONFIG_PATH);
}

async function writeConfigInternal(config: HistoryConfig): Promise<void> {
  await writeJson(CONFIG_PATH, config);
}

async function getConfigInternal(): Promise<HistoryConfig> {
  return (
    (await readConfigInternal()) ?? {
      schemaVersion: HISTORY_SCHEMA_VERSION,
    }
  );
}

async function listWorkspacesInternal(): Promise<WorkspaceSummary[]> {
  const list = (await readJson<WorkspaceSummary[]>(WORKSPACES_INDEX)) ?? [];
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function writeWorkspaceIndexInternal(
  records: WorkspaceSummary[],
): Promise<void> {
  await writeJson(
    WORKSPACES_INDEX,
    [...records].sort((a, b) => b.updatedAt - a.updatedAt),
  );
}

async function getWorkspaceInternal(
  id: string,
): Promise<WorkspaceRecord | null> {
  return readJson<WorkspaceRecord>(workspaceMetaPath(id));
}

async function writeWorkspaceInternal(
  record: WorkspaceRecord,
): Promise<WorkspaceRecord> {
  await writeJson(workspaceMetaPath(record.id), record);
  const current = await listWorkspacesInternal();
  const next = [
    workspaceSummary(record),
    ...current.filter((w) => w.id !== record.id),
  ];
  await writeWorkspaceIndexInternal(next);
  return record;
}

async function resolveWorkspaceInternal(
  input: WorkspaceUpsertInput,
): Promise<WorkspaceRecord> {
  const normalized = normalizePath(input.path);
  const id = await workspaceIdForPath(normalized);
  const existing = await getWorkspaceInternal(id);
  if (existing) {
    const patched: WorkspaceRecord = {
      ...existing,
      path: normalized,
      name: input.name ?? existing.name,
    };
    if (patched.path !== existing.path || patched.name !== existing.name) {
      return writeWorkspaceInternal({ ...patched, updatedAt: now() });
    }
    return existing;
  }

  const ts = now();
  return writeWorkspaceInternal({
    id,
    path: normalized,
    name: input.name ?? workspaceName(normalized),
    createdAt: ts,
    updatedAt: ts,
    sessionCount: 0,
  });
}

async function listSessionsInternal(
  workspaceId: string,
): Promise<SessionSummary[]> {
  const list =
    (await readJson<SessionSummary[]>(sessionIndexPath(workspaceId))) ?? [];
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function writeSessionIndexInternal(
  workspaceId: string,
  records: SessionSummary[],
): Promise<void> {
  await writeJson(
    sessionIndexPath(workspaceId),
    [...records].sort((a, b) => b.updatedAt - a.updatedAt),
  );
}

async function touchWorkspaceForSessionInternal(
  workspaceId: string,
  sessionId: string,
  updatedAt: number,
): Promise<void> {
  const workspace = await getWorkspaceInternal(workspaceId);
  if (!workspace) return;
  const sessions = await listSessionsInternal(workspaceId);
  await writeWorkspaceInternal({
    ...workspace,
    updatedAt,
    lastActiveSessionId: sessionId,
    sessionCount: sessions.length,
  });
}

async function getSessionInternal(
  workspaceId: string,
  sessionId: string,
): Promise<SessionRecord | null> {
  return readJson<SessionRecord>(sessionPath(workspaceId, sessionId));
}

async function writeSessionInternal(
  record: SessionRecord,
): Promise<SessionRecord> {
  await writeJson(sessionPath(record.workspaceId, record.id), record);
  const current = await listSessionsInternal(record.workspaceId);
  const next = [
    sessionSummary(record),
    ...current.filter((s) => s.id !== record.id),
  ];
  await writeSessionIndexInternal(record.workspaceId, next);
  await touchWorkspaceForSessionInternal(
    record.workspaceId,
    record.id,
    record.updatedAt,
  );
  return record;
}

async function createSessionInternal(
  input: SessionCreateInput,
): Promise<SessionRecord> {
  const ts = now();
  const messages = input.messages ?? [];
  const title = input.title ?? titleFromMessages(messages);
  const record: SessionRecord = {
    id: randomId(),
    workspaceId: input.workspaceId,
    title,
    isWorkflow: input.isWorkflow,
    createdAt: ts,
    updatedAt: ts,
    messages,
    ...(input.isWorkflow && input.workflow ? { workflow: input.workflow } : {}),
    ...(input.meta ? { meta: input.meta } : {}),
  };
  return writeSessionInternal(record);
}

async function updateSessionInternal(
  workspaceId: string,
  sessionId: string,
  patch: SessionPatch,
): Promise<SessionRecord> {
  const current = await getSessionInternal(workspaceId, sessionId);
  if (!current) {
    throw new Error(`Session not found: ${workspaceId}/${sessionId}`);
  }

  const nextIsWorkflow =
    current.isWorkflow || patch.isWorkflow === true || !!patch.workflow;
  const messages = patch.messages ?? current.messages;
  const next: SessionRecord = {
    ...current,
    title: patch.title ?? current.title,
    isWorkflow: nextIsWorkflow,
    updatedAt: patch.preserveUpdatedAt ? current.updatedAt : now(),
    messages,
    ...(nextIsWorkflow
      ? { workflow: patch.workflow ?? current.workflow }
      : { workflow: undefined }),
    ...(patch.meta ? { meta: { ...(current.meta ?? {}), ...patch.meta } } : {}),
  };

  return writeSessionInternal(next);
}

async function appendMessageInternal(
  workspaceId: string,
  sessionId: string,
  msg: Message,
): Promise<void> {
  const current = await getSessionInternal(workspaceId, sessionId);
  if (!current) return;
  const messages = [...current.messages, msg];
  await updateSessionInternal(workspaceId, sessionId, {
    messages,
    title:
      isAutoTitlePlaceholder(current.title)
        ? titleFromMessages(messages, current.title)
        : current.title,
  });
}

async function migrateLocalWorkflowInternal(): Promise<void> {
  const config = await getConfigInternal();
  if (config.migratedFromLocalStorage) return;

  const raw = localGet(FUC_STORAGE_KEY);
  let migrated = false;
  if (raw) {
    try {
      const workflow = JSON.parse(raw) as IRGraph;
      if (workflow && Array.isArray(workflow.nodes) && Array.isArray(workflow.edges)) {
        const persisted = loadComposer();
        const workspace = await resolveWorkspaceInternal({
          path: persisted?.composer.workspace ?? '',
        });
        await createSessionInternal({
          workspaceId: workspace.id,
          isWorkflow: true,
          workflow,
          title: workflow.meta?.name ?? '已迁移工作流',
          meta: {
            adapter:
              workflow.meta?.adapter === 'codex' ||
              workflow.meta?.adapter === 'gemini'
                ? workflow.meta.adapter
                : 'claude-code',
          },
        });
        migrated = true;
      }
    } catch {
      /* corrupt legacy autosave: ignore and mark migration attempted */
    }
  }

  await writeConfigInternal({
    ...config,
    schemaVersion: HISTORY_SCHEMA_VERSION,
    migratedFromLocalStorage: true,
    ...(migrated ? {} : {}),
  });
}

export const historyStore: HistoryStore = {
  async ready() {
    await enqueue(async () => {
      const config = await getConfigInternal();
      if (!config.schemaVersion) {
        await writeConfigInternal({
          ...config,
          schemaVersion: HISTORY_SCHEMA_VERSION,
        });
      }
      if (!(await readJson<WorkspaceSummary[]>(WORKSPACES_INDEX))) {
        await writeWorkspaceIndexInternal([]);
      }
      await migrateLocalWorkflowInternal();
    });
  },

  async rootPath() {
    if (tauriAvailable()) {
      return command<string>('history_root');
    }
    return 'localStorage://freeultracode.history.v1';
  },

  getConfig() {
    return getConfigInternal();
  },

  patchConfig(patch) {
    return enqueue(async () => {
      const config = await getConfigInternal();
      const next = { ...config, ...patch, schemaVersion: HISTORY_SCHEMA_VERSION };
      await writeConfigInternal(next);
      return next;
    });
  },

  listWorkspaces() {
    return listWorkspacesInternal();
  },

  getWorkspace(id) {
    return getWorkspaceInternal(id);
  },

  resolveWorkspaceByPath(path) {
    return enqueue(() => resolveWorkspaceInternal({ path }));
  },

  renameWorkspace(id, name) {
    return enqueue(async () => {
      const workspace = await getWorkspaceInternal(id);
      if (!workspace) throw new Error(`Workspace not found: ${id}`);
      return writeWorkspaceInternal({
        ...workspace,
        name: name.trim() || workspace.name,
        updatedAt: now(),
      });
    });
  },

  deleteWorkspace(id, soft = true) {
    return enqueue(async () => {
      await removePath(`workspaces/${id}`, soft);
      const current = await listWorkspacesInternal();
      await writeWorkspaceIndexInternal(current.filter((w) => w.id !== id));
      const config = await getConfigInternal();
      if (config.lastActiveWorkspaceId === id) {
        await writeConfigInternal({
          ...config,
          lastActiveWorkspaceId: undefined,
          lastActiveSessionId: undefined,
        });
      }
    });
  },

  listSessions(workspaceId) {
    return listSessionsInternal(workspaceId);
  },

  getSession(workspaceId, sessionId) {
    return getSessionInternal(workspaceId, sessionId);
  },

  createSession(input) {
    return enqueue(() => createSessionInternal(input));
  },

  updateSession(workspaceId, sessionId, patch) {
    return enqueue(() => updateSessionInternal(workspaceId, sessionId, patch));
  },

  deleteSession(workspaceId, sessionId, soft = true) {
    return enqueue(async () => {
      await removePath(sessionPath(workspaceId, sessionId), soft);
      const current = await listSessionsInternal(workspaceId);
      await writeSessionIndexInternal(
        workspaceId,
        current.filter((s) => s.id !== sessionId),
      );
      const workspace = await getWorkspaceInternal(workspaceId);
      if (workspace) {
        const sessions = await listSessionsInternal(workspaceId);
        await writeWorkspaceInternal({
          ...workspace,
          sessionCount: sessions.length,
          lastActiveSessionId:
            workspace.lastActiveSessionId === sessionId
              ? sessions[0]?.id
              : workspace.lastActiveSessionId,
          updatedAt: now(),
        });
      }
    });
  },

  appendMessage(workspaceId, sessionId, msg) {
    return enqueue(() => appendMessageInternal(workspaceId, sessionId, msg));
  },

  setSessionWorkflow(workspaceId, sessionId, ir) {
    return enqueue(() =>
      updateSessionInternal(workspaceId, sessionId, {
        isWorkflow: true,
        workflow: ir,
        meta: {
          adapter:
            ir.meta.adapter === 'codex' || ir.meta.adapter === 'gemini'
              ? ir.meta.adapter
              : 'claude-code',
        },
      }),
    ).then(() => undefined);
  },
};
