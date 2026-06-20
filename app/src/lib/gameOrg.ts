import defaultGameOrgDefinition from '@/config/gameOrgDefaults.json';
import {
  gameExpertSlashCommand,
  getGameExpertCatalog,
  normalizeGameExpertSettings,
  type GameExpertDefinition,
  type GameExpertSettings,
} from './gameExperts';
import {
  localizedGameExpertName,
  localizedGameGroupLabel,
} from './gameExpertI18n';
import {
  localizedGameExpertRootCommand,
  localizeGameOrgNodeText,
  localizeGameOrgSkillText,
} from './gameOrgI18n';
import type { Locale } from './i18n';

export interface GameOrgSkillDefinition {
  id: string;
  label: string;
  summary: string;
  prompt: string;
  protocol?: GameOrgSkillProtocol;
  collaboratorExpertIds?: string[];
}

export interface GameOrgSkillProtocol {
  triggerConditions: string;
  inputs: string;
  executionSteps: string[];
  toolsAndResources: string;
  outputs: string;
  acceptanceCriteria: string;
}

export interface GameOrgRoleProfile {
  position: string;
  responsibilities: string[];
  scenarios: string[];
  deliverables: string[];
  collaborators: string[];
}

export interface GameOrgNodeDefinition {
  id: string;
  label: string;
  icon?: GameOrgNodeIcon;
  summary?: string;
  role?: string;
  profile?: GameOrgRoleProfile;
  expertIds?: string[];
  skills?: GameOrgSkillDefinition[];
  children?: GameOrgNodeDefinition[];
}

export const GAME_ORG_NODE_ICONS = [
  'producer',
  'design',
  'gameplay',
  'systems',
  'economy',
  'level',
  'narrative',
  'writing',
  'world',
  'tech',
  'client',
  'engine',
  'backend',
  'technical-art',
  'tools',
  'data',
  'art',
  'concept',
  'character',
  'environment',
  'ui',
  'vfx',
  'audio',
  'sound',
  'qa',
  'performance',
  'accessibility',
  'release',
  'community',
  'localization',
  'analytics',
  'team',
] as const;

export type GameOrgNodeIcon = (typeof GAME_ORG_NODE_ICONS)[number];

export interface ResolvedGameOrgSkill extends GameOrgSkillDefinition {
  protocol: GameOrgSkillProtocol;
  commandText: string;
  collaboratorLabels: string[];
}

export interface ResolvedGameOrgNode {
  id: string;
  label: string;
  icon: GameOrgNodeIcon;
  summary: string;
  role: string;
  profile: GameOrgRoleProfile;
  path: string[];
  expertIds: string[];
  experts: GameExpertDefinition[];
  groupLabels: string[];
  commandText: string | null;
  skills: ResolvedGameOrgSkill[];
  children: ResolvedGameOrgNode[];
}

export interface GameOrgSkillBinding {
  roleId: string;
  roleLabel: string;
  skillId: string;
  skillLabel: string;
  collaboratorExpertIds: string[];
  collaboratorLabels: string[];
}

export interface GameOrgSkillBindingOverview {
  own: GameOrgSkillBinding[];
  incoming: GameOrgSkillBinding[];
}

export interface GameOrgSkillRecommendation {
  roleId: string;
  roleLabel: string;
  rolePath: string[];
  skillId: string;
  skillLabel: string;
  skillSummary: string;
  commandText: string;
  collaboratorLabels: string[];
  score: number;
  matchedTerms: string[];
}

export interface RecommendGameOrgSkillsOptions {
  limit?: number;
}

export interface GameOrgTaskPlanStep {
  order: number;
  roleId: string;
  roleLabel: string;
  rolePath: string[];
  skillId: string;
  skillLabel: string;
  skillSummary: string;
  commandText: string;
  collaboratorLabels: string[];
  matchedTerms: string[];
  reason: string;
  deliverable: string;
  acceptanceCriteria: string;
  score: number;
}

export interface GameOrgTaskPlan {
  query: string;
  steps: GameOrgTaskPlanStep[];
  commandText: string;
  documentText: string;
  checklistText: string;
}

export interface PlanGameOrgTaskOptions {
  limit?: number;
  locale?: Locale;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalString(value: unknown): string | undefined {
  const trimmed = trimString(value);
  return trimmed ? trimmed : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.filter((item): item is string => typeof item === 'string'));
}

function normalizeGameOrgSkillProtocol(
  value: unknown,
): GameOrgSkillProtocol | undefined {
  if (!isRecord(value)) return undefined;

  const triggerConditions =
    trimString(value.triggerConditions) || trimString(value.triggers);
  const inputs = trimString(value.inputs) || trimString(value.input);
  const executionSteps =
    stringList(value.executionSteps).length > 0
      ? stringList(value.executionSteps)
      : stringList(value.steps);
  const toolsAndResources =
    trimString(value.toolsAndResources) ||
    trimString(value.tools) ||
    trimString(value.resources);
  const outputs = trimString(value.outputs) || trimString(value.output);
  const acceptanceCriteria =
    trimString(value.acceptanceCriteria) ||
    trimString(value.acceptance) ||
    trimString(value.verification);

  if (
    !triggerConditions &&
    !inputs &&
    executionSteps.length === 0 &&
    !toolsAndResources &&
    !outputs &&
    !acceptanceCriteria
  ) {
    return undefined;
  }

  return {
    triggerConditions,
    inputs,
    executionSteps,
    toolsAndResources,
    outputs,
    acceptanceCriteria,
  };
}

function mergeGameOrgSkillProtocol(
  protocol: GameOrgSkillProtocol | undefined,
  fallback: GameOrgSkillProtocol,
): GameOrgSkillProtocol {
  if (!protocol) return fallback;
  return {
    triggerConditions: protocol.triggerConditions || fallback.triggerConditions,
    inputs: protocol.inputs || fallback.inputs,
    executionSteps:
      protocol.executionSteps.length > 0
        ? protocol.executionSteps
        : fallback.executionSteps,
    toolsAndResources: protocol.toolsAndResources || fallback.toolsAndResources,
    outputs: protocol.outputs || fallback.outputs,
    acceptanceCriteria: protocol.acceptanceCriteria || fallback.acceptanceCriteria,
  };
}

function normalizeGameOrgRoleProfile(value: unknown): GameOrgRoleProfile | undefined {
  if (!isRecord(value)) return undefined;

  const position = trimString(value.position);
  const responsibilities =
    stringList(value.responsibilities).length > 0
      ? stringList(value.responsibilities)
      : stringList(value.coreResponsibilities);
  const scenarios =
    stringList(value.scenarios).length > 0
      ? stringList(value.scenarios)
      : stringList(value.useCases);
  const deliverables =
    stringList(value.deliverables).length > 0
      ? stringList(value.deliverables)
      : stringList(value.outputs);
  const collaborators =
    stringList(value.collaborators).length > 0
      ? stringList(value.collaborators)
      : stringList(value.collaborationTargets);

  if (
    !position &&
    responsibilities.length === 0 &&
    scenarios.length === 0 &&
    deliverables.length === 0 &&
    collaborators.length === 0
  ) {
    return undefined;
  }

  return {
    position,
    responsibilities,
    scenarios,
    deliverables,
    collaborators,
  };
}

function mergeGameOrgRoleProfile(
  profile: GameOrgRoleProfile | undefined,
  fallback: GameOrgRoleProfile,
): GameOrgRoleProfile {
  if (!profile) return fallback;
  return {
    position: profile.position || fallback.position,
    responsibilities:
      profile.responsibilities.length > 0
        ? profile.responsibilities
        : fallback.responsibilities,
    scenarios: profile.scenarios.length > 0 ? profile.scenarios : fallback.scenarios,
    deliverables:
      profile.deliverables.length > 0 ? profile.deliverables : fallback.deliverables,
    collaborators:
      profile.collaborators.length > 0 ? profile.collaborators : fallback.collaborators,
  };
}

export function createDefaultGameOrgRoleProfile(
  role: {
    label: string;
    summary: string;
    role: string;
    collaboratorLabels?: readonly string[];
  },
  locale: Locale,
): GameOrgRoleProfile {
  const collaborators = uniqueStrings(role.collaboratorLabels ?? []);

  if (locale !== 'zh-CN') {
    return {
      position: role.summary || `${role.label} in the project organization.`,
      responsibilities: [
        role.role ||
          `Own ${role.label} responsibilities and keep related work scoped, reviewed, and shippable.`,
      ],
      scenarios: [
        `Use this role when a task needs ${role.label} judgment, breakdown, review, or acceptance.`,
      ],
      deliverables: [
        'Role-scoped plan, task breakdown, risk list, handoff notes, and acceptance criteria.',
      ],
      collaborators:
        collaborators.length > 0
          ? collaborators
          : ['Upstream/downstream roles and bound Skills.'],
    };
  }

  return {
    position: role.summary || `${role.label} 在项目组织中的定位。`,
    responsibilities: [
      role.role || `负责 ${role.label} 范围内的判断、拆解、推进和验收。`,
    ],
    scenarios: [`当任务需要 ${role.label} 判断、拆解、评审或验收时使用。`],
    deliverables: ['职责范围内的方案、任务拆解、风险列表、交接说明和验收标准。'],
    collaborators:
      collaborators.length > 0 ? collaborators : ['上下游岗位和绑定 Skill。'],
  };
}

export function createDefaultGameOrgSkillProtocol(
  skill: Pick<GameOrgSkillDefinition, 'label' | 'summary' | 'prompt'>,
  locale: Locale,
): GameOrgSkillProtocol {
  if (locale !== 'zh-CN') {
    return {
      triggerConditions:
        skill.summary || `A request needs the ${skill.label} capability.`,
      inputs:
        'User request, current project context, relevant code/assets, and role constraints.',
      executionSteps: [
        'Clarify the objective, boundaries, dependencies, and missing context.',
        'Break the work down within this role and identify collaborators.',
        'Return an executable plan, risks, deliverables, and acceptance checks.',
      ],
      toolsAndResources:
        'Current workspace, project files, configured tools, and linked collaborator skills.',
      outputs:
        skill.summary ||
        `A deliverable, task breakdown, or implementation plan for ${skill.label}.`,
      acceptanceCriteria:
        'The result is actionable, scoped to the role, includes risks, and has clear verification criteria.',
    };
  }

  return {
    triggerConditions: skill.summary || `需要执行「${skill.label}」能力时。`,
    inputs: '用户需求、当前项目上下文、相关代码/素材、岗位约束和协作对象。',
    executionSteps: [
      '确认目标、边界、依赖和缺失信息。',
      '按岗位职责拆解执行步骤，并标出需要协作的岗位。',
      '输出可执行方案、风险、产出物和验收口径。',
    ],
    toolsAndResources: '当前工作区、项目文件、已配置工具和绑定的协作 Skill。',
    outputs: skill.summary || `「${skill.label}」对应的方案、任务拆解或交付产物。`,
    acceptanceCriteria:
      '结果可执行，职责边界清楚，风险明确，并给出可验证的验收标准。',
  };
}

export function formatGameOrgSkillPrompt(
  prompt: string,
  protocol: GameOrgSkillProtocol,
  locale: Locale,
): string {
  const steps = protocol.executionSteps
    .map((step, index) => `${index + 1}. ${step}`)
    .join('\n');

  if (locale !== 'zh-CN') {
    return [
      prompt.trim(),
      '',
      'Skill standard protocol:',
      `- Trigger conditions: ${protocol.triggerConditions}`,
      `- Inputs: ${protocol.inputs}`,
      `- Execution steps:\n${steps}`,
      `- Tools/resources: ${protocol.toolsAndResources}`,
      `- Outputs: ${protocol.outputs}`,
      `- Acceptance criteria: ${protocol.acceptanceCriteria}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    prompt.trim(),
    '',
    'Skill 标准六项：',
    `- 触发条件：${protocol.triggerConditions}`,
    `- 输入：${protocol.inputs}`,
    `- 执行步骤：\n${steps}`,
    `- 工具/资源：${protocol.toolsAndResources}`,
    `- 输出：${protocol.outputs}`,
    `- 验收标准：${protocol.acceptanceCriteria}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function isGameOrgNodeIcon(value: unknown): value is GameOrgNodeIcon {
  return (
    typeof value === 'string' &&
    (GAME_ORG_NODE_ICONS as readonly string[]).includes(value)
  );
}

export function normalizeGameOrgSkillDefinition(
  value: unknown,
  fallbackId: string,
): GameOrgSkillDefinition | null {
  if (!isRecord(value)) return null;

  const id = trimString(value.id) || fallbackId;
  const label = trimString(value.label) || id;
  const prompt =
    trimString(value.prompt) ||
    `请以${label}相关职责处理以下需求，并给出可执行建议、风险和验收标准。`;
  const summary = trimString(value.summary) || prompt;
  const collaboratorExpertIds = stringList(value.collaboratorExpertIds);
  const protocol = normalizeGameOrgSkillProtocol(value.protocol);

  return {
    id,
    label,
    summary,
    prompt,
    ...(protocol ? { protocol } : {}),
    ...(collaboratorExpertIds.length > 0 ? { collaboratorExpertIds } : {}),
  };
}

export function normalizeGameOrgNodeDefinition(
  value: unknown,
  fallbackId = 'game-team',
): GameOrgNodeDefinition | null {
  if (!isRecord(value)) return null;

  const id = trimString(value.id) || fallbackId;
  const label = trimString(value.label) || id;
  const expertIds = stringList(value.expertIds);
  const profile = normalizeGameOrgRoleProfile(value.profile);
  const rawChildren = Array.isArray(value.children) ? value.children : [];
  const children = rawChildren
    .map((child, index) => normalizeGameOrgNodeDefinition(child, `${id}-${index + 1}`))
    .filter((child): child is GameOrgNodeDefinition => Boolean(child));

  const hasSkillsProperty = Object.prototype.hasOwnProperty.call(value, 'skills');
  const rawSkills = Array.isArray(value.skills) ? value.skills : [];
  const skills = hasSkillsProperty
    ? rawSkills
        .map((skill, index) =>
          normalizeGameOrgSkillDefinition(skill, `${id}:skill-${index + 1}`),
        )
        .filter((skill): skill is GameOrgSkillDefinition => Boolean(skill))
    : undefined;

  return {
    id,
    label,
    ...(isGameOrgNodeIcon(value.icon) ? { icon: value.icon } : {}),
    ...(optionalString(value.summary) ? { summary: optionalString(value.summary) } : {}),
    ...(optionalString(value.role) ? { role: optionalString(value.role) } : {}),
    ...(profile ? { profile } : {}),
    ...(expertIds.length > 0 ? { expertIds } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

function createDefaultGameOrgDefinition(): GameOrgNodeDefinition {
  return {
    id: 'game-team',
    label: '游戏团队',
    icon: 'team',
    summary: '当前项目的游戏专家团队。',
    role: '按项目需求提供游戏开发协作。',
    skills: [],
    children: [],
  };
}

export function cloneGameOrgDefinition(
  definition: GameOrgNodeDefinition,
): GameOrgNodeDefinition {
  return {
    ...definition,
    profile: definition.profile
      ? {
          ...definition.profile,
          responsibilities: [...definition.profile.responsibilities],
          scenarios: [...definition.profile.scenarios],
          deliverables: [...definition.profile.deliverables],
          collaborators: [...definition.profile.collaborators],
        }
      : undefined,
    expertIds: definition.expertIds ? [...definition.expertIds] : undefined,
    skills: definition.skills?.map((skill) => ({
      ...skill,
      protocol: skill.protocol
        ? {
            ...skill.protocol,
            executionSteps: [...skill.protocol.executionSteps],
          }
        : undefined,
      collaboratorExpertIds: skill.collaboratorExpertIds
        ? [...skill.collaboratorExpertIds]
        : undefined,
    })),
    children: definition.children?.map(cloneGameOrgDefinition),
  };
}

export const DEFAULT_GAME_ORG_DEFINITION: GameOrgNodeDefinition =
  normalizeGameOrgNodeDefinition(defaultGameOrgDefinition, 'producer') ??
  createDefaultGameOrgDefinition();

const GAME_ORG_DEFINITION_STORAGE_KEY = 'freeultracode.gameOrgDefinition.v1';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

export function loadGameOrgDefinition(): GameOrgNodeDefinition {
  if (!hasStorage()) return cloneGameOrgDefinition(DEFAULT_GAME_ORG_DEFINITION);
  try {
    const raw = window.localStorage.getItem(GAME_ORG_DEFINITION_STORAGE_KEY);
    if (!raw) return cloneGameOrgDefinition(DEFAULT_GAME_ORG_DEFINITION);
    return (
      normalizeGameOrgNodeDefinition(JSON.parse(raw), DEFAULT_GAME_ORG_DEFINITION.id) ??
      cloneGameOrgDefinition(DEFAULT_GAME_ORG_DEFINITION)
    );
  } catch {
    return cloneGameOrgDefinition(DEFAULT_GAME_ORG_DEFINITION);
  }
}

export function saveGameOrgDefinition(definition: GameOrgNodeDefinition): void {
  if (!hasStorage()) return;
  try {
    const normalized =
      normalizeGameOrgNodeDefinition(definition, DEFAULT_GAME_ORG_DEFINITION.id) ??
      DEFAULT_GAME_ORG_DEFINITION;
    window.localStorage.setItem(
      GAME_ORG_DEFINITION_STORAGE_KEY,
      JSON.stringify(normalized),
    );
  } catch {
    // Quota / serialization errors are non-fatal.
  }
}

export function resetGameOrgDefinition(): GameOrgNodeDefinition {
  const next = cloneGameOrgDefinition(DEFAULT_GAME_ORG_DEFINITION);
  if (hasStorage()) {
    try {
      window.localStorage.removeItem(GAME_ORG_DEFINITION_STORAGE_KEY);
    } catch {
      // non-fatal
    }
  }
  return next;
}

function expertLabel(
  expert: GameExpertDefinition | undefined,
  fallback: string,
  locale: Locale,
): string {
  return expert ? localizedGameExpertName(expert, locale) : fallback;
}

function fallbackSkill(node: ResolvedGameOrgNode, locale: Locale): GameOrgSkillDefinition {
  if (locale !== 'zh-CN') {
    return {
      id: `${node.id}:consult`,
      label: `Consult ${node.label}`,
      summary: node.summary,
      prompt: `Act as ${node.label} for the following request, and provide actionable recommendations, risks, and acceptance criteria within that role's scope.`,
      collaboratorExpertIds: node.expertIds,
    };
  }
  return {
    id: `${node.id}:consult`,
    label: `调用${node.label}`,
    summary: node.summary,
    prompt: `请以${node.label}身份处理以下需求，并给出职责内的可执行建议、风险和验收标准。`,
    collaboratorExpertIds: node.expertIds,
  };
}

function buildCommandText(
  expert: GameExpertDefinition | undefined,
  prompt: string,
): string {
  return `${expert ? gameExpertSlashCommand(expert) : '/游戏专家'} ${prompt}`.trim();
}

function resolveSkill(
  skill: GameOrgSkillDefinition,
  nodeId: string,
  primaryExpert: GameExpertDefinition | undefined,
  expertById: Map<string, GameExpertDefinition>,
  locale: Locale,
): ResolvedGameOrgSkill {
  const localized = localizeGameOrgSkillText(nodeId, skill.id, locale, skill);
  const protocol = mergeGameOrgSkillProtocol(
    skill.protocol,
    createDefaultGameOrgSkillProtocol(
      {
        label: localized.label ?? skill.label,
        summary: localized.summary ?? skill.summary,
        prompt: localized.prompt ?? skill.prompt,
      },
      locale,
    ),
  );
  const collaboratorLabels = uniqueStrings(
    (skill.collaboratorExpertIds ?? [])
      .map((id) => expertById.get(id))
      .filter((expert): expert is GameExpertDefinition => Boolean(expert))
      .map((expert) => localizedGameExpertName(expert, locale)),
  );
  return {
    ...skill,
    ...localized,
    protocol,
    commandText: buildCommandText(
      primaryExpert,
      formatGameOrgSkillPrompt(localized.prompt ?? skill.prompt, protocol, locale),
    ),
    collaboratorLabels,
  };
}

function resolveNode(
  definition: GameOrgNodeDefinition,
  expertById: Map<string, GameExpertDefinition>,
  locale: Locale,
  parentPath: string[],
): ResolvedGameOrgNode {
  const primaryExpertForLabel = (definition.expertIds ?? [])
    .map((id) => expertById.get(id))
    .find((expert): expert is GameExpertDefinition => Boolean(expert));
  const localizedDefinition = localizeGameOrgNodeText(definition.id, locale, {
    label: definition.label,
    summary: definition.summary,
    role: definition.role,
  });
  const label =
    localizedDefinition.label ||
    expertLabel(primaryExpertForLabel, definition.id, locale);

  const expertIds = uniqueStrings(definition.expertIds ?? []).filter((id) =>
    expertById.has(id),
  );
  const experts = expertIds
    .map((id) => expertById.get(id))
    .filter((expert): expert is GameExpertDefinition => Boolean(expert));

  const children = (definition.children ?? []).map((child) =>
    resolveNode(child, expertById, locale, [...parentPath, label]),
  );

  const primaryExpert = experts[0];
  const path = [...parentPath, label];
  const summary =
    localizedDefinition.summary ??
    primaryExpert?.summary ??
    (locale === 'zh-CN'
      ? `${label} 的项目职责。`
      : `${label} project responsibilities.`);
  const role =
    localizedDefinition.role ??
    (locale === 'zh-CN' ? primaryExpert?.role : undefined) ??
    summary;
  const groupLabels = uniqueStrings(
    experts.map((expert) => localizedGameGroupLabel(expert.group, locale)),
  );
  const collaboratorLabels = uniqueStrings([
    ...experts.map((expert) => localizedGameExpertName(expert, locale)),
    ...children.map((child) => child.label),
  ]);
  const profile = mergeGameOrgRoleProfile(
    definition.profile,
    createDefaultGameOrgRoleProfile(
      {
        label,
        summary,
        role,
        collaboratorLabels,
      },
      locale,
    ),
  );

  const node: ResolvedGameOrgNode = {
    id: definition.id,
    label,
    icon: definition.icon ?? (children.length > 0 ? 'team' : 'gameplay'),
    summary,
    role,
    profile,
    path,
    expertIds,
    experts,
    groupLabels,
    commandText: primaryExpert
      ? `${gameExpertSlashCommand(primaryExpert)} `
      : `${localizedGameExpertRootCommand(locale)} `,
    skills: [],
    children,
  };

  const skills =
    definition.skills !== undefined ? definition.skills : [fallbackSkill(node, locale)];
  node.skills = skills.map((skill) =>
    resolveSkill(skill, definition.id, primaryExpert, expertById, locale),
  );
  return node;
}

export function buildGameOrgTree(
  settings: GameExpertSettings,
  locale: Locale,
  definition: GameOrgNodeDefinition = DEFAULT_GAME_ORG_DEFINITION,
): ResolvedGameOrgNode {
  const normalized = normalizeGameExpertSettings(settings);
  const catalog = getGameExpertCatalog(normalized);
  const expertById = new Map(catalog.map((expert) => [expert.id, expert]));
  const rootDefinition =
    normalizeGameOrgNodeDefinition(definition, DEFAULT_GAME_ORG_DEFINITION.id) ??
    DEFAULT_GAME_ORG_DEFINITION;
  return resolveNode(rootDefinition, expertById, locale, []);
}

export function flattenGameOrgNodes(root: ResolvedGameOrgNode): ResolvedGameOrgNode[] {
  return [root, ...root.children.flatMap(flattenGameOrgNodes)];
}

export function findGameOrgNode(
  root: ResolvedGameOrgNode,
  id: string,
): ResolvedGameOrgNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const match = findGameOrgNode(child, id);
    if (match) return match;
  }
  return null;
}

function gameOrgSkillBinding(
  role: ResolvedGameOrgNode,
  skill: ResolvedGameOrgSkill,
): GameOrgSkillBinding {
  return {
    roleId: role.id,
    roleLabel: role.label,
    skillId: skill.id,
    skillLabel: skill.label,
    collaboratorExpertIds: [...(skill.collaboratorExpertIds ?? [])],
    collaboratorLabels: [...skill.collaboratorLabels],
  };
}

export function collectGameOrgSkillBindings(
  root: ResolvedGameOrgNode,
  nodeId: string,
): GameOrgSkillBindingOverview {
  const selectedNode = findGameOrgNode(root, nodeId);
  if (!selectedNode) return { own: [], incoming: [] };

  const selectedExpertIds = new Set(selectedNode.expertIds);
  const own = selectedNode.skills.map((skill) =>
    gameOrgSkillBinding(selectedNode, skill),
  );
  const incoming = flattenGameOrgNodes(root)
    .filter((node) => node.id !== selectedNode.id)
    .flatMap((node) =>
      node.skills
        .filter((skill) =>
          (skill.collaboratorExpertIds ?? []).some((expertId) =>
            selectedExpertIds.has(expertId),
          ),
        )
        .map((skill) => gameOrgSkillBinding(node, skill)),
    );

  return { own, incoming };
}

function normalizedSearchText(values: readonly string[]): string {
  return values.join(' ').toLocaleLowerCase();
}

function uniqueTerms(values: readonly string[]): string[] {
  return uniqueStrings(values.map((value) => value.toLocaleLowerCase()));
}

function cjkBigrams(value: string): string[] {
  const out: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    out.push(value.slice(index, index + 2));
  }
  return out;
}

const GAME_ORG_QUERY_EXPANSIONS: Array<{
  triggers: readonly string[];
  terms: readonly string[];
}> = [
  {
    triggers: ['攻击', '战斗', '打击', '连招', '伤害', 'combat', 'attack'],
    terms: ['玩法', '机制', '状态机', '输入', '反馈', '手感', '客户端', '动画'],
  },
  {
    triggers: ['性能', '帧率', '卡顿', '内存', '加载', 'fps', 'performance'],
    terms: ['性能预算', '性能排查', '剖析', '优化', 'cpu', 'gpu', '内存', '加载'],
  },
  {
    triggers: ['美术', '角色', '场景', 'shader', '特效', '材质', '2d', '3d'],
    terms: ['美术', '角色', '场景', '特效', 'shader', '规格', '可读性'],
  },
  {
    triggers: ['测试', 'bug', '验收', '回归', 'qa'],
    terms: ['qa', '测试', '验收', '回归', '复现', '质量'],
  },
  {
    triggers: ['联网', '后端', '同步', '服务器', 'network', 'backend'],
    terms: ['联网', '后端', '同步', '安全', '服务器', '接口'],
  },
  {
    triggers: ['关卡', '地图', '路径', '引导', 'level'],
    terms: ['关卡', '路径', '引导', '节奏', '空间', '难度'],
  },
];

function extractRecommendationTerms(query: string): Map<string, number> {
  const normalized = query.toLocaleLowerCase();
  const terms = new Map<string, number>();
  const add = (term: string, weight: number) => {
    const trimmed = term.trim().toLocaleLowerCase();
    if (trimmed.length < 2) return;
    terms.set(trimmed, Math.max(terms.get(trimmed) ?? 0, weight));
  };

  const parts = normalized.match(/[a-z0-9]+|[\p{Script=Han}]+/gu) ?? [];
  for (const part of parts) {
    add(part, 1);
    if (/^[\p{Script=Han}]+$/u.test(part) && part.length > 2) {
      for (const gram of cjkBigrams(part)) add(gram, 0.72);
    }
  }

  for (const expansion of GAME_ORG_QUERY_EXPANSIONS) {
    if (!expansion.triggers.some((trigger) => normalized.includes(trigger))) continue;
    for (const term of expansion.terms) add(term, 0.62);
  }

  return terms;
}

function scoreRecommendationTerm(
  term: string,
  weight: number,
  texts: {
    roleLabel: string;
    roleBody: string;
    skillLabel: string;
    skillBody: string;
    collaboratorBody: string;
  },
): number {
  let score = 0;
  if (texts.skillLabel.includes(term)) score += 130 * weight;
  if (texts.skillBody.includes(term)) score += 74 * weight;
  if (texts.roleLabel.includes(term)) score += 72 * weight;
  if (texts.roleBody.includes(term)) score += 36 * weight;
  if (texts.collaboratorBody.includes(term)) score += 22 * weight;
  return score;
}

export function recommendGameOrgSkills(
  root: ResolvedGameOrgNode,
  query: string,
  options: RecommendGameOrgSkillsOptions = {},
): GameOrgSkillRecommendation[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];

  const terms = extractRecommendationTerms(normalizedQuery);
  if (terms.size === 0) return [];

  const recommendations = flattenGameOrgNodes(root).flatMap((node) => {
    const roleLabel = normalizedSearchText([node.label, node.id, node.path.join(' ')]);
    const roleBody = normalizedSearchText([
      node.summary,
      node.role,
      node.profile.position,
      ...node.profile.responsibilities,
      ...node.profile.scenarios,
      ...node.profile.deliverables,
      ...node.profile.collaborators,
      ...node.groupLabels,
      ...node.expertIds,
      ...node.experts.flatMap((expert) => [
        expert.id,
        expert.name,
        expert.summary,
        expert.role,
        ...expert.triggers,
      ]),
    ]);

    return node.skills.map((skill) => {
      const skillLabel = normalizedSearchText([skill.label, skill.id]);
      const skillBody = normalizedSearchText([
        skill.summary,
        skill.prompt,
        skill.protocol.triggerConditions,
        skill.protocol.inputs,
        ...skill.protocol.executionSteps,
        skill.protocol.toolsAndResources,
        skill.protocol.outputs,
        skill.protocol.acceptanceCriteria,
      ]);
      const collaboratorBody = normalizedSearchText([
        ...(skill.collaboratorExpertIds ?? []),
        ...skill.collaboratorLabels,
      ]);
      const matchedTerms: string[] = [];
      let score = 0;

      for (const [term, weight] of terms) {
        const termScore = scoreRecommendationTerm(term, weight, {
          roleLabel,
          roleBody,
          skillLabel,
          skillBody,
          collaboratorBody,
        });
        if (termScore <= 0) continue;
        score += termScore;
        matchedTerms.push(term);
      }

      if (skillBody.includes(normalizedQuery) || skillLabel.includes(normalizedQuery)) {
        score += 180;
      }
      if (roleBody.includes(normalizedQuery) || roleLabel.includes(normalizedQuery)) {
        score += 88;
      }

      return {
        roleId: node.id,
        roleLabel: node.label,
        rolePath: [...node.path],
        skillId: skill.id,
        skillLabel: skill.label,
        skillSummary: skill.summary,
        commandText: skill.commandText,
        collaboratorLabels: [...skill.collaboratorLabels],
        score,
        matchedTerms: uniqueTerms(matchedTerms),
      };
    });
  });

  return recommendations
    .filter((recommendation) => recommendation.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, options.limit ?? 5);
}

function taskPlanReason(
  recommendation: GameOrgSkillRecommendation,
  locale: Locale,
): string {
  const terms = recommendation.matchedTerms.slice(0, 3);
  if (locale !== 'zh-CN') {
    return terms.length > 0
      ? `Matched ${terms.join(', ')} and falls under ${recommendation.roleLabel}.`
      : `Falls under ${recommendation.roleLabel}.`;
  }
  return terms.length > 0
    ? `命中「${terms.join('、')}」，属于「${recommendation.roleLabel}」职责范围。`
    : `属于「${recommendation.roleLabel}」职责范围。`;
}

function taskPlanDeliverable(
  recommendation: GameOrgSkillRecommendation,
  locale: Locale,
): string {
  if (locale !== 'zh-CN') {
    return (
      recommendation.skillSummary ||
      `${recommendation.skillLabel} deliverable and handoff notes.`
    );
  }
  return (
    recommendation.skillSummary ||
    `「${recommendation.skillLabel}」对应的产出物和交接说明。`
  );
}

function formatGameOrgTaskPlanPrompt(
  query: string,
  steps: readonly GameOrgTaskPlanStep[],
  locale: Locale,
): string {
  if (locale !== 'zh-CN') {
    const lines = steps.map(
      (step) =>
        `${step.order}. ${step.roleLabel} / ${step.skillLabel}: ${step.deliverable}`,
    );
    return [
      `Create a multi-role execution plan for: ${query}`,
      '',
      'Use these role Skills in order:',
      ...lines,
      '',
      'For each step, include owner, inputs, action items, dependencies, risks, deliverables, and acceptance criteria.',
    ].join('\n');
  }

  const lines = steps.map(
    (step) => `${step.order}. ${step.roleLabel} / ${step.skillLabel}：${step.deliverable}`,
  );
  return [
    `请为以下任务生成多岗位执行方案：${query}`,
    '',
    '按顺序使用这些岗位 Skill：',
    ...lines,
    '',
    '每一步都要包含负责人、输入、执行项、依赖、风险、产出物和验收标准。',
  ].join('\n');
}

function formatGameOrgTaskPlanDocument(
  query: string,
  steps: readonly GameOrgTaskPlanStep[],
  locale: Locale,
): string {
  if (steps.length === 0) return '';

  if (locale !== 'zh-CN') {
    return [
      `# Multi-role Task Breakdown: ${query}`,
      '',
      ...steps.flatMap((step) => [
        `## Step ${step.order}: ${step.roleLabel} / ${step.skillLabel}`,
        '',
        `- Role path: ${step.rolePath.join(' / ')}`,
        `- Reason: ${step.reason}`,
        `- Deliverable: ${step.deliverable}`,
        `- Acceptance criteria: ${step.acceptanceCriteria}`,
        `- Collaborators: ${step.collaboratorLabels.join(', ') || 'None'}`,
        `- Matched terms: ${step.matchedTerms.join(', ') || 'None'}`,
        '',
      ]),
    ].join('\n');
  }

  return [
    `# 多岗位任务拆解：${query}`,
    '',
    ...steps.flatMap((step) => [
      `## 步骤 ${step.order}：${step.roleLabel} / ${step.skillLabel}`,
      '',
      `- 岗位路径：${step.rolePath.join(' / ')}`,
      `- 推荐理由：${step.reason}`,
      `- 产出物：${step.deliverable}`,
      `- 验收标准：${step.acceptanceCriteria}`,
      `- 协作对象：${step.collaboratorLabels.join('、') || '暂无'}`,
      `- 命中词：${step.matchedTerms.join('、') || '暂无'}`,
      '',
    ]),
  ].join('\n');
}

function formatGameOrgTaskPlanChecklist(
  query: string,
  steps: readonly GameOrgTaskPlanStep[],
  locale: Locale,
): string {
  if (steps.length === 0) return '';

  if (locale !== 'zh-CN') {
    return [
      `# Execution Checklist: ${query}`,
      '',
      ...steps.flatMap((step) => [
        `- [ ] Step ${step.order}: ${step.roleLabel} / ${step.skillLabel}`,
        `  - Deliverable: ${step.deliverable}`,
        `  - Acceptance: ${step.acceptanceCriteria}`,
        `  - Collaborators: ${step.collaboratorLabels.join(', ') || 'None'}`,
      ]),
    ].join('\n');
  }

  return [
    `# 执行待办清单：${query}`,
    '',
    ...steps.flatMap((step) => [
      `- [ ] 步骤 ${step.order}：${step.roleLabel} / ${step.skillLabel}`,
      `  - 产出物：${step.deliverable}`,
      `  - 验收：${step.acceptanceCriteria}`,
      `  - 协作对象：${step.collaboratorLabels.join('、') || '暂无'}`,
    ]),
  ].join('\n');
}

export function planGameOrgTask(
  root: ResolvedGameOrgNode,
  query: string,
  options: PlanGameOrgTaskOptions = {},
): GameOrgTaskPlan {
  const trimmedQuery = query.trim();
  const locale = options.locale ?? 'zh-CN';
  if (!trimmedQuery) {
    return {
      query: '',
      steps: [],
      commandText: '',
      documentText: '',
      checklistText: '',
    };
  }

  const targetLimit = Math.max(1, options.limit ?? 4);
  const recommendations = recommendGameOrgSkills(root, trimmedQuery, {
    limit: Math.max(targetLimit * 3, 8),
  });
  const selected: GameOrgSkillRecommendation[] = [];
  const usedRoles = new Set<string>();
  const usedSkills = new Set<string>();

  for (const recommendation of recommendations) {
    if (selected.length >= targetLimit) break;
    const skillKey = `${recommendation.roleId}:${recommendation.skillId}`;
    if (usedSkills.has(skillKey)) continue;
    if (usedRoles.has(recommendation.roleId) && selected.length < targetLimit - 1) {
      continue;
    }
    selected.push(recommendation);
    usedRoles.add(recommendation.roleId);
    usedSkills.add(skillKey);
  }

  for (const recommendation of recommendations) {
    if (selected.length >= targetLimit) break;
    const skillKey = `${recommendation.roleId}:${recommendation.skillId}`;
    if (usedSkills.has(skillKey)) continue;
    selected.push(recommendation);
    usedRoles.add(recommendation.roleId);
    usedSkills.add(skillKey);
  }

  const steps = selected.map<GameOrgTaskPlanStep>((recommendation, index) => ({
    order: index + 1,
    roleId: recommendation.roleId,
    roleLabel: recommendation.roleLabel,
    rolePath: [...recommendation.rolePath],
    skillId: recommendation.skillId,
    skillLabel: recommendation.skillLabel,
    skillSummary: recommendation.skillSummary,
    commandText: recommendation.commandText,
    collaboratorLabels: [...recommendation.collaboratorLabels],
    matchedTerms: [...recommendation.matchedTerms],
    reason: taskPlanReason(recommendation, locale),
    deliverable: taskPlanDeliverable(recommendation, locale),
    acceptanceCriteria:
      locale === 'zh-CN'
        ? '产出可执行、职责边界清楚、风险明确，并包含可验证的验收口径。'
        : 'The output is actionable, scoped, risk-aware, and has verifiable acceptance criteria.',
    score: recommendation.score,
  }));

  const commandText =
    steps.length > 0 ? formatGameOrgTaskPlanPrompt(trimmedQuery, steps, locale) : '';
  const documentText =
    steps.length > 0 ? formatGameOrgTaskPlanDocument(trimmedQuery, steps, locale) : '';
  const checklistText =
    steps.length > 0 ? formatGameOrgTaskPlanChecklist(trimmedQuery, steps, locale) : '';

  return {
    query: trimmedQuery,
    steps,
    commandText,
    documentText,
    checklistText,
  };
}
