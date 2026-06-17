// Must run before any module that reads localStorage (e.g. the store seed):
// migrates pre-rebrand `owf_*` keys to `fuc_*` so dev data survives the rename.
import './lib/legacyStorageMigration';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles/global.css';
import { initializeSecureStorage } from '@/lib/secureStorage';
import { initializeGenerationSettingsStore } from '@/lib/generationSettingsStore';
import { initializeGatewayConfigStore } from '@/lib/gatewayConfig';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

async function bootstrap(): Promise<void> {
  // Both hydrate disk-backed state into in-memory caches before the first render
  // so the synchronous load*() readers (secrets, generation settings, gateway
  // config/selection) see real data. They are independent, so run concurrently.
  await Promise.all([
    initializeSecureStorage(),
    initializeGenerationSettingsStore(),
    initializeGatewayConfigStore(),
  ]);
  const [{ default: App }, { applyAppearance }, { useStore }] = await Promise.all([
    import('./App'),
    import('@/lib/appearance'),
    import('@/store/useStore'),
  ]);

  applyAppearance(useStore.getState().appearance);

  createRoot(rootEl!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
