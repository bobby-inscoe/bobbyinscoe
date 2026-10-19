import type { Listing } from '@/features/house-scanner/types/contracts';

type Coordinates = Listing['coordinates'];

/** Wording for a position the geocoder worked out from the street address; null for any other. */
export function estimatedPositionLabel(coordinates: Coordinates) {
  if (!coordinates?.estimated) return null;
  return coordinates.precision === 'approximate_area' ||
    coordinates.source === 'Estimated from the street name (OpenStreetMap)'
    ? 'Approximate street position'
    : 'Estimated from the address';
}

/** A home gets a pin only when it has a position more precise than an area. */
export function hasPin(
  coordinates: Coordinates,
): coordinates is NonNullable<Coordinates> {
  return coordinates !== null && coordinates.precision !== 'approximate_area';
}
