import { expect, it } from 'vitest';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import { cardPhotos } from '@/features/house-scanner/utils/card-photos';

it('appends an available floor plan once and leaves expired plans out', () => {
  const listing = SYNTHETIC_SNAPSHOT.listings[0];
  const plan = listing.floorPlan;
  if (!plan || !listing.photos) throw new Error('Missing gallery fixture');
  expect(cardPhotos(listing).at(-1)).toEqual(plan);
  expect(
    cardPhotos({ ...listing, photos: [...listing.photos, plan] }).filter(
      (photo) => photo.url === plan.url,
    ),
  ).toHaveLength(1);
  expect(
    cardPhotos({
      ...listing,
      floorPlan: { ...plan, expiresAt: '2000-01-01T00:00:00Z' },
    }),
  ).toEqual(listing.photos);
});
