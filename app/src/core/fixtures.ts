import { DATA, EXEC, type IREdge, type IRGraph, type IRNode } from './ir';
import { sampleWorkflow } from './sample';
import { defaultBlueprint } from './defaultBlueprint';

/**
 * Round-trip fixtures exercising the runnable-fidelity emitter/parser:
 * thunk-array parallel, stage-callback pipeline, real if/while nesting,
 * cross-scope data flow, and schema preamble. Consumed by roundtrip.ts.
 */

const exec = (from: string, to: string): IREdge => ({
  id: `e_${from}_${to}`,
  from: { node: from, port: 'exec_out' },
  to: { node: to, port: 'exec_in' },
  kind: EXEC,
});

const data = (from: string, to: string): IREdge => ({
  id: `d_${from}_${to}`,
  from: { node: from, port: 'data_out' },
  to: { node: to, port: 'data_in' },
  kind: DATA,
});

const start: IRNode = { id: 'n_start', type: 'start', label: 'Start', params: {} };
const end: IRNode = { id: 'n_end', type: 'end', label: 'End', params: {} };

const grid = (ids: string[]): Record<string, { x: number; y: number }> =>
  Object.fromEntries(ids.map((id, i) => [id, { x: i * 240, y: 160 }]));

/** F2 — variable → pipeline(items, 2 schema stages) → end. */
export const pipelineSample: IRGraph = {
  version: 1,
  meta: {
    name: 'pipeline-sample',
    adapter: 'claude-code',
    schemaDefs: { REVIEW: '{ ok: false }', VERDICT: '{ pass: false }' },
  },
  nodes: [
    start,
    { id: 'n_files', type: 'variable', label: 'files', params: { name: 'files', value: "['src/a.ts', 'src/b.ts']", raw: true } },
    {
      id: 'n_pipe',
      type: 'pipeline',
      label: 'Pipeline',
      params: {
        items: 'files',
        stages: [
          { prompt: '审查 ${item}', schema: 'REVIEW' },
          { prompt: '验证 ${item} 的发现', schema: 'VERDICT' },
        ],
      },
    },
    end,
  ],
  edges: [exec('n_start', 'n_pipe'), exec('n_pipe', 'n_end'), data('n_files', 'n_pipe')],
  layout: grid(['n_start', 'n_files', 'n_pipe', 'n_end']),
};

/** F3 — branch containing two child agents, on the top spine. */
export const branchSample: IRGraph = {
  version: 1,
  meta: { name: 'branch-sample', adapter: 'claude-code' },
  nodes: [
    start,
    { id: 'n_setup', type: 'agent', label: 'Setup', params: { prompt: '准备数据', model: 'haiku' } },
    { id: 'n_branch', type: 'branch', label: '分支', params: { condition: 'setup.ok' } },
    { id: 'n_c1', type: 'agent', parent: 'n_branch', label: 'Fix', params: { prompt: '修复问题' } },
    { id: 'n_c2', type: 'agent', parent: 'n_branch', label: 'Report', params: { prompt: '汇报结果' } },
    { id: 'n_after', type: 'agent', label: 'After', params: { prompt: '收尾' } },
    end,
  ],
  edges: [
    exec('n_start', 'n_setup'),
    exec('n_setup', 'n_branch'),
    exec('n_branch', 'n_after'),
    exec('n_after', 'n_end'),
    exec('n_branch', 'n_c1'),
    exec('n_c1', 'n_c2'),
  ],
  layout: grid(['n_start', 'n_setup', 'n_branch', 'n_c1', 'n_c2', 'n_after', 'n_end']),
};

/** F4 — loop containing an agent that consumes a top-scope variable (data edge). */
export const loopSample: IRGraph = {
  version: 1,
  meta: { name: 'loop-sample', adapter: 'claude-code' },
  nodes: [
    start,
    { id: 'n_seed', type: 'variable', label: 'seed', params: { name: 'seed', value: '0', raw: true } },
    { id: 'n_loop', type: 'loop', label: '循环', params: { condition: 'false' } },
    { id: 'n_step', type: 'agent', parent: 'n_loop', label: 'Step', params: { prompt: '处理一轮' } },
    end,
  ],
  edges: [
    exec('n_start', 'n_loop'),
    exec('n_loop', 'n_end'),
    exec('n_loop', 'n_step'),
    data('n_seed', 'n_step'),
  ],
  layout: grid(['n_start', 'n_seed', 'n_loop', 'n_step', 'n_end']),
};

/** F5 — branch whose child is a loop with an inner agent (depth ≥2). */
export const nestedSample: IRGraph = {
  version: 1,
  meta: { name: 'nested-sample', adapter: 'claude-code' },
  nodes: [
    start,
    { id: 'n_b', type: 'branch', label: '分支', params: { condition: 'true' } },
    { id: 'n_l', type: 'loop', parent: 'n_b', label: '循环', params: { condition: 'false' } },
    { id: 'n_inner', type: 'agent', parent: 'n_l', label: 'Inner', params: { prompt: '内层步骤' } },
    end,
  ],
  edges: [
    exec('n_start', 'n_b'),
    exec('n_b', 'n_end'),
    exec('n_b', 'n_l'),
    exec('n_l', 'n_inner'),
  ],
  layout: grid(['n_start', 'n_b', 'n_l', 'n_inner', 'n_end']),
};

/** Layout-only fixtures that stress the layered auto-layout. */
export const linearSample: IRGraph = {
  version: 1,
  meta: { name: 'linear-sample', adapter: 'claude-code' },
  nodes: [
    start,
    { id: 'n_a', type: 'agent', label: 'A', params: { prompt: 'A' } },
    { id: 'n_b', type: 'agent', label: 'B', params: { prompt: 'B' } },
    end,
  ],
  edges: [exec('n_start', 'n_a'), exec('n_a', 'n_b'), exec('n_b', 'n_end')],
  layout: grid(['n_start', 'n_a', 'n_b', 'n_end']),
};

export const dataHeavySample: IRGraph = {
  version: 1,
  meta: { name: 'data-heavy-sample', adapter: 'claude-code' },
  nodes: [
    start,
    { id: 'n_seed', type: 'variable', label: 'seed', params: { name: 'seed', value: '42', raw: true } },
    { id: 'n_ctx', type: 'variable', label: 'ctx', params: { name: 'ctx', value: 'input', raw: true } },
    { id: 'n_join', type: 'agent', label: 'Join', params: { prompt: 'Join inputs' } },
    { id: 'n_tail', type: 'agent', label: 'Tail', params: { prompt: 'Tail step' } },
    end,
  ],
  edges: [
    exec('n_start', 'n_join'),
    exec('n_join', 'n_tail'),
    exec('n_tail', 'n_end'),
    data('n_seed', 'n_join'),
    data('n_ctx', 'n_join'),
    data('n_join', 'n_tail'),
  ],
  layout: grid(['n_start', 'n_seed', 'n_ctx', 'n_join', 'n_tail', 'n_end']),
};

export const multiTerminalSample: IRGraph = {
  version: 1,
  meta: { name: 'multi-terminal-sample', adapter: 'claude-code' },
  nodes: [
    start,
    { id: 'n_start2', type: 'start', label: 'Start 2', params: {} },
    { id: 'n_a', type: 'agent', label: 'A', params: { prompt: 'A' } },
    { id: 'n_b', type: 'branch', label: 'Branch', params: { condition: 'true' } },
    { id: 'n_child', type: 'agent', parent: 'n_b', label: 'Child', params: { prompt: 'child' } },
    { id: 'n_end2', type: 'end', label: 'End 2', params: {} },
    end,
  ],
  edges: [
    exec('n_start', 'n_a'),
    exec('n_start2', 'n_b'),
    exec('n_a', 'n_b'),
    exec('n_b', 'n_end2'),
    exec('n_b', 'n_child'),
    exec('n_child', 'n_end'),
  ],
  layout: grid(['n_start', 'n_start2', 'n_a', 'n_b', 'n_child', 'n_end2', 'n_end']),
};

export const isolatedSample: IRGraph = {
  version: 1,
  meta: { name: 'isolated-sample', adapter: 'claude-code' },
  nodes: [
    start,
    { id: 'n_island', type: 'log', label: 'Island', params: { message: 'isolated node' } },
    { id: 'n_data', type: 'variable', label: 'Data', params: { name: 'data', value: '[]', raw: true } },
    end,
  ],
  edges: [exec('n_start', 'n_end')],
  layout: grid(['n_start', 'n_island', 'n_data', 'n_end']),
};

/** Named fixtures for the round-trip suite (F1 = sample, F6 = default blueprint). */
export const roundtripFixtures: { name: string; ir: IRGraph }[] = [
  { name: 'F1 review-changes (parallel + data + schema)', ir: sampleWorkflow },
  { name: 'F2 pipeline (items + stages)', ir: pipelineSample },
  { name: 'F3 branch (nested children)', ir: branchSample },
  { name: 'F4 loop (data edge into body)', ir: loopSample },
  { name: 'F5 nested branch>loop>agent', ir: nestedSample },
  { name: 'F6 default blueprint', ir: defaultBlueprint() },
];

export const layoutFixtures: { name: string; ir: IRGraph }[] = [
  { name: 'L1 linear', ir: linearSample },
  { name: 'L2 data-heavy', ir: dataHeavySample },
  { name: 'L3 multi-terminal', ir: multiTerminalSample },
  { name: 'L4 isolated', ir: isolatedSample },
];
