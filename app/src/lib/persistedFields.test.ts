// M4: behaviour + type-contract coverage for the persisted-field registry.
// The runtime tests prove load/save round-trip and loadPersistedFields; the
// `// @ts-expect-error` blocks are the real point — they fail the build if the
// compile-time load/save pairing ever stops being enforced.
import { describe, expect, it, vi } from 'vitest';
import {
  definePersistedFields,
  loadPersistedFields,
  persistedField,
  type PersistedValue,
} from './persistedFields';

describe('persistedField', () => {
  it('returns the matched load/save pair as-is', () => {
    const load = () => 7;
    const save = vi.fn();
    const field = persistedField({ load, save });
    expect(field.load()).toBe(7);
    field.save(42);
    expect(save).toHaveBeenCalledWith(42);
  });

  it('PersistedValue extracts the stored type', () => {
    const field = persistedField({ load: () => 'hi', save: () => {} });
    // type-level assertion: PersistedValue<typeof field> must be string
    const v: PersistedValue<typeof field> = field.load();
    expect(typeof v).toBe('string');
  });
});

describe('definePersistedFields + loadPersistedFields', () => {
  type Shape = { count: number; name: string };

  it('loads every field into a plain object', () => {
    const registry = definePersistedFields<Shape>({
      count: { load: () => 3, save: () => {} },
      name: { load: () => 'kiro', save: () => {} },
    });
    expect(loadPersistedFields(registry)).toEqual({ count: 3, name: 'kiro' });
  });

  it('routes saves through the registry entries', () => {
    const saveCount = vi.fn();
    const registry = definePersistedFields<Shape>({
      count: { load: () => 0, save: saveCount },
      name: { load: () => '', save: () => {} },
    });
    registry.count.save(99);
    expect(saveCount).toHaveBeenCalledWith(99);
  });
});

describe('compile-time enforcement (type-level)', () => {
  it('rejects a registry entry missing the save half', () => {
    definePersistedFields<{ x: number }>({
      // @ts-expect-error — a persisted field MUST declare save, not just load
      x: { load: () => 1 },
    });
    expect(true).toBe(true);
  });

  it('rejects a save whose type disagrees with load', () => {
    definePersistedFields<{ x: number }>({
      // @ts-expect-error — save must accept the same type load returns (number)
      x: { load: () => 1, save: (v: string) => void v },
    });
    expect(true).toBe(true);
  });

  it('rejects a missing key from the declared shape', () => {
    // @ts-expect-error — `y` is declared in the shape but absent from the registry
    definePersistedFields<{ y: number }>({});
    expect(true).toBe(true);
  });
});
