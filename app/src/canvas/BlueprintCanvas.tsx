import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  type OnConnect,
  type OnNodeDrag,
  type OnNodesDelete,
  type OnEdgesDelete,
} from '@xyflow/react';
import { useStore } from '@/store/useStore';
import { DATA, EXEC, type NodeType, type PinKind } from '@/core/ir';
import { irToFlow, type FlowEdge, type FlowNodeData } from './irToFlow';
import AgentNode from './nodes/AgentNode';
import ParallelNode from './nodes/ParallelNode';
import PipelineNode from './nodes/PipelineNode';
import ContainerNode from './nodes/ContainerNode';
import ControlNode from './nodes/ControlNode';
import CanvasToolbar from './CanvasToolbar';
import { t, type Locale } from '@/lib/i18n';

/**
 * CONTRACT: default export, no props. Renders the IRGraph from the store on a
 * React Flow canvas with grid background, zoom/pan controls, connections, and
 * full manual-edit affordances (connect / delete / drag-reposition / context
 * menu add-node). The runtime-mode toggle drives a read-only state.
 *
 * The IR is the single source of truth: whenever `store.workflow` or
 * `store.runState` changes, the canvas re-projects via {@link irToFlow}.
 * Crucially, `irToFlow` prefers `workflow.layout[id]` over its placeholder
 * grid — so positions written back by `setNodePosition` during a drag survive
 * the re-projection without flickering back to the default coordinates.
 * Semantic branch/loop children are rendered as independent nodes rather than
 * React Flow sub-flow children, so they can be inspected and dragged freely.
 *
 * Mode policy (design vs running):
 *   - design  → fully editable: connect, delete, drag, context-menu add.
 *   - running → read-only: connections, deletions, drags, and add-actions are
 *               disabled (selection + pan/zoom remain available so users can
 *               still inspect the live graph while it executes).
 */

const nodeTypes: NodeTypes = {
  agent: AgentNode,
  parallel: ParallelNode,
  pipeline: PipelineNode,
  container: ContainerNode,
  control: ControlNode,
};

/** Default port id picked when React Flow doesn't supply one on a connection. */
const DEFAULT_EXEC_OUT = 'exec_out';
const DEFAULT_EXEC_IN = 'exec_in';
const DEFAULT_DATA_OUT = 'data_out';
const DEFAULT_DATA_IN = 'data_in';

/** Node categories surfaced in the right-click context menu. Mirrors the catalogue. */
const ADDABLE_NODES: {
  type: NodeType;
  label: string;
  accent: string;
  translations?: Partial<Record<Locale, { label: string }>>;
}[] = [
  {
    type: 'agent',
    label: 'Agent',
    accent: 'var(--accent)',
    translations: { 'zh-CN': { label: '智能体' }, 'en-US': { label: 'Agent' } },
  },
  {
    type: 'parallel',
    label: 'Parallel',
    accent: 'var(--accent-2)',
    translations: { 'zh-CN': { label: '并行' }, 'en-US': { label: 'Parallel' } },
  },
  {
    type: 'pipeline',
    label: 'Pipeline',
    accent: 'var(--accent-2)',
    translations: { 'zh-CN': { label: '流水线' }, 'en-US': { label: 'Pipeline' } },
  },
  {
    type: 'phase',
    label: 'Phase',
    accent: 'var(--accent-3)',
    translations: { 'zh-CN': { label: '阶段' }, 'en-US': { label: 'Phase' } },
  },
  {
    type: 'branch',
    label: 'Branch',
    accent: 'var(--accent-3)',
    translations: { 'zh-CN': { label: '分支' }, 'en-US': { label: 'Branch' } },
  },
  {
    type: 'loop',
    label: 'Loop',
    accent: 'var(--accent-3)',
    translations: { 'zh-CN': { label: '循环' }, 'en-US': { label: 'Loop' } },
  },
  {
    type: 'workflow',
    label: 'Sub-Workflow',
    accent: 'var(--accent)',
    translations: {
      'zh-CN': { label: '子工作流' },
      'en-US': { label: 'Sub-workflow' },
    },
  },
  {
    type: 'log',
    label: 'Log',
    accent: 'var(--fg-dim)',
    translations: { 'zh-CN': { label: '日志' }, 'en-US': { label: 'Log' } },
  },
  {
    type: 'variable',
    label: 'Variable',
    accent: 'var(--fg-dim)',
    translations: { 'zh-CN': { label: '变量' }, 'en-US': { label: 'Variable' } },
  },
  {
    type: 'codeblock',
    label: 'Code Block',
    accent: 'var(--fg-dim)',
    translations: {
      'zh-CN': { label: '代码块' },
      'en-US': { label: 'Code block' },
    },
  },
  {
    type: 'start',
    label: 'Start',
    accent: 'var(--accent-3)',
    translations: { 'zh-CN': { label: '开始' }, 'en-US': { label: 'Start' } },
  },
  {
    type: 'end',
    label: 'End',
    accent: 'var(--accent-4)',
    translations: { 'zh-CN': { label: '结束' }, 'en-US': { label: 'End' } },
  },
];

/** Infer the pin kind from the React Flow handle id. */
function pinKindFromHandle(handle: string | null | undefined): PinKind {
  return handle && handle.startsWith('data') ? DATA : EXEC;
}

/** Normalize a React Flow Connection into IR endpoints + edge kind. */
function connectionToEdge(c: Connection): {
  from: { node: string; port: string };
  to: { node: string; port: string };
  kind: PinKind;
} | null {
  if (!c.source || !c.target) return null;
  const srcKind = pinKindFromHandle(c.sourceHandle);
  const tgtKind = pinKindFromHandle(c.targetHandle);
  // Mixed-kind connections (exec → data) are not meaningful; reject silently.
  if (srcKind !== tgtKind) return null;
  const isData = srcKind === DATA;
  return {
    from: {
      node: c.source,
      port: c.sourceHandle ?? (isData ? DEFAULT_DATA_OUT : DEFAULT_EXEC_OUT),
    },
    to: {
      node: c.target,
      port: c.targetHandle ?? (isData ? DEFAULT_DATA_IN : DEFAULT_EXEC_IN),
    },
    kind: srcKind,
  };
}

/** Context menu state: pixel position (relative to wrapper) + flow coords for placement. */
interface MenuState {
  screenX: number;
  screenY: number;
  flowX: number;
  flowY: number;
}

function BlueprintCanvasInner() {
  const workflow = useStore((s) => s.workflow);
  const locale = useStore((s) => s.locale);
  const runState = useStore((s) => s.runState);
  const mode = useStore((s) => s.mode);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectNode = useStore((s) => s.selectNode);

  const addNode = useStore((s) => s.addNode);
  const addEdge = useStore((s) => s.addEdge);
  const removeNode = useStore((s) => s.removeNode);
  const removeEdge = useStore((s) => s.removeEdge);
  const setNodePosition = useStore((s) => s.setNodePosition);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const isRunning = mode === 'running';

  // Re-project the IR onto the canvas whenever the workflow OR runState changes.
  // Layout coordinates are preserved by irToFlow, so a drag that wrote back via
  // setNodePosition will land at the same spot on re-projection.
  useEffect(() => {
    const { nodes: flowNodes, edges: flowEdges } = irToFlow(workflow, runState);
    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [workflow, runState, setNodes, setEdges]);

  // Mirror the store selection onto React Flow node `selected` flags.
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) =>
        n.selected === (n.id === selectedNodeId)
          ? n
          : { ...n, selected: n.id === selectedNodeId },
      ),
    );
  }, [selectedNodeId, setNodes]);

  // ── Interaction handlers ─────────────────────────────────────────────────

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      selectNode(node.id);
    },
    [selectNode],
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
    setMenu(null);
  }, [selectNode]);

  /** Create an IR edge whenever the user finishes drawing a connection. */
  const onConnect = useCallback<OnConnect>(
    (connection) => {
      if (isRunning) return; // hard block in running mode
      const ir = connectionToEdge(connection);
      if (!ir) return;
      addEdge(ir.from, ir.to, ir.kind);
    },
    [addEdge, isRunning],
  );

  /** Persist drag-stop positions back to the IR layout. */
  const onNodeDragStop = useCallback<OnNodeDrag>(
    (_event, node) => {
      if (isRunning) return;
      setNodePosition(node.id, node.position.x, node.position.y);
    },
    [setNodePosition, isRunning],
  );

  /** Forward delete-key removals to the IR. */
  const onNodesDelete = useCallback<OnNodesDelete>(
    (deleted) => {
      if (isRunning) return;
      for (const n of deleted) removeNode(n.id);
    },
    [removeNode, isRunning],
  );

  const onEdgesDelete = useCallback<OnEdgesDelete>(
    (deleted: Edge[]) => {
      if (isRunning) return;
      for (const e of deleted) removeEdge(e.id);
    },
    [removeEdge, isRunning],
  );

  // ── Context menu (pane right-click → add node) ───────────────────────────

  const [menu, setMenu] = useState<MenuState | null>(null);

  /** Show the add-node menu at the right-click point on empty canvas. */
  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      if (isRunning) return;
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setMenu({ screenX, screenY, flowX: flow.x, flowY: flow.y });
    },
    [isRunning, screenToFlowPosition],
  );

  /** Add a node at the menu's flow-space coords, then close the menu. */
  const addNodeAtMenu = useCallback(
    (type: NodeType) => {
      if (!menu) return;
      const id = addNode(type);
      // Override the auto-placed coords with the right-click spot so the new
      // node materializes exactly where the user clicked. setNodePosition is
      // layout-only and doesn't dirty the workflow further.
      setNodePosition(id, menu.flowX, menu.flowY);
      selectNode(id);
      setMenu(null);
    },
    [addNode, menu, selectNode, setNodePosition],
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

  // ── Render ───────────────────────────────────────────────────────────────

  // `nodesDraggable` / `nodesConnectable` toggle React Flow's built-in
  // affordances; the per-handler `if (isRunning) return` guards are belt &
  // braces for any synthetic events that slip through.
  const interactive = !isRunning;

  const runningBadge = useMemo(() => {
    if (!isRunning) return null;
    return (
      <div
        className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px]"
        style={{
          background: 'rgba(227, 160, 8, 0.12)',
          borderColor: 'var(--accent-3)',
          color: 'var(--accent-3)',
        }}
      >
        <span className="omc-pulse-dot" />
        <span>{t(locale, 'canvas.runningReadonly')}</span>
      </div>
    );
  }, [isRunning, locale]);

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      {/* Local-scoped keyframes used by the running pulse + status badges. */}
      <style>{KEYFRAME_CSS}</style>

      <CanvasToolbar />

      <div className="relative min-h-0 flex-1" ref={wrapperRef}>
        {runningBadge}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          onPaneContextMenu={onPaneContextMenu}
          nodesDraggable={interactive}
          nodesConnectable={interactive}
          edgesFocusable={interactive}
          deleteKeyCode={interactive ? ['Delete', 'Backspace'] : null}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          minZoom={0.25}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: 'smoothstep' }}
        >
          <Background
            variant={BackgroundVariant.Lines}
            gap={22}
            lineWidth={1}
            color="var(--border-soft)"
          />
          <Controls showInteractive={false} style={{ color: 'var(--fg)' }} />
        </ReactFlow>

        {menu && (
          <AddNodeMenu
            x={menu.screenX}
            y={menu.screenY}
            locale={locale}
            onPick={addNodeAtMenu}
            onClose={() => setMenu(null)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Right-click context menu for adding a node. Positioned at the click point
 * (relative to the canvas wrapper) so it stays under the cursor while the
 * flow viewport is panned/zoomed.
 */
function AddNodeMenu({
  x,
  y,
  locale,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  locale: Locale;
  onPick: (type: NodeType) => void;
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
        className="absolute z-40 min-w-[160px] overflow-hidden rounded-md border border-border bg-panel shadow-2xl"
        style={{ left: x, top: y }}
      >
        <div className="border-b border-border-soft px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
          {t(locale, 'canvas.addNode')}
        </div>
        <div className="flex max-h-[280px] flex-col overflow-y-auto py-1">
          {ADDABLE_NODES.map((n) => (
            <button
              key={n.type}
              type="button"
              onClick={() => onPick(n.type)}
              className="flex items-center gap-2 px-3 py-1.5 text-left text-xs text-fg-dim transition-colors hover:bg-panel-2 hover:text-fg"
            >
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: n.accent }}
                aria-hidden
              />
              <span>{n.translations?.[locale]?.label ?? n.label}</span>
              <span className="ml-auto font-mono text-[10px] text-fg-faint">
                {n.type}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * Component-scoped keyframes for the running pulse on node borders and the
 * toolbar "running" badge. Kept inline (vs. global.css) so the canvas module
 * remains the sole owner of its visual chrome.
 */
const KEYFRAME_CSS = `
@keyframes omc-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
.omc-pulse-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  animation: omc-pulse 1.1s ease-in-out infinite;
}
`;

export default function BlueprintCanvas() {
  return (
    <ReactFlowProvider>
      <BlueprintCanvasInner />
    </ReactFlowProvider>
  );
}
