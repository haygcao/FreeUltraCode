import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { FlowNodeData } from '@/canvas/irToFlow';
import { t } from '@/lib/i18n';
import { readStartUserInputs } from '@/core/startInputs';
import { ExecIn, ExecOut } from './handles';
import { BADGE_BASE_STYLE, runStateVisual } from './runStateStyles';
import { CardHeader } from './cardChrome';
import { ACCENT_CONTROL, ACCENT_END, cardClass, cardWrapperStyle } from './cardStyle';

/**
 * Control node — the `start` / `end` flow terminals.
 *
 * Pins:
 *   - start: exec out (▶) only — the script entry point.
 *   - end:   exec in (▶) only — the `return`.
 *
 * Accent tokens: `--accent-3` (start), `--accent-4` (end).
 */
function ControlNodeImpl({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const isStart = d.irType === 'start';
  const { accent, ambient } = isStart ? ACCENT_CONTROL : ACCENT_END;
  const glyph = isStart ? '⏵' : '⏹';
  const startInputs = isStart ? readStartUserInputs(d.params) : [];
  const hasStartInputs = startInputs.length > 0;
  // Simple-workflow nodes (meta.simple) drop the "Start" name entirely — the
  // node is just a nameless container for the user's inputs.
  const nameless = isStart && d.simple === true;
  const startName = nameless ? '' : (d.label ?? t(d.locale, 'nodeType.start'));
  // Show all inputs — node size adapts via CSS (max-width + break-words)

  const run = runStateVisual(d.runState);

  // A simple-workflow node with no inputs yet renders nothing — the canvas
  // stays empty until the user sends something (the node still exists in the
  // graph so inputs can accumulate, it's just invisible while empty).
  if (nameless && !hasStartInputs) return null;

  if (hasStartInputs) {
    return (
      <div
        className={`${cardClass(!!selected)} inline-flex w-fit min-w-[220px] max-w-[420px] flex-col`}
        style={cardWrapperStyle({ accent, ambient, selected: !!selected, run })}
        title={startInputs.join('\n\n')}
      >
        <CardHeader
          accent={accent}
          glyph={glyph}
          label={startName}
          meta={startInputs.length}
        />

        <div className="flex min-w-0 flex-col gap-1 px-3.5 pb-3 pt-2">
          {startInputs.map((input, index) => (
            <div
              key={`${index}-${input.slice(0, 24)}`}
              className="break-words whitespace-pre-wrap rounded bg-panel-2 px-2 py-1 text-[10px] leading-4 text-fg-dim"
            >
              {input}
            </div>
          ))}
        </div>

        <ExecOut id="exec_out" top={24} />

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

  return (
    <div
      className={`${cardClass(!!selected)} flex min-w-[110px] items-center gap-2 rounded-full px-4 py-2`}
      style={cardWrapperStyle({ accent, ambient, selected: !!selected, run, pill: true })}
    >
      <span
        className="text-sm font-semibold"
        style={{ color: accent }}
        aria-hidden
      >
        {glyph}
      </span>
      {!nameless && (
        <span className="text-sm font-medium" style={{ color: accent }}>
          {d.label ?? (isStart ? t(d.locale, 'nodeType.start') : t(d.locale, 'nodeType.end'))}
        </span>
      )}

      {/* Pins: start exposes exec_out only; end exposes exec_in only. */}
      {isStart ? <ExecOut id="exec_out" /> : <ExecIn id="exec_in" />}

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

export default memo(ControlNodeImpl);
