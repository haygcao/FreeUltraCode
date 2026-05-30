import { DATA, EXEC, type IRGraph } from './ir';

/**
 * Demo blueprint for the run-time user-interaction feature (see
 * core/interaction.ts). Loadable from the canvas toolbar ("示例" button).
 *
 * Shape:  start → agent「收集部署偏好」→ agent「生成部署清单」→ end
 *                  (asks select + confirm)   (data edge ← collect)
 *
 * The first agent is prompted to ask the user — via the interaction protocol —
 * to pick a deploy environment (select) and confirm a DB migration (confirm),
 * then summarise the choices. That summary flows through a data edge into the
 * second agent, which produces a short checklist. Both run on `haiku` so a test
 * run is fast and cheap. The adapter defaults to claude-code but can be switched
 * to Codex from the toolbar — both obey the same interaction protocol.
 */
export function interactionSampleBlueprint(): IRGraph {
  return {
    version: 1,
    meta: {
      name: '交互示例 · 部署向导',
      description: '演示运行时让用户选择/确认的交互能力',
      adapter: 'claude-code',
    },
    nodes: [
      { id: 'n_start', type: 'start', label: 'Start', params: {} },
      {
        id: 'n_collect',
        type: 'agent',
        label: '收集部署偏好',
        params: {
          model: 'haiku',
          prompt:
            '你是部署向导。在本节点里请严格按顺序做三件事：\n' +
            '1) 先用 select 让我（用户）选择部署环境，选项为：开发、测试、生产。\n' +
            '2) 拿到我的选择后，再用 confirm 让我确认是否需要执行数据库迁移。\n' +
            '3) 两个回答都拿到后，用一句简体中文总结我的选择（环境 + 是否迁移），作为本节点的最终输出。\n' +
            '部署目标只能由我决定，请不要替我假设，必须通过交互询问。',
        },
      },
      {
        id: 'n_plan',
        type: 'agent',
        label: '生成部署清单',
        params: {
          model: 'haiku',
          prompt:
            '根据上游节点给出的用户部署选择，列出 3-5 条精简的部署步骤清单（简体中文）。' +
            '信息已经完整，不要再向用户提问，直接给出清单。',
        },
      },
      { id: 'n_end', type: 'end', label: 'End', params: {} },
    ],
    edges: [
      {
        id: 'e_start_collect',
        from: { node: 'n_start', port: 'exec_out' },
        to: { node: 'n_collect', port: 'exec_in' },
        kind: EXEC,
      },
      {
        id: 'e_collect_plan',
        from: { node: 'n_collect', port: 'exec_out' },
        to: { node: 'n_plan', port: 'exec_in' },
        kind: EXEC,
      },
      {
        id: 'e_plan_end',
        from: { node: 'n_plan', port: 'exec_out' },
        to: { node: 'n_end', port: 'exec_in' },
        kind: EXEC,
      },
      {
        id: 'd_collect_plan',
        from: { node: 'n_collect', port: 'data_out' },
        to: { node: 'n_plan', port: 'data_in' },
        kind: DATA,
      },
    ],
    layout: {
      n_start: { x: 0, y: 160 },
      n_collect: { x: 240, y: 160 },
      n_plan: { x: 520, y: 160 },
      n_end: { x: 800, y: 160 },
    },
  };
}
