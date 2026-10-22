import { describe, expect, it } from 'vitest';

import {
  coordinateSchema,
  factsSchema,
  listingUrlSchema,
  type SourcePolicy,
  snapshotSchema,
  sourcePolicySchema,
  viewingSchema,
} from '@/features/house-scanner/types/contracts';

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

// Hosts that z.url() accepts but the URL constructor refuses. They used to
// throw out of safeParse, which turned a bad stored policy into a server error.
const HOSTS_THAT_THROW = [
  'https://example.123',
  'https://a.b.c.4',
  'https://a.0x',
  'https://xn--a',
];
// A valid URL that normalizes to 127.0.0.1, so it is a fine link but not an origin.
const HOSTS_THAT_NORMALIZE = ['https://0x7f000001', 'https://0x7f.0.0.1'];

describe('URL refinements fail validation instead of throwing', () => {
  it('accepts the plain synthetic policy', () => {
    expect(sourcePolicySchema.safeParse(policy).success).toBe(true);
  });

  it.each(HOSTS_THAT_THROW)('listing url %s', (value) => {
    expect(() => listingUrlSchema.safeParse(value)).not.toThrow();
    expect(listingUrlSchema.safeParse(value).success).toBe(false);
  });

  it.each([...HOSTS_THAT_THROW, ...HOSTS_THAT_NORMALIZE])(
    'policy origins %s',
    (value) => {
      for (const key of ['listingOrigins', 'imageOrigins'] as const) {
        const attempt = () =>
          sourcePolicySchema.safeParse({ ...policy, [key]: [value] });
        expect(attempt).not.toThrow();
        expect(attempt().success).toBe(false);
      }
    },
  );
});

describe('optional fields added without a version bump', () => {
  const position = {
    longitude: 11.9,
    latitude: 57.7,
    precision: 'address',
    source: 'Synthetic position',
    observedAt: '2026-10-17T10:00:00Z',
  };

  it.each([undefined, true, false])('accepts estimated %s', (estimated) => {
    expect(coordinateSchema.safeParse({ ...position, estimated }).success).toBe(
      true,
    );
  });

  it('rejects a flag that is not a boolean and still rejects unknown keys', () => {
    expect(
      coordinateSchema.safeParse({ ...position, estimated: 'yes' }).success,
    ).toBe(false);
    expect(
      coordinateSchema.safeParse({ ...position, exact: true }).success,
    ).toBe(false);
  });

  const snapshot = {
    contractVersion: 1,
    householdId: '10000000-0000-4000-8000-000000000001',
    edition: null,
    members: [],
    profiles: [],
    listings: [],
    favorites: [],
  };

  it('accepts a snapshot without hides and refuses the old per-member hidden ids', () => {
    expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      snapshotSchema.safeParse({
        ...snapshot,
        hiddenListingIds: ['10000000-0000-4000-8000-000000000002'],
      }).success,
    ).toBe(false);
  });
});

describe('viewings', () => {
  const viewing = {
    startsAt: '2026-10-24T13:00:00Z',
    endsAt: '2026-10-24T14:00:00Z',
  };

  it('accepts a start with or without an end, and nothing else', () => {
    expect(viewingSchema.safeParse(viewing).success).toBe(true);
    expect(viewingSchema.safeParse({ ...viewing, endsAt: null }).success).toBe(
      true,
    );
    expect(
      viewingSchema.safeParse({ startsAt: viewing.startsAt }).success,
    ).toBe(false);
    expect(
      viewingSchema.safeParse({ ...viewing, note: 'Anmäl dig' }).success,
    ).toBe(false);
    expect(
      viewingSchema.safeParse({ ...viewing, startsAt: 'Sat 24 Oct' }).success,
    ).toBe(false);
  });

  it('is optional on a policy, defaulting to not allowed', () => {
    expect(sourcePolicySchema.safeParse(policy).success).toBe(true);
    expect(
      sourcePolicySchema.safeParse({ ...policy, viewings: true }).success,
    ).toBe(true);
    expect(
      sourcePolicySchema.safeParse({ ...policy, viewings: 'yes' }).success,
    ).toBe(false);
  });
});
