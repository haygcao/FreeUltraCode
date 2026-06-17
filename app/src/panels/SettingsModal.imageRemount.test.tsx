import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultBlueprint } from '@/core/defaultBlueprint';
import { loadImageGenerationSettings } from '@/lib/imageGeneration';
import { defaultComposer } from '@/store/sampleSessions';
import { useStore } from '@/store/useStore';
import SettingsModal from './SettingsModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(input, 'value')?.set;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(input, value);
  } else {
    valueSetter?.call(input, value);
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function openImageAddDialog(container: HTMLElement): Promise<HTMLElement> {
  const imageTab = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button'),
  ).find((button) => button.textContent?.trim() === '生图渠道');
  await act(async () => {
    imageTab?.click();
  });
  const addButton = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button'),
  ).find((button) => button.textContent?.trim() === '添加渠道');
  await act(async () => {
    addButton?.click();
  });
  return container.querySelector<HTMLElement>(
    '[data-custom-generation-provider-editor]',
  )!;
}

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('image channel survives modal remount', () => {
  it('still shows the custom image channel after closing and reopening Settings', async () => {
    useStore.setState({
      locale: 'zh-CN',
      workflow: defaultBlueprint('wf'),
      composer: defaultComposer,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root = createRoot(container);

    await act(async () => {
      root.render(<SettingsModal onClose={vi.fn()} />);
    });

    const editor = await openImageAddDialog(container);
    const inputs = Array.from(editor.querySelectorAll<HTMLInputElement>('input'));
    const nameInput = inputs.find((i) => i.placeholder === '新渠道');
    const urlInput = inputs.find((i) => i.placeholder === 'https://api.example.com/v1');
    const tokenInput = inputs.find((i) => i.placeholder === 'sk-...');
    const modelInput = inputs.find((i) => i.placeholder === 'custom-image-model');

    await act(async () => {
      setInputValue(nameInput!, 'yyds');
      setInputValue(urlInput!, 'https://ai.xfws88.com');
      setInputValue(tokenInput!, 'sk-yyds');
      setInputValue(modelInput!, 'custom-image-model');
    });

    const saveButton = Array.from(
      editor.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.textContent?.trim() === '保存');
    await act(async () => {
      saveButton?.click();
    });

    // Persisted right after save
    const afterSave = loadImageGenerationSettings();
    // eslint-disable-next-line no-console
    console.log('AFTER SAVE:', JSON.stringify(afterSave.customProviders.map((p) => p.label)));
    expect(afterSave.customProviders.some((p) => p.label === 'yyds')).toBe(true);

    // Close (unmount) and reopen (fresh mount) — the user's actual flow
    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);
    await act(async () => {
      root.render(<SettingsModal onClose={vi.fn()} />);
    });

    const imageTab2 = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.trim() === '生图渠道');
    await act(async () => {
      imageTab2?.click();
    });

    // eslint-disable-next-line no-console
    console.log('AFTER REOPEN storage:', JSON.stringify(loadImageGenerationSettings().customProviders.map((p) => p.label)));
    // The channel name should appear somewhere in the reopened panel
    expect(container.textContent).toContain('yyds');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
