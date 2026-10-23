import { useEffect } from 'react';
import {
  preloadWorkspaceMap,
  retainMapWorkspace,
} from '@/features/house-scanner/utils/map-runtime';

export function useMapPreload() {
  useEffect(() => {
    const release = retainMapWorkspace();
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let attempted = false;
    const cancel = () => {
      if (idle !== undefined) window.cancelIdleCallback(idle);
      clearTimeout(timer);
      idle = undefined;
      timer = undefined;
    };
    const preload = () => {
      if (!cancelled && !attempted && document.visibilityState === 'visible') {
        attempted = true;
        // Optional preload failure never interrupts household use or retries in a loop.
        void preloadWorkspaceMap().catch(() => {});
      }
    };
    const schedule = () => {
      cancel();
      if (attempted || document.visibilityState !== 'visible') return;
      if ('requestIdleCallback' in window)
        idle = window.requestIdleCallback(preload);
      else timer = setTimeout(preload, 1500);
    };
    // Leave two frames for the useful workspace to paint before optional evaluation.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(schedule);
    });
    document.addEventListener('visibilitychange', schedule);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      cancel();
      document.removeEventListener('visibilitychange', schedule);
      release();
    };
  }, []);
}
