// M4: compile-time-enforced load/save pairing for persisted fields.
//
// The persistence layer (lib/composerStorage.ts, lib/appearanceStorage.ts) is a
// set of hand-written load*/save* pairs with NO compiler link between the two
// sides — historically nothing stopped a new persisted field shipping a load
// without its save (so the field silently never persisted), or vice versa.
//
// This module closes that gap with a tiny typed registry. A field is declared
// via `persistedField({ load, save })`, which REQUIRES both halves and infers
// the stored type T from `load`'s return so `save` must accept the exact same T.
// Registering a field with only one side, or with mismatched types, is a
// compile error. `definePersistedFields` then assembles a registry whose keys
// are checked against a caller-supplied shape, so a new persisted store field
// cannot be added to the registry without its load+save pair.
//
// This is intentionally a thin, dependency-free wrapper around the existing
// storage functions — it does not change where bytes are written, only forces
// the two sides to be declared together and type-checked against each other.

/** A persisted field is exactly a matched (load, save) pair over one type T. */
export interface PersistedField<T> {
  /** Read the persisted value (or its default when absent/invalid). */
  load: () => T;
  /** Write the value back. Must accept the SAME T that `load` returns. */
  save: (value: T) => void;
}

/**
 * Declare one persisted field. Both `load` and `save` are mandatory, and the
 * stored type T is inferred from `load`'s return type, so `save` is forced to
 * accept exactly that type. Omitting either half — or letting their types drift
 * apart — fails to compile.
 */
export function persistedField<T>(field: {
  load: () => T;
  save: (value: T) => void;
}): PersistedField<T> {
  return field;
}

/** Pull the stored value type back out of a PersistedField. */
export type PersistedValue<F> = F extends PersistedField<infer T> ? T : never;

/**
 * Assemble a registry of persisted fields keyed by name. `Shape` pins the set of
 * keys and their value types (typically `Pick<StoreState, ...>` of the persisted
 * slice). The mapped type forces every key in `Shape` to have a matching
 * `PersistedField` whose T equals that key's value type — so you cannot register
 * a field whose load/save type disagrees with the state field it persists, and
 * (because the map is exact) you cannot forget a key either.
 */
export type PersistedRegistry<Shape> = {
  [K in keyof Shape]: PersistedField<Shape[K]>;
};

export function definePersistedFields<Shape>(
  registry: PersistedRegistry<Shape>,
): PersistedRegistry<Shape> {
  return registry;
}

/** Load every field in a registry into a plain `{ [key]: value }` object. */
export function loadPersistedFields<Shape>(
  registry: PersistedRegistry<Shape>,
): Shape {
  const out = {} as Shape;
  for (const key of Object.keys(registry) as (keyof Shape)[]) {
    out[key] = registry[key].load();
  }
  return out;
}
