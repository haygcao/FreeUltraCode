import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadLobeHubMcpServers,
  loadMcpRegistryServers,
  MCP_CATALOG,
  rankMcpServers,
  type McpServerDefinition,
} from './mcpCatalog';

const registryServer = (
  patch: Partial<McpServerDefinition>,
): McpServerDefinition => ({
  id: 'registry:test',
  title: 'Test MCP',
  category: 'cloud',
  description: 'Remote MCP server',
  transport: 'streamable-http',
  command: '',
  args: [],
  env: {},
  install: '远程 MCP',
  sourceUrl: 'https://example.com/mcp',
  connectionUrl: 'https://example.com/mcp',
  tags: ['mcp', 'registry'],
  recommendationPriority: 20,
  trust: 'registry',
  installable: false,
  ...patch,
});

describe('mcpCatalog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads all MCP Registry pages and keeps only the latest version for each server name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const firstPage = !url.includes('cursor=');
        return new Response(
          JSON.stringify(
            firstPage
              ? {
                  servers: [
                    {
                      server: {
                        name: 'example.com/docs',
                        title: 'Docs MCP',
                        description: 'Old docs server',
                        version: '1.0.0',
                        remotes: [
                          { type: 'streamable-http', url: 'https://old.example.com/mcp' },
                        ],
                      },
                      _meta: {
                        'io.modelcontextprotocol.registry/official': { isLatest: false },
                      },
                    },
                  ],
                  metadata: { nextCursor: 'page-2', count: 1 },
                }
              : {
                  servers: [
                    {
                      server: {
                        name: 'example.com/docs',
                        title: 'Docs MCP',
                        description: 'New docs server',
                        version: '2.0.0',
                        remotes: [
                          { type: 'streamable-http', url: 'https://new.example.com/mcp' },
                        ],
                      },
                      _meta: {
                        'io.modelcontextprotocol.registry/official': { isLatest: true },
                      },
                    },
                  ],
                  metadata: { count: 1 },
                },
          ),
          { status: 200 },
        );
      }),
    );

    const servers = await loadMcpRegistryServers();

    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({
      title: 'Docs MCP',
      version: '2.0.0',
      connectionUrl: 'https://new.example.com/mcp',
      installable: false,
    });
  });

  it('turns installable MCP Registry packages into project-ready stdio definitions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            servers: [
              {
                server: {
                  name: 'io.github.example/secret-docs',
                  title: 'Secret Docs',
                  description: 'Reads private documentation',
                  version: '3.2.1',
                  repository: {
                    url: 'https://github.com/example/secret-docs',
                    source: 'github',
                  },
                  packages: [
                    {
                      registryType: 'npm',
                      identifier: '@example/secret-docs-mcp',
                      version: '3.2.1',
                      transport: { type: 'stdio' },
                      environmentVariables: [
                        {
                          name: 'SECRET_DOCS_TOKEN',
                          description: 'API token',
                          isRequired: true,
                          isSecret: true,
                          value: 'demo-token',
                        },
                      ],
                    },
                  ],
                },
                _meta: {
                  'io.modelcontextprotocol.registry/official': {
                    isLatest: true,
                    updatedAt: '2026-06-01T00:00:00Z',
                  },
                },
              },
            ],
            metadata: { count: 1 },
          }),
          { status: 200 },
        ),
      ),
    );

    const servers = await loadMcpRegistryServers();

    expect(servers[0]).toMatchObject({
      id: 'registry:io-github-example-secret-docs',
      title: 'Secret Docs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@example/secret-docs-mcp'],
      env: { SECRET_DOCS_TOKEN: 'demo-token' },
      installable: true,
      requiresUserApproval: true,
      requiredEnv: [
        {
          key: 'SECRET_DOCS_TOKEN',
          label: 'API token',
          placeholder: 'demo-token',
          secret: true,
        },
      ],
    });
  });

  it('preserves MCP Registry runtime values and named required package arguments', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            servers: [
              {
                server: {
                  name: 'io.github.example/filesystem',
                  title: 'Filesystem Tools',
                  description: 'Filesystem with allowed directories',
                  packages: [
                    {
                      registryType: 'npm',
                      identifier: '@example/filesystem-mcp',
                      transport: { type: 'stdio' },
                      runtimeArguments: [{ type: 'positional', value: '-y' }],
                      packageArguments: [
                        {
                          name: 'allowed-directories',
                          description: 'Allowed directories',
                          isRequired: true,
                          type: 'named',
                        },
                      ],
                    },
                  ],
                },
                _meta: {
                  'io.modelcontextprotocol.registry/official': { isLatest: true },
                },
              },
            ],
            metadata: { count: 1 },
          }),
          { status: 200 },
        ),
      ),
    );

    const servers = await loadMcpRegistryServers();

    expect(servers[0]).toMatchObject({
      command: 'npx',
      args: ['-y', '@example/filesystem-mcp', '--allowed-directories', '{allowed-directories}'],
      requiresUserApproval: true,
    });
  });

  it('merges registry MCP entries into the MCP catalog without duplicate local entries', () => {
    const ranked = rankMcpServers('', [
      registryServer({
        id: 'registry:filesystem',
        title: 'Filesystem',
        sourceUrl: 'https://registry.example.com/filesystem',
      }),
      registryServer({
        id: 'registry:abmeter',
        title: 'ABMeter',
        sourceUrl: 'https://abmeter.ai',
        connectionUrl: 'https://mcp.abmeter.ai',
      }),
    ]);

    expect(ranked.filter((server) => server.title === 'Filesystem')).toHaveLength(1);
    expect(ranked.some((server) => server.id === 'registry:abmeter')).toBe(true);
  });

  it('loads LobeHub MCP marketplace entries as registry index items', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                identifier: 'github.tools.docs',
                name: 'Docs Tools',
                description: 'Search docs through MCP',
                connectionType: 'stdio',
                category: 'development',
                github: { url: 'https://github.com/tools/docs-mcp' },
                isValidated: true,
                tags: ['docs'],
                version: '1.2.3',
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const servers = await loadLobeHubMcpServers();

    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({
      id: 'lobehub:github-tools-docs',
      title: 'Docs Tools',
      transport: 'stdio',
      installable: false,
      sourceUrl: 'https://github.com/tools/docs-mcp',
      trust: 'registry',
      version: '1.2.3',
    });
  });

  it('keeps distinct registry servers with the same generic title', () => {
    const ranked = rankMcpServers('generic', [
      registryServer({
        id: 'registry:generic-one',
        registryName: 'vendor.one/generic',
        title: 'Generic MCP Server',
        sourceUrl: 'https://one.example.com',
        connectionUrl: 'https://one.example.com/mcp',
        tags: ['generic'],
      }),
      registryServer({
        id: 'registry:generic-two',
        registryName: 'vendor.two/generic',
        title: 'Generic MCP Server',
        sourceUrl: 'https://two.example.com',
        connectionUrl: 'https://two.example.com/mcp',
        tags: ['generic'],
      }),
    ]);

    expect(ranked.filter((server) => server.title === 'Generic MCP Server')).toHaveLength(2);
  });

  it('ships game-engine MCP servers in the catalog', () => {
    const gameServers = MCP_CATALOG.filter((server) => server.category === 'game');
    const ids = gameServers.map((server) => server.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'blender-mcp',
        'houdini-mcp',
        'unity-mcp',
        'unreal-mcp',
        'godot-mcp',
        'cocos-mcp-server',
      ]),
    );
    // Engine MCP servers touch the user's editor, so they require approval.
    expect(gameServers.every((server) => server.requiresUserApproval === true)).toBe(true);
    expect(MCP_CATALOG.find((server) => server.id === 'godot-mcp')).toMatchObject({
      command: 'npx',
      args: ['-y', '@coding-solo/godot-mcp'],
      sourceUrl: 'https://github.com/wellingfeng/godot-mcp',
    });
    expect(MCP_CATALOG.find((server) => server.id === 'unity-mcp')).toMatchObject({
      sourceUrl: 'https://github.com/wellingfeng/unity-mcp',
    });
    expect(MCP_CATALOG.find((server) => server.id === 'houdini-mcp')).toMatchObject({
      command: 'uv',
      args: ['run', '--directory', '{workspace}/houdini-mcp', 'python', 'houdini_mcp_server.py'],
      sourceUrl: 'https://github.com/wellingfeng/houdini-mcp',
    });
    expect(MCP_CATALOG.find((server) => server.id === 'cocos-mcp-server')).toMatchObject({
      transport: 'streamable-http',
      url: 'http://localhost:3000/mcp',
      sourceUrl: 'https://github.com/wellingfeng/cocos-mcp-server',
    });
    expect(MCP_CATALOG.find((server) => server.id === 'lobehub-mcp-market')).toMatchObject({
      installable: false,
      sourceUrl: 'https://lobehub.com/mcp',
    });
  });

  it('ships MCPMarket auto-install in the catalog', () => {
    expect(MCP_CATALOG.find((server) => server.id === 'mcpmarket-auto-install')).toMatchObject({
      command: 'npx',
      args: ['-y', '@mcpmarket/mcp-auto-install@next'],
      sourceUrl: 'https://github.com/CherryHQ/mcpmarket/tree/main/packages/mcp-auto-install',
      requiresUserApproval: true,
    });
    expect(rankMcpServers('mcpmarket')[0]?.id).toBe('mcpmarket-auto-install');
  });

  it('surfaces game MCP servers via free-text search', () => {
    const ranked = rankMcpServers('unity');
    expect(ranked[0]?.id).toBe('unity-mcp');
    expect(rankMcpServers('houdini')[0]?.id).toBe('houdini-mcp');
  });
});
