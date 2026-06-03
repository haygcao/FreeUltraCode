/**
 * CONTRACT: language set + aliases for rehype-highlight (lowlight under the hood).
 *
 * `rehype-highlight` accepts a `languages` record (Record<string, LanguageFn>)
 * and builds its own lowlight instance internally; it does NOT take a prebuilt
 * lowlight instance. We register only the languages FreeUltraCode's AI output
 * actually emits (web + workflow scripting) so the highlighter stays ~30-40KB gz
 * instead of pulling highlight.js's full "common" bundle. Unknown languages fall
 * back to auto-detect / plain text — lowlight never throws on partial input.
 *
 *   HL_LANGUAGES -> pass as rehype-highlight `languages`
 *   HL_ALIASES   -> pass as rehype-highlight `aliases`
 */

import type { LanguageFn } from 'highlight.js';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

export const HL_LANGUAGES: Record<string, LanguageFn> = {
  bash,
  css,
  diff,
  javascript,
  json,
  markdown,
  python,
  rust,
  typescript,
  xml,
  yaml,
};

/** Common fence-info aliases the model emits → canonical registered ids. */
export const HL_ALIASES: Record<string, string | string[]> = {
  typescript: ['ts', 'tsx'],
  javascript: ['js', 'jsx', 'mjs', 'cjs'],
  bash: ['sh', 'shell', 'zsh'],
  python: ['py'],
  xml: ['html', 'svg', 'vue'],
  markdown: ['md'],
  yaml: ['yml'],
};
