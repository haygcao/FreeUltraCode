import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import AutoTextarea from '@/components/AutoTextarea';
import type { IRAgentSpec, IRNode, NodeType } from '@/core/ir';
import { t, type Locale } from '@/lib/i18n';

/**
 * CONTRACT: default export, no props. Node-properties editor surfaced by
 * PromptPanel when `selectedNodeId` is non-empty.
 *
 * Edits go directly to the store via `updateNodeLabel` / `updateNodeParams`,
 * so the canvas + emitter pick changes up on the next render. The "删除节点"
 * button calls `removeNode`, which also clears the selection.
 *
 * Per-type field schema (lightweight, matches the params shapes in
 * NODE_DEFAULTS):
 *   agent:     prompt (textarea) · model (haiku|sonnet|opus) · schema
 *   parallel:  over · prompt
 *   pipeline:  stages (comma list of agent ids — read-only hint)
 *   phase:     title
 *   branch:    condition
 *   loop:      until
 *   workflow:  name
 *   log:       message (msg alias)
 *   variable:  value (json)
 *   codeblock: code (textarea)
 *   start/end: no params
 */

const NODE_TYPE_OPTIONS: { id: NodeType; label: string }[] = [
  { id: 'start', label: 'Start' },
  { id: 'end', label: 'End' },
  { id: 'agent', label: 'Agent' },
  { id: 'parallel', label: 'Parallel' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'phase', label: 'Phase' },
  { id: 'branch', label: 'Branch' },
  { id: 'loop', label: 'Loop' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'log', label: 'Log' },
  { id: 'variable', label: 'Variable' },
  { id: 'codeblock', label: 'CodeBlock' },
];

const MODEL_OPTIONS = [
  { id: 'haiku', label: 'haiku' },
  { id: 'sonnet', label: 'sonnet' },
  { id: 'opus', label: 'opus' },
];

const fieldLabelClass =
  'mb-1 block text-[10px] font-medium uppercase tracking-wider text-fg-faint';
const textInputClass =
  'w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-xs text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-accent';
/** Class for AutoTextarea — height is managed by the component, not CSS. */
const autoTextareaClass = textInputClass + ' font-mono leading-relaxed';
const selectClass =
  'w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-xs text-fg outline-none transition-colors focus:border-accent';

/** Coerce arbitrary IRNode.params[key] into a string for an <input>/<textarea>. */
function asString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

/** Coerce a params value into IRAgentSpec[] (tolerating the legacy string[] form). */
function readSpecs(value: unknown): IRAgentSpec[] {
  if (!Array.isArray(value)) return [];
  return value.map((v): IRAgentSpec =>
    typeof v === 'string' ? { prompt: v } : { prompt: '', ...(v as object) },
  );
}

interface SpecListFieldProps {
  label: string;
  specs: IRAgentSpec[];
  onChange: (specs: IRAgentSpec[]) => void;
  addLabel: string;
  locale: Locale;
}

/** Editor for a list of agent specs (parallel branches / pipeline stages). */
function SpecListField({
  label,
  specs,
  onChange,
  addLabel,
  locale,
}: SpecListFieldProps) {
  const update = (i: number, patch: Partial<IRAgentSpec>) => {
    const next = specs.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange(next);
  };
  const remove = (i: number) => onChange(specs.filter((_, idx) => idx !== i));
  const add = () => onChange([...specs, { prompt: '' }]);

  return (
    <Field label={label}>
      <div className="flex flex-col gap-2">
        {specs.map((s, i) => (
          <div
            key={i}
            className="flex flex-col gap-1 rounded-md border border-border-soft bg-panel-2 p-2"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-fg-faint">#{i + 1}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-[11px] text-fg-faint hover:text-accent-4"
                title={t(locale, 'inspector.removeSpec')}
              >
                ×
              </button>
            </div>
            <AutoTextarea
              className={autoTextareaClass}
              value={asString(s.prompt)}
              onChange={(v) => update(i, { prompt: v })}
              placeholder={t(locale, 'inspector.subtaskPrompt')}
              minHeight={56}
            />
            <div className="flex gap-1">
              <input
                className={textInputClass}
                value={asString(s.agentType)}
                onChange={(e) => update(i, { agentType: e.target.value })}
                placeholder="agentType"
              />
              <input
                className={textInputClass}
                value={asString(s.schema)}
                onChange={(e) => update(i, { schema: e.target.value })}
                placeholder="schema"
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="rounded-md border border-border bg-panel-2 px-2 py-1 text-[11px] text-fg-dim transition-colors hover:border-accent hover:text-fg"
        >
          {addLabel}
        </button>
      </div>
    </Field>
  );
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

function Field({ label, children }: FieldProps) {
  return (
    <div>
      <label className={fieldLabelClass}>{label}</label>
      {children}
    </div>
  );
}

interface ParamFieldsProps {
  node: IRNode;
  onParam: (patch: Record<string, unknown>) => void;
  locale: Locale;
}

/** Render the type-specific params editor for a single node. */
function ParamFields({ node, onParam, locale }: ParamFieldsProps) {
  const p = node.params ?? {};

  switch (node.type) {
    case 'agent':
      return (
        <>
          <Field label="Prompt">
            <AutoTextarea
              className={autoTextareaClass}
              value={asString(p.prompt)}
              onChange={(v) => onParam({ prompt: v })}
              placeholder={t(locale, 'inspector.agentPromptPlaceholder')}
            />
          </Field>
          <Field label="Agent Type">
            <input
              className={textInputClass}
              value={asString(p.agentType ?? p.agent)}
              onChange={(e) => onParam({ agentType: e.target.value })}
              placeholder={t(locale, 'inspector.agentTypePlaceholder')}
            />
          </Field>
          <Field label="Model">
            <select
              className={selectClass}
              value={asString(p.model) || 'sonnet'}
              onChange={(e) => onParam({ model: e.target.value })}
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t(locale, 'inspector.schemaLabel')}>
            <input
              className={textInputClass}
              value={asString(p.schema)}
              onChange={(e) => onParam({ schema: e.target.value })}
              placeholder={t(locale, 'inspector.schemaPlaceholder')}
            />
          </Field>
        </>
      );

    case 'parallel':
      return (
        <SpecListField
          label={t(locale, 'inspector.branchesLabel')}
          specs={readSpecs(p.branches)}
          onChange={(branches) => onParam({ branches })}
          addLabel={t(locale, 'inspector.addBranch')}
          locale={locale}
        />
      );

    case 'pipeline':
      return (
        <>
          <Field label={t(locale, 'inspector.itemsLabel')}>
            <input
              className={textInputClass}
              value={asString(p.items) || 'args'}
              onChange={(e) => onParam({ items: e.target.value })}
              placeholder={t(locale, 'inspector.itemsPlaceholder')}
            />
          </Field>
          <SpecListField
            label={t(locale, 'inspector.stagesLabel')}
            specs={readSpecs(p.stages)}
            onChange={(stages) => onParam({ stages })}
            addLabel={t(locale, 'inspector.addStage')}
            locale={locale}
          />
        </>
      );

    case 'phase':
      return (
        <Field label="Title">
          <input
            className={textInputClass}
            value={asString(p.title)}
            onChange={(e) => onParam({ title: e.target.value })}
            placeholder={t(locale, 'inspector.phaseName')}
          />
        </Field>
      );

    case 'branch':
      return (
        <>
          <Field label={t(locale, 'inspector.ifCondition')}>
            <input
              className={textInputClass}
              value={asString(p.condition)}
              onChange={(e) => onParam({ condition: e.target.value })}
              placeholder={t(locale, 'inspector.conditionPlaceholder')}
            />
          </Field>
          <div className="text-[11px] text-fg-faint">
            {t(locale, 'inspector.branchHelp')}
          </div>
        </>
      );

    case 'loop':
      return (
        <>
          <Field label={t(locale, 'inspector.whileCondition')}>
            <input
              className={textInputClass}
              value={asString(p.condition ?? p.until)}
              onChange={(e) => onParam({ condition: e.target.value })}
              placeholder={t(locale, 'inspector.loopPlaceholder')}
            />
          </Field>
          <div className="text-[11px] text-fg-faint">
            {t(locale, 'inspector.loopHelp')}
          </div>
        </>
      );

    case 'workflow':
      return (
        <Field label="Name">
          <input
            className={textInputClass}
            value={asString(p.name)}
            onChange={(e) => onParam({ name: e.target.value })}
            placeholder={t(locale, 'inspector.workflowName')}
          />
        </Field>
      );

    case 'log': {
      // Accept both `message` (NODE_DEFAULTS) and legacy `msg` aliases.
      const key = 'message' in p ? 'message' : 'msg' in p ? 'msg' : 'message';
      return (
        <Field label="Message">
          <input
            className={textInputClass}
            value={asString(p[key])}
            onChange={(e) => onParam({ [key]: e.target.value })}
            placeholder={t(locale, 'inspector.logMessage')}
          />
        </Field>
      );
    }

    case 'variable':
      return (
        <Field label="Value (JSON)">
          <AutoTextarea
            className={autoTextareaClass}
            value={asString(p.value)}
            onChange={(raw) => {
              // Try to parse JSON; fall back to raw string so the field is
              // always editable even mid-typing.
              try {
                onParam({ value: JSON.parse(raw) });
              } catch {
                onParam({ value: raw });
              }
            }}
            placeholder='"hello" / 42 / { "k": 1 }'
          />
        </Field>
      );

    case 'codeblock':
      return (
        <Field label="Code">
          <AutoTextarea
            className={autoTextareaClass}
            value={asString(p.code)}
            onChange={(v) => onParam({ code: v })}
            placeholder="// code"
            maxHeight={360}
          />
        </Field>
      );

    case 'start':
    case 'end':
    default:
      return (
        <div className="text-[11px] text-fg-faint">
          {t(locale, 'inspector.noParams')}
        </div>
      );
  }
}

export default function NodeInspector() {
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const locale = useStore((s) => s.locale);
  const nodes = useStore((s) => s.workflow.nodes);
  const updateNodeLabel = useStore((s) => s.updateNodeLabel);
  const updateNodeParams = useStore((s) => s.updateNodeParams);
  const removeNode = useStore((s) => s.removeNode);
  const addNode = useStore((s) => s.addNode);
  const selectNode = useStore((s) => s.selectNode);

  const node = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  if (!node) {
    return (
      <div className="text-xs text-fg-dim">
        {t(locale, 'inspector.selectedNode')}
        <span className="font-mono text-fg">{selectedNodeId}</span>
        <div className="mt-1 text-fg-faint">
          {t(locale, 'inspector.nodeDeleted')}
        </div>
      </div>
    );
  }

  /**
   * Changing a node's type is destructive (params shape differs per type),
   * so we keep the IRGraph consistent by deleting the current node and
   * adding a fresh one of the new type, preserving the label.
   */
  const handleTypeChange = (nextType: NodeType) => {
    if (nextType === node.type) return;
    const label = node.label;
    const parent = node.parent;
    removeNode(node.id);
    const newId = addNode(nextType, undefined, parent);
    if (label) updateNodeLabel(newId, label);
    selectNode(newId);
  };

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-fg-faint">{node.id}</span>
      </div>

      <Field label="Label">
        <input
          className={textInputClass}
          value={node.label ?? ''}
          onChange={(e) => updateNodeLabel(node.id, e.target.value)}
          placeholder={t(locale, 'inspector.nodeLabel')}
        />
      </Field>

      <Field label="Type">
        <select
          className={selectClass}
          value={node.type}
          onChange={(e) => handleTypeChange(e.target.value as NodeType)}
        >
          {NODE_TYPE_OPTIONS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="my-1 border-t border-border-soft" />

      <div className="flex flex-col gap-3">
        <ParamFields
          node={node}
          locale={locale}
          onParam={(patch) => updateNodeParams(node.id, patch)}
        />
      </div>

      <div className="mt-2 border-t border-border-soft pt-3">
        <button
          type="button"
          onClick={() => removeNode(node.id)}
          className="w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 text-xs text-accent-4 transition-colors hover:border-accent-4 hover:bg-border-soft"
        >
          {t(locale, 'inspector.deleteNode')}
        </button>
      </div>
    </div>
  );
}
