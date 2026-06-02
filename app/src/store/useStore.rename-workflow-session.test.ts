import { afterEach, describe, expect, it } from 'vitest';
import { defaultBlueprint } from '@/core/defaultBlueprint';
import type { IRGraph } from '@/core/ir';
import { historyStore } from './history/store';
import type { Session } from './types';
import { useStore } from './useStore';

function cloneGraph(graph: IRGraph): IRGraph {
  return JSON.parse(JSON.stringify(graph)) as IRGraph;
}

function resetStore(): void {
  useStore.setState({
    workflow: cloneGraph(defaultBlueprint('Current workflow')),
    selectedNodeId: null,
    mode: 'design',
    aiStreaming: false,
    aiEditingSessions: [],
    dirty: false,
    currentFilePath: null,
    messages: [],
    composerDraft: '',
    composerDrafts: {},
    activeSessionId: null,
    activeWorkspaceId: null,
    historyReady: false,
    workspaces: [],
    sessions: [],
    sessionTree: {},
    runState: {},
    runOutputs: {},
    lastRunFailedNodeId: null,
  });
}

afterEach(() => {
  resetStore();
  window.localStorage.clear();
});

describe('renameWorkflowSession', () => {
  it('persists the workflow title and workflow meta name for history reloads', async () => {
    window.localStorage.clear();
    await historyStore.ready();
    const workspace = await historyStore.resolveWorkspaceByPath('');
    const workflow = defaultBlueprint('Original workflow');
    const record = await historyStore.createSession({
      workspaceId: workspace.id,
      isWorkflow: true,
      title: workflow.meta.name,
      workflow,
    });
    const session: Session = {
      id: record.id,
      workspaceId: workspace.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      isWorkflow: true,
      messageCount: 0,
    };

    useStore.setState({
      historyReady: true,
      workspaces: [workspace],
      sessions: [session],
      sessionTree: { [workspace.id]: [session] },
      activeWorkspaceId: workspace.id,
      activeSessionId: record.id,
      workflow: cloneGraph(workflow),
      currentFilePath: null,
    });

    await useStore
      .getState()
      .renameWorkflowSession(record.id, workspace.id, 'Renamed workflow');

    const updatedRecord = await historyStore.getSession(workspace.id, record.id);
    const updatedIndex = await historyStore.listSessions(workspace.id);
    const state = useStore.getState();

    expect(updatedRecord?.title).toBe('Renamed workflow');
    expect(updatedRecord?.workflow?.meta.name).toBe('Renamed workflow');
    expect(updatedIndex.find((item) => item.id === record.id)?.title).toBe(
      'Renamed workflow',
    );
    expect(state.workflow.meta.name).toBe('Renamed workflow');
    expect(state.sessions.find((item) => item.id === record.id)?.title).toBe(
      'Renamed workflow',
    );
    expect(
      state.sessionTree[workspace.id]?.find((item) => item.id === record.id)
        ?.title,
    ).toBe('Renamed workflow');
  });
});
