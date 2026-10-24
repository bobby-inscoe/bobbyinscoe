import { ActionIcon, Text } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { useIntl } from 'react-intl';
import { ListingPhoto } from '@/features/house-scanner/components/listing-photo';
import { displayLabel } from '@/features/house-scanner/i18n/display-labels';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type { Listing } from '@/features/house-scanner/types/contracts';

export function ListingGallery({
  listing,
  photos,
  index,
  onSelect,
  contain,
  children,
  onOpen,
  fullScreen,
  actionLabel,
  showAttribution,
}: {
  listing: Listing;
  photos: NonNullable<Listing['photos']>;
  index: number;
  onSelect: (index: number) => void;
  contain?: boolean;
  children: ReactNode;
  onOpen?: () => void;
  fullScreen?: boolean;
  actionLabel?: string;
  showAttribution?: boolean;
}) {
  const intl = useIntl();
  const viewport = useRef<HTMLDivElement>(null);
  const loop = photos.length > 1;
  const slides = loop
    ? [photos[photos.length - 1], ...photos, photos[0]]
    : photos;
  const slot = useRef(index + (loop ? 1 : 0));
  const initialized = useRef(false);
  // Read at mount: every card has a gallery, and a value set later re-rendered each one.
  const reducedMotion = useReducedMotion(undefined, {
    getInitialValueInEffect: false,
  });
  const [controlsHidden, setControlsHidden] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiping = useRef(false);
  const suppressClick = useRef(false);
  const [scrollPosition, setScrollPosition] = useState(index);
  const progress = reducedMotion ? Math.round(scrollPosition) : scrollPosition;
  const shownSlot = scrollPosition + (loop ? 1 : 0);
  // Long galleries crossfade their end windows instead of sweeping through every dot on a loop.
  const dotLayers =
    photos.length > 7 && (progress < 0 || progress > photos.length - 1)
      ? [
          {
            key: 'last',
            position: photos.length - 1,
            opacity: progress < 0 ? -progress : photos.length - progress,
          },
          {
            key: 'first',
            position: 0,
            opacity: progress < 0 ? 1 + progress : progress - photos.length + 1,
          },
        ]
      : [{ key: 'current', position: progress, opacity: 1 }];
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postponeControls = () => {
    if (restoreTimer.current) clearTimeout(restoreTimer.current);
    restoreTimer.current = setTimeout(() => {
      swiping.current = false;
      setControlsHidden(false);
    }, 500);
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
    <div
      className={`${classes.photoGallery} ${fullScreen ? classes.fullScreenGallery : ''}`}
      onPointerDownCapture={() => {
        suppressClick.current = false;
      }}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = false;
        }
      }}
    >
      <div
        ref={viewport}
        className={classes.photoSlides}
        onTouchStart={(event) => {
          suppressClick.current = false;
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
            suppressClick.current = true;
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
        onScroll={(event) => {
          const element = event.currentTarget;
          if (element.clientWidth) {
            setScrollPosition(
              Math.max(
                -1,
                Math.min(
                  photos.length,
                  element.scrollLeft / element.clientWidth - (loop ? 1 : 0),
                ),
              ),
            );
          }
          if (swiping.current && !touchStart.current) postponeControls();
        }}
        onScrollEnd={(event) => {
          const element = event.currentTarget;
          if (!element.clientWidth) return;
          let next = Math.round(element.scrollLeft / element.clientWidth);
          // Edge copies join the last and first photos without a visible jump.
          if (loop && (next === 0 || next === photos.length + 1)) {
            next = next === 0 ? photos.length : 1;
            // Render the real photo before jumping to it, since far slides stay empty.
            flushSync(() => setScrollPosition(next - 1));
            element.scrollTo({
              left: next * element.clientWidth,
              behavior: 'instant',
            });
          }
          slot.current = next;
          setScrollPosition(loop ? next - 1 : next);
          onSelect(loop ? next - 1 : next);
        }}
      >
        {slides.length ? (
          slides.map((photo, position) => (
            // Only the shown photo and its neighbours render; the rest keep their width empty.
            <div
              key={`${loop && position === 0 ? 'before' : loop && position === slides.length - 1 ? 'after' : 'photo'}-${photo.url}`}
              className={classes.photoSlide}
              inert={position !== index + (loop ? 1 : 0)}
              aria-hidden={position !== index + (loop ? 1 : 0)}
            >
              {(Math.abs(position - shownSlot) < 2 ||
                position === index + (loop ? 1 : 0)) && (
                <ListingPhoto
                  listing={{
                    ...listing,
                    photo,
                    title:
                      photo.url === listing.floorPlan?.url
                        ? intl.formatMessage({
                            id: 'listings.details.floorPlan',
                          })
                        : listing.title,
                  }}
                  contain={contain || photo.url === listing.floorPlan?.url}
                  showAttribution={false}
                  linkToListing={!fullScreen}
                  onOpen={onOpen}
                  actionLabel={
                    actionLabel ??
                    (onOpen
                      ? intl.formatMessage({
                          id: 'listings.details.viewFullScreen',
                        })
                      : undefined)
                  }
                />
              )}
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
        {loop && !fullScreen && (
          <>
            <ActionIcon
              variant="default"
              size="lg"
              radius="xl"
              className={classes.photoPrevious}
              aria-label={intl.formatMessage({
                id: 'listings.details.previousPhoto',
              })}
              onClick={() =>
                onSelect((index - 1 + photos.length) % photos.length)
              }
            >
              <ChevronLeft size={22} aria-hidden />
            </ActionIcon>
            <ActionIcon
              variant="default"
              size="lg"
              radius="xl"
              className={classes.photoNext}
              aria-label={intl.formatMessage({
                id: 'listings.details.nextPhoto',
              })}
              onClick={() => onSelect((index + 1) % photos.length)}
            >
              <ChevronRight size={22} aria-hidden />
            </ActionIcon>
          </>
        )}
        {children}
      </div>
      {loop && (
        <div className={classes.photoIndicators}>
          <div
            className={classes.photoDots}
            role="img"
            aria-label={intl.formatMessage(
              { id: 'listings.details.photoPosition' },
              { current: index + 1, total: photos.length },
            )}
          >
            <div
              className={classes.photoDotViewport}
              style={{ width: Math.min(photos.length, 7) * 9 - 2 }}
            >
              {dotLayers.map(({ key, position, opacity }) => (
                <div
                  key={key}
                  className={classes.photoDotTrack}
                  style={{
                    opacity,
                    transform: `translateX(${-Math.max(0, Math.min(position - 3, photos.length - 7)) * 9}px)`,
                  }}
                >
                  {photos.map((photo, dot) => {
                    const distance = Math.abs(position - dot);
                    const active = Math.max(
                      0,
                      1 - Math.min(distance, photos.length - distance),
                    );
                    return (
                      <span
                        key={photo.url}
                        style={{
                          opacity: 0.45 + active * 0.55,
                          transform: reducedMotion
                            ? undefined
                            : `scale(${1 + active * 0.3})`,
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {showAttribution && photos[index] && (
        <Text size="xs" c="dimmed" className={classes.photoAttribution}>
          {displayLabel(intl, photos[index].attribution)}
        </Text>
      )}
    </div>
  );
}
