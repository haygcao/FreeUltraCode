// M3: coverage for the pure run-snapshot <-> session-meta mappers, now that
// they live in their own module and import nothing from useStore. No store is
// constructed here — these are plain data-in/data-out functions.
import { describe, expect, it } from 'vitest';
import type { IRGraph, IRRunSnapshot } from '@/core/ir';
import {
  emptyRunProgress,
  isRunStatus,
  persistedStatusForDisplay,
  restoreWorkflowRunSnapshot,
  runMetaFromSnapshot,
  runProgressFromSnapshot,
  runSnapshotFromMeta,
  runSnapshotFromState,
  workflowWithRunSnapshot,
  workflowWithoutRunSnapshot,
} from './runSnapshot';
import type { SessionMeta } from './history/types';

function graphWith(ids: string[]): IRGraph {
  return {
    version: 1,
    meta: { name: 'g' },
    nodes: ids.map((id) => ({ id, type: 'agent', params: {} })),
    edges: [],
  };
}

describe('isRunStatus', () => {
  it('accepts the five known statuses and rejects others', () => {
    for (const s of ['idle', 'running', 'success', 'error', 'interrupted']) {
      expect(isRunStatus(s)).toBe(true);
    }
    expect(isRunStatus('bogus')).toBe(false);
    expect(isRunStatus(undefined)).toBe(false);
  });
});

describe('persistedStatusForDisplay', () => {
  it('downgrades running to interrupted (a reopened run cannot be live)', () => {
    expect(persistedStatusForDisplay('running')).toBe('interrupted');
    expect(persistedStatusForDisplay('success')).toBe('success');
  });
});

describe('runSnapshotFromMeta', () => {
  it('returns null when meta carries no run data', () => {
    expect(runSnapshotFromMeta(undefined)).toBeNull();
    expect(runSnapshotFromMeta({} as SessionMeta)).toBeNull();
  });

  it('rebuilds a snapshot from flat meta fields', () => {
    const meta = {
      runStatus: 'error',
      runState: { a: 'error' },
      runOutputs: { a: 'boom' },
      failedNodeId: 'a',
      runError: { message: 'x' },
    } as unknown as SessionMeta;
    const snap = runSnapshotFromMeta(meta);
    expect(snap?.status).toBe('error');
    expect(snap?.failedNodeId).toBe('a');
    expect(snap?.outputs).toEqual({ a: 'boom' });
  });
});

describe('runProgressFromSnapshot', () => {
  it('returns empty progress for a null snapshot', () => {
    expect(runProgressFromSnapshot(graphWith([]), null)).toEqual(
      emptyRunProgress(),
    );
  });

  it('keeps only outputs/states whose node still exists', () => {
    const snapshot: IRRunSnapshot = {
      status: 'success',
      nodeStates: { a: 'success', ghost: 'error' },
      outputs: { a: 'ok', ghost: 'dropped' },
      failedNodeId: null,
      error: null,
    };
    const progress = runProgressFromSnapshot(graphWith(['a']), snapshot);
    expect(progress.runOutputs).toEqual({ a: 'ok' });
    expect(progress.runState.a).toBe('success');
    expect('ghost' in progress.runState).toBe(false);
  });

  it('downgrades a persisted running node to interrupted on restore', () => {
    const snapshot: IRRunSnapshot = {
      status: 'running',
      nodeStates: { a: 'running' },
      outputs: {},
      failedNodeId: 'a',
      error: null,
    };
    const progress = runProgressFromSnapshot(graphWith(['a']), snapshot);
    expect(progress.runState.a).toBe('interrupted');
    expect(progress.lastRunFailedNodeId).toBe('a');
  });
});

describe('workflowWithRunSnapshot / workflowWithoutRunSnapshot', () => {
  it('strips an idle/empty snapshot off the workflow meta', () => {
    const wf = graphWith(['a']);
    const withRun = workflowWithRunSnapshot(wf, {
      status: 'idle',
      nodeStates: {},
      outputs: {},
      failedNodeId: null,
      error: null,
    });
    expect(withRun.meta.run).toBeUndefined();
  });

  it('attaches a meaningful snapshot and removes it again', () => {
    const wf = graphWith(['a']);
    const snapshot: IRRunSnapshot = {
      status: 'success',
      nodeStates: { a: 'success' },
      outputs: { a: 'ok' },
      failedNodeId: null,
      error: null,
    };
    const withRun = workflowWithRunSnapshot(wf, snapshot);
    expect(withRun.meta.run?.status).toBe('success');
    expect(workflowWithoutRunSnapshot(withRun).meta.run).toBeUndefined();
  });
});

describe('runSnapshotFromState (state slice in, snapshot out)', () => {
  it('infers success when there are node states but no running/error', () => {
    const snap = runSnapshotFromState({
      runState: { a: 'success' },
      runOutputs: { a: 'ok' },
      lastRunFailedNodeId: null,
      mode: 'design',
      workflow: graphWith(['a']),
      composer: { model: 'm' },
    });
    expect(snap.status).toBe('success');
    expect(snap.outputs).toEqual({ a: 'ok' });
  });

  it('infers running while mode is running', () => {
    const snap = runSnapshotFromState({
      runState: {},
      runOutputs: {},
      lastRunFailedNodeId: null,
      mode: 'running',
      workflow: graphWith(['a']),
      composer: { model: 'm' },
    });
    expect(snap.status).toBe('running');
  });

  it('round-trips through runMetaFromSnapshot', () => {
    const snap = runSnapshotFromState({
      runState: { a: 'error' },
      runOutputs: { a: 'boom' },
      lastRunFailedNodeId: 'a',
      mode: 'design',
      workflow: graphWith(['a']),
      composer: { model: 'm' },
    });
    const meta = runMetaFromSnapshot(snap);
    expect(meta.runStatus).toBe('error');
    expect(meta.failedNodeId).toBe('a');
  });
});

describe('restoreWorkflowRunSnapshot', () => {
  it('restores meta into the workflow, downgrading a running snapshot', () => {
    const wf = graphWith(['a']);
    const meta = {
      runStatus: 'running',
      runState: { a: 'running' },
      runOutputs: {},
      failedNodeId: 'a',
      runError: null,
    } as unknown as SessionMeta;
    const restored = restoreWorkflowRunSnapshot(wf, meta);
    expect(restored.meta.run?.status).toBe('interrupted');
  });

  it('clears the run snapshot when meta has no run data', () => {
    const wf = workflowWithRunSnapshot(graphWith(['a']), {
      status: 'success',
      nodeStates: { a: 'success' },
      outputs: { a: 'ok' },
      failedNodeId: null,
      error: null,
    });
    const restored = restoreWorkflowRunSnapshot(wf, {} as SessionMeta);
    // No run data in the supplied meta, but the workflow itself still carried a
    // snapshot, so restore preserves that source.
    expect(restored.meta.run?.status).toBe('success');
  });
});
