/**
 * One-time localStorage migration for the OpenWorkflow → FreeUltraCode rebrand.
 *
 * The app was renamed from "OpenWorkflow"/`owf` to "FreeUltraCode"/`fuc`, which
 * changed every persisted key prefix from `owf_`/`owf-` to `fuc_`/`fuc-`. In the
 * packaged desktop app the webview storage is keyed by the (new) bundle
 * identifier so it starts fresh anyway, but in the browser/dev build the origin
 * is unchanged — without this shim a developer's autosaved workflow, API keys
 * and settings would silently vanish after the rename.
 *
 * Two legacy namespaces existed pre-rename and are both migrated here:
 *   - prefix style:  `owf_*` / `owf-*`            -> `fuc_*` / `fuc-*`
 *   - dotted style:  `openworkflow.<rest>`        -> `freeultracode.<rest>`
 *     (appearance, composer, history, locale, panel widths, prompt groups, …)
 *
 * Each legacy entry is copied to its new counterpart (without clobbering a
 * value the new build already wrote) exactly once, guarded by a sentinel. It
 * runs as an import side effect and MUST be imported before any module that
 * reads localStorage (e.g. the store seed).
 */

// v2: also migrates the dotted `openworkflow.*` namespace (v1 only did owf_/owf-).
const SENTINEL = 'fuc_legacy_owf_migrated_v2';

function migrateLegacyStorage(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem(SENTINEL)) return;

    // Snapshot keys first — we mutate localStorage while iterating.
    const legacyKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.startsWith('owf_') ||
          key.startsWith('owf-') ||
          key.startsWith('openworkflow.'))
      ) {
        legacyKeys.push(key);
      }
    }

    for (const oldKey of legacyKeys) {
      let newKey: string;
      if (oldKey.startsWith('owf_')) newKey = `fuc_${oldKey.slice(4)}`;
      else if (oldKey.startsWith('owf-')) newKey = `fuc-${oldKey.slice(4)}`;
      else newKey = `freeultracode.${oldKey.slice('openworkflow.'.length)}`;
      // Don't overwrite a value the rebranded build already persisted.
      if (localStorage.getItem(newKey) !== null) continue;
      const value = localStorage.getItem(oldKey);
      if (value !== null) localStorage.setItem(newKey, value);
    }

    localStorage.setItem(SENTINEL, '1');
  } catch {
    /* storage disabled / quota — nothing we can do, fail silently */
  }
}

migrateLegacyStorage();
