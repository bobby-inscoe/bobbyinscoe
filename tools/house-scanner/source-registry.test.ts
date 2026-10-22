import {
  adapterFor,
  bjurforsAdapter,
  boneoAdapter,
  erikOlssonAdapter,
  husmanHagbergAdapter,
  lundinAdapter,
  stadshemAdapter,
  svenskfastAdapter,
} from '@house-scanner-tools/source-adapters';
import {
  approvedPolicy,
  sourceRegistry,
} from '@house-scanner-tools/source-registry';
import { describe, expect, it } from 'vitest';
import { assertSourceAllowed } from '@/features/house-scanner/utils/source-policy';

const adapters = [
  boneoAdapter,
  bjurforsAdapter,
  erikOlssonAdapter,
  stadshemAdapter,
  lundinAdapter,
  husmanHagbergAdapter,
  svenskfastAdapter,
];

type Entry = ReturnType<typeof entry>;
const entry = (sourceId: string) => {
  const found = sourceRegistry().find((e) => e.policy.sourceId === sourceId);
  if (!found) throw new Error(`${sourceId} missing`);
  return structuredClone(found);
};

describe.each(adapters.map((adapter) => [adapter.sourceId, adapter] as const))(
  '%s registry entry',
  (sourceId, adapter) => {
    it('yields a policy the owner can approve for 90 days', () => {
      const approved = approvedPolicy(
        sourceId,
        new Date('2026-10-20T00:00:00Z'),
      );
      expect(approved).toMatchObject({ status: 'approved' });
      expect(() =>
        assertSourceAllowed(approved, new Date('2026-10-21T00:00:00Z')),
      ).not.toThrow();
    });

    it('is found by its capability', () => {
      expect(adapterFor(entry(sourceId))).toBe(adapter);
    });

    it('refuses a capability whose source id, hosts or executor differ', () => {
      const changes: [string, (c: Entry) => unknown][] = [
        ['the wrong source id', (c: Entry) => (c.policy.sourceId = 'other')],
        [
          'a different listing origin',
          (c: Entry) =>
            (c.policy.listingOrigins = [`${adapter.origin}.example.invalid`]),
        ],
        [
          'an extra listing origin',
          (c: Entry) =>
            (c.policy.listingOrigins = [adapter.origin, 'https://x.invalid']),
        ],
        [
          'a plain http origin',
          (c: Entry) =>
            (c.policy.listingOrigins = [
              adapter.origin.replace('https:', 'http:'),
            ]),
        ],
        ['no image origin', (c: Entry) => (c.policy.imageOrigins = [])],
        [
          'another image origin',
          (c: Entry) => (c.policy.imageOrigins = ['https://images.invalid']),
        ],
        [
          'an extra image origin',
          (c: Entry) =>
            (c.policy.imageOrigins = [
              adapter.imageOrigin,
              'https://cdn.invalid',
            ]),
        ],
        [
          'another executor',
          (c: Entry) =>
            (c.executor =
              adapter === boneoAdapter
                ? 'lundin-personal-read'
                : 'boneo-personal-read'),
        ],
        ['no executor', (c: Entry) => (c.executor = 'none')],
      ];
      for (const [name, change] of changes) {
        const capability = entry(sourceId);
        change(capability);
        expect(() => adapterFor(capability), name).toThrow(
          'No permitted executor',
        );
      }
    });
  },
);

it('leaves the sources nobody reads without an executor', () => {
  for (const id of ['alvhem', 'fastighetsbyran', 'booli', 'hemnet', 'norban'])
    expect(entry(id).executor).toBe('none');
});
