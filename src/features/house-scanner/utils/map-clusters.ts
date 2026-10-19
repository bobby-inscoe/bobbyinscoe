import type { MapPoint } from '@/features/house-scanner/utils/listing-view';

type LocatedPoint = Extract<MapPoint, { unlocated?: false }>;

export interface MapGroup {
  key: string;
  points: LocatedPoint[];
  coordinates: LocatedPoint['coordinates'];
  nearby: boolean;
}

const CLUSTER_RADIUS = 56;
export const MAX_CLUSTER_ZOOM = 20;

function project({ longitude, latitude }: LocatedPoint['coordinates']) {
  const sin = Math.sin(
    (Math.max(-85.051129, Math.min(85.051129, latitude)) * Math.PI) / 180,
  );
  return {
    x: (longitude + 180) / 360,
    y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  };
}

// Group exact positions first so repeated coordinates stay navigable at every zoom.
export function clusterMapPoints(points: MapPoint[], zoom: number): MapGroup[] {
  const positions = new Map<string, MapGroup>();
  for (const point of points) {
    if (point.unlocated) continue;
    const key = `${point.coordinates.longitude},${point.coordinates.latitude}`;
    const existing = positions.get(key);
    if (existing) existing.points.push(point);
    else
      positions.set(key, {
        key,
        points: [point],
        coordinates: point.coordinates,
        nearby: false,
      });
  }
  const stacks = [...positions.values()].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  if (zoom >= MAX_CLUSTER_ZOOM) return stacks;
  const scale = 512 * 2 ** Math.floor(zoom);
  const buckets = new Map<
    string,
    { group: MapGroup; x: number; y: number }[]
  >();
  const groups: MapGroup[] = [];
  for (const stack of stacks) {
    const position = project(stack.coordinates);
    const x = position.x * scale;
    const y = position.y * scale;
    const column = Math.floor(x / CLUSTER_RADIUS);
    const row = Math.floor(y / CLUSTER_RADIUS);
    let nearest: MapGroup | undefined;
    let distance = CLUSTER_RADIUS ** 2;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const candidate of buckets.get(`${column + dx},${row + dy}`) ??
          []) {
          const squared = (candidate.x - x) ** 2 + (candidate.y - y) ** 2;
          if (squared <= distance) {
            nearest = candidate.group;
            distance = squared;
          }
        }
      }
    }
    if (nearest) {
      nearest.points.push(...stack.points);
      nearest.nearby = true;
    } else {
      const group = { ...stack, points: [...stack.points] };
      groups.push(group);
      const key = `${column},${row}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push({ group, x, y });
      buckets.set(key, bucket);
    }
  }
  for (const group of groups) {
    if (!group.nearby) continue;
    group.key = JSON.stringify(group.points.map((point) => point.id).sort());
    group.coordinates = {
      longitude:
        group.points.reduce(
          (sum, point) => sum + point.coordinates.longitude,
          0,
        ) / group.points.length,
      latitude:
        group.points.reduce(
          (sum, point) => sum + point.coordinates.latitude,
          0,
        ) / group.points.length,
    };
  }
  return groups;
}

export function clusterExpansionZoom(group: MapGroup, zoom: number): number {
  for (let next = Math.floor(zoom) + 1; next < MAX_CLUSTER_ZOOM; next++) {
    if (clusterMapPoints(group.points, next).length > 1) return next;
  }
  return MAX_CLUSTER_ZOOM;
}
