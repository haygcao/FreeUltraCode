import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { ConsensusStrategy, IRAgentSpec } from '@/core/ir';
import type { FlowNodeData } from '@/canvas/irToFlow';
import { t } from '@/lib/i18n';
import { DataIn, DataOut, ExecIn, ExecOut } from './handles';
import { NodeNumberBadge } from './NodeNumberBadge';
import { BADGE_BASE_STYLE, runStateVisual } from './runStateStyles';
import { CardHeader, SubChip } from './cardChrome';
import { ACCENT_PARALLEL, cardClass, cardWrapperStyle } from './cardStyle';

/**
 * Consensus node — Claude-Code-style "win by adversarial verification": fan out
 * N voters over one target, cross-validate, then vote for a single answer.
 *
 * Pins: exec in/out (▶), data in (target/context ●), data out (chosen answer ●).
 *
 * Accent token: `--accent-2` (shared with parallel; the ⚖ strategy chip
 * differentiates "vote on one target" from parallel's "run N different tasks").
 */

const STRATEGY_LABEL: Record<ConsensusStrategy, string> = {
  adversarial: '对抗验证',
  'multi-lens': '多视角审查',
  tournament: '方案竞标',
  'self-consistency': '自一致投票',
};

function ConsensusNodeImpl({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const params = d.params ?? {};
  const voters: string[] = Array.isArray(params.voters)
    ? (params.voters as (string | IRAgentSpec)[]).map((v) =>
        typeof v === 'string' ? v : v.label || v.agentType || v.prompt || 'voter',
      )
    : [];
  const strategy = (params.strategy as ConsensusStrategy) ?? 'multi-lens';
  const count =
    strategy === 'self-consistency'
      ? Math.min(7, Math.max(2, Number(params.samples) || 3))
      : voters.length;
  const quorum =
    typeof params.quorum === 'number' && params.quorum > 0
      ? params.quorum
      : Math.ceil(count / 2);

  const run = runStateVisual(d.runState);
  const { accent, ambient } = ACCENT_PARALLEL;

  return (
    <div
      className={`${cardClass(!!selected)} min-w-[190px] max-w-[260px]`}
      style={cardWrapperStyle({ accent, ambient, selected: !!selected, run })}
    >
      <NodeNumberBadge value={d.numberLabel} accent={accent} />

      <CardHeader
        accent={accent}
        glyph="⚖"
        label={t(d.locale, 'nodeType.consensus')}
        meta={`${STRATEGY_LABEL[strategy]} · ${count}选${quorum}`}
      />

      {/* Body */}
      <div className="px-3.5 pb-3 pt-2">
        <div className="text-sm font-medium text-fg">{d.label}</div>
        {voters.length > 0 ? (
          <div className="mt-1.5 flex flex-col gap-1">
            {voters.map((v, i) => (
              <SubChip key={i} accent={accent}>
                {v}
              </SubChip>
            ))}
          </div>
        ) : (
          <div className="mt-1 font-mono text-[10px] text-fg-faint">
            {strategy === 'self-consistency' ? `×${count} 自一致` : 'voters[] → vote'}
          </div>
        )}
      </div>

      {/* Pins */}
      <ExecIn id="exec_in" top={26} />
      <ExecOut id="exec_out" top={26} />
      <DataIn id="data_in" top={62} />
      <DataOut id="data_out" top={62} />

      {/* Run-state corner badge */}
      {run && (
        <div
          aria-label={`run-state-${d.runState}`}
          style={{ ...BADGE_BASE_STYLE, ...run.badgeStyle }}
        >
          {run.badge}
        </div>
      )}
    </div>
  );
}

export default memo(ConsensusNodeImpl);
