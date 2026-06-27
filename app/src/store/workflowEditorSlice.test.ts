// H3: prove createWorkflowEditorSlice assembles and runs WITHOUT useStore.
// The slice receives its private collaborators via WorkflowEditorDeps + a plain
// `set`, so we drive it here with a hand-rolled fake store (a single mutable
// state object) and stub deps. No './useStore' import appears anywhere below —
// that is the whole point: the slice is independently testable.
import { describe, expect, it, vi } from 'vitest';
import { EXEC, DATA, type IRGraph } from '@/core/ir';
import {
  createWorkflowEditorSlice,
  selectActiveScopeId,
  type WorkflowEditorDeps,
  type WorkflowEditorSet,
} from './workflowEditorSlice';
import type { StoreState } from './storeState';

function emptyGraph(): IRGraph {
  return {
    version: 1,
    meta: { name: 'test' },
    nodes: [],
    edges: [],
    layout: {},
  };
}

/**
 * A minimal fake store: holds a mutable StoreState-ish object and exposes a
 * zustand-compatible `set`. We only populate the fields the slice touches; the
 * cast keeps us honest about which surface the slice actually reads.
 */
function makeHarness(graph: IRGraph = emptyGraph()) {
  let state = {
    workflow: graph,
    selectedNodeId: null,
    graphPath: [],
    mode: 'design',
    runState: {},
    runOutputs: {},
    lastRunFailedNodeId: null,
    canvasViewport: null,
    dirty: false,
    currentFilePath: null,
  } as unknown as StoreState;

  const set = ((partial: unknown) => {
    const patch =
      typeof partial === 'function'
        ? (partial as (s: StoreState) => Partial<StoreState>)(state)
        : (partial as Partial<StoreState>);
    state = { ...state, ...patch } as StoreState;
  }) as WorkflowEditorSet;

  // applyWorkflowEdit mirrors the real store: run the editor's pure patch fn
  // against the live state, commit it through the same `set`, and report
  // whether a non-null patch was produced.
  const markActiveHistorySessionWorkflow = vi.fn(async () => {});
  const deps: WorkflowEditorDeps = {
    applyWorkflowEdit: (_source, edit) => {
      const patch = edit(state);
      if (patch === null) return false;
      state = { ...state, ...patch } as StoreState;
      return true;
    },
    canWriteWorkflow: () => true,
    emptyRunProgress: () => ({
      runState: {},
      runOutputs: {},
      lastRunFailedNodeId: null,
    }),
    markActiveHistorySessionWorkflow,
    // identity: we are not testing run-snapshot stripping here
    workflowWithoutRunSnapshot: (wf) => wf,
  };

  const slice = createWorkflowEditorSlice(set, deps, {
    workflow: graph,
    mode: 'design',
    runState: {},
    runOutputs: {},
    lastRunFailedNodeId: null,
  });

  // The harness state must reflect the slice's initial values so reads are
  // consistent after construction.
  set(slice as unknown as Partial<StoreState>);

  return {
    slice,
    deps,
    markActiveHistorySessionWorkflow,
    get state() {
      return state;
    },
  };
}

describe('workflowEditorSlice (standalone, no useStore)', () => {
  it('addNode appends a node, returns its id, and dirties the graph', () => {
    const h = makeHarness();
    const id = h.slice.addNode('agent');
    expect(id).toMatch(/^n/);
    expect(h.state.workflow.nodes).toHaveLength(1);
    expect(h.state.workflow.nodes[0].id).toBe(id);
    expect(h.state.workflow.nodes[0].type).toBe('agent');
    expect(h.state.dirty).toBe(true);
  });

  it('addNode returns empty string when applyWorkflowEdit refuses to commit', () => {
    const rejectingDeps: WorkflowEditorDeps = {
      applyWorkflowEdit: () => false,
      canWriteWorkflow: () => false,
      emptyRunProgress: () => ({
        runState: {},
        runOutputs: {},
        lastRunFailedNodeId: null,
      }),
      markActiveHistorySessionWorkflow: vi.fn(async () => {}),
      workflowWithoutRunSnapshot: (wf) => wf,
    };
    const slice = createWorkflowEditorSlice(
      ((p: unknown) => void p) as WorkflowEditorSet,
      rejectingDeps,
      {
        workflow: emptyGraph(),
        mode: 'design',
        runState: {},
        runOutputs: {},
        lastRunFailedNodeId: null,
      },
    );
    expect(slice.addNode('agent')).toBe('');
  });

  it('addNode parents to the active composite scope from graphPath', () => {
    const graph = emptyGraph();
    const h = makeHarness(graph);
    // simulate drilling into a composite by writing graphPath directly
    (h.state as { graphPath: { nodeId: string; label: string }[] }).graphPath = [
      { nodeId: 'cmp1', label: 'Composite' },
    ];
    const id = h.slice.addNode('agent');
    const node = h.state.workflow.nodes.find((n) => n.id === id);
    expect(node?.parent).toBe('cmp1');
  });

  it('updateNodeParams merges patch and deletes undefined keys', () => {
    const h = makeHarness();
    const id = h.slice.addNode('agent', { prompt: 'hi', temp: 1 });
    h.slice.updateNodeParams(id, { prompt: 'bye', temp: undefined });
    const node = h.state.workflow.nodes.find((n) => n.id === id);
    expect(node?.params.prompt).toBe('bye');
    expect('temp' in (node?.params ?? {})).toBe(false);
  });

  it('removeNode drops the node and every edge touching it', () => {
    const h = makeHarness();
    const a = h.slice.addNode('agent');
    const b = h.slice.addNode('agent');
    h.slice.addEdge({ node: a, port: 'exec_out' }, { node: b, port: 'exec_in' }, EXEC);
    expect(h.state.workflow.edges).toHaveLength(1);
    h.slice.removeNode(a);
    expect(h.state.workflow.nodes.find((n) => n.id === a)).toBeUndefined();
    expect(h.state.workflow.edges).toHaveLength(0);
  });

  it('removeNode removes a container subtree (children via parent chain)', () => {
    const h = makeHarness();
    const branch = h.slice.addNode('branch');
    const child = h.slice.addNode('agent', undefined, branch);
    expect(h.state.workflow.nodes).toHaveLength(2);
    h.slice.removeNode(branch);
    expect(h.state.workflow.nodes.find((n) => n.id === child)).toBeUndefined();
    expect(h.state.workflow.nodes).toHaveLength(0);
  });

  it('addEdge dedupes identical edges', () => {
    const h = makeHarness();
    const a = h.slice.addNode('agent');
    const b = h.slice.addNode('agent');
    const first = h.slice.addEdge(
      { node: a, port: 'data_out' },
      { node: b, port: 'data_in' },
      DATA,
    );
    expect(first).not.toBe('');
    const dup = h.slice.addEdge(
      { node: a, port: 'data_out' },
      { node: b, port: 'data_in' },
      DATA,
    );
    expect(dup).toBe('');
    expect(h.state.workflow.edges).toHaveLength(1);
  });

  it('convertNodeToConsensus turns an agent into a consensus node', () => {
    const h = makeHarness();
    const id = h.slice.addNode('agent', { prompt: 'judge this' });
    h.slice.convertNodeToConsensus(id, 'multi-lens');
    const node = h.state.workflow.nodes.find((n) => n.id === id);
    expect(node?.type).toBe('consensus');
    expect(Array.isArray(node?.params.voters)).toBe(true);
    expect((node?.params.voters as unknown[]).length).toBeGreaterThan(0);
  });

  it('setNodePosition writes layout WITHOUT dirtying and flushes via history', () => {
    const h = makeHarness();
    const id = h.slice.addNode('agent');
    // addNode dirtied; clear it to observe setNodePosition does not re-dirty.
    (h.state as { dirty: boolean }).dirty = false;
    h.slice.setNodePosition(id, 42, 99);
    expect(h.state.workflow.layout?.[id]).toEqual({ x: 42, y: 99 });
    expect(h.state.dirty).toBe(false);
    expect(h.markActiveHistorySessionWorkflow).toHaveBeenCalledTimes(1);
  });

  it('composite navigation (enter/exit) only touches graphPath', () => {
    const h = makeHarness();
    const cmp = h.slice.addNode('composite');
    h.slice.enterComposite(cmp);
    expect(selectActiveScopeId(h.state)).toBe(cmp);
    h.slice.exitComposite();
    expect(selectActiveScopeId(h.state)).toBeUndefined();
  });
});
