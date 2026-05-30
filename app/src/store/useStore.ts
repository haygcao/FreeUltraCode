import { create } from 'zustand';
import {
  DATA,
  type IREndpoint,
  type IRGraph,
  type IRLayout,
  type IRNode,
  type IRRunSnapshot,
  type IRRunStatus,
  type NodeType,
  type PinKind,
} from '@/core/ir';
import {
  autoLayoutGraph,
  hasMissingLayout,
  hasStructuralChanges,
} from '@/core/autoLayout';
import { defaultBlueprint } from '@/core/defaultBlueprint';
import { isEmptyWorkflow } from '@/core/isEmptyWorkflow';
import { applyIntent } from '@/core/intentEngine';
import { isRunnable, topoOrderExec } from '@/core/topo';
import { shortId } from '@/lib/id';
import { translatePromptFields } from '@/lib/promptTranslation';
import { aiEditViaCli, cancelAiCli, isTauri } from '@/lib/tauri';
import {
  UNIFIED_SYSTEM,
  extractJsonObject,
  streamAnthropic,
} from '@/lib/anthropic';
import {
  INTERACTION_PROTOCOL,
  formatAnswerForPrompt,
  liveProse,
  parseInteraction,
  stripInteraction,
  type InteractionAnswer,
  type InteractionRequest,
} from '@/core/interaction';
import {
  DEFAULT_LOCALE,
  localizePromptGroup,
  localizePromptItem,
  SUPPORTED_LOCALES,
  type Locale,
  withPromptGroupLocale,
  withPromptItemLocale,
} from '@/lib/i18n';
import {
  defaultComposer,
  initialActiveSessionId,
  modelOptions,
  permissionOptions,
  PROMPT_DEFAULTS_VERSION,
  samplePromptGroups,
  sampleSessions,
} from './sampleSessions';
import {
  loadComposer,
  loadLocale,
  loadPromptAutoTranslate,
  loadPromptGroups,
  loadPromptGroupsVersion,
  saveComposer,
  saveLocale,
  savePromptAutoTranslate,
  savePromptGroups,
  savePromptGroupsVersion,
} from '@/lib/composerStorage';
import { autosave, loadLocalWorkflow } from '@/lib/persist';
import {
  historyStore,
  isAutoTitlePlaceholder,
  titleFromText,
} from './history/store';
import {
  HISTORY_SCHEMA_VERSION,
  type SessionMeta,
  type SessionRecord,
  type SessionSummary,
  type WorkspaceSummary,
} from './history/types';
import type {
  ComposerSettings,
  Message,
  NodeRunState,
  PromptGroup,
  PromptItem,
  SelectOption,
  Session,
} from './types';

/**
 * CONTRACT: the single zustand store. App.tsx and panels rely on this exact
 * surface — keep these fields and actions stable.
 *
 * State (pre-existing, unchanged):
 *   workflow, selectedNodeId,
 *   sessions, activeSessionId, messages, promptGroups,
 *   composer, composerDraft, permissionOptions, modelOptions, workspaceHistory
 * State (added this milestone):
 *   mode ('design'|'running'), runState (Record<id,NodeRunState>),
 *   dirty (boolean), currentFilePath (string|null)
 *
 * Actions (pre-existing, unchanged signatures):
 *   selectNode(id), setWorkflow(ir), setAdapter(id), runWorkflow(),
 *   newWorkflow(), newSession(), sendPrompt(text), setComposer(patch),
 *   setComposerDraft(text), appendComposerDraft(text), setWorkspace(path)
 * Actions (added this milestone — graph editing + run/mode control):
 *   addNode(type, params?) -> id, updateNodeParams(id, patch),
 *   updateNodeLabel(id, label), removeNode(id),
 *   addEdge(from, to, kind) -> id, removeEdge(id),
 *   setNodePosition(id, x, y), setMode(mode),
 *   setRunState(id, state), resetRunState(),
 *   applyGraphEdit(ir), markSaved(path?),
 *   markActiveSessionAsWorkflow() — locked flag, called from any
 *     graph-touching action; once true the session never reverts.
 * Actions (prompt-library CRUD — every mutation persists to localStorage):
 *   addPromptItem(groupId, label, text), updatePromptItem(groupId, itemId, patch),
 *   removePromptItem(groupId, itemId),
 *   addPromptGroup(label) -> id, updatePromptGroup(groupId, label),
 *   removePromptGroup(groupId), resetPromptGroups()
 *
 * Every graph-mutating action sets dirty=true (except setNodePosition, which
 * only touches layout and is flushed via markSaved to avoid polluting the
 * dirty flag during frequent drags).
 */
export interface StoreState {
  // Graph state
  workflow: IRGraph;
  selectedNodeId: string | null;

  // Editor lifecycle state
  mode: 'design' | 'running';
  runState: Record<string, NodeRunState>;
  runOutputs: Record<string, string>;
  lastRunFailedNodeId: string | null;
  dirty: boolean;
  currentFilePath: string | null;

  // AI state (browser-direct streaming).
  /** True while an AI request is streaming in (drives loading + disables send). */
  aiStreaming: boolean;

  // Session / UI state
  sessions: Session[];
  activeSessionId: string | null;
  messages: Message[];
  promptGroups: PromptGroup[];
  locale: Locale;
  promptAutoTranslate: boolean;

  // Composer (AI-input) state — pure UI, never enters the IRGraph.
  composer: ComposerSettings;
  /** Current text in the AI input box. Pure UI state; not persisted. */
  composerDraft: string;
  /** Incremented when another panel asks the AI input box to focus itself. */
  composerFocusVersion: number;
  permissionOptions: SelectOption[];
  modelOptions: SelectOption[];
  /** Previously-selected workspace folders, most-recent-first. */
  workspaceHistory: string[];
  /** True once `.worktree` history has been loaded or gracefully skipped. */
  historyReady: boolean;
  /** Resolved `.worktree` root path for diagnostics. */
  historyRootPath: string | null;
  /** Workspace buckets rendered as the first level of the history tree. */
  workspaces: WorkspaceSummary[];
  /** Session summaries grouped by workspace id for the Sidebar tree. */
  sessionTree: Record<string, Session[]>;
  /** Currently selected workspace bucket. */
  activeWorkspaceId: string | null;

  // Actions
  initHistory: () => void;
  setLocale: (locale: Locale) => void;
  setPromptAutoTranslate: (enabled: boolean) => void;
  selectNode: (id: string | null) => void;
  setWorkflow: (ir: IRGraph) => void;
  setAdapter: (adapter: string) => void;
  runWorkflow: () => void;
  resumeWorkflow: () => void;
  stopWorkflow: () => void;
  newWorkflow: () => void;
  newSession: () => void;
  selectSession: (sessionId: string, workspaceId?: string) => void;
  sendPrompt: (text: string) => void;
  /**
   * Submit the user's answer to an interactive node message (the AI-return dock
   * widget). Marks the message answered and unblocks the waiting run node so it
   * can continue with the user's choice/input. See core/interaction.ts.
   */
  answerInteraction: (messageId: string, answer: InteractionAnswer) => void;
  /**
   * Skip a pending interaction without answering it (the widget's "跳过"). Marks
   * it cancelled and unblocks the waiting loop with a null answer — a node ends
   * quietly; the AI editor proceeds with what it has. See core/interaction.ts.
   */
  dismissInteraction: (messageId: string) => void;
  setComposer: (patch: Partial<ComposerSettings>) => void;
  setComposerDraft: (text: string) => void;
  appendComposerDraft: (text: string) => void;
  setWorkspace: (path: string) => void;

  // Graph editing
  addNode: (
    type: NodeType,
    params?: Record<string, unknown>,
    parent?: string,
  ) => string;
  updateNodeParams: (id: string, patch: Record<string, unknown>) => void;
  updateNodeLabel: (id: string, label: string) => void;
  removeNode: (id: string) => void;
  addEdge: (from: IREndpoint, to: IREndpoint, kind: PinKind) => string;
  removeEdge: (id: string) => void;
  setNodePosition: (id: string, x: number, y: number) => void;

  // Run / mode control
  setMode: (mode: 'design' | 'running') => void;
  setRunState: (id: string, state: NodeRunState) => void;
  resetRunState: () => void;

  // Whole-graph + persistence
  applyGraphEdit: (ir: IRGraph) => void;
  markSaved: (path?: string) => void;

  // Session-type marker: flip the active session's isWorkflow flag to true.
  // Locked — once true, it stays true (mirrors the SessionRecord contract in
  // history-store-spec.md §4.3). Called from every action that touches the
  // workflow blueprint so pure-chat sessions stay false.
  markActiveSessionAsWorkflow: () => void;

  // Prompt-library CRUD (persisted to localStorage)
  addPromptItem: (
    groupId: string,
    label: string,
    text: string,
    locale?: Locale,
  ) => void;
  updatePromptItem: (
    groupId: string,
    itemId: string,
    patch: Partial<PromptItem>,
  ) => void;
  updatePromptItemLocalized: (
    groupId: string,
    itemId: string,
    patch: Partial<PromptItem>,
    locale?: Locale,
  ) => Promise<boolean>;
  removePromptItem: (groupId: string, itemId: string) => void;
  addPromptGroup: (label: string, locale?: Locale) => string;
  updatePromptGroup: (groupId: string, label: string) => void;
  updatePromptGroupLocalized: (
    groupId: string,
    label: string,
    locale?: Locale,
  ) => Promise<boolean>;
  removePromptGroup: (groupId: string) => void;
  resetPromptGroups: () => void;
}

const WORKSPACE_HISTORY_LIMIT = 8;

/** localStorage key holding the user's Anthropic API key (set via AIDock). */
const API_KEY_STORAGE = 'owf_anthropic_key';

/** Read the API key from localStorage; returns null in non-browser contexts. */
function readApiKey(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const v = window.localStorage.getItem(API_KEY_STORAGE);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Per-type default label + params used by addNode. Mirrors the node catalogue
 * in the design doc; agent/control nodes carry their minimal editable params.
 */
const NODE_DEFAULTS: Record<
  NodeType,
  { label: string; params: Record<string, unknown> }
> = {
  start: { label: 'Start', params: {} },
  end: { label: 'End', params: {} },
  agent: { label: '描述你的步骤', params: { model: 'sonnet' } },
  parallel: { label: '并行', params: { branches: [] } },
  pipeline: { label: '流水线', params: { items: 'args', stages: [] } },
  phase: { label: '阶段', params: { title: '阶段' } },
  branch: { label: '分支', params: { condition: 'true' } },
  loop: { label: '循环', params: { condition: 'false' } },
  workflow: { label: '子工作流', params: { name: 'sub' } },
  log: { label: '日志', params: { message: '' } },
  variable: { label: '变量', params: { value: null } },
  codeblock: { label: '代码块', params: { code: '' } },
};

/**
 * Collect a node id plus every transitive descendant (children whose `parent`
 * chain leads back to it). Used by removeNode so deleting a branch/loop removes
 * its whole body rather than orphaning child nodes.
 */
function collectSubtree(nodes: IRNode[], rootId: string): Set<string> {
  const doomed = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parent && doomed.has(n.parent) && !doomed.has(n.id)) {
        doomed.add(n.id);
        grew = true;
      }
    }
  }
  return doomed;
}

function makeSession(locale: Locale = DEFAULT_LOCALE): Session {
  const ts = Date.now();
  return {
    id: shortId('s'),
    title: locale === 'en-US' ? 'New Session' : '新会话',
    createdAt: ts,
    updatedAt: ts,
    // New sessions default to chat-type; the first workflow touch flips this on.
    isWorkflow: false,
  };
}

function sessionFromSummary(summary: SessionSummary): Session {
  return {
    id: summary.id,
    workspaceId: summary.workspaceId,
    title: summary.title,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    isWorkflow: summary.isWorkflow,
    preview: summary.preview,
    messageCount: summary.messageCount,
  };
}

function summaryFromRecord(record: SessionRecord): SessionSummary {
  const last = record.messages[record.messages.length - 1]?.text?.trim();
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    title: record.title,
    isWorkflow: record.isWorkflow,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    preview: last ? last.slice(0, 80) : undefined,
    messageCount: record.messages.length,
  };
}

function sessionFromRecord(record: SessionRecord): Session {
  return sessionFromSummary(summaryFromRecord(record));
}

async function loadSessionTree(
  workspaces: WorkspaceSummary[],
): Promise<Record<string, Session[]>> {
  const pairs = await Promise.all(
    workspaces.map(async (workspace) => {
      const sessions = await historyStore.listSessions(workspace.id);
      return [workspace.id, sessions.map((item) => sessionFromSummary(item))] as const;
    }),
  );
  return Object.fromEntries(pairs);
}

function getActiveHistoryContext():
  | { workspaceId: string; sessionId: string }
  | null {
  const state = useStore.getState();
  if (!state.historyReady) return null;
  if (!state.activeWorkspaceId || !state.activeSessionId) return null;
  return {
    workspaceId: state.activeWorkspaceId,
    sessionId: state.activeSessionId,
  };
}

async function persistMessage(msg: Message): Promise<void> {
  const ctx = getActiveHistoryContext();
  if (!ctx) return;
  await historyStore.appendMessage(ctx.workspaceId, ctx.sessionId, msg);
}

async function persistCurrentMessages(): Promise<void> {
  const ctx = getActiveHistoryContext();
  if (!ctx) return;
  const state = useStore.getState();
  await historyStore.updateSession(ctx.workspaceId, ctx.sessionId, {
    messages: state.messages,
  });
}

function markLocalActiveSessionWorkflow(): void {
  useStore.setState((state) => {
    const sessions = markedSessions(state.sessions, state.activeSessionId);
    if (sessions === state.sessions) return state;
    return {
      sessions,
      sessionTree: state.activeWorkspaceId
        ? { ...state.sessionTree, [state.activeWorkspaceId]: sessions }
        : state.sessionTree,
    };
  });
}

async function markActiveHistorySessionWorkflow(): Promise<void> {
  markLocalActiveSessionWorkflow();
  const ctx = getActiveHistoryContext();
  if (!ctx) return;
  await historyStore.updateSession(ctx.workspaceId, ctx.sessionId, {
    isWorkflow: true,
  });
}

async function persistActiveWorkflowSnapshot(
  ir?: IRGraph,
  meta?: Partial<SessionMeta>,
): Promise<void> {
  markLocalActiveSessionWorkflow();
  const ctx = getActiveHistoryContext();
  if (!ctx) return;
  const state = useStore.getState();
  const workflow = ir ?? state.workflow;
  await historyStore.setSessionWorkflow(ctx.workspaceId, ctx.sessionId, workflow);
  if (meta) {
    await historyStore.updateSession(ctx.workspaceId, ctx.sessionId, {
      meta,
    });
  }
}

function runOutputsFromMeta(meta?: SessionMeta): Record<string, string> {
  const raw = meta?.runOutputs;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function isRunStatus(value: unknown): value is IRRunStatus {
  return (
    value === 'idle' ||
    value === 'running' ||
    value === 'success' ||
    value === 'error' ||
    value === 'interrupted'
  );
}

function persistedStatusForDisplay(status: IRRunStatus): NodeRunState {
  // A reopened workflow cannot still be executing inside this UI session.
  return status === 'running' ? 'interrupted' : status;
}

function runOutputsFromSnapshot(
  snapshot?: IRRunSnapshot,
): Record<string, string> {
  const raw = snapshot?.outputs;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function runSnapshotFromMeta(meta?: SessionMeta): IRRunSnapshot | null {
  if (!meta) return null;
  const hasRunData =
    !!meta.runStatus ||
    !!meta.runState ||
    !!meta.runOutputs ||
    typeof meta.failedNodeId === 'string' ||
    !!meta.runError;
  if (!hasRunData) return null;
  return {
    status: isRunStatus(meta.runStatus) ? meta.runStatus : 'idle',
    nodeStates: meta.runState,
    outputs: runOutputsFromMeta(meta),
    failedNodeId:
      typeof meta.failedNodeId === 'string' ? meta.failedNodeId : null,
    error: meta.runError ?? null,
  };
}

function runProgressFromSnapshot(
  workflow: IRGraph,
  snapshot?: IRRunSnapshot | null,
): Pick<StoreState, 'runState' | 'runOutputs' | 'lastRunFailedNodeId'> {
  if (!snapshot) return emptyRunProgress();

  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  const runOutputs = Object.fromEntries(
    Object.entries(runOutputsFromSnapshot(snapshot)).filter(([nodeId]) =>
      nodeIds.has(nodeId),
    ),
  );
  const runState: Record<string, NodeRunState> = {};

  for (const nodeId of Object.keys(runOutputs)) {
    runState[nodeId] = 'success';
  }

  const rawNodeStates = snapshot.nodeStates;
  if (
    rawNodeStates &&
    typeof rawNodeStates === 'object' &&
    !Array.isArray(rawNodeStates)
  ) {
    for (const [nodeId, status] of Object.entries(rawNodeStates)) {
      if (!nodeIds.has(nodeId) || !isRunStatus(status) || status === 'idle') {
        continue;
      }
      runState[nodeId] = persistedStatusForDisplay(status);
    }
  }

  const preferredFailedNodeId =
    typeof snapshot.failedNodeId === 'string' &&
    nodeIds.has(snapshot.failedNodeId)
      ? snapshot.failedNodeId
      : null;
  const lastRunFailedNodeId =
    preferredFailedNodeId ??
    Object.entries(runState).find(
      ([, status]) =>
        status === 'error' ||
        status === 'interrupted' ||
        status === 'running',
    )?.[0] ??
    null;

  if (lastRunFailedNodeId && runState[lastRunFailedNodeId] == null) {
    runState[lastRunFailedNodeId] =
      snapshot.status === 'interrupted' || snapshot.status === 'running'
        ? 'interrupted'
        : 'error';
  }

  return { runState, runOutputs, lastRunFailedNodeId };
}

function emptyRunProgress(): Pick<
  StoreState,
  'runState' | 'runOutputs' | 'lastRunFailedNodeId'
> {
  return { runState: {}, runOutputs: {}, lastRunFailedNodeId: null };
}

function emptyRunMeta(): Partial<SessionMeta> {
  return {
    runStatus: 'idle',
    runState: {},
    runOutputs: {},
    failedNodeId: null,
    runError: null,
  };
}

function workflowWithoutRunSnapshot(workflow: IRGraph): IRGraph {
  if (!workflow.meta.run) return workflow;
  const meta = { ...workflow.meta };
  delete meta.run;
  return { ...workflow, meta };
}

function workflowWithRunSnapshot(
  workflow: IRGraph,
  snapshot: IRRunSnapshot,
): IRGraph {
  const hasState = snapshot.nodeStates && Object.keys(snapshot.nodeStates).length > 0;
  const hasOutputs = snapshot.outputs && Object.keys(snapshot.outputs).length > 0;
  if (
    snapshot.status === 'idle' &&
    !hasState &&
    !hasOutputs &&
    !snapshot.failedNodeId &&
    !snapshot.error
  ) {
    return workflowWithoutRunSnapshot(workflow);
  }
  return { ...workflow, meta: { ...workflow.meta, run: snapshot } };
}

function runSnapshotFromState(
  state: StoreState,
  status?: IRRunStatus,
  error: Record<string, unknown> | null = null,
): IRRunSnapshot {
  const nodeStates = Object.fromEntries(
    Object.entries(state.runState).filter(([, nodeStatus]) => nodeStatus !== 'idle'),
  );
  const outputs = Object.fromEntries(
    Object.entries(state.runOutputs).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  const inferredStatus =
    state.mode === 'running'
      ? 'running'
      : Object.values(state.runState).some((nodeStatus) => nodeStatus === 'error')
        ? 'error'
        : Object.values(state.runState).some(
              (nodeStatus) => nodeStatus === 'interrupted',
            )
          ? 'interrupted'
          : Object.keys(nodeStates).length > 0
            ? 'success'
            : 'idle';
  return {
    status: status ?? inferredStatus,
    nodeStates,
    outputs,
    failedNodeId: state.lastRunFailedNodeId,
    error,
    updatedAt: Date.now(),
  };
}

function runMetaFromSnapshot(snapshot: IRRunSnapshot): Partial<SessionMeta> {
  return {
    runStatus: snapshot.status,
    runState: snapshot.nodeStates ?? {},
    runOutputs: snapshot.outputs ?? {},
    failedNodeId: snapshot.failedNodeId ?? null,
    runError: snapshot.error ?? null,
  };
}

function restoreWorkflowRunSnapshot(
  workflow: IRGraph,
  meta?: SessionMeta,
): IRGraph {
  const source = runSnapshotFromMeta(meta) ?? workflow.meta.run ?? null;
  if (!source) return workflowWithoutRunSnapshot(workflow);
  const progress = runProgressFromSnapshot(workflow, source);
  return workflowWithRunSnapshot(workflow, {
    status: source.status === 'running' ? 'interrupted' : source.status,
    nodeStates: progress.runState,
    outputs: progress.runOutputs,
    failedNodeId: progress.lastRunFailedNodeId,
    error: source.error ?? null,
    updatedAt: source.updatedAt ?? Date.now(),
  });
}

async function persistWorkflowRunSnapshot(
  workflow: IRGraph,
  snapshot: IRRunSnapshot,
): Promise<void> {
  const nextWorkflow = workflowWithRunSnapshot(workflow, snapshot);
  const currentPath = useStore.getState().currentFilePath;
  await persistActiveWorkflowSnapshot(nextWorkflow, runMetaFromSnapshot(snapshot));
  const path = await autosave(nextWorkflow, currentPath);
  if (path) useStore.getState().markSaved(path);
}

function persistCurrentRunSnapshot(
  status?: IRRunStatus,
  error: Record<string, unknown> | null = null,
): void {
  const state = useStore.getState();
  const snapshot = runSnapshotFromState(state, status, error);
  const workflow = workflowWithRunSnapshot(state.workflow, snapshot);
  useStore.setState({ workflow });
  void persistWorkflowRunSnapshot(workflow, snapshot);
}

function previewFromText(text: string): string {
  const compact = text.trim().replace(/\s+/g, ' ');
  return compact.length > 80 ? `${compact.slice(0, 80)}...` : compact;
}

function applyPromptTitle(
  state: StoreState,
  text: string,
  createdAt: number,
): {
  sessions: Session[];
  sessionTree: Record<string, Session[]>;
  workflow: IRGraph;
} {
  const activeSessionId = state.activeSessionId;
  if (!activeSessionId) {
    return {
      sessions: state.sessions,
      sessionTree: state.sessionTree,
      workflow: state.workflow,
    };
  }

  const title = titleFromText(text);
  const activeSession = state.sessions.find((session) => session.id === activeSessionId);
  const renameSession = activeSession
    ? isAutoTitlePlaceholder(activeSession.title)
    : false;
  const renameWorkflow =
    !!activeSession?.isWorkflow &&
    isAutoTitlePlaceholder(state.workflow.meta.name);

  const updateSession = (session: Session): Session => {
    if (session.id !== activeSessionId) return session;
    return {
      ...session,
      title: renameSession ? title : session.title,
      updatedAt: createdAt,
      preview: previewFromText(text),
      messageCount: (session.messageCount ?? 0) + 1,
    };
  };

  const sessions = state.sessions.map(updateSession);
  const sessionTree = state.activeWorkspaceId
    ? {
        ...state.sessionTree,
        [state.activeWorkspaceId]: (
          state.sessionTree[state.activeWorkspaceId] ?? state.sessions
        ).map(updateSession),
      }
    : state.sessionTree;
  const workflow = renameWorkflow
    ? { ...state.workflow, meta: { ...state.workflow.meta, name: title } }
    : state.workflow;

  return { sessions, sessionTree, workflow };
}

async function createNewChatSession(): Promise<void> {
  const state = useStore.getState();
  const workspaceId = state.activeWorkspaceId;
  if (!state.historyReady || !workspaceId) {
    const session = makeSession(state.locale);
    useStore.setState({
      sessions: [session, ...state.sessions],
      activeSessionId: session.id,
      messages: [],
    });
    return;
  }

  const record = await historyStore.createSession({
    workspaceId,
    isWorkflow: false,
    messages: [],
    title: state.locale === 'en-US' ? 'New Session' : '新会话',
  });
  const session = sessionFromRecord(record);
  const workspaces = await historyStore.listWorkspaces();
  const sessionTree = await loadSessionTree(workspaces);
  useStore.setState({
    workspaces,
    sessions: sessionTree[workspaceId] ?? [session],
    sessionTree,
    activeSessionId: session.id,
    messages: [],
  });
  await historyStore.patchConfig({
    lastActiveWorkspaceId: workspaceId,
    lastActiveSessionId: session.id,
  });
}

async function createNewWorkflowSession(): Promise<void> {
  const state = useStore.getState();
  const workspaceId = state.activeWorkspaceId;
  const workflow = defaultBlueprint(
    state.locale === 'en-US' ? 'Untitled Workflow' : '未命名工作流',
  );
  if (!state.historyReady || !workspaceId) {
    useStore.setState({
      workflow,
      selectedNodeId: null,
      dirty: false,
      runState: {},
      runOutputs: {},
      lastRunFailedNodeId: null,
      mode: 'design',
    });
    return;
  }

  const record = await historyStore.createSession({
    workspaceId,
    isWorkflow: true,
    workflow,
    title:
      workflow.meta.name ??
      (state.locale === 'en-US' ? 'New Workflow' : '新建工作流'),
  });
  const session = sessionFromRecord(record);
  const workspaces = await historyStore.listWorkspaces();
  const sessionTree = await loadSessionTree(workspaces);
  useStore.setState({
    workflow,
    selectedNodeId: null,
    dirty: false,
    runState: {},
    runOutputs: {},
    lastRunFailedNodeId: null,
    mode: 'design',
    workspaces,
    sessions: sessionTree[workspaceId] ?? [session],
    sessionTree,
    activeSessionId: session.id,
    messages: [],
  });
  await historyStore.patchConfig({
    lastActiveWorkspaceId: workspaceId,
    lastActiveSessionId: session.id,
  });
}

async function activateHistorySession(
  sessionId: string,
  workspaceId?: string,
): Promise<void> {
  const state = useStore.getState();
  const targetWorkspaceId = workspaceId ?? state.activeWorkspaceId ?? undefined;
  if (!state.historyReady || !targetWorkspaceId) {
    useStore.setState({ activeSessionId: sessionId });
    return;
  }

  const record = await historyStore.getSession(targetWorkspaceId, sessionId);
  if (!record) return;
  const session = sessionFromRecord(record);
  const workspace = state.workspaces.find((ws) => ws.id === targetWorkspaceId);
  const workflow = restoreWorkflowRunSnapshot(
    record.workflow ?? state.workflow,
    record.meta,
  );
  const runProgress = runProgressFromSnapshot(workflow, workflow.meta.run ?? null);
  useStore.setState((s) => {
    const composer = workspace
      ? { ...s.composer, workspace: workspace.path }
      : s.composer;
    const workspaceHistory = workspace?.path
      ? [
          workspace.path,
          ...s.workspaceHistory.filter((p) => p !== workspace.path),
        ].slice(0, WORKSPACE_HISTORY_LIMIT)
      : s.workspaceHistory;
    if (workspace) saveComposer({ composer, workspaceHistory });
    return {
      activeWorkspaceId: targetWorkspaceId,
      activeSessionId: session.id,
      composer,
      workspaceHistory,
      sessions: s.sessionTree[targetWorkspaceId] ?? [session],
      sessionTree: {
        ...s.sessionTree,
        [targetWorkspaceId]: [
          session,
          ...(s.sessionTree[targetWorkspaceId] ?? []).filter(
            (item) => item.id !== session.id,
          ),
      ],
      },
      messages: record.messages,
      workflow,
      ...runProgress,
      mode: 'design',
    };
  });
  await historyStore.patchConfig({
    lastActiveWorkspaceId: targetWorkspaceId,
    lastActiveSessionId: session.id,
  });
}

async function activateWorkspacePath(path: string): Promise<void> {
  const trimmed = path.trim();
  if (!trimmed) return;
  const state = useStore.getState();
  if (!state.historyReady) return;

  const workspace = await historyStore.resolveWorkspaceByPath(trimmed);
  const sessions = await historyStore.listSessions(workspace.id);
  let active = sessions[0];
  if (!active) {
    const record = await historyStore.createSession({
      workspaceId: workspace.id,
      isWorkflow: false,
      messages: [],
    });
    active = summaryFromRecord(record);
    sessions.unshift(summaryFromRecord(record));
  }

  const workspaces = await historyStore.listWorkspaces();
  const sessionTree = await loadSessionTree(workspaces);
  const activeRecord = active
    ? await historyStore.getSession(workspace.id, active.id)
    : null;
  const workflow = restoreWorkflowRunSnapshot(
    activeRecord?.workflow ?? state.workflow,
    activeRecord?.meta,
  );
  const runProgress = runProgressFromSnapshot(workflow, workflow.meta.run ?? null);
  useStore.setState((s) => ({
    workspaces,
    activeWorkspaceId: workspace.id,
    sessions: sessions.map((item) => sessionFromSummary(item)),
    sessionTree,
    activeSessionId: active?.id ?? null,
    messages: activeRecord?.messages ?? [],
    workflow,
    ...runProgress,
    mode: 'design',
    composer: { ...s.composer, workspace: trimmed },
  }));
  await historyStore.patchConfig({
    lastActiveWorkspaceId: workspace.id,
    lastActiveSessionId: active?.id,
  });
}

async function initHistoryFromDisk(): Promise<void> {
  if (historyInitStarted) return;
  historyInitStarted = true;
  try {
    await historyStore.ready();
    const rootPath = await historyStore.rootPath();
    const config = await historyStore.getConfig();
    let workspaces = await historyStore.listWorkspaces();

    const persisted = loadComposer();
    const persistedPath = persisted?.composer.workspace?.trim();
    const configuredWorkspace = config.lastActiveWorkspaceId
      ? await historyStore.getWorkspace(config.lastActiveWorkspaceId)
      : null;
    let workspace = persistedPath
      ? await historyStore.resolveWorkspaceByPath(persistedPath)
      : configuredWorkspace;
    if (!workspace && workspaces[0]) {
      workspace = await historyStore.getWorkspace(workspaces[0].id);
    }
    if (!workspace) {
      workspace = await historyStore.resolveWorkspaceByPath('');
    }

    workspaces = await historyStore.listWorkspaces();
    const sessions = await historyStore.listSessions(workspace.id);
    let active =
      sessions.find((s) => s.id === config.lastActiveSessionId) ??
      sessions.find((s) => s.id === workspace.lastActiveSessionId) ??
      sessions[0];
    if (!active) {
      const created = await historyStore.createSession({
        workspaceId: workspace.id,
        isWorkflow: false,
        messages: [],
      });
      active = summaryFromRecord(created);
      sessions.unshift(summaryFromRecord(created));
      workspaces = await historyStore.listWorkspaces();
    }
    const sessionTree = await loadSessionTree(workspaces);
    const activeRecord = active
      ? await historyStore.getSession(workspace.id, active.id)
      : null;
    const workflow = restoreWorkflowRunSnapshot(
      activeRecord?.workflow ?? useStore.getState().workflow,
      activeRecord?.meta,
    );
    const runProgress = runProgressFromSnapshot(workflow, workflow.meta.run ?? null);

    useStore.setState((s) => ({
      historyReady: true,
      historyRootPath: rootPath,
      workspaces,
      activeWorkspaceId: workspace.id,
      sessions: sessions.map((item) => sessionFromSummary(item)),
      sessionTree,
      activeSessionId: active?.id ?? null,
      messages: activeRecord?.messages ?? [],
      workflow,
      ...runProgress,
      mode: 'design',
      composer: {
        ...s.composer,
        workspace: workspace.path || s.composer.workspace,
      },
    }));
    await historyStore.patchConfig({
      schemaVersion: HISTORY_SCHEMA_VERSION,
      lastActiveWorkspaceId: workspace.id,
      lastActiveSessionId: active?.id,
    });
  } catch {
    useStore.setState({ historyReady: true });
  }
}

/**
 * Pure helper: return the updated `sessions` array with the active session's
 * `isWorkflow` flipped to true, or the original array when nothing changes
 * (no active session, already flagged, or session missing). Used inside
 * mutating actions so we keep the flag flip in the same set() call as the
 * graph mutation — no extra render.
 *
 * Lock semantics: never flips a `true` back to `false`.
 */
function markedSessions(
  sessions: Session[],
  activeSessionId: string | null,
): Session[] {
  if (!activeSessionId) return sessions;
  let dirty = false;
  const next = sessions.map((s) => {
    if (s.id !== activeSessionId || s.isWorkflow) return s;
    dirty = true;
    return { ...s, isWorkflow: true };
  });
  return dirty ? next : sessions;
}

// Restore persisted composer settings + workspace history (if any). Normalize a
// stale model id (e.g. an old fake option) back to the default so the real
// Anthropic call always gets a valid model.
const persisted = loadComposer();
const seedComposer: ComposerSettings = (() => {
  const c = persisted?.composer ?? defaultComposer;
  const valid = modelOptions.some((o) => o.id === c.model);
  return valid ? c : { ...c, model: defaultComposer.model };
})();
const seedLocale = loadLocale();
const seedPromptAutoTranslate = loadPromptAutoTranslate();

// Seed the graph from the last autosaved workflow if present, otherwise start
// from a fresh default blueprint (start → agent → end). We deliberately do NOT
// seed the demo sample here: that caused "new workflow" to flicker back to the
// review-changes sample whenever the store module re-initialised (e.g. on HMR).
const seedWorkflow =
  loadLocalWorkflow() ??
  defaultBlueprint(seedLocale === 'en-US' ? 'Untitled Workflow' : '未命名工作流');
const seedWorkflowState = restoreWorkflowRunSnapshot(seedWorkflow);
const seedRunProgress = runProgressFromSnapshot(
  seedWorkflowState,
  seedWorkflowState.meta.run ?? null,
);

/**
 * Seed the prompt library, merging newly-shipped default groups into the user's
 * persisted library.
 *
 * Without this, adding a default group to `samplePromptGroups` would never show
 * up for users who already have a persisted library (loadPromptGroups() wins),
 * silently hiding new defaults. The merge runs once per PROMPT_DEFAULTS_VERSION
 * bump (tracked in localStorage): any default group whose `id` is absent from
 * the persisted set is appended, preserving all of the user's own edits and not
 * resurrecting groups they deliberately deleted in earlier versions.
 */
function seedPromptGroups(): PromptGroup[] {
  const stored = loadPromptGroups();
  if (!stored) return samplePromptGroups; // never edited → use full defaults
  if (loadPromptGroupsVersion() >= PROMPT_DEFAULTS_VERSION) return stored;

  const existing = new Set(stored.map((g) => g.id));
  const additions = samplePromptGroups.filter((g) => !existing.has(g.id));
  const merged = additions.length ? [...stored, ...additions] : stored;
  if (additions.length) savePromptGroups(merged);
  savePromptGroupsVersion(PROMPT_DEFAULTS_VERSION);
  return merged;
}
const seedPromptGroupsValue = seedPromptGroups();
let historyInitStarted = false;

export const useStore = create<StoreState>((set) => ({
  // Seed graph: restored autosave, or a fresh default blueprint.
  workflow: seedWorkflowState,
  selectedNodeId: null,

  // Editor lifecycle: start in design mode, no run state, clean, unsaved.
  mode: 'design',
  runState: seedRunProgress.runState,
  runOutputs: seedRunProgress.runOutputs,
  lastRunFailedNodeId: seedRunProgress.lastRunFailedNodeId,
  dirty: false,
  currentFilePath: null,

  // AI: idle.
  aiStreaming: false,

  // Seed session-domain state from the sample module so the dev UI renders
  // a populated session history, message stream, and prompt library.
  sessions: sampleSessions,
  activeSessionId: initialActiveSessionId,
  // Start with an empty AI return stream; messages accrue as the user interacts.
  messages: [],
  // Restore the user-edited prompt library if present (merging in any newly-
  // shipped default groups), else the full defaults. See seedPromptGroups().
  promptGroups: seedPromptGroupsValue,
  locale: seedLocale,
  promptAutoTranslate: seedPromptAutoTranslate,

  // Composer settings seeded from the sample option lists, overlaid with any
  // persisted selections.
  composer: seedComposer,
  composerDraft: '',
  composerFocusVersion: 0,
  permissionOptions,
  modelOptions,
  workspaceHistory: persisted?.workspaceHistory ?? [],
  historyReady: false,
  historyRootPath: null,
  workspaces: [],
  sessionTree: {},
  activeWorkspaceId: null,

  initHistory: () => {
    void initHistoryFromDisk();
  },

  setLocale: (locale) => {
    set({ locale });
    saveLocale(locale);
  },

  setPromptAutoTranslate: (enabled) => {
    set({ promptAutoTranslate: enabled });
    savePromptAutoTranslate(enabled);
  },

  selectNode: (id) => set({ selectedNodeId: id }),

  setWorkflow: (ir) => {
    const workflow = restoreWorkflowRunSnapshot(ir);
    const runProgress = runProgressFromSnapshot(
      workflow,
      workflow.meta.run ?? null,
    );
    set({ workflow, ...runProgress });
    void persistActiveWorkflowSnapshot(
      workflow,
      workflow.meta.run ? runMetaFromSnapshot(workflow.meta.run) : emptyRunMeta(),
    );
  },

  // Switch the target runtime adapter (Claude Code / Codex / Gemini). The
  // adapter lives in the IR meta so the emitter can target the right runtime.
  setAdapter: (adapter) => {
    set((state) => ({
      workflow: workflowWithoutRunSnapshot({
        ...state.workflow,
        meta: { ...state.workflow.meta, adapter },
      }),
      ...emptyRunProgress(),
    }));
    void persistActiveWorkflowSnapshot(undefined, emptyRunMeta());
  },

  // Run action — execute the blueprint node-by-node.
  //
  // Flow:
  //   1. Flip to running mode and reset per-node run state.
  //   2. In Tauri: interpret the IR — walk the exec spine and run each agent/
  //      parallel/pipeline/workflow node through the local CLI (`claude -p` via
  //      `ai_cli`), threading upstream data-edge outputs into the prompt and
  //      streaming each node's result into the dock.
  //   3. In a plain browser (no CLI): a topological simulation (running→success
  //      with a short delay per node).
  //   4. Either way the run terminates and returns to design mode (the "运行中"
  //      badge clears), or the user can hit 停止 to abort early.
  runWorkflow: () => startWorkflowRun(false),

  resumeWorkflow: () => startWorkflowRun(true),

  stopWorkflow: () => stopWorkflowRun(),

  // Load a fresh starter graph (start → agent → end), clean and in design mode.
  newWorkflow: () =>
    void createNewWorkflowSession(),

  newSession: () => {
    void createNewChatSession();
  },

  selectSession: (sessionId, workspaceId) => {
    void activateHistorySession(sessionId, workspaceId);
  },

  // AI-driven graph edit (design mode only).
  //
  // Flow:
  //   1. Push the user message into the stream immediately so the UI feels
  //      responsive.
  //   2. While in running mode, no-op (the AIDock disables input anyway).
  //   3. Snapshot the current IR + read the API key from localStorage.
  //   4. Try `aiEditGraph(ir, text, apiKey)`:
  //        - Success → applyGraphEdit(newIr) + push "已修改蓝图" receipt.
  //        - Throws NO_BACKEND / NO_API_KEY / network error → fall back to
  //          the local intent engine (applyIntent). When the engine changes
  //          the graph, apply it; otherwise push the engine's hint as-is.
  //
  // The action stays `(text) => void` per the public contract; the async
  // work runs in a self-invoked IIFE.
  // AI send — one step, returns an explanation + (optional) IRGraph that is
  // applied automatically.
  //
  // Backend priority:
  //   1. Desktop shell (Tauri): shell out to the local agent CLI (`claude -p`)
  //      via the `ai_cli` command — uses the machine's own env/credentials, so
  //      NO in-app key is needed. Non-streaming (CLI returns the full reply).
  //   2. Browser with a key: stream directly from the Anthropic API (live
  //      token-by-token) using the localStorage key + selected model.
  //   3. Otherwise: local keyword intent engine for simple edits, else a hint.
  //
  // In all cases the reply is a short Chinese explanation optionally followed by
  // a fenced ```json IRGraph; the JSON is hidden from the stream, parsed, and
  // applied to the blueprint. Pure questions (no fence) leave the graph as-is.
  sendPrompt: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const state = useStore.getState();
    if (state.mode === 'running' || state.aiStreaming) return;

    const userMsg: Message = {
      id: shortId('m'),
      role: 'user',
      text: trimmed,
      createdAt: Date.now(),
    };
    const promptState = useStore.getState();
    const promptUpdate = applyPromptTitle(
      promptState,
      trimmed,
      userMsg.createdAt,
    );
    set((s) => ({
      messages: [...s.messages, userMsg],
      sessions: promptUpdate.sessions,
      sessionTree: promptUpdate.sessionTree,
      workflow: promptUpdate.workflow,
    }));
    const promptWorkflowName =
      promptUpdate.workflow.meta.name !== state.workflow.meta.name
        ? promptUpdate.workflow.meta.name
        : null;
    void persistMessage(userMsg);

    const ir = useStore.getState().workflow;
    const apiKey = readApiKey() ?? undefined;
    const model = state.composer.model;
    const adapter = ir.meta.adapter ?? 'claude-code';
    const inTauri = isTauri();
    // Claude Code edits can use the Anthropic API when a key is configured.
    // Other adapters (Codex / Gemini) should respect the selected runtime and
    // go through the local CLI in the desktop shell.
    const useApi = !!apiKey && adapter === 'claude-code';
    const useCli = !useApi && inTauri;

    const pushAssistant = (txt: string) => {
      const msg: Message = {
        id: shortId('m'),
        role: 'assistant',
        text: txt,
        createdAt: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, msg] }));
      void persistMessage(msg);
    };

    // No API key and no desktop CLI: local keyword fallback.
    if (!useApi && !useCli) {
      const result = applyIntent(ir, trimmed);
      if (result.changed) {
        useStore.getState().applyGraphEdit(result.ir);
        pushAssistant(`⟳ 已修改蓝图 (本地意图引擎)。${result.note}`);
      } else {
        pushAssistant(
          `当前环境无法调用所选运行时。请在桌面版中使用本地 CLI，或切回 Claude Code 并配置 API key。\n（本地意图引擎：${result.note}）`,
        );
      }
      return;
    }

    // "grill-me" (and a few aliases) flips the editor into an interrogation
    // mode: instead of editing immediately, the AI uses the interaction protocol
    // to ask the user, one at a time, about gaps it spots in the blueprint.
    const isGrill = /^(grill[-\s]?me|拷问我|审问我|质询我|挑战我)$/i.test(trimmed);
    const wrapped = isGrill
      ? `请扮演严格的需求评审者。针对当前工作流蓝图，用交互（select / input）逐个向我追问还没考虑清楚的关键问题，例如：每个节点的输入/输出、边界与异常处理、成功/验收标准、节点依赖与先后顺序、该并行还是串行、用什么运行时与模型。一次只问一个问题；问清若干轮后，再据此优化蓝图并按要求输出。`
      : isEmptyWorkflow(ir)
        ? `我希望新建一个 workflow，目的如下：\n${trimmed}`
        : `我希望继续修改 workflow，根据下面意见你来优化流程：\n${trimmed}`;
    const userContent = `当前 IRGraph(JSON)：\n${JSON.stringify(ir)}\n\n用户意见：\n${wrapped}`;

    const aiStartedAt = Date.now();
    const withAiTiming = (body: string, endedAt = Date.now()) =>
      `⏱ ${formatClock(aiStartedAt)} → ${formatClock(endedAt)} · 耗时 ${formatDuration(
        endedAt - aiStartedAt,
      )}\n${body}`;
    const withPromptWorkflowName = (nextIr: IRGraph): IRGraph =>
      promptWorkflowName
        ? {
            ...nextIr,
            meta: { ...nextIr.meta, name: promptWorkflowName },
          }
        : nextIr;

    // The edit may, instead of (or before) returning a blueprint, ask the user
    // clarifying questions via the interaction protocol (e.g. "grill-me"). So we
    // wrap the call in a bounded loop: each round streams into a fresh assistant
    // bubble; an interaction block renders a widget and waits for the answer
    // before re-calling, otherwise the returned graph is applied and we stop.
    set({ aiStreaming: true });

    let activeId = '';
    const newBubble = (initial: string) => {
      const id = shortId('m');
      activeId = id;
      set((s) => ({
        messages: [
          ...s.messages,
          { id, role: 'assistant', text: initial, createdAt: Date.now() },
        ],
      }));
    };
    const setActive = (txt: string) => {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === activeId ? { ...m, text: txt } : m,
        ),
      }));
    };

    // Split a full reply into explanation + optional IRGraph and apply it to the
    // active bubble. Only called once the AI is done asking (no interaction block).
    const finalizeReply = (full: string) => {
      const fence = full.indexOf('```');
      const explanation = (fence === -1 ? full : full.slice(0, fence)).trim();
      if (fence === -1) {
        // No fenced JSON. If the model still emitted a bare {…} object, try it;
        // otherwise this was a question/explanation and the graph is unchanged.
        const maybe = extractJsonObject(full);
        if (maybe.trim().startsWith('{')) {
          try {
            const nextIr = withPromptWorkflowName(JSON.parse(maybe) as IRGraph);
            if (Array.isArray(nextIr.nodes) && Array.isArray(nextIr.edges)) {
              useStore.getState().applyGraphEdit(nextIr);
              setActive(
                withAiTiming(
                  `✓ 已更新蓝图（${nextIr.nodes.length} 节点 / ${nextIr.edges.length} 边）。`,
                ),
              );
              void persistCurrentMessages();
              return;
            }
          } catch {
            /* fall through to prose */
          }
        }
        setActive(
          withAiTiming(
            explanation ||
              '(模型未返回蓝图。请把意图描述得更具体，例如“在 X 后加一个 Y 节点”。)',
          ),
        );
        void persistCurrentMessages();
        return;
      }
      try {
        const nextIr = withPromptWorkflowName(
          JSON.parse(extractJsonObject(full)) as IRGraph,
        );
        if (!Array.isArray(nextIr.nodes) || !Array.isArray(nextIr.edges)) {
          throw new Error('返回的不是合法 IRGraph');
        }
        useStore.getState().applyGraphEdit(nextIr);
        const head = explanation ? `${explanation}\n\n` : '';
        setActive(
          withAiTiming(
            `${head}✓ 已更新蓝图（${nextIr.nodes.length} 节点 / ${nextIr.edges.length} 边）。`,
          ),
        );
        void persistCurrentMessages();
      } catch (parseErr) {
        const msg = (parseErr as Error)?.message ?? String(parseErr);
        const head = explanation ? `${explanation}\n\n` : '';
        setActive(withAiTiming(`${head}⚠ 蓝图未更新：返回的 JSON 无法解析 (${msg})。`));
        void persistCurrentMessages();
      }
    };

    // System prompt + interaction protocol so the editor MAY ask the user to
    // clarify (select/input/confirm) before producing the blueprint.
    const systemWithProtocol =
      `${UNIFIED_SYSTEM}\n\n${INTERACTION_PROTOCOL}\n` +
      `（编辑场景：若需澄清，或用户要你反问，就用上面的交互块逐个提问；问清后再按上面的格式输出中文说明 + \`\`\`json 蓝图。）`;

    // One backend round. Streams live into the active bubble (API) or returns the
    // CLI's full reply. Returns the raw text for interaction/graph parsing.
    const callOnce = async (convo: string): Promise<string> => {
      if (useCli) {
        const cliPrompt =
          `${systemWithProtocol}\n\n` +
          `只针对工作流蓝图作答，不要读取或探索任何代码文件。` +
          `如需澄清就用交互块提问；否则输出中文说明 + 一个 \`\`\`json IRGraph 代码块。\n\n` +
          convo;
        return aiEditViaCli(cliPrompt, adapter, {
          permission: 'full', // -> --dangerously-skip-permissions, no prompts
        });
      }
      let full = '';
      await streamAnthropic({
        apiKey,
        model,
        system: systemWithProtocol,
        userContent: convo,
        maxTokens: 8192,
        onDelta: (chunk) => {
          full += chunk;
          setActive(liveProse(full) || '⟳ 生成中…');
        },
      });
      return full;
    };

    void (async () => {
      let convo = userContent;
      let finalized = false;
      try {
        for (let round = 0; round < MAX_INTERACTION_ROUNDS; round += 1) {
          newBubble(useCli ? `⟳ 通过命令行调用 ${adapter}…` : '⟳ 生成中…');
          const full = await callOnce(convo);
          const req = parseInteraction(full);
          if (!req) {
            finalizeReply(full);
            finalized = true;
            break;
          }
          // The AI is asking. Show its prose, render the widget, and wait.
          setActive(
            withAiTiming(stripInteraction(full) || '（我有几个问题想先和你确认）'),
          );
          void persistCurrentMessages();
          const answer = await awaitInteraction(req);
          if (!answer) {
            convo +=
              '\n\n（用户跳过了这个澄清问题，请不要再追问，直接基于现有信息输出优化后的蓝图。）';
            continue;
          }
          convo += `\n\n${formatAnswerForPrompt(req, answer)}`;
        }
        if (!finalized) {
          newBubble(
            withAiTiming(
              `⚠ 澄清轮数已达上限（${MAX_INTERACTION_ROUNDS}）。请根据以上对话再发送一次，让我据此生成/优化蓝图。`,
            ),
          );
          void persistCurrentMessages();
        }
        set({ aiStreaming: false });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        if (activeId) setActive(withAiTiming(`✗ 调用失败: ${msg}`));
        else pushAssistant(withAiTiming(`✗ 调用失败: ${msg}`));
        void persistCurrentMessages();
        set({ aiStreaming: false });
      }
    })();
  },

  // Resolve a node's interaction request with the user's answer. Marks the
  // message answered (so the widget collapses to a summary) and resolves the
  // promise the run loop is awaiting on (see awaitInteraction). A no-op resolver
  // (e.g. answering a stale widget after the run ended) just updates the message.
  answerInteraction: (messageId, answer) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId && m.interactionStatus === 'pending'
          ? { ...m, interactionAnswer: answer, interactionStatus: 'answered' }
          : m,
      ),
    }));
    void persistCurrentMessages();
    const resolver = pendingInteractionResolvers.get(messageId);
    if (resolver) {
      pendingInteractionResolvers.delete(messageId);
      resolver(answer);
    }
  },

  // Skip a pending interaction (the widget's "跳过"): mark it cancelled and
  // resolve the waiting loop with null (no answer).
  dismissInteraction: (messageId) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId && m.interactionStatus === 'pending'
          ? { ...m, interactionStatus: 'cancelled' }
          : m,
      ),
    }));
    void persistCurrentMessages();
    const resolver = pendingInteractionResolvers.get(messageId);
    if (resolver) {
      pendingInteractionResolvers.delete(messageId);
      resolver(null);
    }
  },

  setComposer: (patch) =>
    set((state) => {
      const composer = { ...state.composer, ...patch };
      saveComposer({ composer, workspaceHistory: state.workspaceHistory });
      return { composer };
    }),

  setComposerDraft: (text) => set({ composerDraft: text }),

  appendComposerDraft: (text) => {
    const addition = text.trim();
    if (!addition) return;
    set((state) => {
      const current = state.composerDraft;
      const next =
        current.trim().length === 0
          ? addition
          : current.endsWith('\n')
            ? `${current}${addition}`
            : `${current}\n${addition}`;
      return {
        composerDraft: next,
        composerFocusVersion: state.composerFocusVersion + 1,
      };
    });
  },

  // Set the active workspace and record it in the most-recent-first history
  // (deduped, capped). Empty paths are ignored.
  setWorkspace: (path) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    set((state) => {
      const composer = { ...state.composer, workspace: trimmed };
      const workspaceHistory = [
        trimmed,
        ...state.workspaceHistory.filter((p) => p !== trimmed),
      ].slice(0, WORKSPACE_HISTORY_LIMIT);
      saveComposer({ composer, workspaceHistory });
      return { composer, workspaceHistory };
    });
    void activateWorkspacePath(trimmed);
  },

  // ── Graph editing ──────────────────────────────────────────────────────

  addNode: (type, params, parent) => {
    const id = shortId('n');
    set((state) => {
      const defaults = NODE_DEFAULTS[type];
      const node: IRNode = {
        id,
        type,
        ...(parent ? { parent } : {}),
        label: defaults.label,
        params: { ...defaults.params, ...(params ?? {}) },
      };
      const nextWorkflow = autoLayoutGraph(
        {
          ...state.workflow,
          nodes: [...state.workflow.nodes, node],
        },
        state.workflow,
      );
      return {
        workflow: workflowWithoutRunSnapshot(nextWorkflow),
        dirty: true,
        ...emptyRunProgress(),
      };
    });
    void persistActiveWorkflowSnapshot(undefined, emptyRunMeta());
    return id;
  },

  updateNodeParams: (id, patch) => {
    set((state) => ({
      workflow: workflowWithoutRunSnapshot({
        ...state.workflow,
        nodes: state.workflow.nodes.map((n) =>
          n.id === id ? { ...n, params: { ...n.params, ...patch } } : n,
        ),
      }),
      dirty: true,
      ...emptyRunProgress(),
    }));
    void persistActiveWorkflowSnapshot(undefined, emptyRunMeta());
  },

  updateNodeLabel: (id, label) => {
    set((state) => ({
      workflow: workflowWithoutRunSnapshot({
        ...state.workflow,
        nodes: state.workflow.nodes.map((n) =>
          n.id === id ? { ...n, label } : n,
        ),
      }),
      dirty: true,
      ...emptyRunProgress(),
    }));
    void persistActiveWorkflowSnapshot(undefined, emptyRunMeta());
  },

  // Remove a node and, when it is a container (branch/loop), all of its
  // transitive descendants — plus every edge touching any removed node.
  removeNode: (id) => {
    set((state) => {
      const doomed = collectSubtree(state.workflow.nodes, id);
      const layout = { ...(state.workflow.layout ?? {}) };
      for (const d of doomed) delete layout[d];
      return {
        workflow: workflowWithoutRunSnapshot({
          ...state.workflow,
          nodes: state.workflow.nodes.filter((n) => !doomed.has(n.id)),
          edges: state.workflow.edges.filter(
            (e) => !doomed.has(e.from.node) && !doomed.has(e.to.node),
          ),
          layout,
        }),
        selectedNodeId: doomed.has(state.selectedNodeId ?? '')
          ? null
          : state.selectedNodeId,
        dirty: true,
        ...emptyRunProgress(),
      };
    });
    void persistActiveWorkflowSnapshot(undefined, emptyRunMeta());
  },

  addEdge: (from, to, kind) => {
    const id = kind === DATA ? shortId('d') : shortId('e');
    set((state) => {
      // Dedupe: identical from/to/kind edges are ignored.
      const exists = state.workflow.edges.some(
        (e) =>
          e.kind === kind &&
          e.from.node === from.node &&
          e.from.port === from.port &&
          e.to.node === to.node &&
          e.to.port === to.port,
      );
      if (exists) return state;
      return {
        workflow: workflowWithoutRunSnapshot({
          ...state.workflow,
          edges: [...state.workflow.edges, { id, from, to, kind }],
        }),
        dirty: true,
        ...emptyRunProgress(),
      };
    });
    void persistActiveWorkflowSnapshot(undefined, emptyRunMeta());
    return id;
  },

  removeEdge: (id) => {
    set((state) => ({
      workflow: workflowWithoutRunSnapshot({
        ...state.workflow,
        edges: state.workflow.edges.filter((e) => e.id !== id),
      }),
      dirty: true,
      ...emptyRunProgress(),
    }));
    void persistActiveWorkflowSnapshot(undefined, emptyRunMeta());
  },

  // Layout-only write. Deliberately does not set dirty: drags are frequent and
  // position is flushed to persistence via markSaved.
  setNodePosition: (id, x, y) => {
    set((state) => ({
      workflow: {
        ...state.workflow,
        layout: { ...(state.workflow.layout ?? {}), [id]: { x, y } },
      },
    }));
    void markActiveHistorySessionWorkflow();
  },

  // ── Run / mode control ─────────────────────────────────────────────────

  setMode: (mode) => set({ mode }),

  setRunState: (id, runNodeState) => {
    set((state) => {
      const runState = { ...state.runState, [id]: runNodeState };
      const workflow = workflowWithRunSnapshot(
        state.workflow,
        runSnapshotFromState({ ...state, runState }),
      );
      return { runState, workflow };
    });
    const state = useStore.getState();
    void persistWorkflowRunSnapshot(
      state.workflow,
      runSnapshotFromState(state),
    );
  },

  resetRunState: () => {
    set((state) => ({
      runState: {},
      workflow: workflowWithoutRunSnapshot(state.workflow),
    }));
    const state = useStore.getState();
    void persistWorkflowRunSnapshot(state.workflow, {
      status: 'idle',
      nodeStates: {},
      outputs: {},
      failedNodeId: null,
      error: null,
      updatedAt: Date.now(),
    });
  },

  // ── Whole-graph + persistence ──────────────────────────────────────────

  applyGraphEdit: (ir) => {
    let nextWorkflow = ir;
    set((state) => {
      const trustedLayout: IRLayout = {};
      for (const node of ir.nodes) {
        const pos = state.workflow.layout?.[node.id];
        if (pos) trustedLayout[node.id] = { x: pos.x, y: pos.y };
      }
      const irWithTrustedLayout = { ...ir, layout: trustedLayout };
      const shouldRelayout =
        hasStructuralChanges(state.workflow, ir) ||
        hasMissingLayout(irWithTrustedLayout);
      nextWorkflow = shouldRelayout
        ? autoLayoutGraph(irWithTrustedLayout, state.workflow, { relayout: 'all' })
        : irWithTrustedLayout;
      nextWorkflow = workflowWithoutRunSnapshot(nextWorkflow);
      return {
        workflow: nextWorkflow,
        selectedNodeId: null,
        dirty: true,
        ...emptyRunProgress(),
      };
    });
    void persistActiveWorkflowSnapshot(nextWorkflow, emptyRunMeta());
  },

  markSaved: (path) =>
    set((state) => ({
      dirty: false,
      currentFilePath: path ?? state.currentFilePath,
    })),

  // Flip the active session's isWorkflow flag to true (locked — never reverts).
  // Returns the state unchanged when nothing flips so we avoid an extra render.
  markActiveSessionAsWorkflow: () => {
    set((state) => {
      const sessions = markedSessions(state.sessions, state.activeSessionId);
      if (sessions === state.sessions) return state;
      const workspaceId = state.activeWorkspaceId;
      return {
        sessions,
        sessionTree: workspaceId
          ? { ...state.sessionTree, [workspaceId]: sessions }
          : state.sessionTree,
      };
    });
    void markActiveHistorySessionWorkflow();
  },

  // ── Prompt-library CRUD ────────────────────────────────────────────────
  //
  // Every mutating action computes the next promptGroups array, persists it via
  // savePromptGroups(next), and commits it to the store. Edits therefore survive
  // a reload (loadPromptGroups seeds the store on init).

  addPromptItem: (groupId, label, text, locale = useStore.getState().locale) =>
    set((state) => {
      const next = state.promptGroups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              items: [
                ...g.items,
                withPromptItemLocale(
                  { id: shortId('pi'), label, text },
                  locale,
                  { label, text },
                ),
              ],
            }
          : g,
      );
      savePromptGroups(next);
      return { promptGroups: next };
    }),

  updatePromptItem: (groupId, itemId, patch) =>
    set((state) => {
      const locale = state.locale;
      const next = state.promptGroups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              items: g.items.map((it) =>
                it.id === itemId
                  ? withPromptItemLocale(it, locale, {
                      label:
                        typeof patch.label === 'string'
                          ? patch.label
                          : localizePromptItem(it, locale).label,
                      text:
                        typeof patch.text === 'string'
                          ? patch.text
                          : localizePromptItem(it, locale).text,
                    })
                  : it,
              ),
            }
          : g,
      );
      savePromptGroups(next);
      return { promptGroups: next };
    }),

  updatePromptItemLocalized: async (groupId, itemId, patch, locale) => {
    const state = useStore.getState();
    const sourceLocale = locale ?? state.locale;
    const group = state.promptGroups.find((g) => g.id === groupId);
    const item = group?.items.find((it) => it.id === itemId);
    if (!group || !item) return false;

    const current = localizePromptItem(item, sourceLocale);
    const sourceValue = {
      label: typeof patch.label === 'string' ? patch.label : current.label,
      text: typeof patch.text === 'string' ? patch.text : current.text,
    };

    let next = state.promptGroups.map((g) =>
      g.id === groupId
        ? {
            ...g,
            items: g.items.map((it) =>
              it.id === itemId
                ? withPromptItemLocale(it, sourceLocale, sourceValue)
                : it,
            ),
          }
        : g,
    );
    savePromptGroups(next);
    set({ promptGroups: next });

    if (!state.promptAutoTranslate) return false;

    const targetLocales = SUPPORTED_LOCALES.filter(
      (value): value is Locale => value !== sourceLocale,
    );
    try {
      const translated = await translatePromptFields(
        sourceValue,
        sourceLocale,
        targetLocales,
        {
          apiKey: readApiKey() ?? undefined,
          model: state.composer.model,
          adapter: state.workflow.meta.adapter ?? 'claude-code',
        },
      );
      const translatedLocales = Object.entries(translated) as [
        Locale,
        { label: string; text: string },
      ][];
      if (translatedLocales.length > 0) {
        next = useStore.getState().promptGroups.map((g) =>
          g.id === groupId
            ? {
                ...g,
                items: g.items.map((it) =>
                  it.id === itemId
                    ? translatedLocales.reduce(
                        (acc, [localeKey, value]) =>
                          withPromptItemLocale(acc, localeKey, value),
                        it,
                      )
                    : it,
                ),
              }
            : g,
        );
        savePromptGroups(next);
        set({ promptGroups: next });
      }
      return translatedLocales.length > 0;
    } catch {
      return false;
    }
  },

  removePromptItem: (groupId, itemId) =>
    set((state) => {
      const next = state.promptGroups.map((g) =>
        g.id === groupId
          ? { ...g, items: g.items.filter((it) => it.id !== itemId) }
          : g,
      );
      savePromptGroups(next);
      return { promptGroups: next };
    }),

  addPromptGroup: (label, locale = useStore.getState().locale) => {
    const id = shortId('pg');
    set((state) => {
      const next = [
        ...state.promptGroups,
        withPromptGroupLocale({ id, label, items: [] }, locale, { label }),
      ];
      savePromptGroups(next);
      return { promptGroups: next };
    });
    return id;
  },

  updatePromptGroup: (groupId, label) =>
    set((state) => {
      const locale = state.locale;
      const next = state.promptGroups.map((g) =>
        g.id === groupId
          ? withPromptGroupLocale(g, locale, {
              label:
                typeof label === 'string'
                  ? label
                  : localizePromptGroup(g, locale).label,
            })
          : g,
      );
      savePromptGroups(next);
      return { promptGroups: next };
    }),

  updatePromptGroupLocalized: async (groupId, label, locale) => {
    const state = useStore.getState();
    const sourceLocale = locale ?? state.locale;
    const group = state.promptGroups.find((g) => g.id === groupId);
    if (!group) return false;

    const current = localizePromptGroup(group, sourceLocale);
    const sourceLabel = typeof label === 'string' ? label : current.label;

    let next = state.promptGroups.map((g) =>
      g.id === groupId
        ? withPromptGroupLocale(g, sourceLocale, { label: sourceLabel })
        : g,
    );
    savePromptGroups(next);
    set({ promptGroups: next });

    if (!state.promptAutoTranslate) return false;

    const targetLocales = SUPPORTED_LOCALES.filter(
      (value): value is Locale => value !== sourceLocale,
    );
    try {
      const translated = await translatePromptFields(
        { label: sourceLabel },
        sourceLocale,
        targetLocales,
        {
          apiKey: readApiKey() ?? undefined,
          model: state.composer.model,
          adapter: state.workflow.meta.adapter ?? 'claude-code',
        },
      );
      const translatedLocales = Object.entries(translated) as [
        Locale,
        { label?: string; text?: string },
      ][];
      if (translatedLocales.length > 0) {
        next = useStore.getState().promptGroups.map((g) =>
          g.id === groupId
            ? translatedLocales.reduce(
                (acc, [localeKey, value]) =>
                  withPromptGroupLocale(acc, localeKey, {
                    label: value.label || sourceLabel,
                  }),
                g,
              )
            : g,
        );
        savePromptGroups(next);
        set({ promptGroups: next });
      }
      return translatedLocales.length > 0;
    } catch {
      return false;
    }
  },

  removePromptGroup: (groupId) =>
    set((state) => {
      const next = state.promptGroups.filter((g) => g.id !== groupId);
      savePromptGroups(next);
      return { promptGroups: next };
    }),

  resetPromptGroups: () =>
    set(() => {
      const next = samplePromptGroups;
      savePromptGroups(next);
      savePromptGroupsVersion(PROMPT_DEFAULTS_VERSION);
      return { promptGroups: next };
    }),
}));

/* -------------------------------------------------------------------------- */
/* Run execution helpers                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Per-run CLI config (workspace + permission), captured from the AIDock controls
 * at run start and shared by every node's `aiEditViaCli` call. Only one run is
 * active at a time (guarded by `mode`), so a module-level value is safe and
 * avoids threading these through every interpreter helper.
 */
let activeRunConfig: { cwd?: string; permission?: string } = {};
const activeCliRunIds = new Set<string>();

/**
 * Resolvers for interaction messages the run loop is currently blocked on,
 * keyed by message id. `answerInteraction` (user submits the widget) or
 * `resolveAllPendingInteractions` (run stopped) calls the resolver to unblock
 * the awaiting node. Module-level for the same reason as `activeCliRunIds`:
 * only one run is active at a time.
 */
const pendingInteractionResolvers = new Map<
  string,
  (answer: InteractionAnswer | null) => void
>();

/** Max times a single node may ask the user before we stop re-invoking it. */
const MAX_INTERACTION_ROUNDS = 6;

/**
 * Push an interactive message into the dock and return a promise that resolves
 * when the user answers it (or null if the run is stopped first).
 */
function awaitInteraction(
  req: InteractionRequest,
): Promise<InteractionAnswer | null> {
  const id = shortId('m');
  const msg: Message = {
    id,
    role: 'assistant',
    text: req.prompt,
    createdAt: Date.now(),
    interaction: req,
    interactionStatus: 'pending',
  };
  useStore.setState((s) => ({ messages: [...s.messages, msg] }));
  void persistMessage(msg);
  return new Promise((resolve) => {
    pendingInteractionResolvers.set(id, resolve);
  });
}

/** Cancel every in-flight interaction (run stopped): resolve null, mark them. */
function resolveAllPendingInteractions(): void {
  for (const [id, resolve] of [...pendingInteractionResolvers]) {
    pendingInteractionResolvers.delete(id);
    resolve(null);
  }
  useStore.setState((s) => ({
    messages: s.messages.map((m) =>
      m.interaction && m.interactionStatus === 'pending'
        ? { ...m, interactionStatus: 'cancelled' }
        : m,
    ),
  }));
}

/** Append a system log line to the message stream. */
function pushRunLog(text: string, role: Message['role'] = 'system'): void {
  const msg: Message = { id: shortId('m'), role, text, createdAt: Date.now() };
  useStore.setState((s) => ({
    messages: [...s.messages, msg],
  }));
  void persistMessage(msg);
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const sec = String(seconds).padStart(2, '0');
  const min = String(minutes).padStart(2, '0');
  if (hours > 0) return `${hours}h ${min}m ${sec}s`;
  if (minutes > 0) return `${minutes}m ${sec}s`;
  return `${seconds}s`;
}

function runnableOrder(workflow: IRGraph): IRNode[] {
  return topoOrderExec(workflow).filter(isRunnable);
}

function findResumeNodeId(state: StoreState): string | null {
  const nodeIds = new Set(state.workflow.nodes.map((node) => node.id));
  if (
    state.lastRunFailedNodeId &&
    nodeIds.has(state.lastRunFailedNodeId) &&
    state.runState[state.lastRunFailedNodeId] !== 'success'
  ) {
    return state.lastRunFailedNodeId;
  }
  return (
    runnableOrder(state.workflow).find((node) => {
      const status = state.runState[node.id];
      return status === 'error' || status === 'interrupted';
    })?.id ?? null
  );
}

function seedRunStateFromOutputs(
  workflow: IRGraph,
  outputs: Record<string, string>,
  existing: Record<string, NodeRunState> = {},
): Record<string, NodeRunState> {
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  const runState: Record<string, NodeRunState> = { ...existing };
  for (const nodeId of Object.keys(outputs)) {
    if (nodeIds.has(nodeId)) runState[nodeId] = 'success';
  }
  return runState;
}

function startWorkflowRun(resume: boolean): void {
  const state = useStore.getState();
  if (state.mode === 'running') return;

  const { workflow } = state;
  const name = workflow.meta.name ?? 'untitled';
  const adapter = workflow.meta.adapter ?? 'claude-code';
  const runStartedAt = Date.now();
  const resumeFromNodeId = resume ? findResumeNodeId(state) : null;
  if (resume && !resumeFromNodeId) {
    pushRunLog('没有可继续的失败节点。', 'system');
    return;
  }

  const resumeNode = resumeFromNodeId
    ? workflow.nodes.find((node) => node.id === resumeFromNodeId)
    : null;
  const seedOutputs = resume ? { ...state.runOutputs } : {};
  const initialRunState = resume
    ? seedRunStateFromOutputs(workflow, seedOutputs, state.runState)
    : {};
  if (resumeFromNodeId) delete initialRunState[resumeFromNodeId];

  // Capture the run's workspace + permission (from the AIDock controls) so each
  // node's CLI agent runs in the right dir with enough access to act without
  // stalling on permission prompts.
  activeRunConfig = {
    cwd: state.composer.workspace || undefined,
    permission: state.composer.permission || 'full',
  };

  useStore.setState({
    mode: 'running',
    runState: initialRunState,
    runOutputs: seedOutputs,
    lastRunFailedNodeId: null,
  });
  persistCurrentRunSnapshot('running');

  const action = resume ? '继续工作流' : '运行工作流';
  const from = resumeNode
    ? ` · 从 "${resumeNode.label ?? resumeNode.type}" 继续`
    : '';
  const runMsg: Message = {
    id: shortId('m'),
    role: 'system',
    text: `▶ ${action} "${name}"${from} · 开始 ${formatClock(runStartedAt)} · 运行时 ${adapter} · 权限 ${activeRunConfig.permission}${activeRunConfig.cwd ? ` · 工作区 ${activeRunConfig.cwd}` : ''}`,
    createdAt: runStartedAt,
  };
  useStore.setState((s) => ({
    messages: [...s.messages, runMsg],
  }));
  void persistMessage(runMsg);

  if (isTauri()) {
    void executeViaCliInterpreter(workflow, adapter, runStartedAt, {
      resumeFromNodeId,
      seedOutputs,
    });
  } else {
    void executeViaSimulator(workflow, { resumeFromNodeId, seedOutputs });
  }
}

function stopWorkflowRun(): void {
  const state = useStore.getState();
  if (state.mode !== 'running') return;

  const runningNodeIds = Object.entries(state.runState)
    .filter(([, status]) => status === 'running')
    .map(([nodeId]) => nodeId);
  const interruptedNodeId = runningNodeIds[0] ?? null;
  const stoppedAt = Date.now();
  const runError = interruptedNodeId
    ? {
        code: 'interrupted',
        message: '用户手动中断运行。',
        nodeId: interruptedNodeId,
        occurredAt: stoppedAt,
      }
    : null;

  useStore.setState((s) => ({
    mode: 'design',
    runState: {
      ...s.runState,
      ...Object.fromEntries(
        runningNodeIds.map((nodeId) => [nodeId, 'interrupted' as const]),
      ),
    },
    lastRunFailedNodeId: interruptedNodeId,
  }));

  resolveAllPendingInteractions();
  void cancelActiveCliRuns();
  pushRunLog(
    interruptedNodeId
      ? `⏹ 运行已中断 · ${formatClock(stoppedAt)} · 可从当前节点继续。`
      : `⏹ 运行已中断 · ${formatClock(stoppedAt)}。`,
    'assistant',
  );
  persistCurrentRunSnapshot('interrupted', runError);
}

function makeCliRunId(): string {
  return `cli_${Date.now()}_${shortId('run')}`;
}

async function cancelActiveCliRuns(): Promise<void> {
  const runIds = [...activeCliRunIds];
  await Promise.all(runIds.map((runId) => cancelAiCli(runId).catch(() => {})));
}

async function invokeAgentCli(
  prompt: string,
  adapter: string,
  opts: {
    model?: string;
    cwd?: string;
    permission?: string;
    onProgress?: (text: string) => void;
  } = {},
): Promise<string> {
  const runId = makeCliRunId();
  activeCliRunIds.add(runId);
  try {
    return await aiEditViaCli(prompt, adapter, { ...opts, runId });
  } finally {
    activeCliRunIds.delete(runId);
  }
}

function withNodeExecutionContract(prompt: string): string {
  return `${prompt}

---
OpenWorkflow node execution contract:
- Treat this as one bounded workflow node, not an open-ended session.
- Finish with a concise final answer even if optional verification remains.
- Do not start long-running ad-hoc harnesses after the requested checks pass.
- If a command or investigation stops making progress, stop and report the exact next step instead of waiting indefinitely.`;
}

/** Collect outputs of nodes that feed `node` via data edges (producer → node). */
function dataInputsFor(
  node: IRNode,
  workflow: IRGraph,
  results: Map<string, string>,
): { label: string; text: string }[] {
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]));
  const inputs: { label: string; text: string }[] = [];
  for (const e of workflow.edges) {
    if (e.kind !== DATA || e.to.node !== node.id) continue;
    const out = results.get(e.from.node);
    if (out == null) continue;
    inputs.push({ label: byId.get(e.from.node)?.label ?? e.from.node, text: out });
  }
  return inputs;
}

/** An agent spec for a parallel branch / pipeline stage (tolerates legacy strings). */
interface RunSpec {
  prompt: string;
  label?: string;
  agentType?: string;
  model?: string;
}

type RunFailureCode =
  | 'timeout'
  | 'idle_timeout'
  | 'interrupted'
  | 'exit'
  | 'spawn'
  | 'backend'
  | 'wait'
  | 'unknown';

interface RunFailure {
  code: RunFailureCode;
  message: string;
  raw: string;
  cli?: string;
  exitCode?: number;
  timeoutSeconds?: number;
  idleTimeoutSeconds?: number;
}

const RUN_ERROR_PREVIEW_LIMIT = 1200;

function compactRunError(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= RUN_ERROR_PREVIEW_LIMIT) return trimmed;
  return `${trimmed.slice(0, RUN_ERROR_PREVIEW_LIMIT)}\n...（错误信息已截断）`;
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

function describeRunFailure(err: unknown): RunFailure {
  const raw = compactRunError(errorText(err));

  if (raw === 'NO_BACKEND') {
    return {
      code: 'backend',
      raw,
      message: '当前不在 Tauri 桌面壳，无法调用本地 CLI。',
    };
  }

  const timeout = /CLI "([^"]+)" 超时[（(](\d+)s[）)]已终止/u.exec(raw);
  if (timeout) {
    const seconds = Number(timeout[2]);
    return {
      code: 'timeout',
      raw,
      cli: timeout[1],
      timeoutSeconds: seconds,
      message: `CLI "${timeout[1]}" 超过 ${seconds}s 未完成，已终止。可通过 OPENWORKFLOW_AI_CLI_TIMEOUT_SECS 调整上限。`,
    };
  }

  const idleTimeout =
    /CLI "([^"]+)" 空转超过 (\d+)s 未产生输出，已终止/u.exec(raw);
  if (idleTimeout) {
    const seconds = Number(idleTimeout[2]);
    return {
      code: 'idle_timeout',
      raw,
      cli: idleTimeout[1],
      idleTimeoutSeconds: seconds,
      message: `CLI "${idleTimeout[1]}" 超过 ${seconds}s 没有新的输出或结果文件更新，已终止。可通过 OPENWORKFLOW_AI_CLI_IDLE_TIMEOUT_SECS 调整。`,
    };
  }

  const interrupted = /CLI "([^"]+)" 已由用户中断/u.exec(raw);
  if (interrupted) {
    return {
      code: 'interrupted',
      raw,
      cli: interrupted[1],
      message: `CLI "${interrupted[1]}" 已由用户中断。`,
    };
  }

  const exit = /CLI "([^"]+)" 退出码 (-?\d+):\s*([\s\S]*)/u.exec(raw);
  if (exit) {
    const detail = exit[3]?.trim();
    return {
      code: 'exit',
      raw,
      cli: exit[1],
      exitCode: Number(exit[2]),
      message: `CLI "${exit[1]}" 退出码 ${exit[2]}${
        detail ? `: ${detail}` : ''
      }`,
    };
  }

  const spawn = /启动 CLI "([^"]+)" 失败:\s*([\s\S]*)/u.exec(raw);
  if (spawn) {
    return {
      code: 'spawn',
      raw,
      cli: spawn[1],
      message: `无法启动 CLI "${spawn[1]}"：${spawn[2].trim()}`,
    };
  }

  const wait = /等待 CLI "([^"]+)" 失败:\s*([\s\S]*)/u.exec(raw);
  if (wait) {
    return {
      code: 'wait',
      raw,
      cli: wait[1],
      message: `等待 CLI "${wait[1]}" 结束失败：${wait[2].trim()}`,
    };
  }

  return { code: 'unknown', raw, message: raw || '未知错误' };
}

function failureTitle(failure: RunFailure): string {
  switch (failure.code) {
    case 'timeout':
      return '超时';
    case 'idle_timeout':
      return '空转超时';
    case 'interrupted':
      return '已中断';
    case 'exit':
      return '执行失败';
    case 'spawn':
      return '启动失败';
    case 'backend':
      return '后端不可用';
    case 'wait':
      return '等待失败';
    default:
      return '失败';
  }
}

function formatFailureLine(label: string, failure: RunFailure): string {
  return `✗ ${label} ${failureTitle(failure)}: ${failure.message}`;
}

function runFailureMeta(
  node: IRNode,
  adapter: string,
  failure: RunFailure,
): Record<string, unknown> {
  return {
    code: failure.code,
    message: failure.message,
    raw: failure.raw,
    adapter,
    nodeId: node.id,
    nodeLabel: node.label ?? node.type,
    nodeType: node.type,
    occurredAt: Date.now(),
    ...(failure.cli ? { cli: failure.cli } : {}),
    ...(failure.exitCode == null ? {} : { exitCode: failure.exitCode }),
    ...(failure.timeoutSeconds == null
      ? {}
      : { timeoutSeconds: failure.timeoutSeconds }),
    ...(failure.idleTimeoutSeconds == null
      ? {}
      : { idleTimeoutSeconds: failure.idleTimeoutSeconds }),
  };
}

/** Coerce a params array into RunSpec[] (objects or legacy string[]). */
function specList(value: unknown): RunSpec[] {
  if (!Array.isArray(value)) return [];
  return value.map((v): RunSpec => {
    if (typeof v === 'string') return { prompt: v };
    const o = (v ?? {}) as Record<string, unknown>;
    return {
      prompt: String(o.prompt ?? ''),
      label: typeof o.label === 'string' ? o.label : undefined,
      agentType: typeof o.agentType === 'string' ? o.agentType : undefined,
      model: typeof o.model === 'string' ? o.model : undefined,
    };
  });
}

/**
 * Push a fresh assistant message and return handles to grow it live (append) or
 * replace it (finalize). Used so each node/branch shows its CLI output streaming
 * in rather than appearing all at once when the step finishes.
 */
function createStreamMessage(header: string): {
  append: (chunk: string) => void;
  finalize: (text: string) => void;
  fail: (text: string) => void;
} {
  const id = shortId('m');
  const startedAt = Date.now();
  let currentText = header;
  const decorate = (text: string, endedAt?: number, failed = false) => {
    const prefix = endedAt
      ? `⏱ ${formatClock(startedAt)} → ${formatClock(endedAt)} · 耗时 ${formatDuration(endedAt - startedAt)}${failed ? ' · 失败' : ''}`
      : `⏱ 开始 ${formatClock(startedAt)}`;
    return `${prefix}\n${text}`;
  };
  const replace = (text: string, persist = false, endedAt?: number, failed = false) => {
    currentText = text;
    useStore.setState((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, text: decorate(text, endedAt, failed) } : m,
      ),
    }));
    if (persist) void persistCurrentMessages();
  };

  useStore.setState((s) => ({
    messages: [
      ...s.messages,
      { id, role: 'assistant', text: decorate(header), createdAt: startedAt },
    ],
  }));
  return {
    append: (chunk) => replace(currentText + chunk),
    finalize: (text) => replace(text, true, Date.now(), false),
    fail: (text) =>
      replace(
        currentText.trim()
          ? `${currentText.trimEnd()}\n\n${text}`
          : text,
        true,
        Date.now(),
        true,
      ),
  };
}

/** The model tier configured on a node's params (for `--model`), if any. */
function nodeModel(params: Record<string, unknown>): string | undefined {
  return typeof params.model === 'string' ? params.model : undefined;
}

/** The "上游输出" context block for a node, or '' when it has no data inputs. */
function dataContextString(
  node: IRNode,
  workflow: IRGraph,
  results: Map<string, string>,
): string {
  const inputs = dataInputsFor(node, workflow, results);
  if (inputs.length === 0) return '';
  const ctx = inputs
    .map((i) => `### 来自「${i.label}」的输出\n${i.text}`)
    .join('\n\n');
  return `\n\n---\n以下是上游步骤的输出，供你参考：\n\n${ctx}`;
}

/** Is the run still active? (false once the user hits 停止.) */
function stillRunning(): boolean {
  return useStore.getState().mode === 'running';
}

/**
 * Run one CLI step that may ask the user to choose/type before producing its
 * final result. Streams each attempt into its own dock message. If the model
 * emits an interaction block (see core/interaction.ts) it renders a widget,
 * waits for the answer, appends it to the prompt, and re-invokes — bounded by
 * MAX_INTERACTION_ROUNDS. Returns the final (interaction-stripped) output;
 * throws on CLI failure (after streaming the failure line) so callers can mark
 * the node errored.
 */
async function runCliWithInteraction(opts: {
  /** Streaming header, e.g. `【label】\n`. */
  head: string;
  /** Bracket label for the streamed finalize/failure line (no ✓ prefix). */
  label: string;
  /** Prompt base — already includes upstream data context / stage feed. */
  basePrompt: string;
  adapter: string;
  cli: { model?: string; cwd?: string; permission?: string };
}): Promise<string> {
  let appendix = '';
  let lastClean = '';
  for (let round = 0; round < MAX_INTERACTION_ROUNDS; round += 1) {
    if (!stillRunning()) return lastClean;
    const sm = createStreamMessage(
      round === 0 ? opts.head : `${opts.head}（已根据你的回答继续）\n`,
    );
    const prompt = `${withNodeExecutionContract(opts.basePrompt)}\n\n${INTERACTION_PROTOCOL}${appendix}`;

    let raw: string;
    try {
      raw = (
        await invokeAgentCli(prompt, opts.adapter, {
          model: opts.cli.model,
          cwd: opts.cli.cwd,
          permission: opts.cli.permission,
          onProgress: sm.append,
        })
      ).trim();
    } catch (err) {
      const failure = describeRunFailure(err);
      sm.fail(formatFailureLine(opts.label, failure));
      throw err;
    }

    const clean = stripInteraction(raw);
    lastClean = clean;

    // Stopped during the call, or the node produced a plain result → done.
    const req = stillRunning() ? parseInteraction(raw) : null;
    if (!req) {
      sm.finalize(`【✓ ${opts.label}】\n${clean || '(无输出)'}`);
      return clean;
    }

    // The node is asking. Finalize this attempt (showing any prose it emitted),
    // render the widget, and block until the user answers.
    sm.finalize(
      clean
        ? `【${opts.label}】\n${clean}`
        : `【${opts.label}】\n（已向你提出一个问题，请在下方作答）`,
    );
    const answer = await awaitInteraction(req);
    if (!answer || !stillRunning()) return clean; // dismissed or run stopped
    appendix += `\n\n${formatAnswerForPrompt(req, answer)}`;
  }

  pushRunLog(
    `⚠ ${opts.label}：交互轮数已达上限（${MAX_INTERACTION_ROUNDS}），停止追问。`,
    'system',
  );
  return lastClean;
}

/**
 * Run a `parallel` node: each branch is its own concurrent `claude -p` call
 * (real fan-out, not one lumped prompt). All branches share the node's upstream
 * data context. Per-branch output streams in as it lands; the combined output is
 * threaded to downstream nodes. Throws only if every branch fails.
 */
async function runParallel(
  node: IRNode,
  workflow: IRGraph,
  results: Map<string, string>,
  adapter: string,
): Promise<string> {
  const branches = specList(node.params.branches);
  if (branches.length === 0) return '';
  const upstream = dataContextString(node, workflow, results);

  const settled = await Promise.all(
    branches.map(async (b, i) => {
      const label = b.label || b.agentType || b.prompt.slice(0, 16) || `分支${i + 1}`;
      const stepLabel = `并行分支 ${i + 1}/${branches.length} · ${label}`;
      try {
        const out = (
          await runCliWithInteraction({
            head: `【${stepLabel}】\n`,
            label: stepLabel,
            basePrompt: b.prompt + upstream,
            adapter,
            cli: {
              model: b.model,
              cwd: activeRunConfig.cwd,
              permission: activeRunConfig.permission,
            },
          })
        ).trim();
        return { ok: true as const, label, out };
      } catch (err) {
        const failure = describeRunFailure(err);
        return { ok: false as const, label, out: '', failure };
      }
    }),
  );

  if (settled.every((s) => !s.ok)) {
    const detail = settled
      .map((s) => (s.ok ? '' : `${s.label}: ${s.failure.message}`))
      .filter(Boolean)
      .join('；');
    throw new Error(detail ? `所有并行分支均失败：${detail}` : '所有并行分支均失败');
  }
  return settled
    .map((s) =>
      s.ok ? `【${s.label}】\n${s.out}` : `【${s.label}】\n(失败：${s.failure.message})`,
    )
    .join('\n\n');
}

/**
 * Run a `pipeline` node: stages execute sequentially, each receiving the previous
 * stage's output (the first stage also gets the node's upstream context + items
 * expression). Returns the final stage's output.
 */
async function runPipeline(
  node: IRNode,
  workflow: IRGraph,
  results: Map<string, string>,
  adapter: string,
): Promise<string> {
  const stages = specList(node.params.stages);
  if (stages.length === 0) return '';
  const items = String(node.params.items ?? '').trim();
  let prev = '';

  for (let i = 0; i < stages.length; i += 1) {
    if (!stillRunning()) break;
    const s = stages[i];
    const label = s.label || s.prompt.slice(0, 16) || `阶段${i + 1}`;
    const stepLabel = `流水线阶段 ${i + 1}/${stages.length} · ${label}`;
    const feed =
      i === 0
        ? dataContextString(node, workflow, results) +
          (items ? `\n\n输入数据: ${items}` : '')
        : `\n\n---\n上一步输出：\n${prev}`;
    prev = (
      await runCliWithInteraction({
        head: `【${stepLabel}】\n`,
        label: stepLabel,
        basePrompt: s.prompt + feed,
        adapter,
        cli: {
          model: s.model,
          cwd: activeRunConfig.cwd,
          permission: activeRunConfig.permission,
        },
      })
    ).trim();
  }
  return prev;
}

/**
 * Execute one node, returning its result string (stored for downstream data
 * edges), or null when there is nothing to run (control / log / variable /
 * codeblock). Streams sub-results for parallel/pipeline. Throws on hard error.
 */
async function runNode(
  node: IRNode,
  workflow: IRGraph,
  results: Map<string, string>,
  adapter: string,
): Promise<string | null> {
  const label = node.label ?? node.type;
  switch (node.type) {
    case 'agent': {
      const base = String(node.params.prompt ?? node.label ?? '').trim();
      if (!base) return '';
      return runCliWithInteraction({
        head: `【${label}】\n`,
        label,
        basePrompt: base + dataContextString(node, workflow, results),
        adapter,
        cli: {
          model: nodeModel(node.params),
          cwd: activeRunConfig.cwd,
          permission: activeRunConfig.permission,
        },
      });
    }
    case 'workflow': {
      const base = `运行子工作流 "${String(node.params.name ?? node.label ?? 'sub')}" 并返回结果。`;
      return runCliWithInteraction({
        head: `【${label}】\n`,
        label,
        basePrompt: base + dataContextString(node, workflow, results),
        adapter,
        cli: {
          cwd: activeRunConfig.cwd,
          permission: activeRunConfig.permission,
        },
      });
    }
    case 'parallel':
      return runParallel(node, workflow, results, adapter);
    case 'pipeline':
      return runPipeline(node, workflow, results, adapter);
    case 'log': {
      const msg = String(node.params.message ?? node.params.msg ?? '').trim();
      if (msg) pushRunLog(msg);
      return null;
    }
    default:
      return null; // start/end/branch/loop/variable/codeblock
  }
}

/**
 * Real run: interpret the IR along the exec spine through the local agent CLI.
 * Agent/workflow nodes are single `claude -p` calls; `parallel` fans each branch
 * out as a concurrent call; `pipeline` chains stages sequentially. Outputs stream
 * into the dock, thread to downstream nodes via data edges, and drive per-node
 * run badges. Aborts on 停止; returns to design mode when finished.
 */
async function executeViaCliInterpreter(
  workflow: IRGraph,
  adapter: string,
  runStartedAt: number,
  options: {
    resumeFromNodeId?: string | null;
    seedOutputs?: Record<string, string>;
  } = {},
): Promise<void> {
  const order = runnableOrder(workflow);
  const resumeFromNodeId =
    options.resumeFromNodeId && order.some((node) => node.id === options.resumeFromNodeId)
      ? options.resumeFromNodeId
      : null;
  let resumePending = !!resumeFromNodeId;
  const results = new Map<string, string>(
    Object.entries(options.seedOutputs ?? {}),
  );
  let errored = false;
  let runError: Record<string, unknown> | null = null;

  for (const node of order) {
    if (!stillRunning()) return; // stopped between steps

    if (resumePending && node.id !== resumeFromNodeId) {
      if (
        node.type === 'start' ||
        node.type === 'end' ||
        results.has(node.id) ||
        useStore.getState().runState[node.id] === 'success'
      ) {
        useStore.getState().setRunState(node.id, 'success');
      }
      continue;
    }
    if (resumePending && node.id === resumeFromNodeId) {
      resumePending = false;
    }

    if (node.type === 'start' || node.type === 'end') {
      useStore.getState().setRunState(node.id, 'success');
      continue;
    }

    const nodeStartedAt = Date.now();
    useStore.getState().setRunState(node.id, 'running');
    pushRunLog(`▸ ${node.label ?? node.type} · 开始 ${formatClock(nodeStartedAt)}`);

    try {
      // runNode streams its own labeled message(s) live; we just store the
      // result for downstream data edges.
      const out = await runNode(node, workflow, results, adapter);
      if (!stillRunning()) return; // stopped during the call(s)
      if (out !== null) {
        results.set(node.id, out);
        useStore.setState((state) => ({
          runOutputs: { ...state.runOutputs, [node.id]: out },
          lastRunFailedNodeId: null,
        }));
      }
      useStore.getState().setRunState(node.id, 'success');
      const nodeFinishedAt = Date.now();
      pushRunLog(
        `✓ ${node.label ?? node.type} · 完成 ${formatClock(nodeFinishedAt)} · 耗时 ${formatDuration(
          nodeFinishedAt - nodeStartedAt,
        )}`,
        'assistant',
      );
    } catch (err) {
      const failure = describeRunFailure(err);
      if (!stillRunning()) return;
      const nodeFinishedAt = Date.now();
      pushRunLog(
        `✗ ${node.label ?? node.type} · 失败 ${formatClock(nodeFinishedAt)} · 耗时 ${formatDuration(
          nodeFinishedAt - nodeStartedAt,
        )}: ${failure.message}`,
        'assistant',
      );
      useStore.setState({ lastRunFailedNodeId: node.id });
      runError = runFailureMeta(node, adapter, failure);
      useStore
        .getState()
        .setRunState(
          node.id,
          failure.code === 'interrupted' ? 'interrupted' : 'error',
        );
      persistCurrentRunSnapshot(
        failure.code === 'interrupted' ? 'interrupted' : 'error',
        runError,
      );
      errored = true;
      break;
    }
  }

  if (stillRunning()) {
    const runFinishedAt = Date.now();
    pushRunLog(
      errored
        ? `✗ 运行中断 · 完成 ${formatClock(runFinishedAt)} · 总耗时 ${formatDuration(
            runFinishedAt - runStartedAt,
          )}`
        : `✓ 运行完成 · 完成 ${formatClock(runFinishedAt)} · 总耗时 ${formatDuration(
            runFinishedAt - runStartedAt,
          )}`,
      'assistant',
    );
    persistCurrentRunSnapshot(errored ? 'error' : 'success', errored ? runError : null);
    useStore.getState().setMode('design'); // clear the "运行中" state
  }
}

/**
 * Browser fallback: walk the exec topological order and animate each runnable
 * node idle → running → success with a short delay, streaming a log line per
 * step. Aborted gracefully when the user clicks "停止" (mode flips to design).
 */
async function executeViaSimulator(
  workflow: IRGraph,
  options: {
    resumeFromNodeId?: string | null;
    seedOutputs?: Record<string, string>;
  } = {},
): Promise<void> {
  const order = runnableOrder(workflow);
  const stepDelay = 350;
  const resumeFromNodeId =
    options.resumeFromNodeId && order.some((node) => node.id === options.resumeFromNodeId)
      ? options.resumeFromNodeId
      : null;
  let resumePending = !!resumeFromNodeId;

  for (const node of order) {
    if (useStore.getState().mode !== 'running') return; // user stopped
    if (resumePending && node.id !== resumeFromNodeId) {
      if (
        node.type === 'start' ||
        node.type === 'end' ||
        options.seedOutputs?.[node.id] != null ||
        useStore.getState().runState[node.id] === 'success'
      ) {
        useStore.getState().setRunState(node.id, 'success');
      }
      continue;
    }
    if (resumePending && node.id === resumeFromNodeId) {
      resumePending = false;
    }
    useStore.getState().setRunState(node.id, 'running');
    const startLog: Message = {
      id: shortId('m'),
      role: 'system',
      text: `▸ ${node.label ?? node.type} (${node.id})`,
      createdAt: Date.now(),
    };
    useStore.setState((s) => ({ messages: [...s.messages, startLog] }));
    void persistMessage(startLog);

    await delay(stepDelay);
    if (useStore.getState().mode !== 'running') return;

    useStore.setState((state) => ({
      runOutputs: { ...state.runOutputs, [node.id]: `模拟完成: ${node.label ?? node.type}` },
      lastRunFailedNodeId: null,
    }));
    useStore.getState().setRunState(node.id, 'success');
  }

  if (useStore.getState().mode === 'running') {
    const done: Message = {
      id: shortId('m'),
      role: 'assistant',
      text: `✓ 模拟运行完成 · ${order.length} 个节点（浏览器无命令行，未真正执行）`,
      createdAt: Date.now(),
    };
    useStore.setState((s) => ({ messages: [...s.messages, done] }));
    void persistMessage(done);
    persistCurrentRunSnapshot('success');
    useStore.getState().setMode('design'); // clear the "运行中" state
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------------------- */
/* Autosave subscriber                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Debounced autosave: whenever `dirty` flips to true, schedule a write 1.5s
 * later. We re-read the latest store state inside the timer so we always
 * persist the most recent IR (not the one we observed at scheduling time).
 *
 * Strategy:
 *   - If `currentFilePath` is set (and not the localStorage sentinel), write
 *     to that path via the Tauri fs plugin.
 *   - Otherwise (fresh graph, never saved), write to localStorage so a reload
 *     doesn't lose the user's work.
 *
 * On a successful save we call `markSaved(path)` which clears dirty and
 * remembers the path; the toolbar status text reads that flag.
 *
 * Errors are swallowed deliberately: autosave must never crash the editor.
 * The next dirty edit will retry.
 */
const AUTOSAVE_DEBOUNCE_MS = 1500;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let autosaveInFlight = false;

useStore.subscribe((state, prev) => {
  // Only react when `dirty` transitions false -> true. We don't want to keep
  // rescheduling on every graph edit while a save is already pending.
  if (!state.dirty || prev.dirty) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    void runAutosave();
  }, AUTOSAVE_DEBOUNCE_MS);
});

async function runAutosave(): Promise<void> {
  if (autosaveInFlight) return;
  autosaveInFlight = true;
  try {
    const { workflow, currentFilePath } = useStore.getState();
    const path = await autosave(workflow, currentFilePath);
    if (path) useStore.getState().markSaved(path);
  } catch {
    /* swallow: next dirty edit will retry. */
  } finally {
    autosaveInFlight = false;
  }
}
