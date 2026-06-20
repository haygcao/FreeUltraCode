// Shared slash command / skill catalog model.
//
// CONTRACT: This module owns the *data* layer for slash commands and skills so
// that the inline `/` suggestion menu (AIDock) and the read-only Commands list
// (SettingsModal) never drift. Interaction concerns (trigger detection, adapter
// scoping, top-N filtering) deliberately stay in AIDock; everything here is a
// pure transform over the backend slash catalog plus the app-only static
// entries the catalog does not enumerate.
import type { Locale } from '@/lib/i18n';
import type { SlashCatalogEntry } from '@/lib/tauri';
import type { RuntimeAdapterId } from '@/lib/adapters';
import { GAME_SKILLS } from '@/lib/gameSkillRegistry';
import type { GameSkillCommand } from '@/lib/gameSkill';

export type SlashSuggestionKind = 'command' | 'skill';
export type SlashSourceAdapter = RuntimeAdapterId | 'app' | 'agent';

export interface StaticSlashEntry {
  id: string;
  kind: SlashSuggestionKind;
  name: string;
  label: Partial<Record<Locale, string>>;
  detail: Partial<Record<Locale, string>>;
  insertText: Partial<Record<Locale, string>>;
  source?: string | null;
  sourceAdapter?: SlashSourceAdapter | null;
}

export interface SlashSuggestion {
  id: string;
  kind: SlashSuggestionKind;
  name: string;
  label: string;
  detail: string;
  insertText: string;
  source?: string | null;
  sourceAdapter?: SlashSourceAdapter | null;
  searchText: string;
}

// Generic prompt shortcuts. These are NOT GameSkills — they are generic CLI
// semantics, not introduced by this app — so they are defined inline and are
// intentionally excluded from the GameSkill registry and the project Commands
// allowlists below.
const GENERIC_PROMPT_SHORTCUTS: GameSkillCommand[] = [
  {
    name: '/help',
    label: { 'zh-CN': '帮助', 'en-US': 'Help' },
    detail: { 'zh-CN': '列出当前可用 command / skill', 'en-US': 'List available commands and skills' },
    text: {
      'zh-CN': '列出当前可用的 slash command 和 Skill，按用途分组，并给出每个条目的触发词和适用场景。',
      'en-US': 'List the available slash commands and skills, grouped by use case, with each trigger and when to use it.',
    },
  },
  {
    name: '/plan',
    label: { 'zh-CN': '计划', 'en-US': 'Plan' },
    detail: { 'zh-CN': '先拆步骤，再执行', 'en-US': 'Break down steps before acting' },
    text: {
      'zh-CN': '先给出简短执行计划，再按计划完成任务；只保留必要步骤和风险点。',
      'en-US': 'Start with a short execution plan, then complete the task; keep only necessary steps and risks.',
    },
  },
  {
    name: '/diagnose',
    label: { 'zh-CN': '诊断', 'en-US': 'Diagnose' },
    detail: { 'zh-CN': '复现 -> 根因 -> 修复 -> 验证', 'en-US': 'Reproduce -> root cause -> fix -> verify' },
    text: {
      'zh-CN': '诊断这个问题：先复现或定位触发条件，再找根因，最后给出修复和验证结果。',
      'en-US': 'Diagnose this: reproduce or identify the trigger, find the root cause, then provide the fix and verification.',
    },
  },
  {
    name: '/review',
    label: { 'zh-CN': '审查', 'en-US': 'Review' },
    detail: { 'zh-CN': '按代码审查视角找风险', 'en-US': 'Review for bugs and risks' },
    text: {
      'zh-CN': '按代码审查视角检查：优先列出 bug、回归风险和缺失测试，给出文件/位置和修复建议。',
      'en-US': 'Review this as code: list bugs, regression risks, and missing tests first, with file/location references and fixes.',
    },
  },
  {
    name: '/explain',
    label: { 'zh-CN': '解释', 'en-US': 'Explain' },
    detail: { 'zh-CN': '解释执行路径和关键依赖', 'en-US': 'Explain flow and dependencies' },
    text: {
      'zh-CN': '解释这段内容的执行路径、关键依赖和容易误解的点，结论先行。',
      'en-US': 'Explain the execution flow, key dependencies, and easy-to-misread parts. Start with the conclusion.',
    },
  },
  {
    name: '/test',
    label: { 'zh-CN': '测试', 'en-US': 'Test' },
    detail: { 'zh-CN': '补充或运行相关测试', 'en-US': 'Add or run relevant tests' },
    text: {
      'zh-CN': '为当前任务补充或运行最相关的测试；若失败，说明失败点、可能根因和下一步。',
      'en-US': 'Add or run the most relevant tests for this task; if they fail, report the failure, likely cause, and next step.',
    },
  },
];

// GAME_SKILL_COMMANDS = the GameSkill registry projected to the runtime data
// shape. The GameSkill class hierarchy (gameSkill.ts + gameSkillRegistry.ts) is
// the single source of truth for every FreeUltraCode-introduced command and its
// standard six-part protocol; this array is a pure projection over it.
//
// CONTRACT: GameSkills are surfaced through both the generic `/` menu and the
// faster `#游戏Skill` trigger. `/` is the global command surface; `#` is the
// narrow app-curated GameSkill surface for faster discovery.
export const GAME_SKILL_COMMANDS: GameSkillCommand[] = GAME_SKILLS.map((skill) =>
  skill.toCommand(),
);

// SLASH_COMMANDS keeps the full data set (GameSkills + generic shortcuts) so
// callers that look a command up by name (e.g. the /deep-research expansion at
// submit time) keep resolving regardless of which menu surfaces the command.
export const SLASH_COMMANDS: GameSkillCommand[] = [
  ...GAME_SKILL_COMMANDS,
  ...GENERIC_PROMPT_SHORTCUTS,
];

function toStaticSlashEntry(command: GameSkillCommand): StaticSlashEntry {
  return {
    id: `command:${command.name}`,
    kind: 'command',
    name: command.name,
    label: command.label,
    detail: command.detail,
    insertText: command.text,
    source: 'app',
    sourceAdapter: 'app',
  };
}

// STATIC_SLASH_ENTRIES backs the `/` menu fallback / fold-in. It includes the
// app-defined GameSkills plus generic prompt shortcuts so `/` remains the full
// global command surface even when the backend catalog is missing app entries.
export const STATIC_SLASH_ENTRIES: StaticSlashEntry[] = [
  ...GAME_SKILL_COMMANDS.map(toStaticSlashEntry),
  ...GENERIC_PROMPT_SHORTCUTS.map(toStaticSlashEntry),
];

// GAME_SKILL_STATIC_ENTRIES backs the `#游戏Skill` menu and the read-only
// Commands lists in Settings / Project Settings.
export const GAME_SKILL_STATIC_ENTRIES: StaticSlashEntry[] =
  GAME_SKILL_COMMANDS.map(toStaticSlashEntry);

// FreeUltraCode-specific commands surfaced in the global Settings > Commands tab.
//
// CONTRACT: This is a curated allowlist, NOT everything in SLASH_COMMANDS. The
// inline `/` menu intentionally also offers generic prompt shortcuts (/plan,
// /review, /diagnose, ...) and whatever the backend slash catalog discovers
// (CLI commands, user skills), but the Commands tab is a reference for the
// non-game features that ship with and are unique to this app. Game-specific
// commands live under Project Settings > Commands so non-game projects do not
// advertise game-only flows. /image-to-game is intentionally also listed here
// because it is a reusable reference-image analysis workflow, not tied to a
// detected game workspace.
export const PROJECT_COMMAND_NAMES = [
  '/ultracode',
  '/deep-research',
  '/image-to-game',
  '/music',
  '/music-mode-start',
  '/music-mode-end',
  '/image-mode-start',
  '/image-mode-end',
  '/video-to-frames',
  '/comfyui-mode-start',
  '/comfyui-mode-end',
  '/worldmodel',
  '/worldmodel-mode-start',
  '/worldmodel-mode-end',
  '/screenshot',
  '/screenshot-gif',
] as const;

// Game-only slash commands surfaced under Project Settings > Commands. Grouped
// by feature to mirror the project sidebar tabs (Game Experts, Mesh, online
// model library, Sprite, UI). Sprite lives here (not in PROJECT_COMMAND_NAMES)
// because the Sprite tab is gated behind game projects in GAME_FEATURE_TABS.
export const GAME_PROJECT_COMMAND_NAMES = [
  '/game',
  '/image-to-game',
  '/mesh-mode-start',
  '/mesh-mode-end',
  '/mesh-search',
  '/sprite',
  '/sprite-mode-start',
  '/sprite-mode-end',
  '/blueprint-mode-start',
  '/blueprint-mode-end',
  '/metahuman-mode-start',
  '/metahuman-mode-end',
  '/ui-mode-start',
  '/ui-mode-end',
] as const;

const PROJECT_COMMAND_NAME_SET: ReadonlySet<string> = new Set(
  PROJECT_COMMAND_NAMES.map((name) => name.toLowerCase()),
);

const GAME_PROJECT_COMMAND_NAME_SET: ReadonlySet<string> = new Set(
  GAME_PROJECT_COMMAND_NAMES.map((name) => name.toLowerCase()),
);

export function isProjectCommandName(name: string): boolean {
  return PROJECT_COMMAND_NAME_SET.has(name.trim().toLowerCase());
}

export function isGameProjectCommandName(name: string): boolean {
  return GAME_PROJECT_COMMAND_NAME_SET.has(name.trim().toLowerCase());
}

export function slashText(
  value: Partial<Record<Locale, string>> | Record<string, string | undefined>,
  locale: Locale,
): string {
  return value[locale] ?? value['en-US'] ?? value['zh-CN'] ?? '';
}

function normalizeSlashSourceAdapter(value: unknown): SlashSourceAdapter | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'claude' || normalized === 'anthropic') {
    return 'claude-code';
  }
  if (
    normalized === 'claude-code' ||
    normalized === 'codex' ||
    normalized === 'gemini' ||
    normalized === 'app' ||
    normalized === 'agent'
  ) {
    return normalized;
  }
  return null;
}

function slashSourceAdapterFromPath(value: unknown): SlashSourceAdapter | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const source = value.replace(/\\/g, '/').toLowerCase();
  if (source.includes('/.claude/')) return 'claude-code';
  if (source.includes('/.codex/')) return 'codex';
  if (source.includes('/.gemini/')) return 'gemini';
  if (source.includes('/.agents/')) return 'agent';
  return null;
}

export function slashEntrySourceAdapter(
  entry: StaticSlashEntry | SlashCatalogEntry,
): SlashSourceAdapter | null {
  const direct = normalizeSlashSourceAdapter(
    (entry as { sourceAdapter?: string | null }).sourceAdapter,
  );
  if (direct) return direct;

  const source = entry.source ?? '';
  const fromSource =
    normalizeSlashSourceAdapter(source) ?? slashSourceAdapterFromPath(source);
  if (fromSource) return fromSource;

  const idSource = /^(?:command|skill):([^:]+):/.exec(entry.id)?.[1];
  return (
    normalizeSlashSourceAdapter(idSource) ??
    slashSourceAdapterFromPath(entry.id)
  );
}

// App-implemented commands live in STATIC_SLASH_ENTRIES. The Tauri backend slash
// catalog is authoritative for CLI/skill commands but does not enumerate these
// app features, so when it returns a catalog we must still fold in any app-only
// static entry it lacks — otherwise these commands silently vanish from the `/`
// suggestion menu in the desktop build.
export function withAppOnlyStaticEntries(
  catalogEntries: SlashCatalogEntry[],
): (SlashCatalogEntry | StaticSlashEntry)[] {
  const present = new Set(
    catalogEntries.map((entry) => entry.name.trim().toLowerCase()),
  );
  const missing = STATIC_SLASH_ENTRIES.filter(
    (entry) => !present.has(entry.name.trim().toLowerCase()),
  );
  return [...catalogEntries, ...missing];
}

function mapEntryToSuggestion(
  entry: SlashCatalogEntry | StaticSlashEntry,
  locale: Locale,
): SlashSuggestion {
  const label = slashText(entry.label, locale);
  const detail = slashText(entry.detail, locale);
  const insertText = slashText(entry.insertText, locale);
  const source = entry.source ?? '';
  const sourceAdapter = slashEntrySourceAdapter(entry);
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    label,
    detail,
    insertText,
    source,
    sourceAdapter,
    searchText:
      `${entry.name} ${label} ${detail} ${insertText} ${source} ${
        sourceAdapter ?? ''
      }`.toLowerCase(),
  };
}

function dedupeSuggestions(
  entries: (SlashCatalogEntry | StaticSlashEntry)[],
  locale: Locale,
): SlashSuggestion[] {
  const seen = new Set<string>();
  const out: SlashSuggestion[] = [];
  for (const entry of entries) {
    const source = entry.source ?? '';
    const key = `${entry.kind}:${source || entry.id}:${entry.name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapEntryToSuggestion(entry, locale));
  }
  return out;
}

export function buildSlashSuggestions(
  catalogEntries: SlashCatalogEntry[],
  locale: Locale,
): SlashSuggestion[] {
  const entries: (SlashCatalogEntry | StaticSlashEntry)[] =
    catalogEntries.length > 0
      ? withAppOnlyStaticEntries(catalogEntries)
      : STATIC_SLASH_ENTRIES;
  return dedupeSuggestions(entries, locale);
}

// GameSkill suggestions powering the `#游戏Skill` menu (AIDock) and the
// read-only Commands lists in Settings / Project Settings. Always sourced from
// the GameSkill registry; independent of the backend slash catalog.
export function buildGameSkillSuggestions(locale: Locale): SlashSuggestion[] {
  return dedupeSuggestions(GAME_SKILL_STATIC_ENTRIES, locale);
}
