import { describe, expect, it } from 'vitest';
import {
  clusterExpansionZoom,
  clusterMapPoints,
  isolationZoom,
  MAX_CLUSTER_ZOOM,
} from '@/features/house-scanner/features/listings/features/map/utils/map-clusters';
import { mapSelectionIds } from '@/features/house-scanner/features/listings/features/map/utils/map-selection';
import type { MapPoint } from '@/features/house-scanner/utils/listing-view';

function home(id: string, longitude = 11.97, latitude = 57.71): MapPoint {
  return {
    id,
    label: id,
    markerText: '3m',
    coordinates: { longitude, latitude },
  };
}

const unlocated: MapPoint = {
  id: 'unlocated',
  label: 'No position',
  markerText: '?',
  unlocated: true,
};

describe('clusterMapPoints', () => {
  it('handles empty, unlocated and single-home maps', () => {
    expect(clusterMapPoints([], 11)).toEqual([]);
    expect(clusterMapPoints([unlocated], 11)).toEqual([]);
    expect(clusterMapPoints([home('one'), unlocated], 11)).toMatchObject([
      {
        nearby: false,
        points: [{ id: 'one' }],
        coordinates: { longitude: 11.97, latitude: 57.71 },
      },
    ]);
  });

  it('splits nearby homes as zoom increases while retaining exact-coordinate stacks', () => {
    const points = [
      home('one'),
      home('two'),
      home('nearby', 11.975),
      home('far', 12.1),
      unlocated,
    ];
    const low = clusterMapPoints(points, 11);
    expect(low.map((group) => group.points.length)).toEqual([3, 1]);
    expect(low[0].nearby).toBe(true);
    const high = clusterMapPoints(points, 16);
    expect(high.map((group) => group.points.length)).toEqual([2, 1, 1]);
    expect(high.every((group) => !group.nearby)).toBe(true);
    expect(high[0].points.map((point) => point.id)).toEqual(['one', 'two']);
    const expansion = clusterExpansionZoom(low[0], 11);
    expect(expansion).toBeGreaterThan(11);
    expect(clusterMapPoints(low[0].points, expansion).length).toBeGreaterThan(
      1,
    );
    expect(clusterMapPoints(low[0].points, expansion - 1)).toHaveLength(1);
  });

  it('checks neighboring buckets rather than separating close homes at grid boundaries', () => {
    const zoom = 11;
    const pixelLongitude = 360 / (512 * 2 ** zoom);
    const boundary = Math.round((11.97 + 180) / pixelLongitude / 56) * 56;
    const groups = clusterMapPoints(
      [
        home('left', (boundary - 10) * pixelLongitude - 180),
        home('right', (boundary + 10) * pixelLongitude - 180),
      ],
      zoom,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].nearby).toBe(true);
  });

  it('keeps membership and marker keys stable across point reordering and fractional zoom', () => {
    const points = [home('one'), home('two', 11.975), home('three', 11.98)];
    const before = clusterMapPoints(points, 11.1);
    const after = clusterMapPoints([...points].reverse(), 11.9);
    expect(before.map((group) => group.key)).toEqual(
      after.map((group) => group.key),
    );
    expect(
      before.map((group) => group.points.map((point) => point.id)),
    ).toEqual(after.map((group) => group.points.map((point) => point.id)));
  });

  it('preserves saved and hidden states without moving the original capture geometry', () => {
    const points = [
      { ...home('saved'), savedByMe: true, savedByHousehold: true },
      { ...home('same-position'), dimmed: true },
      { ...home('outside-view', 11.975), savedByHousehold: true },
    ];
    const original = structuredClone(points);
    const [group] = clusterMapPoints(points, 11);
    expect(group.points).toEqual(points);
    expect(group.coordinates.longitude).toBeGreaterThan(11.97);
    expect(group.coordinates.longitude).toBeLessThan(11.975);
    expect(
      mapSelectionIds(
        points,
        ({ longitude }) => ({ x: longitude, y: 100 }),
        { left: 11.96, right: 11.973, top: 0, bottom: 200 },
        [],
      ),
    ).toEqual(['saved', 'same-position']);
    expect(points).toEqual(original);
  });

  it('eventually separates almost-identical positions and never breaks an exact stack', () => {
    const points = [home('one'), home('two'), home('almost', 11.970000001)];
    const [group] = clusterMapPoints(points, 19);
    expect(group.points).toHaveLength(3);
    expect(clusterExpansionZoom(group, 19)).toBe(MAX_CLUSTER_ZOOM);
    expect(
      clusterMapPoints(points, MAX_CLUSTER_ZOOM).map(
        (result) => result.points.length,
      ),
    ).toEqual([2, 1]);
  });

  it.each([500, 1000])(
    'accounts for all %i dense homes, including repeated positions',
    (count) => {
      const points = Array.from({ length: count }, (_, index) =>
        home(
          String(index),
          11.97 + (Math.floor(index / 5) % 20) * 0.0002,
          57.71 + Math.floor(index / 100) * 0.0002,
        ),
      );
      const started = performance.now();
      const low = clusterMapPoints(points, 11);
      const high = clusterMapPoints(points, MAX_CLUSTER_ZOOM);
      expect(low.length).toBeLessThan(high.length / 10);
      expect(high).toHaveLength(count / 5);
      expect(
        high.every((group) => group.points.length === 5 && !group.nearby),
      ).toBe(true);
      expect(
        new Set(low.flatMap((group) => group.points.map((point) => point.id)))
          .size,
      ).toBe(count);
      expect(low.reduce((sum, group) => sum + group.points.length, 0)).toBe(
        count,
      );
      expect(performance.now() - started).toBeLessThan(1000);
    },
  );
});

describe('isolationZoom', () => {
  it('zooms in until the home leaves its cluster', () => {
    const points = [home('a'), home('b', 11.975), home('far', 12.1)];
    const zoom = isolationZoom(points, 'a');
    expect(zoom).toBeGreaterThan(11);
    expect(clusterMapPoints(points, zoom - 1)[0].nearby).toBe(true);
    expect(isolationZoom(points, 'far')).toBeLessThan(zoom);
  });
});
