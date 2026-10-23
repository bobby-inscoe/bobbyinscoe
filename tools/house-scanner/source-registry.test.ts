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
import { sourceRegistry } from '@house-scanner-tools/source-registry';
import { describe, expect, it } from 'vitest';

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
  const found = sourceRegistry().find((e) => e.source.sourceId === sourceId);
  if (!found) throw new Error(`${sourceId} missing`);
  return structuredClone(found);
};

describe.each(adapters.map((adapter) => [adapter.sourceId, adapter] as const))(
  '%s registry entry',
  (sourceId, adapter) => {
    it('is found by its capability', () => {
      expect(adapterFor(entry(sourceId))).toBe(adapter);
    });

    it('refuses a capability whose source id, hosts or executor differ', () => {
      const changes: [string, (c: Entry) => unknown][] = [
        ['the wrong source id', (c: Entry) => (c.source.sourceId = 'other')],
        [
          'a different listing origin',
          (c: Entry) =>
            (c.source.listingOrigins = [`${adapter.origin}.example.invalid`]),
        ],
        [
          'an extra listing origin',
          (c: Entry) =>
            (c.source.listingOrigins = [adapter.origin, 'https://x.invalid']),
        ],
        [
          'a plain http origin',
          (c: Entry) =>
            (c.source.listingOrigins = [
              adapter.origin.replace('https:', 'http:'),
            ]),
        ],
        ['no image origin', (c: Entry) => (c.source.imageOrigins = [])],
        [
          'another image origin',
          (c: Entry) => (c.source.imageOrigins = ['https://images.invalid']),
        ],
        [
          'an extra image origin',
          (c: Entry) =>
            (c.source.imageOrigins = [
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
