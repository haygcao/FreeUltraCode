export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'zh-CN';

export interface PromptItemLocaleValue {
  label: string;
  text: string;
}

export interface PromptGroupLocaleValue {
  label: string;
}

interface PromptItemLike {
  label: string;
  text: string;
  translations?: Partial<Record<Locale, PromptItemLocaleValue>>;
}

interface PromptGroupLike {
  label: string;
  translations?: Partial<Record<Locale, PromptGroupLocaleValue>>;
}

export const LANGUAGE_SELECT_OPTIONS = [
  {
    id: 'zh-CN',
    label: '简体中文',
    hint: 'ZH',
    aiName: 'Simplified Chinese',
    translations: {
      'en-US': { label: 'Simplified Chinese', hint: 'ZH' },
    },
  },
  {
    id: 'en-US',
    label: 'English',
    hint: 'EN',
    aiName: 'English',
    translations: {
      'zh-CN': { label: '英语', hint: 'EN' },
    },
  },
] as const satisfies readonly {
  id: Locale;
  label: string;
  hint: string;
  aiName: string;
  translations?: Partial<Record<Locale, { label: string; hint?: string }>>;
}[];

const UI = {
  'zh-CN': {
    'common.cancel': '取消',
    'common.clear': '清除',
    'common.close': '关闭',
    'common.copy': '复制',
    'common.done': '完成',
    'common.edit': '编辑',
    'common.language': '语言',
    'common.save': '保存',
    'common.delete': '删除',
    'common.resizeHeight': '拖动调整高度',
    'common.resizeSplit': '拖动调整左右宽度',
    'common.resizeWidth': '拖动调整宽度',
    'common.unnamed': '未命名',
    'dialog.openWorkflow': '打开 Workflow',
    'dialog.saveWorkflow': '保存 Workflow',
    'sidebar.newWorkflow': '新建 Workflow',
    'sidebar.open': '打开',
    'sidebar.newSession': '新建会话',
    'sidebar.history': '历史记录',
    'sidebar.emptySessions': '暂无会话',
    'workspace.choose': '选择工作区',
    'workspace.chooseFolder': '选择工作区文件夹',
    'workspace.pickFolder': '选择文件夹…',
    'workspace.noHistory': '暂无历史记录',
    'canvas.unsavedTitle': '尚未保存到文件',
    'canvas.unsaved': '未保存…',
    'canvas.savedJustNow': '已保存 · 刚刚',
    'canvas.runProgress': '运行进度',
    'canvas.switchRuntime': '切换运行时',
    'canvas.zoomOut': '缩小',
    'canvas.fitView': '适应窗口',
    'canvas.zoomIn': '放大',
    'canvas.viewScript': '查看生成的脚本',
    'canvas.script': '脚本',
    'canvas.stopTitle': '停止并返回设计态',
    'canvas.runningStop': '运行中… 停止',
    'canvas.resumeTitle': '从失败或中断节点继续',
    'canvas.resume': '继续',
    'canvas.runTitle': '运行工作流',
    'canvas.run': '运行',
    'canvas.scriptError': '生成脚本失败',
    'canvas.generatedScript': '生成的脚本',
    'canvas.runningReadonly': '运行中 · 只读',
    'canvas.addNode': '添加节点',
    'canvas.noStages': '无阶段',
    'dock.aiReturn': 'AI 返回',
    'dock.aiInput': 'AI 输入',
    'dock.generating': '生成中…',
    'dock.empty': '在右侧描述你的意图，AI 将据此操作画布并在此回显。',
    'dock.readonlySuffix': ' · 只读 (运行中)',
    'dock.apiKeyConfigured': 'Anthropic API key 已配置 · 点击修改',
    'dock.apiKeyMissing': '未配置 API key · 将回退到本地意图引擎',
    'dock.apiKeyHelp': '仅保存在本机 localStorage。未配置时将回退到本地意图引擎。',
    'dock.runningPlaceholder': '运行中 · 输入框已锁定，停止后可再编辑蓝图',
    'dock.placeholder': '描述意图，例如：在 Verify 后加一个汇总节点…',
    'dock.permissionTitle': '权限设定',
    'dock.modelTitle': '模型选择',
    'dock.inputLockedTitle': '运行中 · 输入框已锁定',
    'dock.aiGeneratingTitle': 'AI 生成中…',
    'dock.sendShortcut': 'Ctrl+Enter 发送 · Enter 换行',
    'dock.runningReadonly': '运行中 · 只读',
    'prompt.nodeProperties': '节点属性',
    'prompt.commonPrompts': '常用提示词',
    'prompt.newPrompt': '新提示词',
    'prompt.newGroup': '新分组',
    'prompt.resetConfirm': '确定恢复默认提示词库？你的所有自定义改动将被覆盖。',
    'prompt.renameGroup': '重命名分组',
    'prompt.deleteGroup': '删除分组',
    'prompt.deletePrompt': '删除提示词',
    'prompt.deleteGroupConfirmPrefix': '删除分组',
    'prompt.deleteGroupConfirmSuffix': '及其全部提示词？',
    'prompt.addPrompt': '+ 新增提示词',
    'prompt.addGroup': '+ 新增分组',
    'prompt.resetDefaults': '恢复默认',
    'prompt.editHelp': '编辑模式：增删改提示词与分组，保存后会自动翻译其他语言。',
    'prompt.editHelpOn': '编辑模式：增删改提示词与分组，保存后会自动翻译其他语言。',
    'prompt.editHelpOff': '编辑模式：增删改提示词与分组，当前只保存所选语言。',
    'prompt.clickHelp': '点击 ▷ 将提示词追加到 AI 输入框。',
    'prompt.translateDone': '已保存，并已补齐其他语言。',
    'prompt.translateSkipped': '已保存当前语言；AI 翻译暂不可用。',
    'prompt.translateDisabled': '已保存当前语言；自动翻译已关闭。',
    'prompt.translating': 'AI 翻译中…',
    'prompt.labelPlaceholder': '标签',
    'prompt.textPlaceholder': '提示词内容（发送给 AI 的指令）',
    'prompt.fallbackName': '未命名',
    'inspector.removeSpec': '删除',
    'inspector.labelField': '节点显示名',
    'inspector.typeField': '类型',
    'inspector.promptField': 'Prompt',
    'inspector.agentTypeField': 'Agent 类型',
    'inspector.modelField': '模型',
    'inspector.titleField': '标题',
    'inspector.valueField': '值 (JSON)',
    'inspector.codeField': '代码',
    'inspector.messageField': '消息',
    'inspector.subtaskPrompt': '子任务 prompt',
    'inspector.agentPromptPlaceholder': '描述要让 agent 做什么…',
    'inspector.agentTypePlaceholder': '如 explore / verifier / oh-my-claudecode:executor',
    'inspector.schemaLabel': 'Schema (标识符)',
    'inspector.schemaPlaceholder': 'schema 标识符名，如 REVIEW',
    'inspector.branchesLabel': 'Branches (并行分支)',
    'inspector.addBranch': '+ 分支',
    'inspector.itemsLabel': 'Items (输入表达式)',
    'inspector.itemsPlaceholder': '输入数组表达式，如 files 或 args',
    'inspector.stagesLabel': 'Stages (流水线阶段)',
    'inspector.addStage': '+ 阶段',
    'inspector.phaseName': '阶段名称',
    'inspector.ifCondition': 'Condition (if 条件)',
    'inspector.conditionPlaceholder': '布尔表达式，如 scan.ok',
    'inspector.branchHelp': '带 parent 的子节点会作为 if 块体独立显示在分支旁。',
    'inspector.whileCondition': 'Condition (while 条件)',
    'inspector.loopPlaceholder': '继续循环的条件，如 budget.remaining() > 0',
    'inspector.loopHelp': '带 parent 的子节点会作为 while 块体独立显示在循环旁。',
    'inspector.workflowName': '子工作流名',
    'inspector.logMessage': '日志内容',
    'inspector.noParams': '该节点没有可编辑参数。',
    'inspector.selectedNode': '选中节点：',
    'inspector.nodeDeleted': '（节点已被删除）',
    'inspector.nodeLabel': '节点显示名',
    'inspector.deleteNode': '删除节点',
    'settings.title': '设置',
    'settings.subtitle': '语言、提示词翻译、快捷键和后续配置都放在这里。',
    'settings.open': '设置',
    'settings.openHint': '打开设置',
    'settings.tabs.general': '通用',
    'settings.tabs.shortcuts': '快捷键',
    'settings.tabs.runtime': '运行时',
    'settings.tabs.appearance': '外观',
    'settings.tabs.advanced': '高级',
    'settings.generalTitle': '通用设置',
    'settings.generalDescription': '管理界面语言，以及保存提示词时如何同步其他语言版本。',
    'settings.languageLabel': '界面语言',
    'settings.languageDescription': '界面文案、提示词标签和内置选项会跟随这个语言显示。',
    'settings.autoTranslateLabel': '提示词自动翻译',
    'settings.autoTranslateDescription': '开启后，保存一种语言的提示词时会自动补齐其他语言版本。',
    'settings.targetLanguages': '翻译目标',
    'settings.shortcutsTitle': '快捷键',
    'settings.shortcutsDescription': '查看 OpenWorkflow 当前可用的键盘操作。',
    'settings.shortcutsComposerSendTitle': '发送 AI 输入',
    'settings.shortcutsComposerSendDescription': '在中间区域底部的 AI 输入框中提交当前内容。',
    'settings.shortcutsComposerNewlineTitle': 'AI 输入换行',
    'settings.shortcutsComposerNewlineDescription': '在 AI 输入框中插入换行，适合编写多段提示词。',
    'settings.shortcutsCloseModalTitle': '关闭弹窗',
    'settings.shortcutsCloseModalDescription': '关闭当前打开的设置弹窗或上下文弹层。',
    'settings.runtimeTitle': '运行时配置',
    'settings.runtimeDescription': '后续运行时默认值、CLI 和模型相关配置会放在这里。',
    'settings.appearanceTitle': '外观配置',
    'settings.appearanceDescription': '后续主题、密度和视觉偏好会放在这里。',
    'settings.advancedTitle': '高级配置',
    'settings.advancedDescription': '后续迁移、实验性能力和高级工作流配置会放在这里。',
    'canvas.sample': '示例',
    'canvas.sampleTitle': '加载交互演示工作流（部署向导）',
    'interaction.submit': '提交',
    'interaction.confirm': '确定',
    'interaction.multiHint': '可多选',
    'interaction.inputPlaceholder': '输入内容…',
    'interaction.youAnswered': '你的回答',
    'interaction.answered': '已回答',
    'interaction.cancelled': '交互已取消',
    'interaction.ended': '运行已结束，无法作答',
    'interaction.skip': '跳过',
    'interaction.skipTitle': '跳过这个问题，不作回答',
  },
  'en-US': {
    'common.cancel': 'Cancel',
    'common.clear': 'Clear',
    'common.close': 'Close',
    'common.copy': 'Copy',
    'common.done': 'Done',
    'common.edit': 'Edit',
    'common.language': 'Language',
    'common.save': 'Save',
    'common.delete': 'Delete',
    'common.resizeHeight': 'Drag to resize height',
    'common.resizeSplit': 'Drag to resize panes',
    'common.resizeWidth': 'Drag to resize width',
    'common.unnamed': 'Untitled',
    'dialog.openWorkflow': 'Open Workflow',
    'dialog.saveWorkflow': 'Save Workflow',
    'sidebar.newWorkflow': 'New Workflow',
    'sidebar.open': 'Open',
    'sidebar.newSession': 'New Chat',
    'sidebar.history': 'History',
    'sidebar.emptySessions': 'No sessions',
    'workspace.choose': 'Choose workspace',
    'workspace.chooseFolder': 'Choose workspace folder',
    'workspace.pickFolder': 'Choose folder…',
    'workspace.noHistory': 'No history',
    'canvas.unsavedTitle': 'Not saved to a file',
    'canvas.unsaved': 'Unsaved…',
    'canvas.savedJustNow': 'Saved · just now',
    'canvas.runProgress': 'Run progress',
    'canvas.switchRuntime': 'Switch runtime',
    'canvas.zoomOut': 'Zoom out',
    'canvas.fitView': 'Fit view',
    'canvas.zoomIn': 'Zoom in',
    'canvas.viewScript': 'View generated script',
    'canvas.script': 'Script',
    'canvas.stopTitle': 'Stop and return to design mode',
    'canvas.runningStop': 'Running… Stop',
    'canvas.resumeTitle': 'Resume from the failed or interrupted node',
    'canvas.resume': 'Resume',
    'canvas.runTitle': 'Run workflow',
    'canvas.run': 'Run',
    'canvas.scriptError': 'Script generation failed',
    'canvas.generatedScript': 'Generated script',
    'canvas.runningReadonly': 'Running · read-only',
    'canvas.addNode': 'Add node',
    'canvas.noStages': 'No stages',
    'dock.aiReturn': 'AI Output',
    'dock.aiInput': 'AI Input',
    'dock.generating': 'Generating…',
    'dock.empty': 'Describe your intent on the right. AI changes the canvas and replies here.',
    'dock.readonlySuffix': ' · read-only (running)',
    'dock.apiKeyConfigured': 'Anthropic API key configured · click to edit',
    'dock.apiKeyMissing': 'No API key · local intent engine fallback',
    'dock.apiKeyHelp': 'Stored only in localStorage on this device. Without a key, the local intent engine is used.',
    'dock.runningPlaceholder': 'Running · input is locked until the workflow stops',
    'dock.placeholder': 'Describe intent, e.g. add a summary node after Verify…',
    'dock.permissionTitle': 'Permission',
    'dock.modelTitle': 'Model',
    'dock.inputLockedTitle': 'Running · input locked',
    'dock.aiGeneratingTitle': 'AI is generating…',
    'dock.sendShortcut': 'Ctrl+Enter to send · Enter for newline',
    'dock.runningReadonly': 'Running · read-only',
    'prompt.nodeProperties': 'Node Properties',
    'prompt.commonPrompts': 'Prompt Library',
    'prompt.newPrompt': 'New prompt',
    'prompt.newGroup': 'New group',
    'prompt.resetConfirm': 'Reset the prompt library? This overwrites all custom edits.',
    'prompt.renameGroup': 'Rename group',
    'prompt.deleteGroup': 'Delete group',
    'prompt.deletePrompt': 'Delete prompt',
    'prompt.deleteGroupConfirmPrefix': 'Delete group',
    'prompt.deleteGroupConfirmSuffix': 'and all its prompts?',
    'prompt.addPrompt': '+ Add prompt',
    'prompt.addGroup': '+ Add group',
    'prompt.resetDefaults': 'Restore defaults',
    'prompt.editHelp': 'Edit mode: prompts and groups are saved locally; other languages are auto-translated.',
    'prompt.editHelpOn': 'Edit mode: prompts and groups are saved locally; other languages are auto-translated.',
    'prompt.editHelpOff': 'Edit mode: prompts and groups are saved locally; only the current language is saved.',
    'prompt.clickHelp': 'Click ▷ to append this prompt to AI input.',
    'prompt.translateDone': 'Saved and translated into the other languages.',
    'prompt.translateSkipped': 'Saved current language; AI translation is unavailable.',
    'prompt.translateDisabled': 'Saved current language; auto-translation is turned off.',
    'prompt.translating': 'AI translating…',
    'prompt.labelPlaceholder': 'Label',
    'prompt.textPlaceholder': 'Prompt content sent to AI',
    'prompt.fallbackName': 'Untitled',
    'inspector.removeSpec': 'Remove',
    'inspector.labelField': 'Node display name',
    'inspector.typeField': 'Type',
    'inspector.promptField': 'Prompt',
    'inspector.agentTypeField': 'Agent type',
    'inspector.modelField': 'Model',
    'inspector.titleField': 'Title',
    'inspector.valueField': 'Value (JSON)',
    'inspector.codeField': 'Code',
    'inspector.messageField': 'Message',
    'inspector.subtaskPrompt': 'Subtask prompt',
    'inspector.agentPromptPlaceholder': 'Describe what the agent should do…',
    'inspector.agentTypePlaceholder': 'e.g. explore / verifier / oh-my-claudecode:executor',
    'inspector.schemaLabel': 'Schema (identifier)',
    'inspector.schemaPlaceholder': 'Schema identifier, e.g. REVIEW',
    'inspector.branchesLabel': 'Branches',
    'inspector.addBranch': '+ Branch',
    'inspector.itemsLabel': 'Items (input expression)',
    'inspector.itemsPlaceholder': 'Input array expression, e.g. files or args',
    'inspector.stagesLabel': 'Stages',
    'inspector.addStage': '+ Stage',
    'inspector.phaseName': 'Phase name',
    'inspector.ifCondition': 'Condition (if)',
    'inspector.conditionPlaceholder': 'Boolean expression, e.g. scan.ok',
    'inspector.branchHelp': 'Child nodes with this parent are shown beside the branch and emitted inside the if block.',
    'inspector.whileCondition': 'Condition (while)',
    'inspector.loopPlaceholder': 'Loop condition, e.g. budget.remaining() > 0',
    'inspector.loopHelp': 'Child nodes with this parent are shown beside the loop and emitted as the while body.',
    'inspector.workflowName': 'Sub-workflow name',
    'inspector.logMessage': 'Log message',
    'inspector.noParams': 'This node has no editable parameters.',
    'inspector.selectedNode': 'Selected node:',
    'inspector.nodeDeleted': '(node was deleted)',
    'inspector.nodeLabel': 'Node display name',
    'inspector.deleteNode': 'Delete node',
    'settings.title': 'Settings',
    'settings.subtitle': 'Language, prompt translation, shortcuts, and future configuration live here.',
    'settings.open': 'Settings',
    'settings.openHint': 'Open settings',
    'settings.tabs.general': 'General',
    'settings.tabs.shortcuts': 'Shortcuts',
    'settings.tabs.runtime': 'Runtime',
    'settings.tabs.appearance': 'Appearance',
    'settings.tabs.advanced': 'Advanced',
    'settings.generalTitle': 'General',
    'settings.generalDescription': 'Manage the interface language and how saved prompts sync to other languages.',
    'settings.languageLabel': 'Interface language',
    'settings.languageDescription': 'UI strings, prompt labels, and built-in option names follow this language.',
    'settings.autoTranslateLabel': 'Auto-translate prompts',
    'settings.autoTranslateDescription': 'When enabled, saving a prompt in one language automatically fills the other language versions.',
    'settings.targetLanguages': 'Translation targets',
    'settings.shortcutsTitle': 'Shortcuts',
    'settings.shortcutsDescription': 'Review the keyboard actions currently available in OpenWorkflow.',
    'settings.shortcutsComposerSendTitle': 'Send AI input',
    'settings.shortcutsComposerSendDescription': 'Submit the current content from the AI input box at the bottom of the center workspace.',
    'settings.shortcutsComposerNewlineTitle': 'New line in AI input',
    'settings.shortcutsComposerNewlineDescription': 'Insert a line break in the AI input box for multi-paragraph prompts.',
    'settings.shortcutsCloseModalTitle': 'Close modal',
    'settings.shortcutsCloseModalDescription': 'Close the currently open settings modal or contextual overlay.',
    'settings.runtimeTitle': 'Runtime',
    'settings.runtimeDescription': 'Runtime defaults, CLI, and model configuration will live here later.',
    'settings.appearanceTitle': 'Appearance',
    'settings.appearanceDescription': 'Theme, density, and visual preferences will live here later.',
    'settings.advancedTitle': 'Advanced',
    'settings.advancedDescription': 'Migration, experimental features, and advanced workflow controls will live here later.',
    'canvas.sample': 'Sample',
    'canvas.sampleTitle': 'Load the interaction demo workflow (deploy wizard)',
    'interaction.submit': 'Submit',
    'interaction.confirm': 'Confirm',
    'interaction.multiHint': 'Select all that apply',
    'interaction.inputPlaceholder': 'Type here…',
    'interaction.youAnswered': 'Your answer',
    'interaction.answered': 'Answered',
    'interaction.cancelled': 'Interaction cancelled',
    'interaction.ended': 'Run ended — can no longer answer',
    'interaction.skip': 'Skip',
    'interaction.skipTitle': 'Skip this question without answering',
  },
} as const;

export type TranslationKey = keyof (typeof UI)[typeof DEFAULT_LOCALE];

export function isLocale(value: string | null | undefined): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

export function localeFromLanguageTag(
  value: string | null | undefined,
): Locale | null {
  if (!value) return null;
  if (isLocale(value)) return value;

  const normalized = value.toLowerCase();
  if (normalized.startsWith('zh')) return 'zh-CN';
  if (normalized.startsWith('en')) return 'en-US';
  return null;
}

export function systemLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  const candidates = [
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language,
  ];
  for (const candidate of candidates) {
    const locale = localeFromLanguageTag(candidate);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

export function t(locale: Locale, key: TranslationKey): string {
  return UI[locale][key] ?? UI[DEFAULT_LOCALE][key] ?? key;
}

export function localeAiName(locale: Locale): string {
  return LANGUAGE_SELECT_OPTIONS.find((l) => l.id === locale)?.aiName ?? locale;
}

export function localizePromptGroup(
  group: PromptGroupLike,
  locale: Locale,
): PromptGroupLocaleValue {
  const current = group.translations?.[locale];
  const fallback = group.translations?.[DEFAULT_LOCALE];
  return {
    label: current?.label || fallback?.label || group.label,
  };
}

export function localizePromptItem(
  item: PromptItemLike,
  locale: Locale,
): PromptItemLocaleValue {
  const current = item.translations?.[locale];
  const fallback = item.translations?.[DEFAULT_LOCALE];
  return {
    label: current?.label || fallback?.label || item.label,
    text: current?.text || fallback?.text || item.text,
  };
}

export function withPromptGroupLocale<T extends PromptGroupLike>(
  group: T,
  locale: Locale,
  value: PromptGroupLocaleValue,
): T {
  const translations = {
    ...(group.translations ?? {}),
    [locale]: value,
  };
  const base =
    locale === DEFAULT_LOCALE || !group.label ? { label: value.label } : {};
  return { ...group, ...base, translations };
}

export function withPromptItemLocale<T extends PromptItemLike>(
  item: T,
  locale: Locale,
  value: PromptItemLocaleValue,
): T {
  const translations = {
    ...(item.translations ?? {}),
    [locale]: value,
  };
  const base =
    locale === DEFAULT_LOCALE || (!item.label && !item.text)
      ? { label: value.label, text: value.text }
      : {};
  return { ...item, ...base, translations };
}

export interface LocalizableSelectOption {
  id: string;
  label: string;
  hint?: string;
  translations?: Partial<Record<Locale, { label: string; hint?: string }>>;
}

export function localizeSelectOption<T extends LocalizableSelectOption>(
  option: T,
  locale: Locale,
): T {
  const translated = option.translations?.[locale];
  if (!translated) return option;
  return {
    ...option,
    label: translated.label || option.label,
    hint: translated.hint ?? option.hint,
  };
}
