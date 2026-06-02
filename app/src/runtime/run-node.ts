/**
 * CONTRACT: the shared per-node execution + auto-retry loop.
 *
 * Extracted verbatim from `executeWorkflowDag`'s inner `processNode` so it can be
 * reused by both the top-level DAG pump (dag.ts) and the composite-body scheduler
 * (composite.ts) without duplicating the retry/back-off policy. The observable
 * order, retries, and terminal state are unchanged from the original closure.
 */
import { type IRGraph, type IRNode, type IRRunStatus } from '../core/ir';
import { delay } from './concurrency';
import { dispatchNode } from './node-dispatch';
import { failureTitle, isRetryable, parseRunFailure } from './failure';
import { formatClock, formatDuration } from './format';
import type { NodeRunResult, RunCallbacks, RunContext, RunFailure } from './types';

/** Outcome of {@link runSingleNode}: ok | cancelled-mid-run | terminal failure. */
export type SingleNodeOutcome =
  | { kind: 'ok' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; failure: RunFailure; state: IRRunStatus };

/**
 * Run one node with bounded auto-retry, recording its terminal {@link NodeRunResult}
 * into `nodeResults` and (on success) its output into `results`. Side effects
 * (start/success/failure/retry/log) are routed through `callbacks`. Returns a
 * structured outcome so the caller decides whether to keep scheduling (top-level
 * pump) or unwind the scope (composite body). The caller owns failure-meta
 * aggregation (it knows the run-level `adapter` + first-failure semantics).
 */
export async function runSingleNode(
  context: RunContext,
  callbacks: RunCallbacks,
  node: IRNode,
  workflow: IRGraph,
  results: Map<string, string>,
  nodeResults: Record<string, NodeRunResult>,
): Promise<SingleNodeOutcome> {
  const stillRunning = () => !callbacks.isCancelled();

  if (node.type === 'start' || node.type === 'end') {
    callbacks.onNodeSuccess(node, null);
    nodeResults[node.id] = { status: 'success' };
    return { kind: 'ok' };
  }

  const nodeStartedAt = Date.now();
  callbacks.onNodeStart(node);
  callbacks.onLog(
    `▸ ${node.label ?? node.type} · 开始 ${formatClock(nodeStartedAt)}`,
    'system',
  );

  const maxRetries = context.maxRetries;
  let attempt = 0;

  for (;;) {
    try {
      const out = await dispatchNode(context, callbacks, node, workflow, results);
      if (!stillRunning()) return { kind: 'cancelled' };
      if (out !== null) {
        results.set(node.id, out);
      }
      callbacks.onNodeSuccess(node, out);
      nodeResults[node.id] = {
        status: 'success',
        output: out ?? undefined,
        durationMs: Date.now() - nodeStartedAt,
        retryCount: attempt,
      };
      const nodeFinishedAt = Date.now();
      callbacks.onLog(
        `✓ ${node.label ?? node.type} · 完成 ${formatClock(nodeFinishedAt)} · 耗时 ${formatDuration(
          nodeFinishedAt - nodeStartedAt,
        )}${attempt > 0 ? ` · 重试 ${attempt} 次后成功` : ''}`,
        'assistant',
      );
      return { kind: 'ok' };
    } catch (err) {
      const failure = parseRunFailure(err);
      if (!stillRunning()) return { kind: 'cancelled' };

      if (attempt < maxRetries && isRetryable(failure)) {
        attempt += 1;
        const backoffMs = Math.min(15000, 1500 * attempt);
        callbacks.onLog(
          `⟳ ${node.label ?? node.type} · ${failureTitle(
            failure,
          )}，正在自动重试（第 ${attempt}/${maxRetries} 次，${Math.round(
            backoffMs / 1000,
          )}s 后重试）：${failure.message}`,
          'assistant',
        );
        callbacks.onNodeRetry?.(node, failure, attempt, maxRetries, backoffMs);
        await delay(backoffMs);
        if (!stillRunning()) return { kind: 'cancelled' };
        continue;
      }

      const nodeFinishedAt = Date.now();
      const retriedNote = attempt > 0 ? `（已自动重试 ${attempt} 次仍失败）` : '';
      callbacks.onLog(
        `✗ ${node.label ?? node.type} · 失败 ${formatClock(nodeFinishedAt)} · 耗时 ${formatDuration(
          nodeFinishedAt - nodeStartedAt,
        )}${retriedNote}: ${failure.message}`,
        'assistant',
      );
      const state: IRRunStatus =
        failure.code === 'interrupted' ? 'interrupted' : 'error';
      nodeResults[node.id] = {
        status: state,
        durationMs: nodeFinishedAt - nodeStartedAt,
        failure,
        retryCount: attempt,
      };
      callbacks.onNodeFailure(node, failure, state);
      return { kind: 'failed', failure, state };
    }
  }
}
