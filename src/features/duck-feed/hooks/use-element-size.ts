import { type RefObject, useEffect, useRef, useState } from 'react';

import type { BoardSize } from '@/features/duck-feed/types/game';

export function useElementSize<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  size: BoardSize;
} {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<BoardSize>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}
