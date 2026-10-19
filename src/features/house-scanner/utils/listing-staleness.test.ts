import { describe, expect, it } from 'vitest';

import {
  isListingStale,
  STALE_AFTER_MS,
} from '@/features/house-scanner/utils/listing-staleness';

const PUBLISHED = '2026-10-12T10:00:00Z';
const edition = { publishedAt: PUBLISHED };
const seenBefore = (ms: number) =>
  new Date(Date.parse(PUBLISHED) - ms).toISOString();

describe('isListingStale', () => {
  it('flags a source listing last seen well before the latest edition', () => {
    expect(
      isListingStale(
        { origin: 'source', observedAt: seenBefore(7 * STALE_AFTER_MS) },
        edition,
      ),
    ).toBe(true);
  });

  it('keeps a source listing seen in the latest scan', () => {
    expect(
      isListingStale({ origin: 'source', observedAt: PUBLISHED }, edition),
    ).toBe(false);
    expect(
      isListingStale(
        { origin: 'source', observedAt: seenBefore(STALE_AFTER_MS / 2) },
        edition,
      ),
    ).toBe(false);
  });

  it('treats exactly 24 hours as fresh and one millisecond more as stale', () => {
    expect(
      isListingStale(
        { origin: 'source', observedAt: seenBefore(STALE_AFTER_MS) },
        edition,
      ),
    ).toBe(false);
    expect(
      isListingStale(
        { origin: 'source', observedAt: seenBefore(STALE_AFTER_MS + 1) },
        edition,
      ),
    ).toBe(true);
  });

  it('never flags manual or synthetic listings', () => {
    const observedAt = seenBefore(30 * STALE_AFTER_MS);
    expect(isListingStale({ origin: 'manual', observedAt }, edition)).toBe(
      false,
    );
    expect(isListingStale({ origin: 'synthetic', observedAt }, edition)).toBe(
      false,
    );
  });

  it('never flags anything without an edition', () => {
    expect(
      isListingStale(
        { origin: 'source', observedAt: '2020-01-01T00:00:00Z' },
        null,
      ),
    ).toBe(false);
  });

  it('does not flag when a date cannot be parsed', () => {
    expect(
      isListingStale({ origin: 'source', observedAt: 'not a date' }, edition),
    ).toBe(false);
    expect(
      isListingStale(
        { origin: 'source', observedAt: '2020-01-01T00:00:00Z' },
        { publishedAt: 'not a date' },
      ),
    ).toBe(false);
  });
});
