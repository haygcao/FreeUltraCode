import { DATA, type IRGraph, type IRNode, type NodeType } from '@/core/ir';
import { defaultConsensusLenses } from '@/core/consensusHeuristic';
import { nodeParamsWithGatewayOverride } from '@/lib/modelGateway/resolver';
import { shortId } from '@/lib/id';
import type { StoreState, StoreSet, WorkflowWriteSource } from './storeState';
import type { SessionMeta } from './history/types';

type WorkflowEditorPatch = (
  Partial<
    Pick<
      StoreState,
      | 'selectedNodeId'
      | 'dirty'
      | 'runState'
      | 'runOutputs'
      | 'lastRunFailedNodeId'
    >
  > & { workflow: IRGraph }
) | null;

// Canonical store set signature lives in storeState.ts (derived from zustand's
// StoreApi). Re-exported here under the slice-local name so existing references
// keep working without diverging from what create<StoreState>() passes.
export type WorkflowEditorSet = StoreSet;

export type WorkflowEditorDeps = {
  applyWorkflowEdit: (
    source: WorkflowWriteSource,
    edit: (state: StoreState) => WorkflowEditorPatch,
    persistMeta?: Partial<SessionMeta>,
  ) => boolean;
  canWriteWorkflow: (state: StoreState) => boolean;
  emptyRunProgress: () => Pick<
    StoreState,
    'runState' | 'runOutputs' | 'lastRunFailedNodeId'
  >;
  markActiveHistorySessionWorkflow: () => Promise<void>;
  workflowWithoutRunSnapshot: (workflow: IRGraph) => IRGraph;
};

export type WorkflowEditorSlice = Pick<
  StoreState,
  | 'workflow'
  | 'selectedNodeId'
  | 'graphPath'
  | 'mode'
  | 'runState'
  | 'runOutputs'
  | 'lastRunFailedNodeId'
  | 'canvasViewport'
  | 'dirty'
  | 'currentFilePath'
  | 'selectNode'
  | 'enterComposite'
  | 'exitComposite'
  | 'popToGraph'
  | 'addNode'
  | 'updateNodeParams'
  | 'updateNodeGatewayOverride'
  | 'updateNodeLabel'
  | 'convertNodeToConsensus'
  | 'removeNode'
  | 'addEdge'
  | 'removeEdge'
  | 'setNodePosition'
  | 'autoArrangeWorkflow'
>;

/**
 * Per-type default label + params used by addNode. Mirrors the node catalogue
 * in the design doc; agent/control nodes carry their minimal editable params.
 */
const NODE_DEFAULTS: Record<
  NodeType,
  { label: string; params: Record<string, unknown> }
> = {
  start: { label: 'Start', params: { userInputs: [] } },
  end: { label: 'End', params: {} },
  agent: { label: '描述你的步骤', params: {} },
  parallel: { label: '并行', params: { branches: [] } },
  pipeline: { label: '流水线', params: { items: 'args', stages: [] } },
  phase: { label: '阶段', params: { title: '阶段' } },
  branch: { label: '分支', params: { condition: 'true' } },
  loop: { label: '循环', params: { condition: 'false' } },
  workflow: { label: '子工作流', params: { name: 'sub' } },
  log: { label: '日志', params: { message: '' } },
  variable: { label: '变量', params: { value: null } },
  codeblock: { label: '代码块', params: { code: '' } },
  consensus: { label: '共识', params: { voters: [], strategy: 'multi-lens' } },
  composite: { label: '复合', params: { inputs: [], outputs: [] } },
};

/**
 * The id of the composite node whose subgraph is currently being viewed, or
 * undefined when at the top level. New nodes added via StoreState.addNode are
 * parented to this scope.
 */
export function selectActiveScopeId(
  state: Pick<StoreState, 'graphPath'>,
): string | undefined {
  return state.graphPath[state.graphPath.length - 1]?.nodeId;
}

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

function patchParams(
  params: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...params };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

export function createWorkflowEditorSlice(
  set: WorkflowEditorSet,
  deps: WorkflowEditorDeps,
  initial: Pick<
    WorkflowEditorSlice,
    | 'workflow'
    | 'mode'
    | 'runState'
    | 'runOutputs'
    | 'lastRunFailedNodeId'
  >,
): WorkflowEditorSlice {
  return {
    // Seed graph: restored autosave, or a fresh default blueprint.
    workflow: initial.workflow,
    selectedNodeId: null,
    graphPath: [],

    // Editor lifecycle: start in design mode, no run state, clean, unsaved.
    mode: initial.mode,
    runState: initial.runState,
    runOutputs: initial.runOutputs,
    lastRunFailedNodeId: initial.lastRunFailedNodeId,
    canvasViewport: null,
    dirty: false,
    currentFilePath: null,

    selectNode: (id) => set({ selectedNodeId: id }),

    // Composite drill-down navigation. These only touch the UI-transient
    // graphPath + selection; they never read or mutate `workflow`.
    enterComposite: (nodeId) =>
      set((state) => {
        const node = state.workflow.nodes.find((n) => n.id === nodeId);
        if (!node) return state;
        const label = node.label?.trim() || node.id;
        return {
          graphPath: [...state.graphPath, { nodeId, label }],
          selectedNodeId: null,
        };
      }),

    exitComposite: () =>
      set((state) =>
        state.graphPath.length === 0
          ? state
          : { graphPath: state.graphPath.slice(0, -1), selectedNodeId: null },
      ),

    popToGraph: (depth) =>
      set((state) => {
        const clamped = Math.max(0, Math.min(depth, state.graphPath.length));
        if (clamped === state.graphPath.length) {
          return { selectedNodeId: null };
        }
        return {
          graphPath: state.graphPath.slice(0, clamped),
          selectedNodeId: null,
        };
      }),

    addNode: (type, params, parent) => {
      const id = shortId('n');
      const committed = deps.applyWorkflowEdit('user', (state) => {
        const defaults = NODE_DEFAULTS[type];
        // Default the parent to the composite subgraph currently being viewed, so
        // nodes created while drilled in are owned by that composite. An explicit
        // `parent` arg (e.g. type-change preserving branch/loop nesting) wins.
        const effectiveParent = parent ?? selectActiveScopeId(state);
        const node: IRNode = {
          id,
          type,
          ...(effectiveParent ? { parent: effectiveParent } : {}),
          label: defaults.label,
          params: { ...defaults.params, ...(params ?? {}) },
        };
        // [dynamic-only refactor] autoLayoutGraph(蓝图布局)已停用；蓝图编辑动作在
        // 纯聊天 GUI 下不可达，这里直接追加节点不做自动布局。
        const nextWorkflow = {
          ...state.workflow,
          nodes: [...state.workflow.nodes, node],
        };
        return {
          workflow: deps.workflowWithoutRunSnapshot(nextWorkflow),
          dirty: true,
          ...deps.emptyRunProgress(),
        };
      });
      return committed ? id : '';
    },

    updateNodeParams: (id, patch) => {
      deps.applyWorkflowEdit('user', (state) => ({
        workflow: deps.workflowWithoutRunSnapshot({
          ...state.workflow,
          nodes: state.workflow.nodes.map((n) =>
            n.id === id ? { ...n, params: patchParams(n.params, patch) } : n,
          ),
        }),
        dirty: true,
        ...deps.emptyRunProgress(),
      }));
    },

    updateNodeGatewayOverride: (id, override) => {
      deps.applyWorkflowEdit('user', (state) => ({
        workflow: deps.workflowWithoutRunSnapshot({
          ...state.workflow,
          nodes: state.workflow.nodes.map((n) => {
            if (n.id !== id) return n;
            return {
              ...n,
              params: nodeParamsWithGatewayOverride(n.params ?? {}, override),
            };
          }),
        }),
        dirty: true,
        ...deps.emptyRunProgress(),
      }));
    },

    updateNodeLabel: (id, label) => {
      deps.applyWorkflowEdit('user', (state) => ({
        workflow: deps.workflowWithoutRunSnapshot({
          ...state.workflow,
          nodes: state.workflow.nodes.map((n) =>
            n.id === id ? { ...n, label } : n,
          ),
        }),
        dirty: true,
        ...deps.emptyRunProgress(),
      }));
    },

    convertNodeToConsensus: (id, strategy) => {
      deps.applyWorkflowEdit('user', (state) => {
        let converted = false;
        const nodes = state.workflow.nodes.map((n) => {
          if (n.id !== id || n.type !== 'agent') return n;
          converted = true;
          const target = String(n.params.prompt ?? n.label ?? '');
          return {
            ...n,
            type: 'consensus' as const,
            params: {
              ...n.params,
              voters: defaultConsensusLenses(target),
              strategy,
            },
          };
        });
        if (!converted) return null;
        return {
          workflow: deps.workflowWithoutRunSnapshot({
            ...state.workflow,
            nodes,
          }),
          selectedNodeId: id,
          dirty: true,
          ...deps.emptyRunProgress(),
        };
      });
    },

    // Remove a node and, when it is a container (branch/loop), all of its
    // transitive descendants — plus every edge touching any removed node.
    removeNode: (id) => {
      deps.applyWorkflowEdit('user', (state) => {
        const doomed = collectSubtree(state.workflow.nodes, id);
        const layout = { ...(state.workflow.layout ?? {}) };
        for (const d of doomed) delete layout[d];
        return {
          workflow: deps.workflowWithoutRunSnapshot({
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
          ...deps.emptyRunProgress(),
        };
      });
    },

    addEdge: (from, to, kind) => {
      const id = kind === DATA ? shortId('d') : shortId('e');
      const committed = deps.applyWorkflowEdit('user', (state) => {
        // Dedupe: identical from/to/kind edges are ignored.
        const exists = state.workflow.edges.some(
          (e) =>
            e.kind === kind &&
            e.from.node === from.node &&
            e.from.port === from.port &&
            e.to.node === to.node &&
            e.to.port === to.port,
        );
        if (exists) return null;
        return {
          workflow: deps.workflowWithoutRunSnapshot({
            ...state.workflow,
            edges: [...state.workflow.edges, { id, from, to, kind }],
          }),
          dirty: true,
          ...deps.emptyRunProgress(),
        };
      });
      return committed ? id : '';
    },

    removeEdge: (id) => {
      deps.applyWorkflowEdit('user', (state) => {
        const edges = state.workflow.edges.filter((e) => e.id !== id);
        if (edges.length === state.workflow.edges.length) return null;
        return {
          workflow: deps.workflowWithoutRunSnapshot({
            ...state.workflow,
            edges,
          }),
          dirty: true,
          ...deps.emptyRunProgress(),
        };
      });
    },

    // Layout-only write. Deliberately does not set dirty: drags are frequent and
    // position is flushed to persistence via markSaved.
    setNodePosition: (id, x, y) => {
      let committed = false;
      set((state) => {
        if (!deps.canWriteWorkflow(state)) return state;
        committed = true;
        return {
          workflow: {
            ...state.workflow,
            layout: { ...(state.workflow.layout ?? {}), [id]: { x, y } },
          },
        };
      });
      if (committed) void deps.markActiveHistorySessionWorkflow();
    },

    // Re-layer every node into a clean topological layout along the exec spine.
    // Layout-only (preserves run state) but dirties so positions persist. Reuses
    // the existing layered engine; stripping the prior layout forces a full
    // re-arrange rather than honoring stale coordinates.
    autoArrangeWorkflow: () => {
      // [dynamic-only refactor] 画布自动布局已停用（autoLayoutGraph 模块 exclude）。
      /* disabled: blueprint canvas auto-layout removed */
    },
  };
}
