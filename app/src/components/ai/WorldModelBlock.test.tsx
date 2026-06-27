import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import MessageContent from './MessageContent';

// Render the worldmodel fenced block through the real Markdown -> CodeBlock
// dispatch so we exercise the actual chat-stream path, mirroring MermaidBlock's
// test approach.
async function renderText(text: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(MessageContent, { text }));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return {
    container,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('WorldModelBlock', () => {
  it('renders a worldmodel fenced block as an interactive world card', async () => {
    const body = JSON.stringify({
      provider: 'decart-oasis',
      title: '可漫游森林',
      prompt: '一片可自由探索的森林世界',
      controls: 'WASD 移动，鼠标转视角',
    });
    const { container, cleanup } = await renderText(
      ['```worldmodel', body, '```'].join('\n'),
    );
    try {
      expect(container.querySelector('.ai-world')).not.toBeNull();
      expect(container.textContent).toContain('可漫游森林');
      expect(container.textContent).toContain('一片可自由探索的森林世界');
      // No raw code block chrome leaked through.
      expect(container.querySelector('.ai-code')).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('shows the parse-failed fallback for an unusable body', async () => {
    const { container, cleanup } = await renderText(
      ['```worldmodel', '{}', '```'].join('\n'),
    );
    try {
      const block = container.querySelector('.ai-world');
      expect(block).not.toBeNull();
      // Fallback surfaces the raw JSON for copy/inspection.
      expect(block?.querySelector('.ai-code, pre')).not.toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('accepts a bare prompt body (no JSON envelope)', async () => {
    const { container, cleanup } = await renderText(
      ['```worldmodel', '一座漂浮在云端的城市', '```'].join('\n'),
    );
    try {
      expect(container.querySelector('.ai-world')).not.toBeNull();
      expect(container.textContent).toContain('一座漂浮在云端的城市');
    } finally {
      await cleanup();
    }
  });
});

