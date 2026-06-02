import type { ReactNode } from 'react';

/**
 * Component chrome for the glassmorphic blueprint node cards: the gradient
 * header strip and the flat body sub-rows. The accent color is the only
 * per-type variable.
 *
 * Pure helpers (accent tokens, wrapper class/style builders) live in the
 * JSX-free sibling {@link ./cardStyle} so React Fast Refresh keeps working.
 */

/** Gradient header strip with a glyph, a label, and an optional right-aligned meta chip. */
export function CardHeader({
  accent,
  glyph,
  label,
  meta,
}: {
  accent: string;
  glyph: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-t-2xl px-3.5 py-2 text-[10.5px] font-semibold uppercase tracking-[0.07em]"
      style={{
        background: `linear-gradient(135deg, ${accent} 0%, var(--header-tail) 100%)`,
        color: 'var(--header-fg)',
        borderBottom: '1px solid var(--node-border)',
      }}
    >
      <span aria-hidden>{glyph}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta != null && (
        <span className="ml-auto shrink-0 font-mono text-[10px] normal-case opacity-80">
          {meta}
        </span>
      )}
    </div>
  );
}

/** A flat body sub-row (parallel branch / pipeline stage / consensus voter). */
export function SubChip({
  accent,
  children,
}: {
  accent: string;
  children: ReactNode;
}) {
  return (
    <div
      className="whitespace-normal break-words rounded-md px-2 py-1 font-mono text-[10px] leading-[1.3]"
      style={{
        background: 'color-mix(in oklab, var(--panel-2) 70%, transparent)',
        color: 'var(--fg-dim)',
        boxShadow: 'inset 0 0 0 1px var(--border-soft)',
        borderLeft: `2px solid ${accent}`,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Small floating chip marking a node that will trigger run-time divergence
 * voting (the 2→4→8→16 escalation): ⚡ for a complex node, ⧿ for a terminal
 * (tail / self-test) node. Positioned top-right, just below the run-state badge
 * slot. Title gives the human explanation on hover.
 */
export function VotingBadge({
  kind,
  title,
}: {
  kind: 'terminal' | 'complex';
  title: string;
}) {
  return (
    <div
      aria-label={`voting-${kind}`}
      title={title}
      style={{
        position: 'absolute',
        top: 6,
        right: 30,
        zIndex: 5,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: '1px 5px',
        borderRadius: 999,
        fontSize: 9,
        fontWeight: 600,
        lineHeight: 1.4,
        color: 'var(--header-fg)',
        background:
          kind === 'terminal'
            ? 'color-mix(in oklab, var(--accent-3) 85%, transparent)'
            : 'color-mix(in oklab, var(--accent-2) 85%, transparent)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
      }}
    >
      {kind === 'terminal' ? '⧿' : '⚡'}
    </div>
  );
}
