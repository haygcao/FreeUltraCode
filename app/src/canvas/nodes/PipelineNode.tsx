import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { IRAgentSpec } from '@/core/ir';
import type { FlowNodeData } from '@/canvas/irToFlow';
import { t } from '@/lib/i18n';
import { DataIn, DataOut, ExecIn, ExecOut } from './handles';
import { NodeNumberBadge } from './NodeNumberBadge';
import { BADGE_BASE_STYLE, runStateVisual } from './runStateStyles';
import { CardHeader, SubChip } from './cardChrome';
import { ACCENT_PARALLEL, cardClass, cardWrapperStyle } from './cardStyle';

/**
 * Pipeline node — a `pipeline(items, stage1, stage2, …)` run.
 *
 * Shows the input expression and one row per stage callback.
 * Accent token: `--accent-2`.
 */
function PipelineNodeImpl({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const params = d.params ?? {};
  const items = typeof params.items === 'string' ? params.items : 'args';
  const stages: IRAgentSpec[] = Array.isArray(params.stages)
    ? (params.stages as IRAgentSpec[])
    : [];

  const run = runStateVisual(d.runState);
  const { accent, ambient } = ACCENT_PARALLEL;

  return (
    <div
      className={`${cardClass(!!selected)} min-w-[210px]`}
      style={cardWrapperStyle({ accent, ambient, selected: !!selected, run })}
    >
      <NodeNumberBadge value={d.numberLabel} accent={accent} />

      <CardHeader accent={accent} glyph="⛓" label={t(d.locale, 'nodeType.pipeline')} />

      <div className="px-3.5 pb-3 pt-2">
        <div className="text-sm font-medium text-fg">{d.label}</div>
        <div className="mt-1 font-mono text-[10px] text-fg-faint">over {items}</div>
        {stages.length > 0 ? (
          <div className="mt-1.5 flex flex-col gap-1">
            {stages.map((s, i) => (
              <SubChip key={i} accent={accent}>
                {i + 1}. {(s.label ?? s.prompt ?? 'stage').slice(0, 28)}
              </SubChip>
            ))}
          </div>
        ) : (
          <div className="mt-1 font-mono text-[10px] text-fg-faint">no stages</div>
        )}
      </div>

      <ExecIn id="exec_in" top={26} />
      <ExecOut id="exec_out" top={26} />
      <DataIn id="data_in" top={62} />
      <DataOut id="data_out" top={62} />

      {run && (
        <div aria-label={`run-state-${d.runState}`} style={{ ...BADGE_BASE_STYLE, ...run.badgeStyle }}>
          {run.badge}
        </div>
      )}
    </div>
  );
}

export default memo(PipelineNodeImpl);
