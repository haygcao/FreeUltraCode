// CONTRACT: disk-backed store for the small "generation settings" blobs (image,
// video, music, 3D, speech). It exists to lift these settings off the browser's
// ~5MB localStorage quota: in the Tauri desktop shell they are persisted to disk
// under `.freeultracode/settings/*.json` via the same atomic history commands the
// session store uses, while the browser/dev build falls back to localStorage.
//
// The hard problem is that every `load*Settings()` is SYNCHRONOUS (called inside
// `useState(() => load())` initializers) but Tauri `invoke` is async. We solve it
// exactly like `secureStorage.ts`: at boot we `await` a one-time load of every
// known settings file into an in-memory cache, then serve reads synchronously and
// write back to disk asynchronously (write-behind). localStorage is always kept as
// a synchronous mirror so the cache can be rebuilt and the browser path just works.

import { tauriAvailable } from '@/lib/tauri';

/** Every settings file managed by this store, as `(relPath, legacyLocalStorageKey)`. */
const MANAGED_SETTINGS: ReadonlyArray<readonly [relPath: string, legacyKey: string]> = [
  ['settings/imageGeneration.v1.json', 'freeultracode.imageGeneration.v1'],
  ['settings/videoGeneration.v1.json', 'freeultracode.videoGeneration.v1'],
  ['settings/musicGeneration.v1.json', 'freeultracode.musicGeneration.v1'],
  ['settings/threeDGeneration.v1.json', 'freeultracode.threeDGeneration.v1'],
  ['settings/speechGeneration.v1.json', 'freeultracode.speechGeneration.v1'],
];

// relPath -> serialized JSON. Authoritative in-memory view once `diskReady`.
const cache = new Map<string, string>();
let diskReady = false;

async function getInvoke() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke;
}

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

function localGet(key: string): string | null {
  if (!hasLocalStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function localSet(key: string, value: string): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage may be full — non-fatal here because disk is the source of
    // truth under Tauri. The synchronous writeSettingsRaw return value already
    // tells the caller whether the durable write (disk or localStorage) landed.
  }
}

async function diskRead(relPath: string): Promise<string | null> {
  if (!tauriAvailable()) return null;
  try {
    const invoke = await getInvoke();
    return await invoke<string | null>('history_read_json', { relPath });
  } catch (err) {
    console.warn('[generationSettings] disk read failed', relPath, err);
    return null;
  }
}

function diskWriteSoon(relPath: string, json: string): void {
  if (!tauriAvailable()) return;
  void (async () => {
    try {
      const invoke = await getInvoke();
      await invoke<void>('history_write_json', { relPath, json });
    } catch (err) {
      console.error('[generationSettings] disk write failed', relPath, err);
    }
  })();
}

/**
 * Boot-time load. For each managed file: read from disk into the cache. If the
 * disk has nothing yet but a legacy localStorage value exists, migrate it to
 * disk once. Must be awaited before the first synchronous `load*Settings()`.
 */
export async function initializeGenerationSettingsStore(): Promise<void> {
  if (diskReady) return;
  if (!tauriAvailable()) {
    // Browser/dev: nothing to preload; reads/writes go straight to localStorage.
    return;
  }
  await Promise.all(
    MANAGED_SETTINGS.map(async ([relPath, legacyKey]) => {
      const fromDisk = await diskRead(relPath);
      if (fromDisk != null) {
        cache.set(relPath, fromDisk);
        // Keep the localStorage mirror in sync so the browser fallback and any
        // synchronous reader see the same value.
        localSet(legacyKey, fromDisk);
        return;
      }
      // One-time migration: seed disk from the legacy localStorage value.
      const legacy = localGet(legacyKey);
      if (legacy != null) {
        cache.set(relPath, legacy);
        diskWriteSoon(relPath, legacy);
      }
    }),
  );
  diskReady = true;
}

/**
 * Synchronous read. Under Tauri prefer the in-memory cache (populated at boot),
 * falling back to the localStorage mirror; in the browser read localStorage.
 */
export function readSettingsRaw(relPath: string, legacyKey: string): string | null {
  if (tauriAvailable()) {
    const cached = cache.get(relPath);
    if (cached != null) return cached;
  }
  return localGet(legacyKey);
}

/**
 * Synchronous write. Updates the in-memory cache and the localStorage mirror, and
 * schedules an async disk write under Tauri. Returns true when the value was
 * durably accepted (cache+disk under Tauri, or localStorage in the browser),
 * false only when the sole available sink (browser localStorage) rejected it.
 */
export function writeSettingsRaw(relPath: string, legacyKey: string, json: string): boolean {
  if (tauriAvailable()) {
    cache.set(relPath, json);
    localSet(legacyKey, json); // best-effort mirror; disk is the source of truth
    diskWriteSoon(relPath, json);
    return true;
  }
  // Browser/dev: localStorage is the only durable sink, so surface failures.
  if (!hasLocalStorage()) return false;
  try {
    window.localStorage.setItem(legacyKey, json);
    return true;
  } catch (err) {
    console.error('[generationSettings] localStorage write failed', legacyKey, err);
    return false;
  }
}

/** Test-only: reset the in-memory state between cases. */
export function resetGenerationSettingsStoreForTests(): void {
  cache.clear();
  diskReady = false;
}
