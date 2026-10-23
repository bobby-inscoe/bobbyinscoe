import { describe, expect, it } from 'vitest';

import {
  coordinateSchema,
  factsSchema,
  listingUrlSchema,
  type SourceSettings,
  snapshotSchema,
  sourceSettingsSchema,
  viewingSchema,
} from '@/features/house-scanner/types/contracts';

const source: SourceSettings = {
  sourceId: 'synthetic-fixture',
  enabled: true,
  listingOrigins: ['https://example.invalid'],
  imageOrigins: ['https://images.example.invalid'],
};

// Hosts that z.url() accepts but the URL constructor refuses. They used to
// throw out of safeParse, which turned a bad stored source into a server error.
const HOSTS_THAT_THROW = [
  'https://example.123',
  'https://a.b.c.4',
  'https://a.0x',
  'https://xn--a',
];
// A valid URL that normalizes to 127.0.0.1, so it is a fine link but not an origin.
const HOSTS_THAT_NORMALIZE = ['https://0x7f000001', 'https://0x7f.0.0.1'];

describe('URL refinements fail validation instead of throwing', () => {
  it('accepts the plain synthetic source', () => {
    expect(sourceSettingsSchema.safeParse(source).success).toBe(true);
  });

  it.each(HOSTS_THAT_THROW)('listing url %s', (value) => {
    expect(() => listingUrlSchema.safeParse(value)).not.toThrow();
    expect(listingUrlSchema.safeParse(value).success).toBe(false);
  });

  it.each([...HOSTS_THAT_THROW, ...HOSTS_THAT_NORMALIZE])(
    'source origins %s',
    (value) => {
      for (const key of ['listingOrigins', 'imageOrigins'] as const) {
        const attempt = () =>
          sourceSettingsSchema.safeParse({ ...source, [key]: [value] });
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
});
