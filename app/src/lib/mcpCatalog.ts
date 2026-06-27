import type { CliPlatform } from '@/lib/tauri';
import type { ProjectMcpTransport } from '@/lib/projectSettings';

/** Coarse grouping used for filtering the MCP registry. */
export type McpServerCategory =
  | 'filesystem'
  | 'vcs'
  | 'web'
  | 'search'
  | 'database'
  | 'memory'
  | 'automation'
  | 'productivity'
  | 'communication'
  | 'cloud'
  | 'devtools'
  | 'game'
  | 'ai';

export const MCP_CATEGORY_LABELS: Record<McpServerCategory, string> = {
  filesystem: '文件系统',
  vcs: '版本控制',
  web: '网页抓取',
  search: '搜索',
  database: '数据库',
  memory: '记忆/知识',
  automation: '浏览器自动化',
  productivity: '效率工具',
  communication: '协作沟通',
  cloud: '云服务',
  devtools: '开发工具',
  game: '游戏 / 引擎 / 图形',
  ai: 'AI / 模型',
};

const MCP_CATEGORY_LABELS_EN: Record<McpServerCategory, string> = {
  filesystem: 'File system',
  vcs: 'Version control',
  web: 'Web scraping',
  search: 'Search',
  database: 'Database',
  memory: 'Memory / knowledge',
  automation: 'Browser automation',
  productivity: 'Productivity',
  communication: 'Communication',
  cloud: 'Cloud services',
  devtools: 'Dev tools',
  game: 'Game / engine / graphics',
  ai: 'AI / models',
};

export function mcpCategoryLabel(
  category: McpServerCategory,
  locale?: string,
): string {
  if (locale && locale !== 'zh-CN') return MCP_CATEGORY_LABELS_EN[category];
  return MCP_CATEGORY_LABELS[category];
}

/** Optional prefetch command (npm -g / uv tool install) run before first use. */
export interface McpInstallCommand {
  label: string;
  command: string;
  args: string[];
  platforms?: CliPlatform[];
}

/** A required environment variable the user must fill before the server runs. */
export interface McpEnvVarSpec {
  key: string;
  label: string;
  /** Placeholder kept in the server env until the user supplies a real value. */
  placeholder: string;
  secret?: boolean;
}

export interface McpServerDefinition {
  id: string;
  title: string;
  category: McpServerCategory;
  description: string;
  transport: ProjectMcpTransport;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Remote MCP endpoint URL when the registry entry is not a local stdio server. */
  url?: string;
  /** Env vars that need user-provided secrets/config before connecting. */
  requiredEnv?: McpEnvVarSpec[];
  /** Human-readable install/runtime note. */
  install: string;
  /** Optional one-click prefetch commands. Most servers run via npx/uvx on demand. */
  installCommands?: McpInstallCommand[];
  sourceUrl: string;
  registryName?: string;
  connectionUrl?: string;
  version?: string;
  updatedAt?: string;
  /** Registry-only remote entries are discoverable, but not installable as local project MCP yet. */
  installable?: boolean;
  tags: string[];
  recommendationPriority: number;
  trust: 'official' | 'curated' | 'community' | 'registry';
  requiresUserApproval?: boolean;
}

export interface RankedMcpServerDefinition extends McpServerDefinition {
  searchScore: number;
}

function quoteArg(value: string): string {
  return /[\s"']/.test(value) ? JSON.stringify(value) : value;
}

export function mcpInstallCommandText(command: McpInstallCommand): string {
  return [command.command, ...command.args].map(quoteArg).join(' ');
}

/** Full command line preview for a catalog server (command + args). */
export function mcpCommandText(definition: McpServerDefinition): string {
  return [definition.command, ...definition.args].map(quoteArg).join(' ');
}

function commandLineText(command: string, args: readonly string[]): string {
  return [command, ...args].map(quoteArg).join(' ');
}

interface McpRegistryRemote {
  type?: string;
  url?: string;
}

interface McpRegistryHeader {
  name?: string;
  description?: string;
  value?: string;
  isRequired?: boolean;
  isSecret?: boolean;
}

interface McpRegistryArgument {
  name?: string;
  description?: string;
  type?: string;
  isRequired?: boolean;
  default?: string;
  value?: string;
  valueHint?: string;
  variables?: Record<string, McpRegistryArgument>;
}

interface McpRegistryEnvVar {
  name?: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
  value?: string;
}

interface McpRegistryTransport {
  type?: string;
  url?: string;
  headers?: McpRegistryHeader[];
}

interface McpRegistryPackage {
  registryType?: string;
  identifier?: string;
  version?: string;
  runtimeHint?: string;
  transport?: McpRegistryTransport;
  environmentVariables?: McpRegistryEnvVar[];
  packageArguments?: McpRegistryArgument[];
  runtimeArguments?: McpRegistryArgument[];
}

interface McpRegistryRepository {
  url?: string;
  source?: string;
  subfolder?: string;
}

interface McpRegistryServer {
  name?: string;
  title?: string;
  description?: string;
  version?: string;
  websiteUrl?: string;
  repository?: McpRegistryRepository;
  packages?: McpRegistryPackage[];
  remotes?: McpRegistryRemote[];
}

interface McpRegistryEntry {
  server?: McpRegistryServer;
  _meta?: Record<string, { isLatest?: boolean; updatedAt?: string; publishedAt?: string }>;
}

interface McpRegistryResponse {
  servers?: McpRegistryEntry[];
  metadata?: { nextCursor?: string; count?: number };
}

const MCP_REGISTRY_BASE = 'https://registry.modelcontextprotocol.io/v0/servers';
const MCP_REGISTRY_PAGE_LIMIT = 100;
const MCP_REGISTRY_PREVIEW_PAGES = 3;
const LOBEHUB_MARKET_BASE_URL = 'https://market.lobehub.com';

interface LobeHubPluginItem {
  capabilities?: {
    prompts?: boolean;
    resources?: boolean;
    tools?: boolean;
  };
  category?: string;
  connectionType?: string;
  createdAt?: string;
  description?: string;
  github?: {
    url?: string;
  };
  identifier?: string;
  installationMethods?: string;
  isOfficial?: boolean;
  isValidated?: boolean;
  name?: string;
  tags?: string[];
  updatedAt?: string;
  version?: string;
}

interface LobeHubPluginListResponse {
  items?: LobeHubPluginItem[];
}

function compactText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    signal,
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

function isLobeHubAuthRequiredError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /(?:401|403|missing bearer|credentials)/i.test(message);
}

function fetchMcpRegistryPage(
  cursor: string | undefined,
  query: string,
  signal?: AbortSignal,
): Promise<McpRegistryResponse> {
  const params = new URLSearchParams({
    limit: String(MCP_REGISTRY_PAGE_LIMIT),
    version: 'latest',
  });
  if (query) params.set('search', query);
  if (cursor) params.set('cursor', cursor);
  return fetchJson<McpRegistryResponse>(`${MCP_REGISTRY_BASE}?${params}`, signal);
}

function slugFromMcpName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'mcp-server';
}

function mcpRegistryMeta(entry: McpRegistryEntry): {
  isLatest: boolean;
  updatedAt?: string;
} {
  const official = entry._meta?.['io.modelcontextprotocol.registry/official'];
  return {
    isLatest: official?.isLatest === true,
    updatedAt: official?.updatedAt || official?.publishedAt,
  };
}

function inferMcpCategory(server: McpRegistryServer): McpServerCategory {
  const text = [
    server.name,
    server.title,
    server.description,
    server.repository?.url,
    server.repository?.subfolder,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const includesAny = (patterns: RegExp[]) => patterns.some((pattern) => pattern.test(text));
  if (includesAny([/\bfile(system)?\b/, /\bstorage\b/, /\bs3\b/])) return 'filesystem';
  if (includesAny([/\bgit(hub|lab)?\b/, /\brepo(sitory)?\b/, /\bpull request\b/, /\bissue\b/])) {
    return 'vcs';
  }
  if (includesAny([/\bsearch\b/, /\bweb search\b/, /\bbrave\b/, /\btavily\b/])) return 'search';
  if (includesAny([/\bpostgres\b/, /\bsqlite\b/, /\bmysql\b/, /\bdatabase\b/, /\bsql\b/])) {
    return 'database';
  }
  if (includesAny([/\bmemory\b/, /\bknowledge\b/, /\bgraph\b/])) return 'memory';
  if (includesAny([/\bbrowser\b/, /\bplaywright\b/, /\bpuppeteer\b/, /\bautomation\b/])) {
    return 'automation';
  }
  if (includesAny([/\bslack\b/, /\bdiscord\b/, /\bemail\b/, /\bmail\b/, /\bchat\b/])) {
    return 'communication';
  }
  if (includesAny([/\bnotion\b/, /\bcalendar\b/, /\bdocs?\b/, /\bworkflow\b/])) {
    return 'productivity';
  }
  if (
    includesAny([
      /\bgame\b/,
      /\bunity\b/,
      /\bunreal\b/,
      /\bgodot\b/,
      /\bblender\b/,
      /\bshader\b/,
      /\brenderdoc\b/,
      /\bgraphics\b/,
      /\bgamedev\b/,
    ])
  ) {
    return 'game';
  }
  if (includesAny([/\bai\b/, /\bllm\b/, /\bmodel\b/, /\binference\b/, /\bagent\b/])) return 'ai';
  if (includesAny([/\bdev(tool)?s?\b/, /\bsdk\b/, /\bapi\b/])) return 'devtools';
  return 'cloud';
}

function pickBestMcpPackage(packages: readonly McpRegistryPackage[]): McpRegistryPackage | null {
  return (
    packages.find((pkg) => pkg.registryType === 'npm' && pkg.transport?.type === 'stdio') ??
    packages.find((pkg) => pkg.transport?.type === 'stdio') ??
    packages.find((pkg) => compactText(pkg.identifier)) ??
    null
  );
}

function mcpPackageCommand(pkg: McpRegistryPackage): string {
  const hint = compactText(pkg.runtimeHint);
  if (hint) return hint;
  switch (compactText(pkg.registryType)) {
    case 'npm':
      return 'npx';
    case 'pypi':
      return 'uvx';
    case 'oci':
      return 'docker';
    default:
      return 'npx';
  }
}

function mcpRegistryArgumentValue(arg: McpRegistryArgument): string {
  const name = compactText(arg.name);
  const fixedValue = compactText(arg.value);
  const defaultValue = compactText(arg.default);
  const valueHint = compactText(arg.valueHint);
  if (fixedValue) return fixedValue;
  if (defaultValue) return defaultValue;
  if (valueHint) return `{${valueHint}}`;
  return name ? `{${name.replace(/^-+/, '')}}` : '';
}

function appendMcpRegistryArguments(args: string[], registryArgs: readonly McpRegistryArgument[]): void {
  for (const arg of registryArgs) {
    if (!arg.isRequired && !compactText(arg.value) && !compactText(arg.default)) continue;
    const value = mcpRegistryArgumentValue(arg);
    const name = compactText(arg.name);
    if (!value) continue;
    if (arg.type === 'positional') {
      args.push(value);
    } else if (name) {
      args.push(name.startsWith('-') ? name : `--${name}`, value);
    }
  }
}

function mcpPackageArgs(pkg: McpRegistryPackage): string[] {
  const identifier = compactText(pkg.identifier);
  const args: string[] = [];
  const runtimeArgs = pkg.runtimeArguments ?? [];
  switch (compactText(pkg.registryType)) {
    case 'npm':
      if (runtimeArgs.length > 0) appendMcpRegistryArguments(args, runtimeArgs);
      else args.push('-y');
      args.push(identifier);
      break;
    case 'pypi':
      appendMcpRegistryArguments(args, runtimeArgs);
      args.push(identifier);
      break;
    case 'oci':
      args.push('run', '-i', '--rm');
      appendMcpRegistryArguments(args, runtimeArgs);
      args.push(identifier);
      break;
    default:
      appendMcpRegistryArguments(args, runtimeArgs);
      args.push(identifier);
      break;
  }

  appendMcpRegistryArguments(args, pkg.packageArguments ?? []);

  return args.filter(Boolean);
}

function registryPackageRequiresUserInput(pkg: McpRegistryPackage): boolean {
  const requiresArgInput = (arg: McpRegistryArgument): boolean =>
    Object.values(arg.variables ?? {}).some((variable) => variable.isRequired === true);
  return [...(pkg.runtimeArguments ?? []), ...(pkg.packageArguments ?? [])].some(
    (arg) =>
      (arg.isRequired === true && !compactText(arg.value) && !compactText(arg.default)) ||
      requiresArgInput(arg),
  );
}

function registryEnvSpecs(pkg: McpRegistryPackage): McpEnvVarSpec[] {
  return (pkg.environmentVariables ?? [])
    .map((item): McpEnvVarSpec | null => {
      const key = compactText(item.name);
      if (!key || !item.isRequired) return null;
      return {
        key,
        label: compactText(item.description) || key,
        placeholder: compactText(item.value) || compactText(item.default) || `${key}=...`,
        secret: item.isSecret === true,
      };
    })
    .filter((item): item is McpEnvVarSpec => Boolean(item));
}

function registryPackageEnv(pkg: McpRegistryPackage): Record<string, string> {
  return Object.fromEntries(
    (pkg.environmentVariables ?? [])
      .map((item): [string, string] | null => {
        const key = compactText(item.name);
        if (!key) return null;
        return [key, compactText(item.value) || compactText(item.default)];
      })
      .filter((item): item is [string, string] => Boolean(item)),
  );
}

function registryHeadersRequireUserApproval(remotes: readonly McpRegistryRemote[] = []): boolean {
  return remotes.some((remote) =>
    (remote as { headers?: McpRegistryHeader[] }).headers?.some(
      (header) => header.isRequired || header.isSecret,
    ),
  );
}

function registryServerToDefinition(entry: McpRegistryEntry): McpServerDefinition | null {
  const server = entry.server ?? {};
  const name = compactText(server.name);
  if (!name) return null;
  const remote = server.remotes?.find((item) => compactText(item.url)) ?? null;
  const remoteUrl = compactText(remote?.url);
  const remoteType = compactText(remote?.type) || 'streamable-http';
  const installablePackage = pickBestMcpPackage(server.packages ?? []);
  const packageTransport = compactText(installablePackage?.transport?.type);
  const packageIdentifier = compactText(installablePackage?.identifier);
  const command =
    installablePackage && packageTransport === 'stdio' && packageIdentifier
      ? mcpPackageCommand(installablePackage)
      : '';
  const args = command && installablePackage ? mcpPackageArgs(installablePackage) : [];
  const requiredEnv = installablePackage ? registryEnvSpecs(installablePackage) : [];
  const sourceUrl =
    compactText(server.websiteUrl) ||
    compactText(server.repository?.url) ||
    remoteUrl ||
    'https://registry.modelcontextprotocol.io';
  const title = compactText(server.title) || name;
  const meta = mcpRegistryMeta(entry);
  const installable = Boolean(command);
  const packageType = compactText(installablePackage?.registryType);
  const category = inferMcpCategory(server);
  const packageRequiresUserInput = installablePackage
    ? registryPackageRequiresUserInput(installablePackage)
    : false;
  return {
    id: `registry:${slugFromMcpName(name)}`,
    title,
    category,
    description: compactText(server.description) || 'MCP Registry server.',
    transport: installable ? 'stdio' : remoteType,
    command,
    args,
    env: installablePackage ? registryPackageEnv(installablePackage) : {},
    url: !installable && remoteUrl ? remoteUrl : undefined,
    install: installable
      ? `MCP Registry ${packageType || 'package'}：${commandLineText(command, args)}`
      : remoteUrl
        ? `远程 MCP（${remoteType}）：${remoteUrl}`
        : 'MCP Registry 条目；请查看来源获取连接方式。',
    sourceUrl,
    registryName: name,
    connectionUrl: installable ? undefined : remoteUrl || sourceUrl,
    version: compactText(server.version) || undefined,
    updatedAt: meta.updatedAt,
    installable,
    requiredEnv: requiredEnv.length > 0 ? requiredEnv : undefined,
    tags: [
      'mcp',
      'registry',
      packageType,
      packageIdentifier,
      remoteType,
      compactText(server.repository?.source),
      compactText(server.repository?.subfolder),
    ].filter(Boolean),
    recommendationPriority: installable ? 36 : 20,
    trust: 'registry',
    requiresUserApproval:
      requiredEnv.length > 0 ||
      packageRequiresUserInput ||
      registryHeadersRequireUserApproval(server.remotes),
  };
}

export async function loadMcpRegistryServers(
  signal?: AbortSignal,
  options: { query?: string; maxPages?: number } = {},
): Promise<McpServerDefinition[]> {
  const query = compactText(options.query);
  const maxPages = Math.max(1, options.maxPages ?? (query ? 1 : MCP_REGISTRY_PREVIEW_PAGES));
  const entries: McpRegistryEntry[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const catalog = await fetchMcpRegistryPage(cursor, query, signal);
    entries.push(...(catalog.servers ?? []));
    cursor = compactText(catalog.metadata?.nextCursor) || undefined;
    if (!cursor || (catalog.servers ?? []).length === 0) break;
  }

  const byName = new Map<string, McpRegistryEntry>();
  for (const entry of entries) {
    const name = compactText(entry.server?.name);
    if (!name) continue;
    const existing = byName.get(name);
    if (!existing || mcpRegistryMeta(entry).isLatest) {
      byName.set(name, entry);
    }
  }

  const servers = Array.from(byName.values())
    .map(registryServerToDefinition)
    .filter((server): server is McpServerDefinition => Boolean(server));

  return dedupeMcpServers(servers);
}

function inferLobeHubMcpCategory(plugin: LobeHubPluginItem): McpServerCategory {
  return inferMcpCategory({
    name: plugin.identifier,
    title: plugin.name,
    description: plugin.description,
    repository: {
      url: plugin.github?.url,
      subfolder: plugin.category,
    },
  });
}

function lobeHubTransport(value: string): ProjectMcpTransport {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'stdio') return 'stdio';
  if (normalized === 'sse') return 'sse';
  if (normalized === 'http' || normalized === 'streamable-http') return 'streamable-http';
  return 'streamable-http';
}

export async function loadLobeHubMcpServers(
  signal?: AbortSignal,
  options: { query?: string } = {},
): Promise<McpServerDefinition[]> {
  const query = compactText(options.query);
  const params = new URLSearchParams({
    page: '1',
    pageSize: '80',
    sort: query ? 'relevance' : 'recommended',
    order: 'desc',
    locale: 'zh-CN',
  });
  if (query) params.set('q', query);
  let catalog: LobeHubPluginListResponse;
  try {
    catalog = await fetchJson<LobeHubPluginListResponse>(
      `${LOBEHUB_MARKET_BASE_URL}/api/v1/plugins?${params}`,
      signal,
    );
  } catch (err) {
    if (isLobeHubAuthRequiredError(err)) return [];
    throw err;
  }
  const servers = (catalog.items ?? [])
    .map((plugin): McpServerDefinition | null => {
      const identifier = compactText(plugin.identifier);
      if (!identifier) return null;
      const title = compactText(plugin.name) || identifier;
      const transport = lobeHubTransport(compactText(plugin.connectionType));
      const sourceUrl =
        compactText(plugin.github?.url) ||
        `https://lobehub.com/mcp/${encodeURIComponent(identifier)}`;
      const capabilities = [
        plugin.capabilities?.tools ? 'tools' : '',
        plugin.capabilities?.resources ? 'resources' : '',
        plugin.capabilities?.prompts ? 'prompts' : '',
      ].filter(Boolean);
      return {
        id: `lobehub:${slugFromMcpName(identifier)}`,
        title,
        category: inferLobeHubMcpCategory(plugin),
        description:
          compactText(plugin.description) || `${title} LobeHub MCP marketplace entry.`,
        transport,
        command: '',
        args: [],
        env: {},
        install:
          compactText(plugin.installationMethods) ||
          'LobeHub MCP 市场条目；请查看来源获取安装或连接配置。',
        sourceUrl,
        registryName: identifier,
        connectionUrl: `https://lobehub.com/mcp/${encodeURIComponent(identifier)}`,
        version: compactText(plugin.version) || undefined,
        updatedAt: compactText(plugin.updatedAt) || compactText(plugin.createdAt) || undefined,
        installable: false,
        tags: [
          'mcp',
          'lobehub',
          transport,
          compactText(plugin.category),
          ...capabilities,
          ...(plugin.tags ?? []),
        ]
          .filter(Boolean)
          .map((tag) => tag.toLowerCase()),
        recommendationPriority: plugin.isOfficial ? 35 : plugin.isValidated ? 30 : 24,
        trust: plugin.isOfficial ? 'official' : plugin.isValidated ? 'registry' : 'community',
      };
    })
    .filter((server): server is McpServerDefinition => Boolean(server));

  return dedupeMcpServers(servers);
}

export async function loadOnlineMcpCatalogServers(
  signal?: AbortSignal,
  options: { query?: string } = {},
): Promise<McpServerDefinition[]> {
  const query = compactText(options.query);
  const settled = await Promise.allSettled([
    loadMcpRegistryServers(signal, { query }),
    loadLobeHubMcpServers(signal, { query }),
  ]);
  if (signal?.aborted) return [];
  const servers = settled
    .filter(
      (result): result is PromiseFulfilledResult<McpServerDefinition[]> =>
        result.status === 'fulfilled',
    )
    .flatMap((result) => result.value);
  if (servers.length > 0) return dedupeMcpServers(servers);
  const firstError = settled.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (firstError) throw firstError.reason;
  return [];
}

export const MCP_CATALOG: McpServerDefinition[] = [
  {
    id: 'lobehub-mcp-market',
    title: 'LobeHub MCP 市场',
    category: 'devtools',
    description:
      'LobeHub MCP 市场索引，覆盖远程与本地 MCP 插件；在线接口可用时会加载具体条目。',
    transport: 'streamable-http',
    command: '',
    args: [],
    env: {},
    install: '打开 LobeHub MCP 市场查看安装方式；具体条目会在在线仓库加载成功后显示。',
    sourceUrl: 'https://lobehub.com/mcp',
    connectionUrl: 'https://lobehub.com/mcp',
    installable: false,
    tags: ['lobehub', 'mcp', 'market', 'registry'],
    recommendationPriority: 42,
    trust: 'registry',
  },
  {
    id: 'filesystem',
    title: 'Filesystem',
    category: 'filesystem',
    description: '在指定目录内安全地读取、写入、搜索文件，是最常用的本地 MCP。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '{workspace}'],
    env: {},
    install: '通过 npx 按需运行；首个参数为允许访问的目录（默认 {workspace}）。',
    sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    tags: ['file', 'fs', 'read', 'write', '本地', 'official'],
    recommendationPriority: 100,
    trust: 'official',
  },
  {
    id: 'git',
    title: 'Git',
    category: 'vcs',
    description: '读取仓库状态、提交历史、diff 并执行常见 Git 操作。',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-git', '--repository', '{workspace}'],
    env: {},
    install: '需要本地安装 uv / Python；通过 uvx 按需运行。',
    sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
    tags: ['git', 'vcs', 'commit', 'diff', 'official'],
    recommendationPriority: 95,
    trust: 'official',
  },
  {
    id: 'github',
    title: 'GitHub',
    category: 'vcs',
    description: '管理 GitHub 仓库、issue、PR，搜索代码与读取文件。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    requiredEnv: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub Personal Access Token',
        placeholder: 'ghp_xxx',
        secret: true,
      },
    ],
    install: '需要 GitHub Personal Access Token；通过 npx 按需运行。',
    sourceUrl: 'https://github.com/github/github-mcp-server',
    tags: ['github', 'pr', 'issue', 'repo', 'official'],
    recommendationPriority: 92,
    trust: 'official',
    requiresUserApproval: true,
  },
  {
    id: 'fetch',
    title: 'Fetch',
    category: 'web',
    description: '抓取网页并转换为适合 LLM 阅读的 Markdown 内容。',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    env: {},
    install: '需要本地安装 uv / Python；通过 uvx 按需运行。',
    sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    tags: ['fetch', 'web', 'http', 'scrape', 'markdown', 'official'],
    recommendationPriority: 88,
    trust: 'official',
  },
  {
    id: 'memory',
    title: 'Memory',
    category: 'memory',
    description: '基于知识图谱的持久记忆，让模型跨会话记住实体与关系。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    env: {},
    install: '通过 npx 按需运行；记忆默认存放在本地。',
    sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    tags: ['memory', 'knowledge', 'graph', '记忆', 'official'],
    recommendationPriority: 80,
    trust: 'official',
  },
  {
    id: 'sequential-thinking',
    title: 'Sequential Thinking',
    category: 'ai',
    description: '提供结构化的逐步推理工具，辅助复杂问题的分解与反思。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    env: {},
    install: '通过 npx 按需运行，无需额外配置。',
    sourceUrl:
      'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    tags: ['thinking', 'reasoning', 'plan', '推理', 'official'],
    recommendationPriority: 78,
    trust: 'official',
  },
  {
    id: 'everything',
    title: 'Everything (参考)',
    category: 'devtools',
    description: '官方参考服务器，演示 prompts / resources / tools 的全部能力，适合测试。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    env: {},
    install: '通过 npx 按需运行；主要用于调试 MCP 客户端。',
    sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/everything',
    tags: ['reference', 'demo', 'test', 'official'],
    recommendationPriority: 40,
    trust: 'official',
  },
  {
    id: 'playwright',
    title: 'Playwright',
    category: 'automation',
    description: 'Microsoft 官方浏览器自动化 MCP，可访问页面、点击、填写表单与截图。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    env: {},
    install: '通过 npx 按需运行；首次使用会下载浏览器内核。',
    sourceUrl: 'https://github.com/microsoft/playwright-mcp',
    tags: ['browser', 'playwright', 'automation', 'e2e', '自动化', 'curated'],
    recommendationPriority: 85,
    trust: 'curated',
  },
  {
    id: 'puppeteer',
    title: 'Puppeteer',
    category: 'automation',
    description: '基于 Puppeteer 的浏览器自动化，支持导航、截图与执行 JS。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    env: {},
    install: '通过 npx 按需运行；首次使用会下载 Chromium。',
    sourceUrl:
      'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/puppeteer',
    tags: ['browser', 'puppeteer', 'automation', 'screenshot', 'curated'],
    recommendationPriority: 70,
    trust: 'curated',
  },
  {
    id: 'brave-search',
    title: 'Brave Search',
    category: 'search',
    description: '通过 Brave Search API 进行网页与本地搜索。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: '' },
    requiredEnv: [
      {
        key: 'BRAVE_API_KEY',
        label: 'Brave Search API Key',
        placeholder: 'BSA...',
        secret: true,
      },
    ],
    install: '需要 Brave Search API Key；通过 npx 按需运行。',
    sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
    tags: ['search', 'brave', 'web', '搜索', 'curated'],
    recommendationPriority: 75,
    trust: 'curated',
    requiresUserApproval: true,
  },
  {
    id: 'tavily',
    title: 'Tavily Search',
    category: 'search',
    description: '面向 LLM 优化的 Tavily 搜索与网页提取服务。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'tavily-mcp@latest'],
    env: { TAVILY_API_KEY: '' },
    requiredEnv: [
      {
        key: 'TAVILY_API_KEY',
        label: 'Tavily API Key',
        placeholder: 'tvly-...',
        secret: true,
      },
    ],
    install: '需要 Tavily API Key；通过 npx 按需运行。',
    sourceUrl: 'https://github.com/tavily-ai/tavily-mcp',
    tags: ['search', 'tavily', 'web', 'rag', 'community'],
    recommendationPriority: 68,
    trust: 'community',
    requiresUserApproval: true,
  },
  {
    id: 'context7',
    title: 'Context7',
    category: 'devtools',
    description: '为模型按需提供最新的库 / 框架官方文档，减少 API 猜测。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp@latest'],
    env: {},
    install: '通过 npx 按需运行；可选填写 Upstash API Key 提升额度。',
    sourceUrl: 'https://github.com/upstash/context7',
    tags: ['docs', 'context', 'library', 'reference', '文档', 'community'],
    recommendationPriority: 82,
    trust: 'community',
  },
  {
    id: 'mcpmarket-auto-install',
    title: 'MCPMarket Auto Install',
    category: 'devtools',
    description:
      'mcpmarket.com 出品的 MCP 自动安装器：可搜索官方 MCP Registry、查看详情，并生成/写入其它 MCP server 配置。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcpmarket/mcp-auto-install@next'],
    env: {},
    install:
      '通过 npx 按需运行；工具本身会访问官方 MCP Registry，并可按目标客户端写入 MCP 配置。执行写入前请确认目标配置文件。',
    sourceUrl: 'https://github.com/CherryHQ/mcpmarket/tree/main/packages/mcp-auto-install',
    tags: ['mcpmarket', 'registry', 'auto-install', 'mcp', 'installer', 'community'],
    recommendationPriority: 66,
    trust: 'community',
    requiresUserApproval: true,
  },
  {
    id: 'postgres',
    title: 'PostgreSQL',
    category: 'database',
    description: '以只读方式查询 PostgreSQL，并暴露表结构作为资源。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', '{connectionString}'],
    env: {},
    requiredEnv: [
      {
        key: 'POSTGRES_CONNECTION_STRING',
        label: 'PostgreSQL 连接串',
        placeholder: 'postgresql://user:pass@host:5432/db',
        secret: true,
      },
    ],
    install: '将连接串作为最后一个参数；通过 npx 按需运行。',
    sourceUrl:
      'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/postgres',
    tags: ['database', 'postgres', 'sql', '数据库', 'curated'],
    recommendationPriority: 72,
    trust: 'curated',
    requiresUserApproval: true,
  },
  {
    id: 'sqlite',
    title: 'SQLite',
    category: 'database',
    description: '查询并分析本地 SQLite 数据库文件。',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-sqlite', '--db-path', '{workspace}/data.db'],
    env: {},
    install: '需要本地安装 uv / Python；通过 uvx 按需运行。',
    sourceUrl:
      'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/sqlite',
    tags: ['database', 'sqlite', 'sql', 'curated'],
    recommendationPriority: 64,
    trust: 'curated',
  },
  {
    id: 'slack',
    title: 'Slack',
    category: 'communication',
    description: '读取频道消息、发送消息并管理 Slack 工作区。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: '' },
    requiredEnv: [
      { key: 'SLACK_BOT_TOKEN', label: 'Slack Bot Token', placeholder: 'xoxb-...', secret: true },
      { key: 'SLACK_TEAM_ID', label: 'Slack Team ID', placeholder: 'T01234567' },
    ],
    install: '需要 Slack Bot Token 与 Team ID；通过 npx 按需运行。',
    sourceUrl:
      'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/slack',
    tags: ['slack', 'chat', 'communication', '协作', 'curated'],
    recommendationPriority: 55,
    trust: 'curated',
    requiresUserApproval: true,
  },
  {
    id: 'notion',
    title: 'Notion',
    category: 'productivity',
    description: '读取与更新 Notion 页面、数据库，整合知识库内容。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    env: { NOTION_TOKEN: '' },
    requiredEnv: [
      { key: 'NOTION_TOKEN', label: 'Notion Integration Token', placeholder: 'ntn_...', secret: true },
    ],
    install: '需要 Notion Integration Token；通过 npx 按需运行。',
    sourceUrl: 'https://github.com/makenotion/notion-mcp-server',
    tags: ['notion', 'docs', 'productivity', '笔记', 'community'],
    recommendationPriority: 60,
    trust: 'community',
    requiresUserApproval: true,
  },
  {
    id: 'time',
    title: 'Time',
    category: 'devtools',
    description: '提供当前时间与时区换算，弥补模型对时间的盲区。',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-time'],
    env: {},
    install: '需要本地安装 uv / Python；通过 uvx 按需运行。',
    sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
    tags: ['time', 'timezone', 'utility', 'official'],
    recommendationPriority: 50,
    trust: 'official',
  },
  // CATALOG_ENTRIES_PLACEHOLDER
  {
    id: 'blender-mcp',
    title: 'Blender MCP',
    category: 'game',
    description: '连接 Blender，用自然语言创建/编辑场景、材质与对象，并驱动 Python 脚本与渲染。',
    transport: 'stdio',
    command: 'uvx',
    args: ['blender-mcp'],
    env: {},
    install: '需要本地安装 uv / Python，并在 Blender 内安装 BlenderMCP 插件；通过 uvx 按需运行。',
    sourceUrl: 'https://github.com/ahujasid/blender-mcp',
    tags: ['blender', '3d', 'modeling', 'render', 'game', 'dcc', 'community'],
    recommendationPriority: 76,
    trust: 'community',
    requiresUserApproval: true,
  },
  {
    id: 'houdini-mcp',
    title: 'Houdini MCP',
    category: 'game',
    description:
      '连接 SideFX Houdini，通过本地插件与 stdio 桥接脚本创建和修改节点、执行 Python 代码并驱动程序化资产工作流。',
    transport: 'stdio',
    command: 'uv',
    args: ['run', '--directory', '{workspace}/houdini-mcp', 'python', 'houdini_mcp_server.py'],
    env: {},
    install:
      '需要 SideFX Houdini、uv / Python 3.12+；先 git clone wellingfeng/houdini-mcp，并把 Houdini 插件安装到 houdinimcp 脚本目录，在 Houdini 中启动本地服务（默认 localhost:9876）后再连接。',
    sourceUrl: 'https://github.com/wellingfeng/houdini-mcp',
    tags: [
      'houdini',
      'sidefx',
      'procedural',
      'nodes',
      'vfx',
      'dcc',
      'modeling',
      'game',
      'wellingfeng',
      'community',
    ],
    recommendationPriority: 75,
    trust: 'community',
    requiresUserApproval: true,
  },
  {
    id: 'unity-mcp',
    title: 'Unity MCP',
    category: 'game',
    description: '与 Unity 编辑器交互：管理资产、场景、脚本与组件，读取控制台日志并执行编辑器操作。',
    transport: 'stdio',
    command: 'uvx',
    args: ['--from', 'mcpforunityserver', 'mcp-for-unity', '--transport', 'stdio'],
    env: {},
    install: '需要 uv / Python，并在 Unity 内安装 wellingfeng/unity-mcp 包；首次连接需在编辑器中授权。',
    sourceUrl: 'https://github.com/wellingfeng/unity-mcp',
    tags: ['unity', 'csharp', 'editor', 'game', 'engine', 'wellingfeng', 'community'],
    recommendationPriority: 78,
    trust: 'community',
    requiresUserApproval: true,
  },
  {
    id: 'unreal-mcp',
    title: 'Unreal Engine MCP',
    category: 'game',
    description: '通过 Python/Remote Control 控制 Unreal 编辑器：创建 Actor、蓝图、关卡与编辑器自动化。',
    transport: 'stdio',
    command: 'uvx',
    args: ['unreal-mcp'],
    env: {},
    install: '需要 uv / Python，并在 UE 项目中启用 Python 与 Remote Control 插件；通过 uvx 按需运行。',
    sourceUrl: 'https://github.com/chongdashu/unreal-mcp',
    tags: ['unreal', 'ue5', 'cpp', 'blueprint', 'editor', 'game', 'engine', 'community'],
    recommendationPriority: 74,
    trust: 'community',
    requiresUserApproval: true,
  },
  {
    id: 'godot-mcp',
    title: 'Godot MCP',
    category: 'game',
    description: '驱动 Godot 引擎：运行项目、捕获调试输出、管理场景与脚本，辅助 GDScript 排错。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@coding-solo/godot-mcp'],
    env: { GODOT_PATH: '' },
    install: '需要本地安装 Godot；自动发现失败时填写 GODOT_PATH。通过 npx 按需运行。',
    sourceUrl: 'https://github.com/wellingfeng/godot-mcp',
    tags: ['godot', 'gdscript', 'editor', 'game', 'engine', 'wellingfeng', 'community'],
    recommendationPriority: 72,
    trust: 'community',
    requiresUserApproval: true,
  },
  {
    id: 'cocos-mcp-server',
    title: 'Cocos MCP',
    category: 'game',
    description: '连接 Cocos Creator 扩展服务，读取和操作场景、节点、资源与编辑器状态。',
    transport: 'streamable-http',
    command: '',
    args: [],
    env: {},
    url: 'http://localhost:3000/mcp',
    install:
      '需要将 wellingfeng/cocos-mcp-server 安装到项目 extensions/cocos-mcp-server，并在 Cocos Creator 中启用扩展。',
    sourceUrl: 'https://github.com/wellingfeng/cocos-mcp-server',
    connectionUrl: 'http://localhost:3000/mcp',
    tags: ['cocos', 'cocos creator', 'editor', 'game', 'engine', 'wellingfeng', 'community'],
    recommendationPriority: 71,
    trust: 'community',
    requiresUserApproval: true,
  },
  {
    id: '3dsmax-mcp',
    title: '3ds Max MCP',
    category: 'game',
    description:
      '连接 Autodesk 3ds Max（2023–2027），用自然语言创建对象、构建材质、管理修改器/控制器、捕获视口并驱动 MAXScript/插件工作流。',
    transport: 'stdio',
    command: 'uv',
    args: ['run', '--directory', '{workspace}/3dsmax-mcp', '3dsmax-mcp'],
    env: {},
    install:
      '需要 uv / Python 3.10+ 与 3ds Max 2023–2027；先 git clone wellingfeng/3dsmax-mcp 并执行 uv sync 与 uv run python install.py，再把 --directory 指向克隆目录后重启 3ds Max。',
    sourceUrl: 'https://github.com/wellingfeng/3dsmax-mcp',
    tags: ['3dsmax', '3ds max', 'autodesk', 'maxscript', 'dcc', 'modeling', 'game', 'wellingfeng', 'community'],
    recommendationPriority: 70,
    trust: 'community',
    requiresUserApproval: true,
  },
  {
    id: 'maya-mcp',
    title: 'Maya MCP',
    category: 'game',
    description:
      '通过 Maya 命令端口连接 Autodesk Maya（2023 / 2025），用自然语言创建对象、材质、曲线，执行建模操作并生成完整场景。',
    transport: 'stdio',
    command: 'python',
    args: ['{workspace}/MayaMCP/src/maya_mcp_server.py'],
    env: {},
    install:
      '需要 Python 3.10+；先 git clone wellingfeng/MayaMCP，创建 venv 并 pip install -r requirements.txt，再把 command 指向该 venv 的 python、参数指向 maya_mcp_server.py。Maya 端首次连接需点击 Allow All。',
    sourceUrl: 'https://github.com/wellingfeng/MayaMCP',
    tags: ['maya', 'autodesk', 'mel', 'python', 'dcc', 'modeling', 'game', 'wellingfeng', 'community'],
    recommendationPriority: 69,
    trust: 'community',
    requiresUserApproval: true,
  },
  {
    id: 'vibeue-mcp',
    title: 'VibeUE (Unreal)',
    category: 'game',
    description:
      '在 Unreal Engine 5.7+ 内通过本地 MCP 代理操作蓝图、材质、控件、地形、动画与关卡，并可捕获视口截图做可视化自检。',
    transport: 'streamable-http',
    command: '',
    args: [],
    env: {},
    url: 'http://127.0.0.1:8089/mcp',
    install:
      '需要在 UE 项目中安装 VibeUE 插件并填写 VibeUE API Key（vibeue.com 免费申请）；在插件设置与 vibeue-proxy.json 中设置同一 bearer token，启动本地代理后连接 http://127.0.0.1:8089/mcp。',
    sourceUrl: 'https://github.com/kevinpbuckley/VibeUE',
    connectionUrl: 'http://127.0.0.1:8089/mcp',
    tags: ['unreal', 'ue5', 'vibeue', 'blueprint', 'material', 'editor', 'game', 'engine', 'community'],
    recommendationPriority: 73,
    trust: 'community',
    requiresUserApproval: true,
  },
];

function searchableMcpText(server: McpServerDefinition): string {
  return [
    server.id,
    server.title,
    server.description,
    server.category,
    MCP_CATEGORY_LABELS[server.category],
    server.registryName,
    server.command,
    ...server.args,
    server.connectionUrl,
    server.url,
    server.sourceUrl,
    ...server.tags,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function compactMcpKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

function normalizedMcpUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    return `${url.hostname.replace(/^www\./, '')}${url.pathname}`
      .replace(/\/+$/, '')
      .replace(/\.git$/i, '')
      .toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
  }
}

function mcpDedupeKeys(server: McpServerDefinition): string[] {
  const keys = new Set<string>();
  const add = (prefix: string, value?: string) => {
    const compact = compactMcpKey(value ?? '');
    if (compact.length > 2) keys.add(`${prefix}:${compact}`);
  };
  add('id', server.id.replace(/^registry:/, ''));
  add('title', server.title);
  add('name', server.registryName);
  const source = normalizedMcpUrl(server.sourceUrl);
  const connection = normalizedMcpUrl(server.connectionUrl ?? server.url ?? '');
  if (source) add('url', source);
  if (connection) add('url', connection);
  return Array.from(keys);
}

export function dedupeMcpServers(
  servers: readonly McpServerDefinition[],
): McpServerDefinition[] {
  const seen = new Map<string, McpServerDefinition>();
  const out: McpServerDefinition[] = [];
  for (const server of servers) {
    const keys = mcpDedupeKeys(server);
    if (
      keys.some((key) => {
        const existing = seen.get(key);
        if (!existing) return false;
        return !(
          key.startsWith('title:') &&
          existing.trust === 'registry' &&
          server.trust === 'registry'
        );
      })
    ) {
      continue;
    }
    out.push(server);
    keys.forEach((key) => seen.set(key, server));
  }
  return out;
}

export function mergedMcpCatalog(
  registryServers: readonly McpServerDefinition[] = [],
): McpServerDefinition[] {
  return dedupeMcpServers([...MCP_CATALOG, ...registryServers]);
}

/** Filter + rank the registry by a free-text query. Empty query keeps catalog order. */
export function rankMcpServers(
  query = '',
  registryServers: readonly McpServerDefinition[] = [],
): RankedMcpServerDefinition[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  return mergedMcpCatalog(registryServers).map((server) => {
    const haystack = searchableMcpText(server);
    const matchedTerms = terms.filter((term) => haystack.includes(term)).length;
    const titleBoost = terms.some((term) =>
      server.title.toLowerCase().includes(term),
    )
      ? 50
      : 0;
    const searchScore =
      terms.length === 0
        ? server.recommendationPriority
        : matchedTerms * 100 + titleBoost + server.recommendationPriority;
    return { ...server, searchScore };
  })
    .filter((server) => {
      if (terms.length === 0) return true;
      const haystack = searchableMcpText(server);
      return terms.every((term) => haystack.includes(term));
    })
    .sort(
      (a, b) =>
        b.searchScore - a.searchScore ||
        b.recommendationPriority - a.recommendationPriority ||
        a.title.localeCompare(b.title, 'zh-CN'),
    );
}

export function mcpServerById(id: string): McpServerDefinition | undefined {
  return MCP_CATALOG.find((server) => server.id === id);
}
