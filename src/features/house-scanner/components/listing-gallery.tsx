import { useReducedMotion } from '@mantine/hooks';
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { ListingPhoto } from '@/features/house-scanner/components/listing-photo';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type { Listing } from '@/features/house-scanner/types/contracts';

export function ListingGallery({
  listing,
  photos,
  index,
  onSelect,
  contain,
  children,
}: {
  listing: Listing;
  photos: NonNullable<Listing['photos']>;
  index: number;
  onSelect: (index: number) => void;
  contain?: boolean;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const loop = photos.length > 1;
  const slides = loop
    ? [photos[photos.length - 1], ...photos, photos[0]]
    : photos;
  const slot = useRef(index + (loop ? 1 : 0));
  const initialized = useRef(false);
  const reducedMotion = useReducedMotion();
  const [controlsHidden, setControlsHidden] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiping = useRef(false);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postponeControls = () => {
    if (restoreTimer.current) clearTimeout(restoreTimer.current);
    restoreTimer.current = setTimeout(() => {
      swiping.current = false;
      setControlsHidden(false);
    }, 3000);
  };
  useEffect(
    () => () => {
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const currentIndex = loop
      ? (slot.current - 1 + photos.length) % photos.length
      : slot.current;
    if (initialized.current && currentIndex === index) return;
    let target = index + (loop ? 1 : 0);
    if (loop && initialized.current) {
      if (slot.current === photos.length && index === 0)
        target = photos.length + 1;
      if (slot.current === 1 && index === photos.length - 1) target = 0;
    }
    slot.current = target;
    element.scrollTo({
      left: target * element.clientWidth,
      behavior: !initialized.current || reducedMotion ? 'instant' : 'smooth',
    });
    initialized.current = true;
  }, [index, loop, photos.length, reducedMotion]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = new ResizeObserver(() => {
      element.scrollTo({
        left: slot.current * element.clientWidth,
        behavior: 'instant',
      });
    });
    resize.observe(element);
    return () => resize.disconnect();
  }, []);

  return (
    <div className={classes.photoGallery}>
      <div
        ref={viewport}
        className={classes.photoSlides}
        onTouchStart={(event) => {
          if (!loop || event.touches.length !== 1) return;
          touchStart.current = {
            x: event.touches[0].clientX,
            y: event.touches[0].clientY,
          };
          if (restoreTimer.current) clearTimeout(restoreTimer.current);
        }}
        onTouchMove={(event) => {
          const start = touchStart.current;
          if (!start || event.touches.length !== 1) return;
          const dx = Math.abs(event.touches[0].clientX - start.x);
          const dy = Math.abs(event.touches[0].clientY - start.y);
          if (dx > 8 && dx > dy) {
            swiping.current = true;
            setControlsHidden(true);
            if (restoreTimer.current) clearTimeout(restoreTimer.current);
          }
        }}
        onTouchEnd={() => {
          touchStart.current = null;
          if (swiping.current) postponeControls();
        }}
        onTouchCancel={() => {
          touchStart.current = null;
          if (swiping.current) postponeControls();
        }}
        onScroll={() => {
          if (swiping.current && !touchStart.current) postponeControls();
        }}
        onScrollEnd={(event) => {
          const element = event.currentTarget;
          if (!element.clientWidth) return;
          let next = Math.round(element.scrollLeft / element.clientWidth);
          // Edge copies join the last and first photos without a visible jump.
          if (loop && (next === 0 || next === photos.length + 1)) {
            next = next === 0 ? photos.length : 1;
            element.scrollTo({
              left: next * element.clientWidth,
              behavior: 'instant',
            });
          }
          slot.current = next;
          onSelect(loop ? next - 1 : next);
        }}
      >
        {slides.length ? (
          slides.map((photo, position) => (
            <div
              key={`${loop && position === 0 ? 'before' : loop && position === slides.length - 1 ? 'after' : 'photo'}-${photo.url}`}
              className={classes.photoSlide}
              inert={position !== index + (loop ? 1 : 0)}
            >
              <ListingPhoto listing={{ ...listing, photo }} contain={contain} />
            </div>
          ))
        ) : (
          <ListingPhoto listing={{ ...listing, photo: null }} />
        )}
      </div>
      <div
        className={classes.photoGalleryControls}
        data-hidden={controlsHidden || undefined}
        inert={controlsHidden}
        aria-hidden={controlsHidden || undefined}
      >
        {children}
      </div>
    </div>
  );
}
