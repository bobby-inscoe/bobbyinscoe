import { useEffect } from 'react';

export function useShellterPwa() {
  useEffect(() => {
    if (
      import.meta.env.PROD &&
      'serviceWorker' in navigator &&
      window.isSecureContext
    ) {
      void navigator.serviceWorker
        .register('/shellter/sw.js', {
          scope: '/shellter/',
          updateViaCache: 'none',
        })
        .catch(() => {
          console.warn('Shellter offline fallback could not be installed.');
        });
    }
  }, []);
}
