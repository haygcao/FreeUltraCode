import { useEffect } from 'react';
import BlueprintCanvas from '@/canvas/BlueprintCanvas';
import Sidebar from '@/panels/Sidebar';
import PromptPanel from '@/panels/PromptPanel';
import AIDock from '@/panels/AIDock';
import { useStore } from '@/store/useStore';

/**
 * Top-level three-zone layout:
 *   left  : Sidebar
 *   center: BlueprintCanvas (top) + AIDock (bottom)
 *   right : PromptPanel
 *
 * App.tsx is the consumer of all import contracts.
 */
export default function App() {
  const initHistory = useStore((s) => s.initHistory);

  useEffect(() => {
    initHistory();
  }, [initHistory]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-fg">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <BlueprintCanvas />
        </div>
        <AIDock />
      </main>
      <PromptPanel />
    </div>
  );
}
