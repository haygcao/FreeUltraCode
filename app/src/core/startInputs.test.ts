/**
 * Tests for the Start-node helpers: user-input capture (existing) and the
 * AI-generation provenance stamp (quantity-for-quality surfacing).
 */
import { describe, expect, it } from 'vitest';
import { EXEC, type IRGraph } from './ir';
import {
  appendStartUserInputs,
  hasGenerationProvenance,
  readGenerationProvenance,
  readStartUserInputs,
  setGenerationProvenance,
  type GenProvenance,
} from './startInputs';

function baseGraph(): IRGraph {
  return {
    version: 1,
    meta: { name: 't' },
    nodes: [
      { id: 'n_start', type: 'start', label: 'Start', params: {} },
      { id: 'a', type: 'agent', label: 'A', params: { prompt: 'x' } },
      { id: 'n_end', type: 'end', label: 'End', params: {} },
    ],
    edges: [
      { id: 'e1', from: { node: 'n_start', port: 'o' }, to: { node: 'a', port: 'i' }, kind: EXEC },
      { id: 'e2', from: { node: 'a', port: 'o' }, to: { node: 'n_end', port: 'i' }, kind: EXEC },
    ],
  };
}

describe('hasGenerationProvenance', () => {
  it('is false for null / empty, true for any non-null field', () => {
    expect(hasGenerationProvenance(null)).toBe(false);
    expect(hasGenerationProvenance({})).toBe(false);
    expect(hasGenerationProvenance({ candidates: 3 })).toBe(true);
    expect(hasGenerationProvenance({ at: 0 })).toBe(true); // 0 is a real value
  });
});

describe('setGenerationProvenance', () => {
  it('stamps provenance onto the Start node, readable back', () => {
    const prov: GenProvenance = { candidates: 3, candidatesValid: 2, upgradedNodes: 1 };
    const out = setGenerationProvenance(baseGraph(), prov);
    const start = out.nodes.find((n) => n.type === 'start')!;
    expect(readGenerationProvenance(start.params)).toEqual(prov);
  });

  it('is a no-op for empty provenance (returns the same graph reference)', () => {
    const g = baseGraph();
    expect(setGenerationProvenance(g, {})).toBe(g);
  });

  it('returns the graph unchanged when there is no Start node', () => {
    const g: IRGraph = { ...baseGraph(), nodes: baseGraph().nodes.filter((n) => n.type !== 'start') };
    expect(setGenerationProvenance(g, { candidates: 2 })).toBe(g);
  });

  it('does not disturb existing Start user inputs', () => {
    const withInputs = appendStartUserInputs(baseGraph(), ['build me a thing']);
    const out = setGenerationProvenance(withInputs, { candidates: 2 });
    const start = out.nodes.find((n) => n.type === 'start')!;
    expect(readStartUserInputs(start.params)).toEqual(['build me a thing']);
    expect(readGenerationProvenance(start.params)?.candidates).toBe(2);
  });

  it('provenance does not leak into readStartUserInputs', () => {
    const out = setGenerationProvenance(baseGraph(), { candidates: 5 });
    const start = out.nodes.find((n) => n.type === 'start')!;
    expect(readStartUserInputs(start.params)).toEqual([]);
  });
});
