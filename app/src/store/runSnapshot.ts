// Run-snapshot <-> session-meta mapping — the PURE conversion layer between a
// workflow's persisted IRRunSnapshot (meta.run), the flat SessionMeta fields the
// history store records, and the in-memory run progress the UI renders.
//
// Extracted from useStore.ts as a continuation of the streaming/run-state
// decomposition (architect M3). Every function here is pure: it takes plain
// data and returns plain data, touching neither `useStore` nor any module-level
// mutable state, so this module imports nothing from useStore and cannot join
// the store import cycle. useStore.ts re-exports the names it previously owned
// (runProgressFromSnapshot, emptyRunProgress, restoreWorkflowRunSnapshot, ...)
// so existing import sites keep working unchanged.
//
// The store-coupled neighbours (applyWorkflowEdit / commitGraphEdit /
// persistWorkflowRunSnapshot, which call useStore.setState + autosave) stay in
// useStore.ts; only the pure mappers live here.
import type { IRGraph, IRRunSnapshot, IRRunStatus } from '@/core/ir';
import { normalizeWorkflowNodeNumbers } from '@/core/nodeNumbers';
import {
  normalizeGatewayWorkflow as migrateWorkflowGateway,
  workflowDefaultGatewaySelection,
} from '@/lib/modelGateway/resolver';
import { defaultComposer } from './sampleSessions';
import type { SessionMeta } from './history/types';
import type { NodeRunState } from './types';

export function runOutputsFromMeta(meta?: SessionMeta): Record<string, string> {
  const raw = meta?.runOutputs;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

export function isRunStatus(value: unknown): value is IRRunStatus {
  return (
    value === 'idle' ||
    value === 'running' ||
    value === 'success' ||
    value === 'error' ||
    value === 'interrupted'
  );
}

export function persistedStatusForDisplay(status: IRRunStatus): NodeRunState {
  // A reopened workflow cannot still be executing inside this UI session.
  return status === 'running' ? 'interrupted' : status;
}

export function runOutputsFromSnapshot(
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

export function runSnapshotFromMeta(meta?: SessionMeta): IRRunSnapshot | null {
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

export function runProgressFromSnapshot(
  workflow: IRGraph,
  snapshot?: IRRunSnapshot | null,
): { runState: Record<string, NodeRunState>; runOutputs: Record<string, string>; lastRunFailedNodeId: string | null } {
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

export function emptyRunProgress(): {
  runState: Record<string, NodeRunState>;
  runOutputs: Record<string, string>;
  lastRunFailedNodeId: string | null;
} {
  return { runState: {}, runOutputs: {}, lastRunFailedNodeId: null };
}

export function emptyRunMeta(): Partial<SessionMeta> {
  return {
    runStatus: 'idle',
    runState: {},
    runOutputs: {},
    failedNodeId: null,
    runError: null,
  };
}

export function workflowWithoutRunSnapshot(workflow: IRGraph): IRGraph {
  if (!workflow.meta.run) return workflow;
  const meta = { ...workflow.meta };
  delete meta.run;
  return { ...workflow, meta };
}

export function workflowWithRunSnapshot(
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

export function runMetaFromSnapshot(snapshot: IRRunSnapshot): Partial<SessionMeta> {
  return {
    runStatus: snapshot.status,
    runState: snapshot.nodeStates ?? {},
    runOutputs: snapshot.outputs ?? {},
    failedNodeId: snapshot.failedNodeId ?? null,
    runError: snapshot.error ?? null,
  };
}

/**
 * A run snapshot derived from in-memory store fields. Takes only the slice of
 * state it needs (so it stays pure and testable) rather than the whole store.
 */
export function runSnapshotFromState(
  state: {
    runState: Record<string, NodeRunState>;
    runOutputs: Record<string, string>;
    lastRunFailedNodeId: string | null;
    mode: 'design' | 'running';
    workflow: IRGraph;
    composer: { model?: string };
  },
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
    route: workflowDefaultGatewaySelection(
      state.workflow,
      state.composer.model,
    ),
    updatedAt: Date.now(),
  };
}

export function restoreWorkflowRunSnapshot(
  workflow: IRGraph,
  meta?: SessionMeta,
): IRGraph {
  const migrated = normalizeWorkflowNodeNumbers(
    migrateWorkflowGateway(workflow, defaultComposer.model),
  );
  const source = runSnapshotFromMeta(meta) ?? migrated.meta.run ?? null;
  if (!source) return workflowWithoutRunSnapshot(migrated);
  const progress = runProgressFromSnapshot(migrated, source);
  return workflowWithRunSnapshot(migrated, {
    status: source.status === 'running' ? 'interrupted' : source.status,
    nodeStates: progress.runState,
    outputs: progress.runOutputs,
    failedNodeId: progress.lastRunFailedNodeId,
    error: source.error ?? null,
    updatedAt: source.updatedAt ?? Date.now(),
  });
}
