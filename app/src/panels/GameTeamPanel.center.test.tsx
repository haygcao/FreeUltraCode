import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 捕获 React Flow 的 setCenter 调用，用来证明“点击岗位 → 画布居中”确实发生。
// 同时把 getInternalNode 固定为 undefined，模拟 jsdom 下 React Flow 无法测量节点的情况，
// 这样居中会走组件本地布局坐标的兜底分支——正是修复要保证的路径。
const setCenter = vi.fn(
  (...args: [number, number, { zoom?: number; duration?: number }?]) => {
    void args;
    return Promise.resolve(true);
  },
);
const getInternalNode = vi.fn(() => undefined);
const getZoom = vi.fn(() => 1);

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
    useReactFlow: () => ({ setCenter, getInternalNode, getZoom }),
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

// 用受控的 requestAnimationFrame：把回调按句柄收集起来，由测试手动逐帧推进。
// cancelAnimationFrame 真实移除对应回调——这样如果居中 effect 在排队的帧执行前被
// 无关重渲染打断（旧实现的 bug），就会复现“帧被取消、setCenter 永不触发”。
let rafCallbacks = new Map<number, (time: number) => void>();
let rafHandle = 0;
let originalRaf: typeof window.requestAnimationFrame;
let originalCancel: typeof window.cancelAnimationFrame;

function flushFrames(count: number): void {
  for (let i = 0; i < count; i += 1) {
    const callbacks = Array.from(rafCallbacks.values());
    rafCallbacks = new Map();
    for (const callback of callbacks) callback(performance.now());
  }
}

beforeEach(() => {
  setCenter.mockClear();
  getInternalNode.mockClear();
  rafCallbacks = new Map();
  rafHandle = 0;
  originalRaf = window.requestAnimationFrame;
  originalCancel = window.cancelAnimationFrame;
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    rafHandle += 1;
    rafCallbacks.set(rafHandle, callback);
    return rafHandle;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((handle: number) => {
    rafCallbacks.delete(handle);
  }) as typeof window.cancelAnimationFrame;
});

afterEach(() => {
  window.requestAnimationFrame = originalRaf;
  window.cancelAnimationFrame = originalCancel;
  window.localStorage.clear();
  document.body.innerHTML = '';
});

async function renderOrganization(): Promise<{
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
    root.render(<GameTeamPanel mode="organization" onOpenDetails={() => {}} />);
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

describe('GameTeamPanel centering', () => {
  it('clicking a quick-locate role chip centers the canvas on that node', async () => {
    const view = await renderOrganization();
    try {
      const locate = view.container.querySelector<HTMLButtonElement>(
        '[aria-label="定位 技术总监"]',
      );
      expect(locate).toBeInstanceOf(HTMLButtonElement);

      await act(async () => {
        locate?.click();
      });

      // getInternalNode 始终返回 undefined，兜底分支会在用尽 40 帧重试后调用 setCenter。
      await act(async () => {
        flushFrames(45);
      });

      expect(setCenter).toHaveBeenCalledTimes(1);
      const [x, y, options] = setCenter.mock.calls[0];
      expect(typeof x).toBe('number');
      expect(typeof y).toBe('number');
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(options).toMatchObject({ zoom: expect.any(Number) });
    } finally {
      await view.cleanup();
    }
  });

  it('still centers when unrelated re-renders interleave between animation frames', async () => {
    const view = await renderOrganization();
    try {
      const locate = view.container.querySelector<HTMLButtonElement>(
        '[aria-label="定位 技术总监"]',
      );
      expect(locate).toBeInstanceOf(HTMLButtonElement);

      await act(async () => {
        locate?.click();
      });

      // 在逐帧推进的过程中穿插一次与居中无关的重渲染（在搜索框输入再清空）。
      // 旧实现里这会让居中 effect 重建并 cancelAnimationFrame，导致 setCenter 永不触发；
      // 修复后 effect 只依赖 focusRequest，排队的帧不会被打断。
      const searchInput = view.container.querySelector<HTMLInputElement>(
        'input[aria-label="搜索组织岗位"]',
      );
      expect(searchInput).toBeInstanceOf(HTMLInputElement);

      await act(async () => {
        flushFrames(10);
      });
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set;
        setter?.call(searchInput!, '总');
        searchInput!.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set;
        setter?.call(searchInput!, '');
        searchInput!.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        flushFrames(45);
      });

      expect(setCenter).toHaveBeenCalledTimes(1);
    } finally {
      await view.cleanup();
    }
  });
});
