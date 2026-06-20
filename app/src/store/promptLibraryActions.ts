// ARCHITECTURAL CONSTRAINT — do not break the import cycle.
// This module is NOT a Zustand slice (no createXxxSlice(set, get) factory). It is
// a call-time *actions* module: it imports `useStore` from './useStore' while
// './useStore' imports the action functions from here, forming a deliberate
// import cycle. The cycle is only safe because every reference below is used
// EXCLUSIVELY inside function bodies (evaluated after the store is fully built),
// never at module-eval time.
//
// RULES (enforced by convention — ESLint cannot detect module-eval-time usage):
//   1. NEVER reference any './useStore' import at module top-level (no
//      `const x = useStore.getState()`, no calling an imported helper outside a
//      function body). A single such line silently yields `undefined` at startup.
//   2. This file must only be imported by './useStore' (enforced via
//      no-restricted-imports in .eslintrc.cjs) so the cycle stays a single edge.
//   3. If you need slice-style state ownership, convert this to a real
//      createXxxSlice(set, get) in a *Slice.ts file instead of extending the cycle.
// Extracted verbatim from useStore.ts (the contiguous prompt-library CRUD block).

// --- store internals (the cycle edge; used only inside function bodies) ---
import { useStore } from './useStore';
import type { StoreState } from './storeState';

// --- types ---
import type { PromptItem } from './types';
import type { GatewaySelection } from '@/core/ir';

// --- same-dir / lib leaf imports ---
import { samplePromptGroups, PROMPT_DEFAULTS_VERSION } from './sampleSessions';
import { savePromptGroups, savePromptGroupsVersion } from '@/lib/composerStorage';
import {
  localizePromptGroup,
  localizePromptItem,
  SUPPORTED_LOCALES,
  withPromptGroupLocale,
  withPromptItemLocale,
  type Locale,
} from '@/lib/i18n';
import { shortId } from '@/lib/id';
import { translatePromptFields } from '@/lib/promptTranslation';
import { resolveDirectGatewayRoute } from '@/lib/modelGateway/modelGateway';
import { workflowDefaultGatewaySelection } from '@/lib/modelGateway/resolver';
import { readApiKey, readBaseUrl } from '@/lib/apiConfig';

/**
 * Gateway options used when auto-translating prompt-library labels/text. Reads
 * the workflow's default coding/text selection + the active composer model and
 * resolves a direct API route (key/base/model/adapter) for translatePromptFields.
 */
export function promptTranslationGatewayOptions(state: StoreState): {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  adapter?: string;
  selection?: GatewaySelection;
} {
  const selection = workflowDefaultGatewaySelection(
    state.workflow,
    state.composer.model,
  );
  const direct = resolveDirectGatewayRoute(selection);
  return {
    selection,
    apiKey: (direct?.apiKey ?? readApiKey()) || undefined,
    baseUrl: (direct?.baseUrl ?? readBaseUrl()) || undefined,
    model: direct?.model ?? selection.modelClass,
    adapter: direct?.adapter ?? selection.adapter,
  };
}

// ── Prompt-library CRUD ────────────────────────────────────────────────
//
// Every mutating action computes the next promptGroups array, persists it via
// savePromptGroups(next), and commits it to the store. Edits therefore survive
// a reload (loadPromptGroups seeds the store on init).

export function addPromptItem(
  groupId: string,
  label: string,
  text: string,
  locale?: Locale,
): void {
  const resolvedLocale = locale ?? useStore.getState().locale;
  useStore.setState((state) => {
    const next = state.promptGroups.map((g) =>
      g.id === groupId
        ? {
            ...g,
            items: [
              ...g.items,
              withPromptItemLocale(
                { id: shortId('pi'), label, text },
                resolvedLocale,
                { label, text },
              ),
            ],
          }
        : g,
    );
    savePromptGroups(next);
    return { promptGroups: next };
  });
}

export function updatePromptItem(
  groupId: string,
  itemId: string,
  patch: Partial<PromptItem>,
): void {
  useStore.setState((state) => {
    const locale = state.locale;
    const next = state.promptGroups.map((g) =>
      g.id === groupId
        ? {
            ...g,
            items: g.items.map((it) =>
              it.id === itemId
                ? withPromptItemLocale(it, locale, {
                    label:
                      typeof patch.label === 'string'
                        ? patch.label
                        : localizePromptItem(it, locale).label,
                    text:
                      typeof patch.text === 'string'
                        ? patch.text
                        : localizePromptItem(it, locale).text,
                  })
                : it,
            ),
          }
        : g,
    );
    savePromptGroups(next);
    return { promptGroups: next };
  });
}

export async function updatePromptItemLocalized(
  groupId: string,
  itemId: string,
  patch: Partial<PromptItem>,
  locale?: Locale,
): Promise<boolean> {
  const state = useStore.getState();
  const sourceLocale = locale ?? state.locale;
  const group = state.promptGroups.find((g) => g.id === groupId);
  const item = group?.items.find((it) => it.id === itemId);
  if (!group || !item) return false;

  const current = localizePromptItem(item, sourceLocale);
  const sourceValue = {
    label: typeof patch.label === 'string' ? patch.label : current.label,
    text: typeof patch.text === 'string' ? patch.text : current.text,
  };

  let next = state.promptGroups.map((g) =>
    g.id === groupId
      ? {
          ...g,
          items: g.items.map((it) =>
            it.id === itemId
              ? withPromptItemLocale(it, sourceLocale, sourceValue)
              : it,
          ),
        }
      : g,
  );
  savePromptGroups(next);
  useStore.setState({ promptGroups: next });

  if (!state.promptAutoTranslate) return false;

  const targetLocales = SUPPORTED_LOCALES.filter(
    (value): value is Locale => value !== sourceLocale,
  );
  try {
    const translated = await translatePromptFields(
      sourceValue,
      sourceLocale,
      targetLocales,
      promptTranslationGatewayOptions(state),
    );
    const translatedLocales = Object.entries(translated) as [
      Locale,
      { label: string; text: string },
    ][];
    if (translatedLocales.length > 0) {
      next = useStore.getState().promptGroups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              items: g.items.map((it) =>
                it.id === itemId
                  ? translatedLocales.reduce(
                      (acc, [localeKey, value]) =>
                        withPromptItemLocale(acc, localeKey, value),
                      it,
                    )
                  : it,
              ),
            }
          : g,
      );
      savePromptGroups(next);
      useStore.setState({ promptGroups: next });
    }
    return translatedLocales.length > 0;
  } catch {
    return false;
  }
}

export function removePromptItem(groupId: string, itemId: string): void {
  useStore.setState((state) => {
    const next = state.promptGroups.map((g) =>
      g.id === groupId
        ? { ...g, items: g.items.filter((it) => it.id !== itemId) }
        : g,
    );
    savePromptGroups(next);
    return { promptGroups: next };
  });
}

export function addPromptGroup(label: string, locale?: Locale): string {
  const resolvedLocale = locale ?? useStore.getState().locale;
  const id = shortId('pg');
  useStore.setState((state) => {
    const next = [
      ...state.promptGroups,
      withPromptGroupLocale({ id, label, items: [] }, resolvedLocale, { label }),
    ];
    savePromptGroups(next);
    return { promptGroups: next };
  });
  return id;
}

export function updatePromptGroup(groupId: string, label: string): void {
  useStore.setState((state) => {
    const locale = state.locale;
    const next = state.promptGroups.map((g) =>
      g.id === groupId
        ? withPromptGroupLocale(g, locale, {
            label:
              typeof label === 'string'
                ? label
                : localizePromptGroup(g, locale).label,
          })
        : g,
    );
    savePromptGroups(next);
    return { promptGroups: next };
  });
}

export async function updatePromptGroupLocalized(
  groupId: string,
  label: string,
  locale?: Locale,
): Promise<boolean> {
  const state = useStore.getState();
  const sourceLocale = locale ?? state.locale;
  const group = state.promptGroups.find((g) => g.id === groupId);
  if (!group) return false;

  const current = localizePromptGroup(group, sourceLocale);
  const sourceLabel = typeof label === 'string' ? label : current.label;

  let next = state.promptGroups.map((g) =>
    g.id === groupId
      ? withPromptGroupLocale(g, sourceLocale, { label: sourceLabel })
      : g,
  );
  savePromptGroups(next);
  useStore.setState({ promptGroups: next });

  if (!state.promptAutoTranslate) return false;

  const targetLocales = SUPPORTED_LOCALES.filter(
    (value): value is Locale => value !== sourceLocale,
  );
  try {
    const translated = await translatePromptFields(
      { label: sourceLabel },
      sourceLocale,
      targetLocales,
      promptTranslationGatewayOptions(state),
    );
    const translatedLocales = Object.entries(translated) as [
      Locale,
      { label?: string; text?: string },
    ][];
    if (translatedLocales.length > 0) {
      next = useStore.getState().promptGroups.map((g) =>
        g.id === groupId
          ? translatedLocales.reduce(
              (acc, [localeKey, value]) =>
                withPromptGroupLocale(acc, localeKey, {
                  label: value.label || sourceLabel,
                }),
              g,
            )
          : g,
      );
      savePromptGroups(next);
      useStore.setState({ promptGroups: next });
    }
    return translatedLocales.length > 0;
  } catch {
    return false;
  }
}

export function removePromptGroup(groupId: string): void {
  useStore.setState((state) => {
    const next = state.promptGroups.filter((g) => g.id !== groupId);
    savePromptGroups(next);
    return { promptGroups: next };
  });
}

export function resetPromptGroups(): void {
  useStore.setState(() => {
    const next = samplePromptGroups;
    savePromptGroups(next);
    savePromptGroupsVersion(PROMPT_DEFAULTS_VERSION);
    return { promptGroups: next };
  });
}
