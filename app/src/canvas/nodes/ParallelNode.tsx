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
 * Parallel node — a `parallel(items.map(...))` fan-out / fan-in.
 *
 * Pins: exec in/out (▶), data in (over[] ●), data out (results[] ●).
 *
 * Accent token: `--accent-2` (parallel).
 *
 * Run state: see {@link runStateVisual} for the status palette.
 */
function ParallelNodeImpl({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const params = d.params ?? {};
  // Branches are structured specs; tolerate the legacy `string[]` form too.
  const branches: string[] = Array.isArray(params.branches)
    ? (params.branches as (string | IRAgentSpec)[]).map((b) =>
        typeof b === 'string' ? b : b.label || b.agentType || b.prompt || 'branch',
      )
    : [];

  const run = runStateVisual(d.runState);
  const { accent, ambient } = ACCENT_PARALLEL;

  return (
    <div
      className={`${cardClass(!!selected)} min-w-[190px] max-w-[260px]`}
      style={cardWrapperStyle({ accent, ambient, selected: !!selected, run })}
    >
      <NodeNumberBadge value={d.numberLabel} accent={accent} />

      <CardHeader accent={accent} glyph="⇶" label={t(d.locale, 'nodeType.parallel')} />

      {/* Body */}
      <div className="px-3.5 pb-3 pt-2">
        <div className="text-sm font-medium text-fg">{d.label}</div>
        {branches.length > 0 ? (
          <div className="mt-1.5 flex flex-col gap-1">
            {branches.map((b, i) => (
              <SubChip key={i} accent={accent}>
                {b}
              </SubChip>
            ))}
          </div>
        ) : (
          <div className="mt-1 font-mono text-[10px] text-fg-faint">over[] → results[]</div>
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

export default memo(ParallelNodeImpl);
