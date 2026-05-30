import { useEffect, useState, type ReactNode } from 'react';
import {
  Keyboard,
  Palette,
  Settings as SettingsIcon,
  SlidersHorizontal,
  SquareTerminal,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  LANGUAGE_SELECT_OPTIONS,
  localizeSelectOption,
  t,
  type Locale,
  type TranslationKey,
} from '@/lib/i18n';
import { useStore } from '@/store/useStore';

type SettingsTab = 'general' | 'shortcuts' | 'runtime' | 'appearance' | 'advanced';
type LanguageOption = (typeof LANGUAGE_SELECT_OPTIONS)[number];

const tabs: { id: SettingsTab; labelKey: TranslationKey; Icon: LucideIcon }[] = [
  { id: 'general', labelKey: 'settings.tabs.general', Icon: SlidersHorizontal },
  { id: 'shortcuts', labelKey: 'settings.tabs.shortcuts', Icon: Keyboard },
  { id: 'runtime', labelKey: 'settings.tabs.runtime', Icon: SquareTerminal },
  { id: 'appearance', labelKey: 'settings.tabs.appearance', Icon: Palette },
  { id: 'advanced', labelKey: 'settings.tabs.advanced', Icon: Wrench },
];

const placeholderCopy: Record<
  Exclude<SettingsTab, 'general' | 'shortcuts'>,
  { titleKey: TranslationKey; descriptionKey: TranslationKey }
> = {
  runtime: {
    titleKey: 'settings.runtimeTitle',
    descriptionKey: 'settings.runtimeDescription',
  },
  appearance: {
    titleKey: 'settings.appearanceTitle',
    descriptionKey: 'settings.appearanceDescription',
  },
  advanced: {
    titleKey: 'settings.advancedTitle',
    descriptionKey: 'settings.advancedDescription',
  },
};

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTab>('general');
  const locale = useStore((s) => s.locale);
  const setLocale = useStore((s) => s.setLocale);
  const promptAutoTranslate = useStore((s) => s.promptAutoTranslate);
  const setPromptAutoTranslate = useStore((s) => s.setPromptAutoTranslate);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const languageOptions = LANGUAGE_SELECT_OPTIONS.map((option) =>
    localizeSelectOption(option, locale),
  );
  const targetLanguages = languageOptions.filter(
    (option) => option.id !== locale,
  );
  const panelId = `settings-panel-${tab}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex h-[86vh] w-[calc(100vw-2rem)] max-w-[980px] max-h-[660px] flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl sm:w-[calc(100vw-3rem)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border-soft bg-bg-alt px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-bg">
              <SettingsIcon size={18} strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="settings-title" className="text-base font-semibold text-fg">
                {t(locale, 'settings.title')}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-fg-faint">
                {t(locale, 'settings.subtitle')}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              title={t(locale, 'common.close')}
              aria-label={t(locale, 'common.close')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-panel-2 text-fg-faint transition-colors hover:border-accent hover:text-fg"
            >
              <X size={15} strokeWidth={2.2} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex flex-1 bg-border-soft">
          <nav
            aria-label={t(locale, 'settings.title')}
            className="w-52 shrink-0 overflow-y-auto bg-bg-alt p-3"
          >
            <div
              role="tablist"
              aria-orientation="vertical"
              className="flex flex-col gap-1"
            >
              {tabs.map((item) => {
                const active = item.id === tab;
                const Icon = item.Icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    id={`settings-tab-${item.id}`}
                    role="tab"
                    aria-selected={active}
                    aria-controls={`settings-panel-${item.id}`}
                    onClick={() => setTab(item.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors',
                      active
                        ? 'border border-accent bg-accent/15 text-fg'
                        : 'border border-transparent text-fg-dim hover:bg-border-soft hover:text-fg',
                    )}
                  >
                    <Icon
                      size={15}
                      strokeWidth={2}
                      className={active ? 'text-accent' : 'text-fg-faint'}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {t(locale, item.labelKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>

          <section
            id={panelId}
            role="tabpanel"
            aria-labelledby={`settings-tab-${tab}`}
            className="min-w-0 flex-1 overflow-y-auto bg-panel px-6 py-5 md:px-7 md:py-6"
          >
            <div className="mx-auto max-w-3xl">
              {tab === 'general' ? (
                <GeneralSettings
                  locale={locale}
                  languageOptions={languageOptions}
                  targetLanguages={targetLanguages}
                  promptAutoTranslate={promptAutoTranslate}
                  setLocale={setLocale}
                  setPromptAutoTranslate={setPromptAutoTranslate}
                />
              ) : tab === 'shortcuts' ? (
                <ShortcutsSettings locale={locale} />
              ) : (
                <PlaceholderTab tab={tab} locale={locale} />
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function GeneralSettings({
  locale,
  languageOptions,
  targetLanguages,
  promptAutoTranslate,
  setLocale,
  setPromptAutoTranslate,
}: {
  locale: Locale;
  languageOptions: LanguageOption[];
  targetLanguages: LanguageOption[];
  promptAutoTranslate: boolean;
  setLocale: (locale: Locale) => void;
  setPromptAutoTranslate: (enabled: boolean) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-fg">
          {t(locale, 'settings.generalTitle')}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-fg-faint">
          {t(locale, 'settings.generalDescription')}
        </p>
      </div>

      <SettingRow
        title={t(locale, 'settings.languageLabel')}
        description={t(locale, 'settings.languageDescription')}
      >
        <div className="flex flex-wrap gap-2">
          {languageOptions.map((option) => {
            const active = option.id === locale;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => setLocale(option.id)}
                className={cn(
                  'flex min-w-[9.5rem] items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  active
                    ? 'border-accent bg-accent/15 text-fg'
                    : 'border-border bg-panel text-fg-dim hover:border-accent hover:text-fg',
                )}
              >
                <span className="truncate">{option.label}</span>
                {option.hint && (
                  <span className="rounded bg-border-soft px-1.5 py-0.5 font-mono text-[10px] text-fg-faint">
                    {option.hint}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </SettingRow>

      <SettingRow
        title={t(locale, 'settings.autoTranslateLabel')}
        description={t(locale, 'settings.autoTranslateDescription')}
      >
        <button
          type="button"
          role="switch"
          aria-checked={promptAutoTranslate}
          onClick={() => setPromptAutoTranslate(!promptAutoTranslate)}
          className={cn(
            'relative h-6 w-11 rounded-full border transition-colors',
            promptAutoTranslate
              ? 'border-accent bg-accent/25'
              : 'border-border bg-panel-2',
          )}
        >
          <span
            className={cn(
              'absolute left-0.5 top-0.5 h-5 w-5 rounded-full transition-transform',
              promptAutoTranslate
                ? 'translate-x-5 bg-accent'
                : 'translate-x-0 bg-fg-faint',
            )}
          />
        </button>
      </SettingRow>

      <SettingRow title={t(locale, 'settings.targetLanguages')}>
        <div className="flex flex-wrap gap-2">
          {targetLanguages.map((option) => (
            <span
              key={option.id}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                promptAutoTranslate
                  ? 'border-accent/40 bg-accent/10 text-fg'
                  : 'border-border bg-panel text-fg-faint',
              )}
            >
              <span>{option.label}</span>
              {option.hint && (
                <span className="font-mono text-[10px] text-fg-faint">
                  {option.hint}
                </span>
              )}
            </span>
          ))}
        </div>
      </SettingRow>
    </div>
  );
}

function ShortcutsSettings({ locale }: { locale: Locale }) {
  const shortcuts: {
    id: string;
    keys: string[];
    titleKey: TranslationKey;
    descriptionKey: TranslationKey;
  }[] = [
    {
      id: 'composer-send',
      keys: ['Ctrl', 'Enter'],
      titleKey: 'settings.shortcutsComposerSendTitle',
      descriptionKey: 'settings.shortcutsComposerSendDescription',
    },
    {
      id: 'composer-newline',
      keys: ['Enter'],
      titleKey: 'settings.shortcutsComposerNewlineTitle',
      descriptionKey: 'settings.shortcutsComposerNewlineDescription',
    },
    {
      id: 'modal-close',
      keys: ['Esc'],
      titleKey: 'settings.shortcutsCloseModalTitle',
      descriptionKey: 'settings.shortcutsCloseModalDescription',
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-fg">
          {t(locale, 'settings.shortcutsTitle')}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-fg-faint">
          {t(locale, 'settings.shortcutsDescription')}
        </p>
      </div>

      <div className="space-y-2">
        {shortcuts.map((shortcut) => (
          <div
            key={shortcut.id}
            className="grid gap-3 rounded-lg border border-border bg-bg-alt px-4 py-3 md:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)] md:items-center"
          >
            <ShortcutKeys keys={shortcut.keys} />
            <div className="min-w-0">
              <div className="text-sm font-medium text-fg">
                {t(locale, shortcut.titleKey)}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-fg-faint">
                {t(locale, shortcut.descriptionKey)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShortcutKeys({ keys }: { keys: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="contents">
          {index > 0 && (
            <span className="font-mono text-[10px] text-fg-faint">+</span>
          )}
          <kbd className="min-w-8 rounded border border-border-soft bg-bg px-2 py-1 text-center font-mono text-[11px] text-fg">
            {key}
          </kbd>
        </span>
      ))}
    </div>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-4 rounded-lg border border-border bg-bg-alt p-4 md:grid-cols-[minmax(0,1fr)_minmax(12rem,24rem)] md:items-center">
      <div className="space-y-1">
        <div className="text-sm font-medium text-fg">{title}</div>
        {description && (
          <p className="text-xs leading-relaxed text-fg-faint">{description}</p>
        )}
      </div>
      <div className="md:justify-self-end">{children}</div>
    </div>
  );
}

function PlaceholderTab({
  tab,
  locale,
}: {
  tab: Exclude<SettingsTab, 'general' | 'shortcuts'>;
  locale: Locale;
}) {
  const copy = placeholderCopy[tab];
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-fg">
          {t(locale, copy.titleKey)}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-fg-faint">
          {t(locale, copy.descriptionKey)}
        </p>
      </div>
      <div className="space-y-2">
        <div className="h-12 rounded-lg border border-dashed border-border-soft bg-bg-alt/70" />
        <div className="h-12 rounded-lg border border-dashed border-border-soft bg-bg-alt/50" />
        <div className="h-12 rounded-lg border border-dashed border-border-soft bg-bg-alt/30" />
      </div>
    </div>
  );
}
