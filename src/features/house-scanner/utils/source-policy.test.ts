import { describe, expect, it } from 'vitest';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import {
  factsSchema,
  type Observation,
  type SourcePolicy,
} from '@/features/house-scanner/types/contracts';
import { assertObservationAllowed } from '@/features/house-scanner/utils/source-policy';

const now = new Date('2026-10-12T12:00:00Z');
const policy: SourcePolicy = {
  sourceId: 'synthetic-fixture',
  revision: 1,
  status: 'approved',
  reviewedAt: '2026-10-12T00:00:00Z',
  reviewDueAt: '2027-01-01T00:00:00Z',
  rightsBasis: 'Authored local test fixture',
  listingOrigins: ['https://example.invalid'],
  freeOnly: true,
  automatedCollection: true,
  privateDisplay: true,
  modelProcessing: false,
  emailDigest: false,
  telegramDigest: false,
  allowedFactFields: [...factsSchema.keyof().options],
  retentionDays: 30,
  capabilities: {
    discovery: true,
    knownListingRefresh: true,
    unknownPrice: true,
    upcoming: true,
    pagination: true,
    resultCap: null,
    coverageGaps: ['Synthetic only'],
  },
  allowedEvidenceSubjects: ['nature_access'],
  imageDisplay: true,
  imageHotlink: true,
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

describe('source content permission', () => {
  it('accepts current content with explicit field, evidence and image rights', () => {
    expect(() =>
      assertObservationAllowed(policy, observation, now),
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
        expect(() => assertObservationAllowed(policy, stale, now)).toThrow(
          'time window',
        );
      }
    },
  );
  it.each([
    { status: 'pending' },
    { automatedCollection: false },
    { privateDisplay: false },
    { reviewDueAt: now.toISOString() },
    { reviewedAt: '2026-10-13T12:00:00Z' },
  ] satisfies Partial<SourcePolicy>[])(
    'fails closed for policy %j',
    (change) => {
      expect(() =>
        assertObservationAllowed({ ...policy, ...change }, observation, now),
      ).toThrow();
    },
  );
  it('accepts viewing times only for a source whose policy allows them', () => {
    const withViewings = {
      ...observation,
      viewings: [{ startsAt: '2026-10-24T13:00:00Z', endsAt: null }],
    };
    expect(() => assertObservationAllowed(policy, withViewings, now)).toThrow(
      'Viewing times',
    );
    expect(() =>
      assertObservationAllowed(
        { ...policy, viewings: true },
        withViewings,
        now,
      ),
    ).not.toThrow();
    expect(() =>
      assertObservationAllowed(policy, { ...observation, viewings: [] }, now),
    ).not.toThrow();
  });
  it('rejects unapproved fields, image origin, image expiry and evidence origins', () => {
    expect(() =>
      assertObservationAllowed(
        { ...policy, allowedFactFields: [] },
        observation,
        now,
      ),
    ).toThrow('fact field');
    expect(() =>
      assertObservationAllowed(
        { ...policy, imageOrigins: [] },
        observation,
        now,
      ),
    ).toThrow('Photo permission');
    expect(() =>
      assertObservationAllowed(
        policy,
        {
          ...observation,
          photo: observation.photo && {
            ...observation.photo,
            expiresAt: now.toISOString(),
          },
        },
        now,
      ),
    ).toThrow('Photo permission');
    expect(() =>
      assertObservationAllowed(
        policy,
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
          policy,
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
        policy,
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
