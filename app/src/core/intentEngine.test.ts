import { describe, expect, it } from 'vitest';
import { defaultBlueprint } from './defaultBlueprint';
import { applyIntent } from './intentEngine';

describe('applyIntent consensus conversion', () => {
  it('converts a numbered agent node to consensus in place', () => {
    const ir = defaultBlueprint('Intent conversion');
    const beforeEdges = ir.edges;
    const beforeLayout = ir.layout;

    const result = applyIntent(ir, '将 #1 节点转为共识节点');

    expect(result.changed).toBe(true);
    expect(result.ir.nodes.map((node) => node.id)).toEqual(
      ir.nodes.map((node) => node.id),
    );
    expect(result.ir.edges).toEqual(beforeEdges);
    expect(result.ir.layout).toEqual(beforeLayout);
    const converted = result.ir.nodes.find((node) => node.id === 'n_step1');
    expect(converted?.type).toBe('consensus');
    expect(Array.isArray(converted?.params.voters)).toBe(true);
    expect((converted?.params.voters as unknown[]).length).toBeGreaterThan(0);
  });
});
