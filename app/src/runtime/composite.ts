/**
 * CONTRACT: runtime execution of a `composite` node (the 4th container kind).
 *
 * A composite is a reusable sub-workflow with declared input/output ports. Its
 * body nodes are ordinary IR nodes carrying `parent === composite.id` (flat
 * scoping, same as branch/loop). `getRunnableNodes` (dag.ts) excludes body nodes
 * from the OUTER schedule; when the composite node itself executes,
 * {@link runComposite} drives its body through a lightweight scoped scheduler that
 * REUSES the shared per-node retry loop ({@link runSingleNode}) and the shared
 * `results` map / `callbacks`.
 *
 * Port plumbing — composite output ports are materialised under COMPOSITE keys so
 * downstream nodes can read a specific port by composite key `${id}::${portId}`:
 *
 *   1. Bind inputs   — for each input port, read the OUTER producer's value (its
 *      data edge `OUTER → COMPOSITE.port`) and seed it under `${id}::${portId}`,
 *      so body nodes reading the input port (`COMPOSITE.port → INNER`) pick it up
 *      via the port-aware {@link getDataInputs} (context.ts).
 *   2. Run the body  — `topoOrderScope(workflow, composite.id)` runs the DIRECT
 *      children only; a nested composite child is itself dispatched (re-entering
 *      runComposite), so unlimited nesting falls out naturally.
 *   3. Materialise outputs — for each output port, read the INNER producer's value
 *      (its precise data edge `INNER → COMPOSITE.port`) and store it under
 *      `${id}::${portId}`. The composite's MAIN output (the value
 *      `executeWorkflowDag` stores under the bare composite id) is the FIRST
 *      declared output port's value, so downstream edges that lost their port id
 *      during identifier-scan reconstruction (defaulting to `data_out`) still
 *      resolve.
 *
 * Failure / cancel — a body-node failure throws; the OUTER `processNode` catches
 * it, so the composite node as a whole becomes the recorded failure point and the
 * resume point (resume re-runs the WHOLE composite — body nodes are not in the
 * outer `order`, so there is no finer-grained resume). Cancel mid-body stops.
 */
import { DATA, type IRGraph, type IRNode, type IRPort } from '../core/ir';
import { isRunnable, topoOrderScope } from '../core/topo';
import { runSingleNode } from './run-node';
import type { RunCallbacks, RunContext } from './types';

/** A composite node's declared port list (defensive: tolerates a missing/bad param). */
function portList(value: unknown): IRPort[] {
  return Array.isArray(value) ? (value as IRPort[]) : [];
}

/** Composite-port composite key under which a port's value is stored in `results`. */
export function compositePortKey(compositeId: string, portId: string): string {
  return `${compositeId}::${portId}`;
}

/**
 * Read the value an OUTER producer feeds into `composite`'s input `portId`. The
 * outer input-binding edge is `{ DATA, to.node===composite, to.port===portId }`.
 * The producer's value lives under its own id, OR — when the producer is itself a
 * composite output port — under that producer's composite key.
 */
function readInputBinding(
  composite: IRNode,
  portId: string,
  workflow: IRGraph,
  results: Map<string, string>,
): string | undefined {
  for (const e of workflow.edges) {
    if (e.kind !== DATA) continue;
    if (e.to.node !== composite.id || e.to.port !== portId) continue;
    // Prefer a port-specific composite key when the upstream endpoint names one.
    if (e.from.port && e.from.port !== 'data_out') {
      const keyed = results.get(compositePortKey(e.from.node, e.from.port));
      if (keyed != null) return keyed;
    }
    const main = results.get(e.from.node);
    if (main != null) return main;
  }
  return undefined;
}

/**
 * Read the value the INNER producer writes to `composite`'s output `portId`. The
 * inner output-binding edge is `{ DATA, to.node===composite, to.port===portId }`
 * whose `from` is the inner producer (precise port, per stage-1 contract).
 */
function readOutputBinding(
  composite: IRNode,
  portId: string,
  workflow: IRGraph,
  results: Map<string, string>,
): string | undefined {
  for (const e of workflow.edges) {
    if (e.kind !== DATA) continue;
    if (e.to.node !== composite.id || e.to.port !== portId) continue;
    if (e.from.port && e.from.port !== 'data_out') {
      const keyed = results.get(compositePortKey(e.from.node, e.from.port));
      if (keyed != null) return keyed;
    }
    const main = results.get(e.from.node);
    if (main != null) return main;
  }
  return undefined;
}

/**
 * Build the intra-scope dependency map for a composite body: a body node depends
 * on every other body node feeding it via an exec OR data edge. Cross-scope edges
 * (e.g. `COMPOSITE.port → INNER` input bindings, the body-entry edge) are skipped
 * because one endpoint is outside the body id set — input values are pre-seeded,
 * so body nodes are free to start as soon as their in-body deps clear.
 */
function buildBodyDeps(
  bodyOrder: IRNode[],
  workflow: IRGraph,
): Map<string, Set<string>> {
  const idSet = new Set(bodyOrder.map((n) => n.id));
  const deps = new Map<string, Set<string>>();
  for (const n of bodyOrder) deps.set(n.id, new Set());
  for (const e of workflow.edges) {
    if (!idSet.has(e.from.node) || !idSet.has(e.to.node)) continue;
    if (e.from.node === e.to.node) continue;
    deps.get(e.to.node)!.add(e.from.node);
  }
  return deps;
}

/**
 * Execute a `composite` node. Returns its MAIN output (first declared output
 * port's value, or '' when none). Throws if any body node fails so the outer
 * `processNode` records the composite as the failure point.
 */
export async function runComposite(
  context: RunContext,
  callbacks: RunCallbacks,
  node: IRNode,
  workflow: IRGraph,
  results: Map<string, string>,
): Promise<string> {
  const stillRunning = () => !callbacks.isCancelled();
  const inputs = portList(node.params.inputs);
  const outputs = portList(node.params.outputs);

  // 1. Bind inputs — seed each input port's value under its composite key so body
  //    nodes (reading `COMPOSITE.port → INNER`) pick it up via getDataInputs.
  for (const port of inputs) {
    const value = readInputBinding(node, port.id, workflow, results);
    if (value != null) {
      results.set(compositePortKey(node.id, port.id), value);
    }
  }

  // 2. Run the body — DIRECT children only (nested composites re-enter here).
  const bodyOrder = topoOrderScope(workflow, node.id).filter(isRunnable);
  const nodeResults = context.nodeResults ?? {};

  if (bodyOrder.length > 0) {
    const deps = buildBodyDeps(bodyOrder, workflow);
    const concurrency = context.gateway.effectiveConcurrency(
      context.concurrency,
      context.selection,
    );
    const done = new Set<string>();
    const claimed = new Set<string>();

    await new Promise<void>((resolve, reject) => {
      let active = 0;
      let settled = false;
      let bodyError: unknown = null;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (bodyError) reject(bodyError);
        else resolve();
      };

      const pickReady = (): IRNode | null => {
        for (const n of bodyOrder) {
          if (claimed.has(n.id)) continue;
          let ready = true;
          for (const dep of deps.get(n.id)!) {
            if (!done.has(dep)) {
              ready = false;
              break;
            }
          }
          if (ready) return n;
        }
        if (active === 0) {
          for (const n of bodyOrder) if (!claimed.has(n.id)) return n;
        }
        return null;
      };

      const pump = (): void => {
        if (settled) return;
        if (!stillRunning()) {
          if (active === 0) finish();
          return;
        }
        while (active < concurrency && !bodyError && stillRunning()) {
          const next = pickReady();
          if (!next) break;
          claimed.add(next.id);
          active += 1;
          void runSingleNode(
            context,
            callbacks,
            next,
            workflow,
            results,
            nodeResults,
          ).then((outcome) => {
            active -= 1;
            if (outcome.kind === 'ok') {
              done.add(next.id);
            } else if (outcome.kind === 'failed' && !bodyError) {
              // A body node failed terminally — surface it as the composite's
              // failure (the outer processNode catches & records it).
              bodyError = new Error(
                `复合节点「${node.label ?? node.id}」内部节点「${
                  next.label ?? next.id
                }」失败：${outcome.failure.message}`,
              );
            }
            pump();
          });
        }
        if (active === 0 && (bodyError || !stillRunning() || !pickReady())) {
          finish();
        }
      };

      pump();
    });
  }

  if (!stillRunning()) return '';

  // 3. Materialise outputs — store each output port's value under its composite
  //    key; the MAIN output is the first declared output port's value.
  let mainOutput = '';
  outputs.forEach((port, i) => {
    const value = readOutputBinding(node, port.id, workflow, results);
    if (value != null) {
      results.set(compositePortKey(node.id, port.id), value);
      if (i === 0) mainOutput = value;
    }
  });

  return mainOutput;
}
