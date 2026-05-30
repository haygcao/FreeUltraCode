import type { IRGraph, IRLayout, IRNode } from './ir';
import { topoOrderScope } from './topo';
import { estimateNodeSize, layoutGraphLayered } from './autoLayoutLayered';

const MAIN_Y = 160;
const X_GAP = 300;
const Y_GAP = 48;
const CHILD_X_OFFSET = 330;
const CHILD_Y_OFFSET = 140;
const CHILD_Y_GAP = 150;
const DEFAULT_MAX_LAYERED_NODES = 320;

interface Size {
  w: number;
  h: number;
}

export interface AutoLayoutOptions {
  engine?: 'layered' | 'legacy';
  relayout?: 'auto' | 'all' | 'missing';
  maxLayeredNodes?: number;
}

function nodeSize(node: IRNode): Size {
  return estimateNodeSize(node.type);
}

function childrenByParent(nodes: IRNode[]): Map<string, IRNode[]> {
  const map = new Map<string, IRNode[]>();
  for (const node of nodes) {
    if (!node.parent) continue;
    const list = map.get(node.parent) ?? [];
    list.push(node);
    map.set(node.parent, list);
  }
  return map;
}

function nodeOrderIndex(graph: IRGraph): Map<string, number> {
  return new Map(graph.nodes.map((node, index) => [node.id, index]));
}

function isSameStructuralNode(
  previous: IRGraph | undefined,
  node: IRNode,
): boolean {
  const old = previous?.nodes.find((item) => item.id === node.id);
  return !!old && old.type === node.type && old.parent === node.parent;
}

function isScopedPositionTooClose(
  node: IRNode,
  layout: IRLayout,
  parent: IRNode | undefined,
): boolean {
  if (!node.parent || !parent) return false;
  const pos = layout[node.id];
  const parentPos = layout[parent.id];
  if (!pos || !parentPos) return true;
  const parentSize = nodeSize(parent);
  return (
    pos.x < parentPos.x + parentSize.w + 70 &&
    pos.y < parentPos.y + parentSize.h + CHILD_Y_OFFSET
  );
}

function planMissingAndScopedPositions(
  graph: IRGraph,
  layout: IRLayout,
): IRLayout {
  const planned: IRLayout = { ...layout };
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const children = childrenByParent(graph.nodes);

  const placeScope = (
    parentId: string | undefined,
    originX: number,
    originY: number,
  ): void => {
    const scopeNodes = topoOrderScope(graph, parentId).filter(
      (node) => node.type !== 'end' || parentId === undefined,
    );
    let cursorX = originX;
    let cursorY = originY;

    for (const node of scopeNodes) {
      const parent = node.parent ? byId.get(node.parent) : undefined;
      const needsScopedMove = isScopedPositionTooClose(node, planned, parent);
      if (!planned[node.id] || needsScopedMove) {
        planned[node.id] = parentId
          ? { x: originX, y: cursorY }
          : { x: cursorX, y: originY };
      }

      if (children.has(node.id)) {
        const pos = planned[node.id];
        placeScope(node.id, pos.x + CHILD_X_OFFSET, pos.y + CHILD_Y_OFFSET);
      }

      if (parentId) {
        cursorY += CHILD_Y_GAP;
      } else {
        cursorX += X_GAP;
      }
    }
  };

  placeScope(undefined, 0, MAIN_Y);
  return planned;
}

function overlaps(
  a: { x: number; y: number; size: Size },
  b: { x: number; y: number; size: Size },
): boolean {
  return !(
    a.x + a.size.w + X_GAP / 5 <= b.x ||
    b.x + b.size.w + X_GAP / 5 <= a.x ||
    a.y + a.size.h + Y_GAP <= b.y ||
    b.y + b.size.h + Y_GAP <= a.y
  );
}

function resolveCollisions(graph: IRGraph, layout: IRLayout): IRLayout {
  const resolved: IRLayout = {};
  const order = nodeOrderIndex(graph);
  const nodes = [...graph.nodes].sort((a, b) => {
    const depthA = a.parent ? 1 : 0;
    const depthB = b.parent ? 1 : 0;
    return depthA - depthB || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  });
  const placed: { id: string; x: number; y: number; size: Size }[] = [];

  for (const node of nodes) {
    const size = nodeSize(node);
    const start = layout[node.id] ?? { x: 0, y: MAIN_Y };
    const x = start.x;
    let y = start.y;
    let guard = 0;

    while (guard < 80) {
      const hit = placed.find((other) => overlaps({ x, y, size }, other));
      if (!hit) break;
      y = hit.y + hit.size.h + CHILD_Y_GAP / 2;
      guard += 1;
    }

    resolved[node.id] = { x, y };
    placed.push({ id: node.id, x, y, size });
  }

  return resolved;
}

function legacyAutoLayoutGraph(graph: IRGraph, previous?: IRGraph): IRGraph {
  const layout: IRLayout = {};
  const nextLayout = graph.layout ?? {};
  const previousLayout = previous?.layout ?? {};

  for (const node of graph.nodes) {
    if (isSameStructuralNode(previous, node) && previousLayout[node.id]) {
      layout[node.id] = previousLayout[node.id];
    } else if (nextLayout[node.id]) {
      layout[node.id] = nextLayout[node.id];
    }
  }

  const planned = planMissingAndScopedPositions(graph, layout);
  return {
    ...graph,
    layout: resolveCollisions(graph, planned),
  };
}

function normalizedLayout(graph: IRGraph, layout: IRLayout | undefined): IRLayout {
  const normalized: IRLayout = {};
  if (!layout) return normalized;

  for (const node of graph.nodes) {
    const pos = layout[node.id];
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) continue;
    normalized[node.id] = { x: pos.x, y: pos.y };
  }

  return normalized;
}

function hasLayoutOverlap(graph: IRGraph, layout: IRLayout | undefined): boolean {
  const normalized = normalizedLayout(graph, layout);
  const placed: { id: string; x: number; y: number; size: Size }[] = [];

  for (const node of graph.nodes) {
    const pos = normalized[node.id];
    if (!pos) return true;
    const current = { id: node.id, x: pos.x, y: pos.y, size: nodeSize(node) };
    if (placed.some((other) => overlaps(current, other))) return true;
    placed.push(current);
  }

  return false;
}

function nodeSignature(graph: IRGraph): string {
  return graph.nodes
    .map((node) => `${node.id}:${node.type}:${node.parent ?? ''}`)
    .sort()
    .join('|');
}

function edgeSignature(graph: IRGraph): string {
  return graph.edges
    .map(
      (edge) =>
        `${edge.kind}:${edge.from.node}:${edge.from.port}>${edge.to.node}:${edge.to.port}`,
    )
    .sort()
    .join('|');
}

export function hasStructuralChanges(previous: IRGraph, next: IRGraph): boolean {
  return (
    nodeSignature(previous) !== nodeSignature(next) ||
    edgeSignature(previous) !== edgeSignature(next)
  );
}

export function hasMissingLayout(graph: IRGraph): boolean {
  return graph.nodes.some((node) => {
    const pos = graph.layout?.[node.id];
    return !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y);
  });
}

export function autoLayoutGraph(
  graph: IRGraph,
  previous?: IRGraph,
  options: AutoLayoutOptions = {},
): IRGraph {
  const engine = options.engine ?? 'layered';
  const relayout = options.relayout ?? 'auto';
  const maxLayeredNodes = options.maxLayeredNodes ?? DEFAULT_MAX_LAYERED_NODES;

  if (engine === 'legacy' || graph.nodes.length > maxLayeredNodes) {
    return legacyAutoLayoutGraph(graph, previous);
  }

  const preferredLayout = previous?.layout ?? graph.layout;
  if (relayout === 'missing') {
    return legacyAutoLayoutGraph({ ...graph, layout: preferredLayout }, previous);
  }

  if (
    relayout === 'auto' &&
    previous &&
    !hasStructuralChanges(previous, graph) &&
    !hasMissingLayout({ ...graph, layout: preferredLayout }) &&
    !hasLayoutOverlap(graph, preferredLayout)
  ) {
    return {
      ...graph,
      layout: normalizedLayout(graph, preferredLayout),
    };
  }

  try {
    return {
      ...graph,
      layout: layoutGraphLayered({ ...graph, layout: preferredLayout }, previous),
    };
  } catch {
    return legacyAutoLayoutGraph({ ...graph, layout: preferredLayout }, previous);
  }
}
