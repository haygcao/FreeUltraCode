import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { IRPort } from '@/core/ir';
import type { FlowNodeData } from '@/canvas/irToFlow';
import { t } from '@/lib/i18n';
import { DataIn, DataOut, ExecIn, ExecOut } from './handles';
import { NodeNumberBadge } from './NodeNumberBadge';
import { BADGE_BASE_STYLE, runStateVisual } from './runStateStyles';
import { CardHeader } from './cardChrome';
import { ACCENT_CONTROL, cardClass, cardWrapperStyle } from './cardStyle';

/**
 * Composite node — the fourth container kind. It declares typed input/output
 * ports (`params.inputs` / `params.outputs`, each an {@link IRPort}); its body
 * is the set of child nodes whose `parent === composite.id`, edited by drilling
 * in (double-click → enterComposite).
 *
 * Pins:
 *   - exec in/out (▶) at top=26 — the execution body entry/exit.
 *   - one data-in (●) per `params.inputs[i]`, id = port.id, stacked on the left.
 *   - one data-out (●) per `params.outputs[i]`, id = port.id, stacked right.
 *
 * The Handle ids match the IR port ids so the boundary data edges produced by
 * the parser/store (`OUTER → COMPOSITE.<inputId>`, `COMPOSITE.<outputId> →
 * DOWNSTREAM`) attach correctly via {@link toFlowEdge}.
 *
 * Accent token: `--accent-3` (shared with branch/loop container family).
 */

/** Vertical layout for stacked data pins. */
const PIN_TOP_BASE = 60;
const PIN_TOP_STEP = 18;

function readPorts(value: unknown, direction: 'in' | 'out'): IRPort[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (p): p is IRPort =>
      !!p &&
      typeof p === 'object' &&
      typeof (p as IRPort).id === 'string' &&
      (p as IRPort).direction === direction,
  );
}

function CompositeNodeImpl({ data, selected }: NodeProps) {
  const d = data as FlowNodeData;
  const params = d.params ?? {};
  const inputs = readPorts(params.inputs, 'in');
  const outputs = readPorts(params.outputs, 'out');

  const run = runStateVisual(d.runState);
  const { accent, ambient } = ACCENT_CONTROL;

  // Reserve enough height for the tallest pin column so stacked pins stay on the
  // card body rather than overflowing past the bottom edge.
  const pinRows = Math.max(inputs.length, outputs.length);
  const minHeight = PIN_TOP_BASE + pinRows * PIN_TOP_STEP + 16;

  return (
    <div
      className={`${cardClass(!!selected)} min-w-[200px]`}
      style={{
        ...cardWrapperStyle({ accent, ambient, selected: !!selected, run }),
        minHeight,
      }}
    >
      <NodeNumberBadge value={d.numberLabel} accent={accent} />

      <CardHeader
        accent={accent}
        glyph="▣"
        label={t(d.locale, 'nodeType.composite')}
        meta={`${inputs.length}→${outputs.length}`}
      />

      <div className="px-3.5 pb-3 pt-2">
        <div className="truncate text-sm font-medium text-fg">
          {d.label || t(d.locale, 'nodeType.composite')}
        </div>
        <div className="mt-1 font-mono text-[10px] text-fg-faint">
          {t(d.locale, 'inspector.openSubgraph')}
        </div>
      </div>

      {/* Exec body entry/exit. */}
      <ExecIn id="exec_in" top={26} />
      <ExecOut id="exec_out" top={26} />

      {/* One data pin per declared port; Handle id === IRPort.id. */}
      {inputs.map((port, i) => (
        <DataIn key={port.id} id={port.id} top={PIN_TOP_BASE + i * PIN_TOP_STEP} />
      ))}
      {outputs.map((port, i) => (
        <DataOut key={port.id} id={port.id} top={PIN_TOP_BASE + i * PIN_TOP_STEP} />
      ))}

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

export default memo(CompositeNodeImpl);
