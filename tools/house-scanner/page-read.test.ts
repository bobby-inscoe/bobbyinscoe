import { imagesOf } from '@house-scanner-tools/page-read';
import { describe, expect, it } from 'vitest';

describe('gallery limits', () => {
  it.each([0, 3, 8, 9])(
    'keeps up to eight photos from %i, with a separate floor plan',
    (count) => {
      const urls = Array.from(
        { length: count },
        (_, n) => `https://example.invalid/photo-${n}`,
      );
      const result = imagesOf(
        urls,
        'https://example.invalid/plan',
        'Synthetic',
        '2026-10-23T12:00:00Z',
      );
      const photos = [result.photo, ...(result.morePhotos ?? [])].filter(
        Boolean,
      );
      expect(photos.map((photo) => photo?.url)).toEqual(urls.slice(0, 8));
      expect(result.floorPlan?.url).toBe('https://example.invalid/plan');
    },
  );
});
