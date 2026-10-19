import { useEffect, useRef } from 'react';

export function useRoomMotion(paused: boolean) {
  const roomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const surfaces = room.querySelectorAll<HTMLElement>('[data-surface]');
    function update() {
      frame = 0;
      for (const surface of surfaces) {
        const bounds = surface.getBoundingClientRect();
        const distance = Math.max(
          -1,
          Math.min(
            1,
            (bounds.top + bounds.height / 2 - window.innerHeight / 2) /
              window.innerHeight,
          ),
        );
        surface.style.setProperty(
          '--approach',
          paused || preference.matches ? '0' : String(distance),
        );
      }
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    preference.addEventListener('change', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      preference.removeEventListener('change', schedule);
    };
  }, [paused]);
  return roomRef;
}
