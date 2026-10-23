import { describe, expect, it } from 'vitest';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import type {
  Observation,
  SourceSettings,
} from '@/features/house-scanner/types/contracts';
import { assertObservationAllowed } from '@/features/house-scanner/utils/source-settings';

const now = new Date('2026-10-12T12:00:00Z');
const source: SourceSettings = {
  sourceId: 'synthetic-fixture',
  enabled: true,
  listingOrigins: ['https://example.invalid'],
  imageOrigins: ['https://images.example.invalid'],
};
const listing = SYNTHETIC_SNAPSHOT.listings[0];
const observation: Observation = {
  sourceListingId: 'authored-fixture',
  episodeId: 'fixture-1',
  sourceUrl: 'https://example.invalid/home',
  title: 'Authored fixture',
  observedAt: now.toISOString(),
  publishedAt: null,
  facts: listing.facts,
  conflicts: [],
  coordinates: listing.coordinates,
  evidence: [
    {
      id: '00000000-0000-4000-8000-000000000050',
      kind: 'measurement',
      subject: 'nature_access',
      summary: 'Synthetic distance',
      sourceUrl: 'https://example.invalid/evidence',
      observedAt: now.toISOString(),
      datasetVersion: 'fixture-v1',
      method: 'Synthetic straight line',
      value: 100,
      unit: 'metres_straight_line',
    },
  ],
  photo: {
    url: 'https://images.example.invalid/photo.jpg',
    attribution: 'Synthetic author',
    rightsBasis: 'Authored fixture',
    observedAt: now.toISOString(),
    expiresAt: '2026-10-13T12:00:00Z',
    displayAllowed: true,
    hotlinkAllowed: true,
  },
};

describe('source content check', () => {
  it('accepts current content from the source hosts', () => {
    expect(() =>
      assertObservationAllowed(source, observation, now),
    ).not.toThrow();
  });
  it.each(['observation', 'coordinates', 'evidence', 'photo'] as const)(
    'checks the independent %s timestamp, rather than the refreshed outer date',
    (part) => {
      for (const timestamp of [
        '2026-09-01T12:00:00Z',
        '2026-10-12T12:05:01Z',
      ]) {
        const stale = structuredClone(observation);
        if (part === 'observation') stale.observedAt = timestamp;
        if (part === 'coordinates' && stale.coordinates)
          stale.coordinates.observedAt = timestamp;
        if (part === 'evidence') stale.evidence[0].observedAt = timestamp;
        if (part === 'photo' && stale.photo) stale.photo.observedAt = timestamp;
        expect(() => assertObservationAllowed(source, stale, now)).toThrow(
          'time window',
        );
      }
    },
  );
  it('refuses everything from a switched-off source', () => {
    expect(() =>
      assertObservationAllowed({ ...source, enabled: false }, observation, now),
    ).toThrow('switched off');
  });
  it('accepts viewing times and any fact', () => {
    expect(() =>
      assertObservationAllowed(
        source,
        {
          ...observation,
          facts: {
            ...observation.facts,
            bidding: true,
            highestBidSek: 2_000_000,
          },
          viewings: [{ startsAt: '2026-10-24T13:00:00Z', endsAt: null }],
        },
        now,
      ),
    ).not.toThrow();
  });
  it('rejects a listing, image or evidence from another host, and an expired image', () => {
    expect(() =>
      assertObservationAllowed(
        { ...source, listingOrigins: ['https://other.invalid'] },
        observation,
        now,
      ),
    ).toThrow('Listing origin');
    expect(() =>
      assertObservationAllowed(
        { ...source, imageOrigins: [] },
        observation,
        now,
      ),
    ).toThrow('another host');
    const photo = observation.photo;
    if (!photo) throw new Error('Missing fixture photo');
    expect(() =>
      assertObservationAllowed(
        source,
        {
          ...observation,
          floorPlan: { ...photo, url: 'https://other.invalid/plan.jpg' },
        },
        now,
      ),
    ).toThrow('another host');
    expect(() =>
      assertObservationAllowed(
        source,
        {
          ...observation,
          photo: observation.photo && {
            ...observation.photo,
            expiresAt: now.toISOString(),
          },
        },
        now,
      ),
    ).toThrow('another host');
    expect(() =>
      assertObservationAllowed(
        source,
        {
          ...observation,
          evidence: [
            {
              ...observation.evidence[0],
              sourceUrl: 'https://other.example.invalid/evidence',
            },
          ],
        },
        now,
      ),
    ).toThrow('provenance');
  });
  it.each(['buyer_observation', 'model_interpretation'] as const)(
    'prevents ingestion from claiming %s ownership',
    (kind) => {
      expect(() =>
        assertObservationAllowed(
          source,
          { ...observation, evidence: [{ ...observation.evidence[0], kind }] },
          now,
        ),
      ).toThrow('provenance');
    },
  );
  it('prevents source ingestion from claiming user supplied coordinates', () => {
    const coordinates = observation.coordinates;
    if (!coordinates) throw new Error('Missing fixture coordinate');
    expect(() =>
      assertObservationAllowed(
        source,
        {
          ...observation,
          coordinates: {
            ...coordinates,
            precision: 'user_supplied',
          },
        },
        now,
      ),
    ).toThrow('user-supplied');
  });
});
