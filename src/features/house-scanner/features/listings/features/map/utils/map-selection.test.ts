import { describe, expect, it, vi } from 'vitest';
import {
  mapSelectionIds,
  reviewMapSelection,
} from '@/features/house-scanner/features/listings/features/map/utils/map-selection';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import {
  type MapPoint,
  mapPoints,
} from '@/features/house-scanner/utils/listing-view';

it('reviews only captured, still-visible, unhidden homes with confirmed positions', () => {
  const located = SYNTHETIC_SNAPSHOT.listings[0];
  if (!located.coordinates)
    throw new Error('Fixture needs a building position');
  const estimated = {
    ...located,
    id: 'estimated',
    coordinates: { ...located.coordinates, estimated: true },
  };
  const hidden = { ...located, id: 'hidden' };
  const outsideCapture = { ...located, id: 'outside-capture' };
  const visible = [
    ...SYNTHETIC_SNAPSHOT.listings,
    estimated,
    hidden,
    outsideCapture,
  ];
  const captured = [
    ...SYNTHETIC_SNAPSHOT.listings.map((listing) => listing.id),
    estimated.id,
    hidden.id,
    'no-longer-visible',
  ];
  expect(
    reviewMapSelection(visible, captured, new Set([hidden.id])).map(
      (listing) => listing.id,
    ),
  ).toEqual([located.id, SYNTHETIC_SNAPSHOT.listings[3].id]);
});

const viewport = { left: 20, top: 20, right: 280, bottom: 380 };
const project = ({
  longitude,
  latitude,
}: NonNullable<MapPoint['coordinates']>) => ({
  x: longitude,
  y: latitude,
});
function point(id: string, x: number, y: number): MapPoint {
  return {
    id,
    label: id,
    markerText: id,
    coordinates: { longitude: x, latitude: y },
  };
}

describe('mapSelectionIds', () => {
  it('includes the visible boundary and excludes points beyond each edge', () => {
    expect(
      mapSelectionIds(
        [
          point('top-left', 20, 20),
          point('bottom-right', 280, 380),
          point('left', 19, 100),
          point('right', 281, 100),
          point('top', 100, 19),
          point('bottom', 100, 381),
        ],
        project,
        viewport,
        [],
      ),
    ).toEqual(['top-left', 'bottom-right']);
  });

  it('excludes points covered by controls, attribution or a preview, including their boundaries', () => {
    const controls = { left: 20, top: 20, right: 140, bottom: 100 };
    const navigation = { left: 250, top: 20, right: 280, bottom: 160 };
    const attribution = { left: 120, top: 360, right: 280, bottom: 380 };
    const preview = { left: 160, top: 200, right: 280, bottom: 350 };
    expect(
      mapSelectionIds(
        [
          point('controls', 140, 100),
          point('navigation', 260, 120),
          point('attribution', 200, 370),
          point('preview', 200, 250),
          point('visible', 100, 200),
        ],
        project,
        viewport,
        [controls, navigation, attribution, preview],
      ),
    ).toEqual(['visible']);
  });

  it('never projects unlocated homes', () => {
    const projection = vi.fn(project);
    const unlocated: MapPoint = {
      id: 'unlocated',
      label: 'Unlocated home',
      markerText: '?',
      unlocated: true,
    };
    expect(mapSelectionIds([unlocated], projection, viewport, [])).toEqual([]);
    expect(projection).not.toHaveBeenCalled();
  });

  it('excludes approximate and missing positions from spatial selection', () => {
    const homes = SYNTHETIC_SNAPSHOT.listings.filter(
      (listing) =>
        listing.coordinates === null ||
        listing.coordinates.precision === 'approximate_area',
    );
    expect(homes.length).toBeGreaterThan(0);
    const projection = vi.fn(() => ({ x: 100, y: 100 }));
    expect(mapSelectionIds(mapPoints(homes), projection, viewport, [])).toEqual(
      [],
    );
    expect(projection).not.toHaveBeenCalled();
  });

  it('returns a new snapshot in point order and handles an empty or unusable view', () => {
    const points = [point('second', 100, 100), point('first', 150, 150)];
    const captured = mapSelectionIds(points, project, viewport, []);
    points.reverse();
    expect(captured).toEqual(['second', 'first']);
    expect(mapSelectionIds([], project, viewport, [])).toEqual([]);
    expect(
      mapSelectionIds(points, project, { ...viewport, right: 0 }, []),
    ).toEqual([]);
    expect(
      mapSelectionIds(
        [point('invalid', Number.NaN, 100)],
        project,
        viewport,
        [],
      ),
    ).toEqual([]);
  });
});
