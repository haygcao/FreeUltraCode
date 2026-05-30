import { useCallback, useMemo, useState } from 'react';
import { useReactFlow, useStore as useRFStore } from '@xyflow/react';
import { useStore } from '@/store/useStore';
import { emitClaudeScript } from '@/core/emitter';
import { interactionSampleBlueprint } from '@/core/interactionSample';
import { t, type Locale } from '@/lib/i18n';

/**
 * Canvas toolbar that sits above the blueprint graph (design doc section 6).
 *
 * Left:  workflow name + autosave hint · live run-progress badge when running.
 * Right: runtime-adapter switch · live zoom % (click to fit) · Script ·
 *        Run / Resume / Stop (mode-aware). While `mode === 'running'` the run
 *        button flips to a stop button that cancels active CLI invocations.
 *
 * MUST render inside a <ReactFlowProvider> — it reads the live viewport zoom
 * and drives zoomIn/zoomOut/fitView through the React Flow instance.
 */

const ADAPTERS: { id: string; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini', label: 'Gemini' },
];

export default function CanvasToolbar() {
  const workflow = useStore((s) => s.workflow);
  const locale = useStore((s) => s.locale);
  const setAdapter = useStore((s) => s.setAdapter);
  const setWorkflow = useStore((s) => s.setWorkflow);
  const runWorkflow = useStore((s) => s.runWorkflow);
  const resumeWorkflow = useStore((s) => s.resumeWorkflow);
  const stopWorkflow = useStore((s) => s.stopWorkflow);
  const dirty = useStore((s) => s.dirty);
  const currentFilePath = useStore((s) => s.currentFilePath);
  const mode = useStore((s) => s.mode);
  const runState = useStore((s) => s.runState);
  const lastRunFailedNodeId = useStore((s) => s.lastRunFailedNodeId);

  const { zoomIn, zoomOut, fitView } = useReactFlow();
  // Live zoom factor straight from the React Flow transform.
  const zoom = useRFStore((s) => s.transform[2]);
  const zoomPct = Math.round((zoom ?? 1) * 100);

  const adapter = workflow.meta.adapter ?? 'claude-code';
  const adapterLabel =
    ADAPTERS.find((a) => a.id === adapter)?.label ?? adapter;

  const [adapterOpen, setAdapterOpen] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);

  const script = useMemo(
    () => (scriptOpen ? safeEmit(workflow, locale) : ''),
    [scriptOpen, workflow, locale],
  );

  const copyScript = useCallback(() => {
    if (script) void navigator.clipboard?.writeText(script);
  }, [script]);

  // Derive a compact run-progress summary from runState so the badge can show
  // success / error / running counts at a glance.
  const runStats = useMemo(() => {
    const values = Object.values(runState);
    return {
      total: values.length,
      running: values.filter((v) => v === 'running').length,
      success: values.filter((v) => v === 'success').length,
      error: values.filter((v) => v === 'error').length,
      interrupted: values.filter((v) => v === 'interrupted').length,
    };
  }, [runState]);

  const running = mode === 'running';
  const canResume =
    !running &&
    (!!lastRunFailedNodeId ||
      Object.values(runState).some(
        (state) => state === 'error' || state === 'interrupted',
      ));

  return (
    <div className="flex items-center gap-2.5 border-b border-border-soft bg-bg-alt px-3 py-2.5">
      {/* Left: workflow title + autosave */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-accent">⎇</span>
        <span className="truncate text-[13px] font-semibold text-fg">
          {workflow.meta.name ?? 'untitled'}
        </span>
        <span
          className={
            'shrink-0 text-[11px] ' +
            (dirty ? 'text-accent-3' : 'text-fg-faint')
          }
          title={currentFilePath ?? t(locale, 'canvas.unsavedTitle')}
        >
          · {dirty ? t(locale, 'canvas.unsaved') : t(locale, 'canvas.savedJustNow')}
        </span>
        {running && (
          <span
            className="ml-2 flex shrink-0 items-center gap-1.5 rounded-md border border-accent-2/40 bg-accent-2/10 px-2 py-0.5 text-[11px] font-mono text-accent-2"
            title={t(locale, 'canvas.runProgress')}
          >
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent-2" />
            <span>
              ✓{runStats.success}
              {runStats.error > 0 && (
                <span className="ml-1 text-[#f78b8b]">✗{runStats.error}</span>
              )}
              {runStats.interrupted > 0 && (
                <span className="ml-1 text-[#d995a6]">!{runStats.interrupted}</span>
              )}
              {runStats.running > 0 && (
                <span className="ml-1 text-accent-3">▸{runStats.running}</span>
              )}
            </span>
          </span>
        )}
      </div>

      {/* Runtime adapter switch */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setAdapterOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent-2 hover:text-fg"
          title={t(locale, 'canvas.switchRuntime')}
        >
          <span className="text-accent-2">▣</span>
          <span className="font-mono">{adapterLabel}</span>
          <span className="text-fg-faint">▾</span>
        </button>
        {adapterOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-md border border-border bg-panel shadow-lg">
            {ADAPTERS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setAdapter(a.id);
                  setAdapterOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-panel-2 ${
                  a.id === adapter ? 'text-accent-2' : 'text-fg-dim'
                }`}
              >
                <span className="w-3">{a.id === adapter ? '✓' : ''}</span>
                <span className="font-mono">{a.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Zoom control */}
      <div className="flex items-center rounded-md border border-border bg-panel-2 text-xs text-fg-dim">
        <button
          type="button"
          onClick={() => void zoomOut()}
          className="px-2 py-1.5 transition-colors hover:text-fg"
          title={t(locale, 'canvas.zoomOut')}
        >
          −
        </button>
        <button
          type="button"
          onClick={() => void fitView({ padding: 0.25, duration: 200 })}
          className="min-w-[44px] border-x border-border px-1 py-1.5 text-center font-mono transition-colors hover:text-fg"
          title={t(locale, 'canvas.fitView')}
        >
          {zoomPct}%
        </button>
        <button
          type="button"
          onClick={() => void zoomIn()}
          className="px-2 py-1.5 transition-colors hover:text-fg"
          title={t(locale, 'canvas.zoomIn')}
        >
          +
        </button>
      </div>

      {/* Sample — load the interaction demo workflow for quick testing. */}
      <button
        type="button"
        onClick={() => setWorkflow(interactionSampleBlueprint())}
        disabled={running}
        className="flex items-center gap-1.5 rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent-3 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        title={t(locale, 'canvas.sampleTitle')}
      >
        <span className="text-accent-3">✦</span>
        <span>{t(locale, 'canvas.sample')}</span>
      </button>

      {/* Script */}
      <button
        type="button"
        onClick={() => setScriptOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-panel-2 px-2.5 py-1.5 text-xs text-fg-dim transition-colors hover:border-accent hover:text-fg"
        title={t(locale, 'canvas.viewScript')}
      >
        <span className="text-fg-dim">{'</>'}</span>
        <span>{t(locale, 'canvas.script')}</span>
      </button>

      {/* Run / Stop — flips appearance + behavior based on mode. While running,
          clicking stops the run by flipping back to design mode; the run loop
          watches `mode` and bails out on the next step. */}
      {running ? (
        <button
          type="button"
          onClick={() => stopWorkflow()}
          className="flex items-center gap-1.5 rounded-md border border-[#f778ba]/40 bg-[#f778ba]/15 px-3 py-1.5 text-xs font-semibold text-[#f778ba] transition-opacity hover:opacity-90"
          title={t(locale, 'canvas.stopTitle')}
        >
          <span className="inline-block h-2 w-2 animate-pulse rounded-sm bg-[#f778ba]" />
          <span>{t(locale, 'canvas.runningStop')}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => (canResume ? resumeWorkflow() : runWorkflow())}
          className={
            canResume
              ? 'flex items-center gap-1.5 rounded-md border border-accent-3/50 bg-accent-3/15 px-3 py-1.5 text-xs font-semibold text-accent-3 transition-opacity hover:opacity-90'
              : 'flex items-center gap-1.5 rounded-md bg-accent-2 px-3 py-1.5 text-xs font-semibold text-[#06231d] transition-opacity hover:opacity-90'
          }
          title={canResume ? t(locale, 'canvas.resumeTitle') : t(locale, 'canvas.runTitle')}
        >
          <span>{canResume ? '↻' : '▶'}</span>
          <span>{canResume ? t(locale, 'canvas.resume') : t(locale, 'canvas.run')}</span>
        </button>
      )}

      {scriptOpen && (
        <ScriptModal
          script={script}
          adapterLabel={adapterLabel}
          locale={locale}
          onCopy={copyScript}
          onClose={() => setScriptOpen(false)}
        />
      )}
    </div>
  );
}

/** Generate the script defensively — never let an emitter error blank the UI. */
function safeEmit(
  workflow: Parameters<typeof emitClaudeScript>[0],
  locale: Locale,
): string {
  try {
    return emitClaudeScript(workflow);
  } catch (err) {
    return `// ${t(locale, 'canvas.scriptError')}: ${(err as Error).message}`;
  }
}

function ScriptModal({
  script,
  adapterLabel,
  locale,
  onCopy,
  onClose,
}: {
  script: string;
  adapterLabel: string;
  locale: Locale;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border-soft px-4 py-3">
          <span className="text-fg-dim">{'</>'}</span>
          <span className="text-[13px] font-semibold text-fg">
            {t(locale, 'canvas.generatedScript')}
          </span>
          <span className="font-mono text-[11px] text-fg-faint">
            {adapterLabel}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onCopy}
            className="rounded-md border border-border bg-panel-2 px-2.5 py-1 text-xs text-fg-dim transition-colors hover:text-fg"
          >
            {t(locale, 'common.copy')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs text-fg-faint transition-colors hover:text-fg"
          >
            {t(locale, 'common.close')}
          </button>
        </div>
        <pre className="overflow-auto bg-[#010409] px-4 py-3 font-mono text-[12.5px] leading-relaxed text-[#c9d1d9]">
          <code>{script}</code>
        </pre>
      </div>
    </div>
  );
}
