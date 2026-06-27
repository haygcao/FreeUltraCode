import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React Flow 在 jsdom 下无法真正渲染画布，这里桩掉它，让 GameTeamPanel 的
// 组织架构视图把岗位卡片渲染成普通 DOM，便于点击测试。
vi.mock('@xyflow/react', () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Background: () => null,
    BackgroundVariant: { Lines: 'lines' },
    Controls: () => null,
    Handle: () => null,
    MarkerType: { ArrowClosed: 'arrowclosed' },
    MiniMap: () => null,
    Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
    ReactFlow: Passthrough,
    ReactFlowProvider: Passthrough,
    useReactFlow: () => ({
      setCenter: () => Promise.resolve(true),
      getInternalNode: () => undefined,
      getZoom: () => 1,
    }),
  };
});

import GameTeamPanel from './GameTeamPanel';
import {
  DEFAULT_GAME_EXPERT_SETTINGS,
  normalizeGameExpertSettings,
} from '@/lib/gameExperts';
import { useStore } from '@/store/useStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
  ResizeObserverStub as typeof ResizeObserver;

let originalSetItem: typeof window.localStorage.setItem;

beforeEach(() => {
  originalSetItem = window.localStorage.setItem.bind(window.localStorage);
});

afterEach(() => {
  window.localStorage.setItem = originalSetItem;
  window.localStorage.clear();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function renderOrganization(onOpenDetails: (id: string) => void): Promise<{
  container: HTMLDivElement;
  cleanup: () => Promise<void>;
}> {
  useStore.setState({
    locale: 'zh-CN',
    composerDraft: '',
    composerDrafts: {},
    gameExpertSettings: normalizeGameExpertSettings({
      ...DEFAULT_GAME_EXPERT_SETTINGS,
      enabled: true,
    }),
  });

  const container = document.createElement('div');
  container.style.height = '760px';
  container.style.width = '440px';
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(
      <GameTeamPanel mode="organization" onOpenDetails={onOpenDetails} />,
    );
  });

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe('GameTeamPanel resilient to full localStorage', () => {
  it('still fires onOpenDetails when localStorage.setItem throws QuotaExceededError', async () => {
    // 复现桌面端 WebView2 下 localStorage 写满的情形：任何 setItem 都抛
    // QuotaExceededError。修复前，writeSelectedNodeId 的 setItem 没有 try/catch，
    // 异常会冒泡打断 onPointerDown/onClick 处理函数，导致 onSelect / onOpenDetails
    // 永远执行不到，点岗位节点右侧详情面板打不开。修复后写入失败被静默吞掉，
    // 点击照常派发详情打开回调。
    window.localStorage.setItem = vi.fn(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    }) as typeof window.localStorage.setItem;

    const onOpenDetails = vi.fn();
    const view = await renderOrganization(onOpenDetails);

    try {
      // jsdom 下 React Flow 被桩成透传组件，画布里的岗位卡片节点不会真正渲染，
      // 因此点顶部「快捷定位」chip 来走同一条 activateNode → onSelect(写入 localStorage)
      // → onOpenDetails 路径（与点节点卡片等价）。技术总监是顶层子岗位，必有定位 chip。
      const locate = view.container.querySelector<HTMLButtonElement>(
        '[aria-label="定位 技术总监"]',
      );
      expect(locate).toBeInstanceOf(HTMLButtonElement);

      // 即便选中节点的 localStorage.setItem 抛 QuotaExceededError，也不能阻断
      // onOpenDetails（修复前这里会因为异常冒泡而根本不触发）。
      await act(async () => {
        locate?.click();
      });

      expect(onOpenDetails).toHaveBeenCalled();
      expect(onOpenDetails.mock.calls[0][0]).toBe('technical-director');
    } finally {
      await view.cleanup();
    }
  });
});
