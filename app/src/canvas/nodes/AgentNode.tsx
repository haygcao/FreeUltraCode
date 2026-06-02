import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { FlowNodeData } from '@/canvas/irToFlow';
import { t } from '@/lib/i18n';
import { DataIn, DataOut, ExecIn, ExecOut } from './handles';
import { NodeNumberBadge } from './NodeNumberBadge';
import { BADGE_BASE_STYLE, runStateVisual } from './runStateStyles';
import { CardHeader, VotingBadge } from './cardChrome';
import { ACCENT_AGENT, cardClass, cardWrapperStyle } from './cardStyle';

/**
 * Agent node — an `agent(prompt, opts)` invocation.
 *
 * Pins (matching the IR sample / design doc):
 *   exec in/out (▶), data in (prompt/model/channel/schema ●), data out (result ●).
 *
 * Accent token: `--accent` (agent).
 *
 * Run state: when `data.runState` is present and non-`idle`, the wrapper
 * border + corner badge reflect the live status (running / success / error).
 */
function AgentNodeImpl({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const params = d.params ?? {};
  // Prefer the real `agentType` option; fall back to the legacy `agent` key.
  const agent =
    typeof params.agentType === 'string'
      ? params.agentType
      : typeof params.agent === 'string'
        ? params.agent
        : undefined;
  const gateway =
    typeof params.gateway === 'object' && params.gateway !== null
      ? (params.gateway as Record<string, unknown>)
      : null;
  const model =
    typeof gateway?.modelClass === 'string'
      ? gateway.modelClass
      : typeof params.model === 'string'
        ? params.model
        : undefined;

  const run = runStateVisual(d.runState);
  const { accent, ambient } = ACCENT_AGENT;

  return (
    <div
      className={`${cardClass(!!selected)} min-w-[180px]`}
      style={cardWrapperStyle({ accent, ambient, selected: !!selected, run })}
    >
      <NodeNumberBadge value={d.numberLabel} accent={accent} />

      {d.voting && (
        <VotingBadge
          kind={d.voting}
          title={`${t(
            d.locale,
            d.voting === 'terminal'
              ? 'inspector.votingMarker.terminal'
              : 'inspector.votingMarker.complex',
          )} · ${t(d.locale, 'inspector.votingMarker.willVote')}`}
        />
      )}

      <CardHeader accent={accent} glyph="▶" label={t(d.locale, 'nodeType.agent')} />

      {/* Body */}
      <div className="px-3.5 pb-3 pt-2">
        <div className="text-sm font-medium text-fg">{d.label}</div>
        {(agent || model) && (
          <div className="mt-1 font-mono text-[10px] text-fg-dim">
            {agent}
            {agent && model ? ' · ' : ''}
            {model}
          </div>
        )}
        <div className="mt-2 flex flex-col gap-1 text-[10px] text-fg-faint">
          <span>● prompt / model / channel / schema</span>
          <span>● result</span>
        </div>
      </div>

      {/* Pins */}
      <ExecIn id="exec_in" top={26} />
      <ExecOut id="exec_out" top={26} />
      <DataIn id="data_in" top={74} />
      <DataOut id="data_out" top={92} />

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

export default memo(AgentNodeImpl);
