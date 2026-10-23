import type { Listing } from '@/features/house-scanner/types/contracts';

export function cardPhotos(listing: Listing) {
  const photos = listing.photos?.length
    ? listing.photos
    : listing.photo
      ? [listing.photo]
      : [];
  const plan = listing.floorPlan;
  return plan &&
    Date.parse(plan.expiresAt) > Date.now() &&
    !photos.some((photo) => photo.url === plan.url)
    ? [...photos, plan]
    : photos;
}
