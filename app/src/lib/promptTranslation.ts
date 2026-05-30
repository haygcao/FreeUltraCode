import { extractJsonObject, streamAnthropic } from '@/lib/anthropic';
import { aiEditViaCli, isTauri } from '@/lib/tauri';
import {
  localeAiName,
  type Locale,
} from '@/lib/i18n';

export interface TranslationSource {
  label?: string;
  text?: string;
}

export type TranslationMap = Partial<Record<Locale, TranslationSource>>;

export interface TranslatePromptOptions {
  apiKey?: string;
  model?: string;
  adapter?: string;
}

interface TranslationResponse {
  translations?: TranslationMap;
}

export async function translatePromptFields(
  source: TranslationSource,
  sourceLocale: Locale,
  targetLocales: Locale[],
  opts: TranslatePromptOptions = {},
): Promise<TranslationMap> {
  const targets = targetLocales.filter((locale) => locale !== sourceLocale);
  if (targets.length === 0) return {};
  if (!source.label && !source.text) {
    return Object.fromEntries(targets.map((locale) => [locale, { label: '', text: '' }])) as TranslationMap;
  }

  const request = {
    sourceLocale,
    sourceLanguage: localeAiName(sourceLocale),
    targetLocales: targets,
    targetLanguages: targets.map((locale) => localeAiName(locale)),
    source,
  };

  const system = [
    'You translate OpenWorkflow prompt-library strings.',
    'Translate faithfully, keeping meaning, tone, placeholders, model ids, code fragments, paths, and product names intact.',
    'Return ONLY a single valid JSON object with this shape:',
    '{ "translations": { "en-US": { "label": "...", "text": "..." } } }',
    'Only include the requested target locale keys. Use simplified Chinese for zh-CN.',
  ].join(' ');

  const userContent = JSON.stringify(request, null, 2);
  const full = await callTranslationModel(system, userContent, opts);
  const parsed = JSON.parse(extractJsonObject(full)) as TranslationResponse;
  const translations = parsed.translations ?? {};
  return Object.fromEntries(
    targets
      .map((locale) => [locale, translations[locale]])
      .filter((entry): entry is [Locale, TranslationSource] => !!entry[1]),
  ) as TranslationMap;
}

async function callTranslationModel(
  system: string,
  userContent: string,
  opts: TranslatePromptOptions,
): Promise<string> {
  const apiKey = opts.apiKey?.trim();
  if (apiKey) {
    return streamAnthropic({
      apiKey,
      model: opts.model,
      system,
      userContent,
      maxTokens: 2048,
    });
  }

  if (isTauri()) {
    const adapter = opts.adapter ?? 'claude-code';
    const prompt = `${system}\n\n${userContent}`;
    return aiEditViaCli(prompt, adapter, { permission: 'full', model: opts.model });
  }

  throw new Error('NO_TRANSLATION_BACKEND');
}
