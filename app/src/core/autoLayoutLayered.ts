import { DATA, EXEC, type IRGraph, type IRLayout, type IRNode, type NodeType } from './ir';

const CANVAS_X = 0;
const CANVAS_Y = 120;
const LAYER_GAP_X = 160;
const ROW_GAP_Y = 72;
const COMPONENT_GAP_Y = 180;
const SCOPE_GAP_X = 96;
const SCOPE_GAP_Y = 72;

const EXEC_ORDER_WEIGHT = 8;
const DATA_ORDER_WEIGHT = 1;
const MAX_SWEEPS = 6;
const Y_ALIGN_SWEEPS = 4;

interface Size {
  w: number;
  h: number;
}

interface Point {
  x: number;
  y: number;
}

interface LayoutEdge {
  id: string;
  from: string;
  to: string;
}

interface LayoutBlock {
  width: number;
  height: number;
  child?: ScopeLayout;
  childOffset?: Point;
}

interface ScopeLayout {
  positions: Map<string, Point>;
  width: number;
  height: number;
}

interface LayoutContext {
  graph: IRGraph;
  nodeById: Map<string, IRNode>;
  children: Map<string, IRNode[]>;
  nodeIndex: Map<string, number>;
  edgeIndex: Map<string, number>;
  currentLayout: IRLayout;
  previousLayout: IRLayout;
}

type Direction = 'forward' | 'backward';

export function estimateNodeSize(type: NodeType): Size {
  switch (type) {
    case 'start':
    case 'end':
      return { w: 130, h: 56 };
    case 'branch':
    case 'loop':
      return { w: 240, h: 92 };
    case 'parallel':
    case 'pipeline':
      return { w: 270, h: 150 };
    default:
      return { w: 240, h: 120 };
  }
}

export function layoutGraphLayered(graph: IRGraph, previous?: IRGraph): IRLayout {
  const ctx = createLayoutContext(graph, previous);
  const root = appendUnplacedNodes(ctx, layoutScope(ctx, undefined, new Set()));
  const layout: IRLayout = {};

  for (const node of graph.nodes) {
    const pos = root.positions.get(node.id) ?? { x: 0, y: 0 };
    layout[node.id] = {
      x: Math.round(CANVAS_X + pos.x),
      y: Math.round(CANVAS_Y + pos.y),
    };
  }

  return layout;
}

function createLayoutContext(graph: IRGraph, previous?: IRGraph): LayoutContext {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const children = new Map<string, IRNode[]>();

  for (const node of graph.nodes) {
    const parent = effectiveParent(nodeById, node);
    if (!parent) continue;
    const list = children.get(parent) ?? [];
    list.push(node);
    children.set(parent, list);
  }

  return {
    graph,
    nodeById,
    children,
    nodeIndex: new Map(graph.nodes.map((node, index) => [node.id, index])),
    edgeIndex: new Map(graph.edges.map((edge, index) => [edge.id, index])),
    currentLayout: graph.layout ?? {},
    previousLayout: previous?.layout ?? {},
  };
}

function effectiveParent(
  nodeById: Map<string, IRNode>,
  node: IRNode,
): string | undefined {
  if (!node.parent || node.parent === node.id) return undefined;
  return nodeById.has(node.parent) ? node.parent : undefined;
}

function layoutScope(
  ctx: LayoutContext,
  parentId: string | undefined,
  scopePath: Set<string>,
): ScopeLayout {
  const nodes = scopeNodes(ctx, parentId);
  if (nodes.length === 0) return emptyScope();

  const nodeIds = new Set(nodes.map((node) => node.id));
  const execEdges = breakCyclesStable(
    nodes,
    collectScopeEdges(ctx, nodeIds, EXEC, false),
    ctx.edgeIndex,
  );
  const dataEdges = collectScopeEdges(ctx, nodeIds, DATA, true);
  const rank = assignRanks(nodes, execEdges, ctx.nodeIndex);

  anchorDataOnlyNodes(nodes, rank, execEdges, dataEdges, nodeIds);
  normalizeRanks(nodes, rank, parentId === undefined);

  const layers = buildInitialLayers(ctx, nodes, rank, parentId);
  const ordered = orderLayersByMedian(ctx, layers, execEdges, dataEdges, rank);
  const blocks = buildBlocks(ctx, nodes, scopePath);

  return assignScopeCoordinates(ordered, blocks, execEdges);
}

function scopeNodes(
  ctx: LayoutContext,
  parentId: string | undefined,
): IRNode[] {
  return ctx.graph.nodes.filter(
    (node) => effectiveParent(ctx.nodeById, node) === parentId,
  );
}

function emptyScope(): ScopeLayout {
  return { positions: new Map(), width: 0, height: 0 };
}

function collectScopeEdges(
  ctx: LayoutContext,
  nodeIds: Set<string>,
  kind: typeof EXEC | typeof DATA,
  includeAttached: boolean,
): LayoutEdge[] {
  const edges: LayoutEdge[] = [];

  for (const edge of ctx.graph.edges) {
    if (edge.kind !== kind) continue;
    const fromInScope = nodeIds.has(edge.from.node);
    const toInScope = nodeIds.has(edge.to.node);
    if (includeAttached ? fromInScope || toInScope : fromInScope && toInScope) {
      edges.push({ id: edge.id, from: edge.from.node, to: edge.to.node });
    }
  }

  return edges;
}

function breakCyclesStable(
  nodes: IRNode[],
  edges: LayoutEdge[],
  edgeIndex: Map<string, number>,
): LayoutEdge[] {
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) adjacency.set(node.id, new Set());

  const kept: LayoutEdge[] = [];
  const orderedEdges = [...edges].sort(
    (a, b) =>
      (edgeIndex.get(a.id) ?? 0) - (edgeIndex.get(b.id) ?? 0) ||
      a.id.localeCompare(b.id),
  );

  for (const edge of orderedEdges) {
    if (edge.from === edge.to) continue;
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    if (hasPath(adjacency, edge.to, edge.from)) continue;
    adjacency.get(edge.from)!.add(edge.to);
    kept.push(edge);
  }

  return kept;
}

function hasPath(
  adjacency: Map<string, Set<string>>,
  from: string,
  to: string,
): boolean {
  const stack = [from];
  const seen = new Set<string>();

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of adjacency.get(id) ?? []) stack.push(next);
  }

  return false;
}

function assignRanks(
  nodes: IRNode[],
  edges: LayoutEdge[],
  nodeIndex: Map<string, number>,
): Map<string, number> {
  const rank = new Map(nodes.map((node) => [node.id, 0]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));

  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const queue = nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .sort((a, b) => (nodeIndex.get(a.id) ?? 0) - (nodeIndex.get(b.id) ?? 0))
    .map((node) => node.id);

  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of outgoing.get(id) ?? []) {
      rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(id) ?? 0) + 1));
      const nextIndegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextIndegree);
      if (nextIndegree === 0) queue.push(next);
    }
  }

  return rank;
}

function anchorDataOnlyNodes(
  nodes: IRNode[],
  rank: Map<string, number>,
  execEdges: LayoutEdge[],
  dataEdges: LayoutEdge[],
  nodeIds: Set<string>,
): void {
  const execIncident = new Set<string>();
  for (const edge of execEdges) {
    execIncident.add(edge.from);
    execIncident.add(edge.to);
  }

  for (const node of nodes) {
    if (execIncident.has(node.id)) continue;
    const neighborRanks: number[] = [];

    for (const edge of dataEdges) {
      const other =
        edge.from === node.id
          ? edge.to
          : edge.to === node.id
            ? edge.from
            : undefined;
      if (!other || !nodeIds.has(other)) continue;
      const otherRank = rank.get(other);
      if (typeof otherRank === 'number') neighborRanks.push(otherRank);
    }

    rank.set(
      node.id,
      neighborRanks.length > 0 ? Math.max(0, Math.round(median(neighborRanks))) : 0,
    );
  }
}

function normalizeRanks(
  nodes: IRNode[],
  rank: Map<string, number>,
  isTopScope: boolean,
): void {
  for (const node of nodes) {
    rank.set(node.id, Math.max(0, Math.round(rank.get(node.id) ?? 0)));
  }

  if (isTopScope) {
    for (const node of nodes) {
      if (node.type === 'start') rank.set(node.id, 0);
    }
  }

  const nonEndNodes = isTopScope
    ? nodes.filter((node) => node.type !== 'end')
    : nodes;
  const uniqueRanks = [...new Set(nonEndNodes.map((node) => rank.get(node.id) ?? 0))]
    .sort((a, b) => a - b);
  const compressed = new Map(uniqueRanks.map((value, index) => [value, index]));

  for (const node of nonEndNodes) {
    rank.set(node.id, compressed.get(rank.get(node.id) ?? 0) ?? 0);
  }

  if (!isTopScope) return;

  const lastNonEndRank = nonEndNodes.reduce(
    (max, node) => Math.max(max, rank.get(node.id) ?? 0),
    -1,
  );
  for (const node of nodes) {
    if (node.type === 'end') rank.set(node.id, Math.max(0, lastNonEndRank + 1));
  }
}

function buildInitialLayers(
  ctx: LayoutContext,
  nodes: IRNode[],
  rank: Map<string, number>,
  parentId: string | undefined,
): string[][] {
  const maxRank = nodes.reduce(
    (max, node) => Math.max(max, rank.get(node.id) ?? 0),
    0,
  );
  const layers = Array.from({ length: maxRank + 1 }, () => [] as string[]);
  const entryOrder = scopeEntryOrder(ctx, parentId);

  for (const node of nodes) {
    layers[rank.get(node.id) ?? 0].push(node.id);
  }

  for (const layer of layers) {
    layer.sort((a, b) => compareInitialOrder(ctx, entryOrder, a, b));
  }

  return layers;
}

function scopeEntryOrder(
  ctx: LayoutContext,
  parentId: string | undefined,
): Map<string, number> {
  const order = new Map<string, number>();
  if (!parentId) return order;

  for (const edge of ctx.graph.edges) {
    if (edge.kind !== EXEC || edge.from.node !== parentId) continue;
    if (!order.has(edge.to.node)) {
      order.set(edge.to.node, ctx.edgeIndex.get(edge.id) ?? order.size);
    }
  }

  return order;
}

function compareInitialOrder(
  ctx: LayoutContext,
  entryOrder: Map<string, number>,
  a: string,
  b: string,
): number {
  const ay = knownLayoutY(ctx, a);
  const by = knownLayoutY(ctx, b);
  if (ay != null && by != null && ay !== by) return ay - by;
  if (ay != null && by == null) return -1;
  if (ay == null && by != null) return 1;

  const ae = entryOrder.get(a) ?? Number.POSITIVE_INFINITY;
  const be = entryOrder.get(b) ?? Number.POSITIVE_INFINITY;
  if (ae !== be) return ae - be;

  return (
    (ctx.nodeIndex.get(a) ?? 0) - (ctx.nodeIndex.get(b) ?? 0) ||
    a.localeCompare(b)
  );
}

function knownLayoutY(ctx: LayoutContext, id: string): number | undefined {
  const pos = ctx.previousLayout[id] ?? ctx.currentLayout[id];
  if (!pos || !Number.isFinite(pos.y)) return undefined;
  return pos.y;
}

function orderLayersByMedian(
  ctx: LayoutContext,
  layers: string[][],
  execEdges: LayoutEdge[],
  dataEdges: LayoutEdge[],
  rank: Map<string, number>,
): string[][] {
  const current = cloneLayers(layers);
  let best = cloneLayers(current);
  let bestScore = scoreLayers(best, execEdges, dataEdges, rank, buildOrderMap(layers));
  const initialOrder = buildOrderMap(layers);

  for (let sweepIndex = 0; sweepIndex < MAX_SWEEPS; sweepIndex += 1) {
    sweepLayers(ctx, current, rank, execEdges, dataEdges, 'forward');
    sweepLayers(ctx, current, rank, execEdges, dataEdges, 'backward');
    transposeAdjacentIfBetter(current, execEdges, dataEdges, rank, initialOrder);

    const score = scoreLayers(current, execEdges, dataEdges, rank, initialOrder);
    if (score < bestScore) {
      best = cloneLayers(current);
      bestScore = score;
    }
  }

  return best;
}

function sweepLayers(
  ctx: LayoutContext,
  layers: string[][],
  rank: Map<string, number>,
  execEdges: LayoutEdge[],
  dataEdges: LayoutEdge[],
  direction: Direction,
): void {
  const ranks =
    direction === 'forward'
      ? [...Array(layers.length).keys()].slice(1)
      : [...Array(layers.length).keys()].slice(0, Math.max(0, layers.length - 1)).reverse();

  for (const layerIndex of ranks) {
    const layer = layers[layerIndex];
    if (layer.length < 2) continue;
    const order = buildOrderMap(layers);

    layer.sort((a, b) => {
      const av = weightedNeighborOrder(a, direction, rank, order, execEdges, dataEdges);
      const bv = weightedNeighborOrder(b, direction, rank, order, execEdges, dataEdges);
      if (av != null && bv != null && av !== bv) return av - bv;
      if (av != null && bv == null) return -1;
      if (av == null && bv != null) return 1;
      return (
        (order.get(a) ?? 0) - (order.get(b) ?? 0) ||
        (ctx.nodeIndex.get(a) ?? 0) - (ctx.nodeIndex.get(b) ?? 0) ||
        a.localeCompare(b)
      );
    });
  }
}

function weightedNeighborOrder(
  id: string,
  direction: Direction,
  rank: Map<string, number>,
  order: Map<string, number>,
  execEdges: LayoutEdge[],
  dataEdges: LayoutEdge[],
): number | undefined {
  const nodeRank = rank.get(id);
  if (nodeRank == null) return undefined;

  let weighted = 0;
  let totalWeight = 0;
  const add = (neighbor: string, weight: number) => {
    const neighborRank = rank.get(neighbor);
    const neighborOrder = order.get(neighbor);
    if (neighborRank == null || neighborOrder == null) return;
    if (direction === 'forward' && neighborRank >= nodeRank) return;
    if (direction === 'backward' && neighborRank <= nodeRank) return;
    weighted += neighborOrder * weight;
    totalWeight += weight;
  };

  for (const edge of execEdges) {
    if (direction === 'forward' && edge.to === id) add(edge.from, EXEC_ORDER_WEIGHT);
    if (direction === 'backward' && edge.from === id) add(edge.to, EXEC_ORDER_WEIGHT);
  }

  for (const edge of dataEdges) {
    if (edge.from === id) add(edge.to, DATA_ORDER_WEIGHT);
    if (edge.to === id) add(edge.from, DATA_ORDER_WEIGHT);
  }

  return totalWeight > 0 ? weighted / totalWeight : undefined;
}

function transposeAdjacentIfBetter(
  layers: string[][],
  execEdges: LayoutEdge[],
  dataEdges: LayoutEdge[],
  rank: Map<string, number>,
  initialOrder: Map<string, number>,
): void {
  for (const layer of layers) {
    if (layer.length < 2) continue;
    for (let i = 0; i < layer.length - 1; i += 1) {
      const before = scoreLayers(layers, execEdges, dataEdges, rank, initialOrder);
      const current = layer[i];
      layer[i] = layer[i + 1];
      layer[i + 1] = current;
      const after = scoreLayers(layers, execEdges, dataEdges, rank, initialOrder);
      if (after >= before) {
        layer[i + 1] = layer[i];
        layer[i] = current;
      }
    }
  }
}

function scoreLayers(
  layers: string[][],
  execEdges: LayoutEdge[],
  dataEdges: LayoutEdge[],
  rank: Map<string, number>,
  initialOrder: Map<string, number>,
): number {
  const order = buildOrderMap(layers);
  const execCrossings = countCrossings(execEdges, rank, order);
  const dataCrossings = countCrossings(dataEdges, rank, order);
  const dataDistance = dataEdges.reduce(
    (sum, edge) => sum + edgeOrderDistance(edge, rank, order),
    0,
  );
  const movement = [...order].reduce(
    (sum, [id, value]) => sum + Math.abs(value - (initialOrder.get(id) ?? value)),
    0,
  );

  return execCrossings * 100 + dataCrossings * 8 + dataDistance + movement * 0.1;
}

function countCrossings(
  edges: LayoutEdge[],
  rank: Map<string, number>,
  order: Map<string, number>,
): number {
  let crossings = 0;
  const positioned = edges.filter(
    (edge) =>
      rank.has(edge.from) &&
      rank.has(edge.to) &&
      order.has(edge.from) &&
      order.has(edge.to) &&
      rank.get(edge.from) !== rank.get(edge.to),
  );

  for (let i = 0; i < positioned.length; i += 1) {
    for (let j = i + 1; j < positioned.length; j += 1) {
      const a = positioned[i];
      const b = positioned[j];
      if (a.from === b.from || a.to === b.to) continue;
      if (rank.get(a.from) !== rank.get(b.from)) continue;
      if (rank.get(a.to) !== rank.get(b.to)) continue;
      const sourceDelta = (order.get(a.from) ?? 0) - (order.get(b.from) ?? 0);
      const targetDelta = (order.get(a.to) ?? 0) - (order.get(b.to) ?? 0);
      if (sourceDelta * targetDelta < 0) crossings += 1;
    }
  }

  return crossings;
}

function edgeOrderDistance(
  edge: LayoutEdge,
  rank: Map<string, number>,
  order: Map<string, number>,
): number {
  const fromRank = rank.get(edge.from);
  const toRank = rank.get(edge.to);
  const fromOrder = order.get(edge.from);
  const toOrder = order.get(edge.to);
  if (fromRank == null || toRank == null || fromOrder == null || toOrder == null) {
    return 0;
  }
  return Math.abs(fromOrder - toOrder) + Math.abs(fromRank - toRank) * 0.25;
}

function buildBlocks(
  ctx: LayoutContext,
  nodes: IRNode[],
  scopePath: Set<string>,
): Map<string, LayoutBlock> {
  const blocks = new Map<string, LayoutBlock>();

  for (const node of nodes) {
    const child =
      (ctx.children.get(node.id)?.length ?? 0) > 0 && !scopePath.has(node.id)
        ? layoutScope(ctx, node.id, new Set([...scopePath, node.id]))
        : undefined;
    const own = estimateNodeSize(node.type);

    if (!child || child.positions.size === 0) {
      blocks.set(node.id, { width: own.w, height: own.h });
      continue;
    }

    const childOffset = { x: own.w + SCOPE_GAP_X, y: own.h + SCOPE_GAP_Y };
    blocks.set(node.id, {
      width: Math.max(own.w, childOffset.x + child.width),
      height: Math.max(own.h, childOffset.y + child.height),
      child,
      childOffset,
    });
  }

  return blocks;
}

function assignScopeCoordinates(
  layers: string[][],
  blocks: Map<string, LayoutBlock>,
  execEdges: LayoutEdge[],
): ScopeLayout {
  if (layers.length === 0) return emptyScope();

  const xByRank = computeRankX(layers, blocks);
  const positions = initialYByOrder(layers, blocks, xByRank);

  for (let i = 0; i < Y_ALIGN_SWEEPS; i += 1) {
    alignYToNeighborMedian(positions, layers, blocks, execEdges);
    enforceMinRowSeparation(positions, layers, blocks);
  }

  return normalizeAndMaterialize(positions, blocks);
}

function computeRankX(
  layers: string[][],
  blocks: Map<string, LayoutBlock>,
): number[] {
  const xByRank: number[] = [];
  let x = 0;

  for (let rank = 0; rank < layers.length; rank += 1) {
    xByRank[rank] = x;
    const maxWidth = layers[rank].reduce(
      (max, id) => Math.max(max, blocks.get(id)?.width ?? 0),
      0,
    );
    x += maxWidth + LAYER_GAP_X;
  }

  return xByRank;
}

function initialYByOrder(
  layers: string[][],
  blocks: Map<string, LayoutBlock>,
  xByRank: number[],
): Map<string, Point> {
  const positions = new Map<string, Point>();
  const layerHeights = layers.map((layer) => stackHeight(layer, blocks));
  const maxHeight = layerHeights.reduce((max, height) => Math.max(max, height), 0);

  for (let rank = 0; rank < layers.length; rank += 1) {
    let y = (maxHeight - layerHeights[rank]) / 2;
    for (const id of layers[rank]) {
      positions.set(id, { x: xByRank[rank], y });
      y += (blocks.get(id)?.height ?? 0) + ROW_GAP_Y;
    }
  }

  return positions;
}

function stackHeight(layer: string[], blocks: Map<string, LayoutBlock>): number {
  if (layer.length === 0) return 0;
  return layer.reduce(
    (sum, id, index) =>
      sum + (blocks.get(id)?.height ?? 0) + (index === 0 ? 0 : ROW_GAP_Y),
    0,
  );
}

function alignYToNeighborMedian(
  positions: Map<string, Point>,
  layers: string[][],
  blocks: Map<string, LayoutBlock>,
  execEdges: LayoutEdge[],
): void {
  const next = new Map<string, Point>();

  for (const layer of layers) {
    for (const id of layer) {
      const pos = positions.get(id);
      const own = blocks.get(id);
      if (!pos || !own) continue;
      const centers: number[] = [];

      for (const edge of execEdges) {
        const other =
          edge.from === id
            ? edge.to
            : edge.to === id
              ? edge.from
              : undefined;
        if (!other) continue;
        const otherPos = positions.get(other);
        const otherBlock = blocks.get(other);
        if (!otherPos || !otherBlock) continue;
        centers.push(otherPos.y + otherBlock.height / 2);
      }

      if (centers.length === 0) {
        next.set(id, pos);
        continue;
      }

      const targetY = median(centers) - own.height / 2;
      next.set(id, {
        x: pos.x,
        y: pos.y * 0.45 + targetY * 0.55,
      });
    }
  }

  for (const [id, pos] of next) positions.set(id, pos);
}

function enforceMinRowSeparation(
  positions: Map<string, Point>,
  layers: string[][],
  blocks: Map<string, LayoutBlock>,
): void {
  for (const layer of layers) {
    let cursor = Number.NEGATIVE_INFINITY;

    for (const id of layer) {
      const pos = positions.get(id);
      const block = blocks.get(id);
      if (!pos || !block) continue;
      const y = Math.max(pos.y, cursor);
      positions.set(id, { x: pos.x, y });
      cursor = y + block.height + ROW_GAP_Y;
    }
  }
}

function normalizeAndMaterialize(
  positions: Map<string, Point>,
  blocks: Map<string, LayoutBlock>,
): ScopeLayout {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [id, pos] of positions) {
    const block = blocks.get(id);
    if (!block) continue;
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + block.width);
    maxY = Math.max(maxY, pos.y + block.height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return emptyScope();

  const normalized = new Map<string, Point>();
  for (const [id, pos] of positions) {
    normalized.set(id, { x: pos.x - minX, y: pos.y - minY });
  }

  const materialized = new Map<string, Point>(normalized);
  for (const [id, pos] of normalized) {
    const block = blocks.get(id);
    if (!block?.child || !block.childOffset) continue;
    for (const [childId, childPos] of block.child.positions) {
      materialized.set(childId, {
        x: pos.x + block.childOffset.x + childPos.x,
        y: pos.y + block.childOffset.y + childPos.y,
      });
    }
  }

  return {
    positions: materialized,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function appendUnplacedNodes(ctx: LayoutContext, root: ScopeLayout): ScopeLayout {
  const positions = new Map(root.positions);
  let cursorY = root.height > 0 ? root.height + COMPONENT_GAP_Y : 0;
  let width = root.width;

  for (const node of ctx.graph.nodes) {
    if (positions.has(node.id)) continue;
    const size = estimateNodeSize(node.type);
    positions.set(node.id, { x: 0, y: cursorY });
    cursorY += size.h + ROW_GAP_Y;
    width = Math.max(width, size.w);
  }

  return {
    positions,
    width,
    height: Math.max(root.height, cursorY),
  };
}

function buildOrderMap(layers: string[][]): Map<string, number> {
  const order = new Map<string, number>();
  for (const layer of layers) {
    layer.forEach((id, index) => order.set(id, index));
  }
  return order;
}

function cloneLayers(layers: string[][]): string[][] {
  return layers.map((layer) => [...layer]);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}
