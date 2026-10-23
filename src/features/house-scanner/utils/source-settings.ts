import {
  type Observation,
  RETENTION_DAYS,
  type SourceSettings,
} from '@/features/house-scanner/types/contracts';

/**
 * The checks ingest makes before the database makes them again: the source is switched on, every address is on one
 * of its hosts, and no time is in the future or older than the retention window.
 */
export function assertObservationAllowed(
  source: SourceSettings,
  observation: Observation,
  now: Date,
): void {
  if (!source.enabled) throw new Error('Source is switched off.');
  if (observation.coordinates?.precision === 'user_supplied')
    throw new Error('Source ingestion cannot claim user-supplied coordinates.');
  if (!source.listingOrigins.includes(new URL(observation.sourceUrl).origin))
    throw new Error('Listing origin is not one of the source hosts.');
  const images = [
    ...(observation.photo ? [observation.photo] : []),
    ...(observation.morePhotos ?? []),
    ...(observation.floorPlan ? [observation.floorPlan] : []),
  ];
  const observedTimes = [
    observation.observedAt,
    ...images.map((image) => image.observedAt),
    ...(observation.coordinates ? [observation.coordinates.observedAt] : []),
    ...observation.evidence.map((evidence) => evidence.observedAt),
  ];
  if (
    observedTimes.some(
      (timestamp) =>
        Date.parse(timestamp) > now.getTime() + 300000 ||
        Date.parse(timestamp) < now.getTime() - RETENTION_DAYS * 86400000,
    )
  )
    throw new Error('Observation is outside the permitted time window.');
  if (
    images.some(
      (image) =>
        !source.imageOrigins.includes(new URL(image.url).origin) ||
        Date.parse(image.expiresAt) <= now.getTime(),
    )
  )
    throw new Error('Image is from another host or has expired.');
  if (
    observation.evidence.some(
      (e) =>
        !['source_claim', 'measurement'].includes(e.kind) ||
        (e.sourceUrl !== null &&
          !source.listingOrigins.includes(new URL(e.sourceUrl).origin)),
    )
  )
    throw new Error('Evidence provenance is not the source.');
}
