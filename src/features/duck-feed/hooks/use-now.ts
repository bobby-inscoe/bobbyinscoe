import { useEffect, useState } from 'react';

/** Re-renders the caller every `intervalMs` with the current time, while `isActive`. */
export function useNow(intervalMs: number, isActive: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(interval);
  }, [isActive, intervalMs]);

  return now;
}
