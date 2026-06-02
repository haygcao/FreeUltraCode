import { describe, expect, it } from 'vitest';
import { emitClaudeScript } from './emitter';
import { parseClaudeScript } from './parser';
import { roundtrip } from './roundtrip';
import { compositeSingleSample, compositeNestedSample } from './fixtures';

describe('composite emission', () => {
  it('emits a local async function declaration + call site for a composite', () => {
    const script = emitClaudeScript(compositeSingleSample);

    // Definition annotations carry the authoritative id + declared ports.
    expect(script).toContain('// @composite c1');
    expect(script).toContain('// @ports in=in_topic:topic out=out_summary:summary');
    // Function name is anchored to the call var; param derives from the input port label.
    expect(script).toContain('async function __composite_');
    // Single declared output → annotated return.
    expect(script).toContain('// @return out_summary');
    // Call site is annotated with the composite node id.
    expect(script).toContain('// @node c1');
  });
});

describe('composite round-trip (emit → parse → emit)', () => {
  it('is structurally lossless and idempotent for a single in/out composite', () => {
    const report = roundtrip(compositeSingleSample);
    expect(report.diffs).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.idempotent).toBe(true);
  });

  it('is structurally lossless and idempotent for a nested composite', () => {
    const report = roundtrip(compositeNestedSample);
    expect(report.diffs).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.idempotent).toBe(true);
  });

  it('recovers the composite node (type/parent) and skips no body node', () => {
    const reparsed = parseClaudeScript(emitClaudeScript(compositeSingleSample));
    const c1 = reparsed.nodes.find((n) => n.id === 'c1');
    expect(c1?.type).toBe('composite');
    // Body children carry parent === composite id.
    expect(reparsed.nodes.find((n) => n.id === 'a1')?.parent).toBe('c1');
    expect(reparsed.nodes.find((n) => n.id === 'a2')?.parent).toBe('c1');
    // No stray codeblock leaked from the function declaration.
    expect(reparsed.nodes.some((n) => n.type === 'codeblock')).toBe(false);
  });
});
