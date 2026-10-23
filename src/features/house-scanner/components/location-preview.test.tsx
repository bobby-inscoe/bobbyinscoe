// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { act, render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { expect, it, vi } from 'vitest';
import { LocationPreview } from '@/features/house-scanner/components/location-preview';
import { catalogs } from '@/features/house-scanner/i18n/catalogs';

const runtime = vi.hoisted(() => {
  const map = {
    addControl: vi.fn(),
    touchZoomRotate: { disableRotation: vi.fn() },
    keyboard: { disableRotation: vi.fn() },
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    jumpTo: vi.fn(),
    remove: vi.fn(),
  };
  const marker = { setLngLat: vi.fn(), addTo: vi.fn(), remove: vi.fn() };
  marker.setLngLat.mockReturnValue(marker);
  marker.addTo.mockReturnValue(marker);
  return {
    NavigationControl: vi.fn(function NavigationFixture() {}),
    Map: vi.fn(function MapFixture() {
      return map;
    }),
    Marker: vi.fn(function MarkerFixture() {
      return marker;
    }),
    map,
    marker,
    release: vi.fn(),
  };
});
vi.mock('@/features/house-scanner/utils/map-runtime', () => ({
  loadMapRuntime: () => Promise.resolve(runtime),
  retainMap: () => runtime.release,
  STREET_STYLE: 'local-fixture',
}));

it('waits for the drawer and its scroll viewport, moves one map between homes, and disposes it on close', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  let intersect!: (entries: Partial<IntersectionObserverEntry>[]) => void;
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const viewport = { current: document.createElement('div') };
  const renderPreview = (ready: boolean, longitude = 11.97) => (
    <MantineProvider>
      <IntlProvider locale="en" messages={catalogs.en}>
        <LocationPreview
          coordinates={{
            longitude,
            latitude: 57.71,
            source: 'Fixture',
            precision: 'building',
            observedAt: '2026-10-23T12:00:00Z',
          }}
          ready={ready}
          viewport={viewport}
        />
      </IntlProvider>
    </MantineProvider>
  );
  const view = render(renderPreview(false));
  expect(observe).not.toHaveBeenCalled();
  expect(runtime.Map).not.toHaveBeenCalled();
  view.rerender(renderPreview(true));
  expect(observe).toHaveBeenCalledOnce();
  expect(runtime.Map).not.toHaveBeenCalled();
  await act(async () => {
    intersect([{ isIntersecting: true }]);
  });
  expect(runtime.Map).toHaveBeenCalledOnce();
  view.rerender(renderPreview(true, 18.06));
  expect(runtime.Map).toHaveBeenCalledOnce();
  expect(runtime.marker.setLngLat).toHaveBeenLastCalledWith([18.06, 57.71]);
  expect(runtime.map.jumpTo).toHaveBeenLastCalledWith({
    center: [18.06, 57.71],
  });
  view.unmount();
  expect(runtime.map.remove).toHaveBeenCalledOnce();
  expect(runtime.marker.remove).toHaveBeenCalledOnce();
  expect(runtime.release).toHaveBeenCalledOnce();
  expect(disconnect).toHaveBeenCalled();
});
