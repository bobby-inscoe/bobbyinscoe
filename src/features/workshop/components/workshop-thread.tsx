import { type RefObject, useEffect, useState } from 'react';

interface WorkshopThreadProps {
  roomRef: RefObject<HTMLDivElement | null>;
}

export function WorkshopThread({ roomRef }: WorkshopThreadProps) {
  const [path, setPath] = useState('');

  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    const overview = room.querySelector('.overview-duck-feed');
    const surfaces = [...room.querySelectorAll<HTMLElement>('[data-surface]')];
    if (!overview || surfaces.length === 0) return;

    function measure() {
      if (!room || !overview) return;
      const bounds = room.getBoundingClientRect();
      const start = overview.getBoundingClientRect();
      const x = start.left - bounds.left + start.width * 0.4;
      const y = start.top - bounds.top + start.height * 0.7;
      let d = `M ${x} ${y}`;
      let previousX = x;
      let previousY = y;

      for (const [index, surface] of surfaces.entries()) {
        const rect = surface.getBoundingClientRect();
        const targetX =
          rect.left -
          bounds.left +
          rect.width * [0.42, 0.64, 0.38, 0.57][index % 4];
        const targetY =
          rect.top -
          bounds.top +
          rect.height * [0.58, 0.46, 0.64, 0.51][index % 4];
        const edge = index % 2 === 0 ? -32 : bounds.width + 32;
        // Cross the gap below the preceding caption, then tuck under the next plane.
        const previousArea = surfaces[index - 1]?.closest('.work-area');
        const bendY = previousArea
          ? previousArea.getBoundingClientRect().bottom - bounds.top - 28
          : previousY + (targetY - previousY) * 0.2;
        const direction = index % 2 === 0 ? -1 : 1;
        const exitY = previousArea
          ? surfaces[index - 1].getBoundingClientRect().bottom - bounds.top + 18
          : bendY;
        if (previousArea) {
          const previousRect = surfaces[index - 1].getBoundingClientRect();
          const hemY = previousRect.bottom - bounds.top;
          const span = Math.abs(edge - previousX);
          const lowX =
            previousX +
            (edge - previousX) * [0.62, 0.68, 0.55, 0.73][index % 4];
          const lowY = hemY + [32, 46, 38, 27][index % 4];
          const tangent = direction * span * 0.2;
          // A shared horizontal tangent lets the slack settle without a kink or curl.
          d += ` C ${previousX + direction * span * 0.12} ${previousY + 110}, ${lowX - tangent} ${lowY}, ${lowX} ${lowY}`;
          d += ` C ${lowX + tangent} ${lowY}, ${edge - direction * span * 0.14} ${exitY - 8}, ${edge} ${exitY}`;
        } else {
          const span = previousX - edge;
          d += ` C ${previousX - span * 0.22} ${previousY + 90}, ${edge + span * 0.4} ${exitY + 28}, ${edge} ${exitY}`;
        }
        if (previousArea) {
          d += ` C ${edge + direction * 80} ${exitY + 60}, ${edge + direction * 55} ${bendY - 60}, ${edge} ${bendY}`;
        }
        d += ` C ${edge + direction * 100} ${bendY + 100}, ${edge - direction * 110} ${targetY + 70}, ${targetX} ${targetY}`;
        previousX = targetX;
        previousY = targetY;
      }
      const lastBottom =
        surfaces[surfaces.length - 1].getBoundingClientRect().bottom -
        bounds.top;
      // One cubic keeps the final drape's curvature continuous beneath the caption.
      d += ` C ${previousX * 0.75} ${lastBottom + 72}, ${previousX * 0.3} ${lastBottom + 40}, -35 ${lastBottom + 14}`;
      setPath(d);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(room);
    for (const surface of surfaces) observer.observe(surface);
    measure();
    return () => observer.disconnect();
  }, [roomRef]);

  return (
    <svg className="workshop-thread" fill="none" aria-hidden="true">
      <path d={path} />
      <path className="fibre-fuzz" d={path} />
    </svg>
  );
}
