/**
 * Runtime tests for the `composite` container (stage 2: DAG execution + multi
 * output ports). Imports ONLY `@/runtime` + the IR types — no store / React /
 * Tauri — proving composite execution is part of the pure run engine.
 *
 * A fake gateway echoes a per-node deterministic string and records how many
 * times each node id is dispatched (via the prompt's 【label】 header). We assert:
 *   - inner body nodes execute EXACTLY once (no double-run by outer pump + body);
 *   - the input bound to the composite's `in_topic` port reaches the first inner
 *     node's prompt (upstream-context block);
 *   - the composite's MAIN output = the inner producer's output, and that value
 *     reaches the downstream consumer's prompt;
 *   - multi-output: each declared output port is materialised under its composite
 *     key and the right downstream edge reads the right port.
 */
import { describe, expect, it } from 'vitest';
import { DATA, EXEC, type IREdge, type IRGraph, type IRNode } from '@/core/ir';
import {
  executeWorkflowDag,
  type RunCallbacks,
  type RunContext,
  type RunGateway,
  type SpawnCliAgentOpts,
} from '@/runtime';

/* ----------------------------------------------------------------- fixtures */

const exec = (from: string, to: string): IREdge => ({
  id: `e_${from}_${to}`,
  from: { node: from, port: 'exec_out' },
  to: { node: to, port: 'exec_in' },
  kind: EXEC,
});
const portData = (
  from: string,
  fromPort: string,
  to: string,
  toPort: string,
): IREdge => ({
  id: `d_${from}_${fromPort}_${to}_${toPort}`,
  from: { node: from, port: fromPort },
  to: { node: to, port: toPort },
  kind: DATA,
});

const start: IRNode = { id: 'n_start', type: 'start', label: 'Start', params: {} };
const end: IRNode = { id: 'n_end', type: 'end', label: 'End', params: {} };

/**
 * Single-input / single-output composite. An upstream AGENT (`n_src`, so it
 * actually produces a runtime value) feeds the composite's `in_topic` port; two
 * chained inner agents (a1 → a2) produce the body result; `out_summary` flows to
 * the downstream consumer agent.
 */
function compositeSingleGraph(): IRGraph {
  return {
    version: 1,
    meta: { name: 'composite-single-runtime', adapter: 'claude-code' },
    nodes: [
      start,
      { id: 'n_src', type: 'agent', label: 'Source', params: { prompt: '产出主题。' } },
      {
        id: 'c1',
        type: 'composite',
        label: 'Composite',
        params: {
          inputs: [{ id: 'in_topic', direction: 'in', kind: DATA, label: 'topic' }],
          outputs: [{ id: 'out_summary', direction: 'out', kind: DATA, label: 'summary' }],
        },
      },
      { id: 'a1', type: 'agent', parent: 'c1', label: 'Research', params: { prompt: '研究主题。' } },
      { id: 'a2', type: 'agent', parent: 'c1', label: 'Summarize', params: { prompt: '总结发现。' } },
      { id: 'n_consumer', type: 'agent', label: 'Consumer', params: { prompt: '撰写报告。' } },
      end,
    ],
    edges: [
      exec('n_start', 'n_src'),
      exec('n_src', 'c1'),
      exec('c1', 'n_consumer'),
      exec('n_consumer', 'n_end'),
      // body entry + inner exec.
      exec('c1', 'a1'),
      exec('a1', 'a2'),
      // inner input binding: composite input port → first inner consumer.
      portData('c1', 'in_topic', 'a1', 'data_in'),
      // inner output binding: inner producer → composite output port.
      portData('a2', 'data_out', 'c1', 'out_summary'),
      // outer input binding: outer producer → composite input port.
      portData('n_src', 'data_out', 'c1', 'in_topic'),
      // outer output binding: composite output port → downstream consumer.
      portData('c1', 'out_summary', 'n_consumer', 'data_in'),
    ],
  };
}

/**
 * Two-output composite. `b1` writes port `out_a`, `b2` writes port `out_b`. Two
 * downstream consumers each read a DIFFERENT port (port-precise edges). Verifies
 * multi-output materialisation + port-aware getDataInputs.
 */
function compositeMultiOutGraph(): IRGraph {
  return {
    version: 1,
    meta: { name: 'composite-multi-out', adapter: 'claude-code' },
    nodes: [
      start,
      {
        id: 'c1',
        type: 'composite',
        label: 'Composite',
        params: {
          inputs: [],
          outputs: [
            { id: 'out_a', direction: 'out', kind: DATA, label: 'A' },
            { id: 'out_b', direction: 'out', kind: DATA, label: 'B' },
          ],
        },
      },
      { id: 'b1', type: 'agent', parent: 'c1', label: 'MakeA', params: { prompt: '产 A。' } },
      { id: 'b2', type: 'agent', parent: 'c1', label: 'MakeB', params: { prompt: '产 B。' } },
      { id: 'ca', type: 'agent', label: 'ReadA', params: { prompt: '读 A。' } },
      { id: 'cb', type: 'agent', label: 'ReadB', params: { prompt: '读 B。' } },
      end,
    ],
    edges: [
      exec('n_start', 'c1'),
      exec('c1', 'ca'),
      exec('ca', 'cb'),
      exec('cb', 'n_end'),
      // body entry (two independent inner producers).
      exec('c1', 'b1'),
      exec('c1', 'b2'),
      // inner output bindings.
      portData('b1', 'data_out', 'c1', 'out_a'),
      portData('b2', 'data_out', 'c1', 'out_b'),
      // outer output bindings to distinct consumers, port-precise.
      portData('c1', 'out_a', 'ca', 'data_in'),
      portData('c1', 'out_b', 'cb', 'data_in'),
    ],
  };
}

/* -------------------------------------------------------------------- mocks */

interface Recorder {
  /** node name → number of dispatch calls. */
  counts: Map<string, number>;
  /** node name → the FULL prompt last seen for that node. */
  prompts: Map<string, string>;
}

/**
 * Maps each node's distinctive base-prompt prefix to a stable name. The prompt
 * that reaches `spawnCliAgent` begins with the node's own `params.prompt` (the
 * `【label】` header goes to `beginStream`, not the model prompt), so we attribute
 * a call by which known base prompt it starts with.
 */
const PROMPT_TO_NAME: Array<[string, string]> = [
  ['产出主题。', 'Source'],
  ['研究主题。', 'Research'],
  ['总结发现。', 'Summarize'],
  ['撰写报告。', 'Consumer'],
  ['产 A。', 'MakeA'],
  ['产 B。', 'MakeB'],
  ['读 A。', 'ReadA'],
  ['读 B。', 'ReadB'],
];

/**
 * Fake gateway: always spawns the CLI, returns a deterministic per-node string,
 * and records each call attributed by its base-prompt prefix.
 */
function recordingGateway(rec: Recorder): RunGateway {
  const nameOf = (prompt: string): string =>
    PROMPT_TO_NAME.find(([needle]) => prompt.startsWith(needle))?.[1] ?? '?';
  const respond = async (
    prompt: string,
    adapter: string,
    opts: SpawnCliAgentOpts,
  ): Promise<string> => {
    void adapter;
    void opts;
    const name = nameOf(prompt);
    rec.counts.set(name, (rec.counts.get(name) ?? 0) + 1);
    rec.prompts.set(name, prompt);
    return `OUT[${name}]`;
  };
  return {
    resolveDirectRoute: () => null,
    resolveCliRoute: async () => ({ adapter: 'claude-code', cliCommand: 'claude' }),
    completeText: async () => ({ text: '', adapter: 'claude-code' }),
    spawnCliAgent: respond,
    applyOverride: (s) => s,
    recordCall: () => {},
    timeoutPolicy: () => ({ timeoutSeconds: 600, idleTimeoutSeconds: 180 }),
    effectiveConcurrency: (n) => n,
    effectiveConsensusSamples: (n) => n,
    nodeGatewayOverride: () => undefined,
    modelClassFromModelId: () => 'sonnet',
  };
}

function silentCallbacks(): RunCallbacks {
  return {
    onNodeStart: () => {},
    onNodeSuccess: () => {},
    onNodeFailure: () => {},
    onLog: () => {},
    beginStream: () => ({ append: () => {}, finalize: () => {}, fail: () => {} }),
    isCancelled: () => false,
    promptInteraction: async () => null,
  };
}

function ctx(gateway: RunGateway): RunContext {
  return {
    selection: { adapter: 'claude-code', modelClass: 'sonnet' },
    concurrency: 4,
    maxRetries: 0,
    consensusSamples: 3,
    gateway,
  };
}

/* -------------------------------------------------------------------- tests */

describe('runComposite — single in/out', () => {
  it('runs each inner node once and threads input → body → output → downstream', async () => {
    const rec: Recorder = { counts: new Map(), prompts: new Map() };
    const result = await executeWorkflowDag(
      compositeSingleGraph(),
      silentCallbacks(),
      ctx(recordingGateway(rec)),
    );

    expect(result.success).toBe(true);

    // Inner nodes a1 (Research) & a2 (Summarize) execute EXACTLY once each.
    expect(rec.counts.get('Research')).toBe(1);
    expect(rec.counts.get('Summarize')).toBe(1);
    // Composite is not itself a model call; the source & consumer run once.
    expect(rec.counts.get('Source')).toBe(1);
    expect(rec.counts.get('Consumer')).toBe(1);

    // Input binding: a1's prompt carries the source output fed into in_topic.
    expect(rec.prompts.get('Research')).toContain('OUT[Source]');

    // Composite MAIN output = first declared output port (out_summary) = a2's
    // output, surfaced under the bare composite id for downstream main reads.
    expect(result.outputs['c1']).toBe('OUT[Summarize]');
    // Multi-output composite key carries the same value.
    expect(result.outputs['c1::out_summary']).toBe('OUT[Summarize]');

    // The output threads to the downstream consumer's prompt.
    expect(rec.prompts.get('Consumer')).toContain('OUT[Summarize]');
  });
});

describe('runComposite — multiple output ports', () => {
  it('materialises each output port under its composite key and routes per-port', async () => {
    const rec: Recorder = { counts: new Map(), prompts: new Map() };
    const result = await executeWorkflowDag(
      compositeMultiOutGraph(),
      silentCallbacks(),
      ctx(recordingGateway(rec)),
    );

    expect(result.success).toBe(true);

    // Both inner producers ran exactly once.
    expect(rec.counts.get('MakeA')).toBe(1);
    expect(rec.counts.get('MakeB')).toBe(1);

    // Each output port materialised under its composite key.
    expect(result.outputs['c1::out_a']).toBe('OUT[MakeA]');
    expect(result.outputs['c1::out_b']).toBe('OUT[MakeB]');
    // MAIN output = first declared port (out_a).
    expect(result.outputs['c1']).toBe('OUT[MakeA]');

    // Port-precise routing: ReadA sees out_a only, ReadB sees out_b only.
    expect(rec.prompts.get('ReadA')).toContain('OUT[MakeA]');
    expect(rec.prompts.get('ReadA')).not.toContain('OUT[MakeB]');
    expect(rec.prompts.get('ReadB')).toContain('OUT[MakeB]');
    expect(rec.prompts.get('ReadB')).not.toContain('OUT[MakeA]');
  });
});
