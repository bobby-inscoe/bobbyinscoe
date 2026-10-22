import type { Listing } from '@/features/house-scanner/types/contracts';
import { hasPin } from '@/features/house-scanner/utils/listing-position';
import type { MapPoint } from '@/features/house-scanner/utils/listing-view';

export function reviewMapSelection(
  visible: Listing[],
  capturedIds: string[],
  hiddenIds: ReadonlySet<string>,
) {
  const captured = new Set(capturedIds);
  return visible.filter(
    (listing) =>
      captured.has(listing.id) &&
      !hiddenIds.has(listing.id) &&
      hasPin(listing.coordinates) &&
      listing.coordinates.estimated !== true,
  );
}

interface MapRectangle {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ProjectedPoint {
  x: number;
  y: number;
}

function contains(rect: MapRectangle, { x, y }: ProjectedPoint) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function mapSelectionIds(
  points: MapPoint[],
  project: (
    coordinates: NonNullable<MapPoint['coordinates']>,
  ) => ProjectedPoint,
  viewport: MapRectangle,
  obscured: MapRectangle[],
): string[] {
  return points.flatMap((point) => {
    if (point.unlocated) return [];
    const position = project(point.coordinates);
    return contains(viewport, position) &&
      !obscured.some((rect) => contains(rect, position))
      ? [point.id]
      : [];
  });
}
