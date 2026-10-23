// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListingGallery } from '@/features/house-scanner/components/listing-gallery';
import { catalogs } from '@/features/house-scanner/i18n/catalogs';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import { classes } from '@/features/house-scanner/theme/shellter-theme';

beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(cleanup);

function gallery(count = 3, reducedMotion = false) {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: reducedMotion && media.includes('prefers-reduced-motion'),
    addEventListener() {},
    removeEventListener() {},
  }));
  const listing = SYNTHETIC_SNAPSHOT.listings[0];
  const photo = listing.photos?.[0] ?? listing.photo;
  if (!photo) throw new Error('Missing demo photo');
  const photos = Array.from({ length: count }, (_, i) => ({
    ...photo,
    url: `https://images.example.invalid/photo-${i}.jpg`,
  }));
  const onSelect = vi.fn();
  const { container } = render(
    <MantineProvider>
      <IntlProvider locale="en" messages={catalogs.en}>
        <ListingGallery
          listing={listing}
          photos={photos}
          index={0}
          onSelect={onSelect}
        >
          {null}
        </ListingGallery>
      </IntlProvider>
    </MantineProvider>,
  );
  const viewport = container.querySelector<HTMLElement>(
    `.${classes.photoSlides}`,
  );
  if (!viewport) throw new Error('Missing gallery viewport');
  Object.defineProperty(viewport, 'clientWidth', { value: 100 });
  const dots = screen.getByRole('img', { name: `Photo 1 of ${count}` });
  const move = (position: number) =>
    fireEvent.scroll(viewport, {
      target: { scrollLeft: (position + 1) * 100 },
    });
  vi.mocked(HTMLElement.prototype.scrollTo).mockClear();
  return { viewport, dots, move, onSelect };
}

it('follows an unfinished swipe and reverses without changing the settled photo or steering the scroll', () => {
  const { viewport, dots, move, onSelect } = gallery();
  const [first, second, last] = dots.querySelectorAll('span');
  expect(first.style.opacity).toBe('1');
  move(0.5);
  const halfway = Number(first.style.opacity);
  expect(halfway).toBeGreaterThan(0.45);
  expect(halfway).toBeLessThan(1);
  expect(Number(second.style.opacity)).toBeCloseTo(halfway);
  expect(last.style.opacity).toBe('0.45');
  expect(onSelect).not.toHaveBeenCalled();
  expect(HTMLElement.prototype.scrollTo).not.toHaveBeenCalled();
  move(0.2);
  expect(Number(first.style.opacity)).toBeGreaterThan(halfway);
  expect(Number(second.style.opacity)).toBeLessThan(halfway);
  move(0);
  fireEvent(viewport, new Event('scrollend'));
  expect(first.style.opacity).toBe('1');
  expect(onSelect).toHaveBeenLastCalledWith(0);
});

it('slides a long dot window and crossfades between its ends when looping in either direction', () => {
  const { viewport, dots, move, onSelect } = gallery(10);
  const tracks = () =>
    dots.querySelectorAll<HTMLElement>(`.${classes.photoDotTrack}`);
  move(4.5);
  const before = tracks()[0].style.transform;
  move(5.5);
  expect(tracks()[0].style.transform).not.toBe(before);
  move(9.5);
  expect(tracks()).toHaveLength(2);
  expect(tracks()[0].style.opacity).toBe('0.5');
  expect(tracks()[1].style.opacity).toBe('0.5');
  move(10);
  fireEvent(viewport, new Event('scrollend'));
  expect(onSelect).toHaveBeenLastCalledWith(0);
  expect(tracks()).toHaveLength(1);
  expect(tracks()[0].querySelector('span')?.style.opacity).toBe('1');
  move(-0.5);
  expect(tracks()).toHaveLength(2);
  expect(tracks()[0].style.opacity).toBe('0.5');
  move(-1);
  fireEvent(viewport, new Event('scrollend'));
  expect(onSelect).toHaveBeenLastCalledWith(9);
  expect(tracks()).toHaveLength(1);
  expect(tracks()[0].querySelectorAll('span')[9].style.opacity).toBe('1');
});

it('uses discrete dots without scaling when reduced motion is requested', () => {
  const { dots, move } = gallery(3, true);
  const [first, second] = dots.querySelectorAll('span');
  move(0.25);
  expect(first.style.opacity).toBe('1');
  expect(second.style.opacity).toBe('0.45');
  move(0.75);
  expect(first.style.opacity).toBe('0.45');
  expect(second.style.opacity).toBe('1');
  expect(second.style.transform).toBe('');
});
