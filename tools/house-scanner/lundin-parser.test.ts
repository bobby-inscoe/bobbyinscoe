import { assertAdapterOutput } from '@house-scanner-tools/live-run';
import { readLundinSearchPage } from '@house-scanner-tools/lundin-parser';
import {
  GUID,
  IMAGE_GUID,
  lundinHome,
  lundinList,
} from '@house-scanner-tools/lundin-test-pages';
import {
  LUNDIN_ORIGIN,
  sourceRegistry,
} from '@house-scanner-tools/source-registry';
import { describe, expect, it } from 'vitest';

const observedAt = new Date('2026-10-17T09:00:00.000Z');
const context = {
  origin: LUNDIN_ORIGIN,
  observedAt,
  receivedBefore: 0,
  municipality: 'Göteborg',
};

function page(body: string, over: Partial<typeof context> = {}) {
  const read = readLundinSearchPage(body, { ...context, ...over });
  if (read.kind !== 'page') throw new Error(`Page failed: ${read.reason}`);
  return read;
}

describe('Lundin list', () => {
  it('reads a home into a contract observation with the photo and no position', () => {
    const [observation] = page(lundinList([lundinHome()])).observations;
    expect(observation).toMatchObject({
      sourceListingId: GUID,
      episodeId: 'listed',
      sourceUrl: `https://www.lundin.se/beskrivning/${GUID}/exempelgatan-1`,
      title: 'Exempelgatan 1',
      observedAt: observedAt.toISOString(),
      coordinates: null,
      evidence: [],
      photo: {
        url: `https://www.lundin.se/dc/${IMAGE_GUID}.jpg?mode=max&w=640&h=480&scale=down`,
        attribution: 'Lundin',
        displayAllowed: true,
        hotlinkAllowed: true,
        observedAt: observedAt.toISOString(),
      },
    });
    expect(observation.facts).toMatchObject({
      propertyType: 'apartment',
      tenure: 'cooperative',
      purchase: true,
      livingAreaM2: 70.5,
      rooms: 3,
      askingPriceSek: 3_900_000,
      baseFeeSek: 4250,
      municipality: 'Göteborg',
      status: 'available',
      groundFloor: null,
      lift: null,
      outdoor: null,
      glazed: null,
    });
    expect(
      Date.parse(observation.photo?.expiresAt ?? '') - observedAt.getTime(),
    ).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('passes the contract and the Lundin policy checks', () => {
    const policy = sourceRegistry().find(
      (entry) => entry.policy.sourceId === 'lundin',
    )?.policy;
    if (!policy) throw new Error('Lundin is not in the registry.');
    const [observation] = page(lundinList([lundinHome()])).observations;
    expect(() => assertAdapterOutput(policy, observation)).not.toThrow();
  });

  it.each([
    ['CMBoLgh', 'apartment', 'cooperative'],
    ['CMBOLGH', 'apartment', 'cooperative'],
    ['cmbolgh', 'apartment', 'cooperative'],
    ['CMVilla', 'house', 'ownership'],
    ['CMFritidshus', 'house', 'ownership'],
  ])(
    'reads type %s as %s with tenure %s, whatever the letter case',
    (type, propertyType, tenure) => {
      const [observation] = page(
        lundinList([lundinHome({ Type: type })]),
      ).observations;
      expect(observation.facts).toMatchObject({ propertyType, tenure });
    },
  );

  it('keeps coming-soon homes, marked upcoming, and counts sold homes, plots and new production as skipped', () => {
    const read = page(
      lundinList([
        lundinHome({
          Guid: 'OBJ1',
          Status: 'Snart till salu',
          DescrUrl: '/beskrivning/OBJ1/a',
        }),
        lundinHome({
          Guid: 'OBJ2',
          Status: 'Såld',
          DescrUrl: '/beskrivning/OBJ2/b',
        }),
        lundinHome({
          Guid: 'OBJ3',
          Type: 'CMTomt',
          DescrUrl: '/beskrivning/OBJ3/c',
        }),
        lundinHome({
          Guid: 'OBJ4',
          Type: 'cmnyprod',
          Status: 'Pågående',
          DescrUrl: '/beskrivning/OBJ4/d',
        }),
      ]),
    );
    expect(read.observations.map((o) => o.facts.status)).toEqual(['upcoming']);
    expect(read.itemCount).toBe(4);
    expect(read.skipped).toBe(3);
  });

  it('treats a zero or missing price, fee, area and room count as unknown, never zero', () => {
    const [observation] = page(
      lundinList([lundinHome({ Price: 0, Rent: 0, Area: 0, Rooms: null })]),
    ).observations;
    expect(observation.facts).toMatchObject({
      askingPriceSek: null,
      baseFeeSek: null,
      livingAreaM2: null,
      rooms: null,
    });
  });

  it.each([
    ['Göteborg', 'Innerstaden', 'Göteborg'],
    ['GÖTEBORG', '', 'Göteborg'],
    ['Hovås', 'Västra Göteborg', 'Göteborg'],
    ['Västra Frölunda', 'Västra Göteborg', 'Göteborg'],
    ['Mölndal', '', 'Mölndal'],
    ['Lindome', 'Mölndals kommun', 'Mölndal'],
  ])(
    'places city %s in district %s in %s',
    (City, ParentLocation, municipality) => {
      const [observation] = page(
        lundinList([lundinHome({ City, ParentLocation })]),
        { municipality },
      ).observations;
      expect(observation.facts.municipality).toBe(municipality);
    },
  );

  it('keeps only the partition municipality; other places and places it cannot place count as skipped', () => {
    const read = page(
      lundinList([
        lundinHome({ Guid: 'OBJ1', DescrUrl: '/beskrivning/OBJ1/a' }),
        lundinHome({
          Guid: 'OBJ2',
          City: 'Mölndal',
          ParentLocation: '',
          DescrUrl: '/beskrivning/OBJ2/b',
        }),
        lundinHome({
          Guid: 'OBJ3',
          City: 'Kungsbacka',
          ParentLocation: 'Kungsbacka Kommun',
          DescrUrl: '/beskrivning/OBJ3/c',
        }),
        lundinHome({
          Guid: 'OBJ4',
          City: 'Billdal',
          ParentLocation: '',
          DescrUrl: '/beskrivning/OBJ4/d',
        }),
      ]),
    );
    expect(read.observations.map((o) => o.sourceListingId)).toEqual(['OBJ1']);
    expect(read.skipped).toBe(3);
  });

  it('drops homes whose id or address path is not the expected shape, and repeated ids', () => {
    const read = page(
      lundinList([
        lundinHome({ Guid: 'OBJ1', DescrUrl: '/beskrivning/OBJ2/a' }),
        lundinHome({
          Guid: 'OBJ3',
          DescrUrl: 'https://evil.example/beskrivning/OBJ3/a',
        }),
        lundinHome({ Guid: 'OBJ4', DescrUrl: '/beskrivning/OBJ4/a b' }),
        lundinHome({ Guid: 'bad id!', DescrUrl: '/beskrivning/bad id!/a' }),
        lundinHome({ Guid: 'OBJ5', DescrUrl: '/beskrivning/OBJ5/a' }),
        lundinHome({ Guid: 'OBJ5', DescrUrl: '/beskrivning/OBJ5/a' }),
      ]),
    );
    expect(read.observations.map((o) => o.sourceListingId)).toEqual(['OBJ5']);
    expect(read.skipped).toBe(5);
  });

  it('shows no photo unless the image id is a plain id', () => {
    for (const ImageGuid of [null, '', '../x', 'a b'])
      expect(
        page(lundinList([lundinHome({ ImageGuid })])).observations[0].photo,
      ).toBeNull();
  });

  it('accepts a byte order mark, and reports one page with no more pages', () => {
    const read = page(`﻿${lundinList([lundinHome()])}`);
    expect(read.observations).toHaveLength(1);
    expect(read.more).toEqual({ kind: 'none' });
    expect(read.total).toBe(1);
  });

  it('fails coverage for anything that is not a non-empty list, never an empty result', () => {
    const fail = (body: string) => readLundinSearchPage(body, context);
    expect(fail('<html>maintenance</html>')).toEqual({
      kind: 'failed',
      reason: 'invalid-embedded-data',
    });
    expect(fail('{"error":"x"}')).toEqual({
      kind: 'failed',
      reason: 'unexpected-shape',
    });
    expect(fail('[]')).toEqual({ kind: 'failed', reason: 'no-results-list' });
    expect(fail(' '.repeat(3_000_001))).toEqual({
      kind: 'failed',
      reason: 'too-large',
    });
  });

  it('never carries free text from the answer into the observation', () => {
    const [observation] = page(lundinList([lundinHome()])).observations;
    expect(JSON.stringify(observation)).not.toContain('aldrig sparas');
    expect(JSON.stringify(observation)).not.toContain('Pris:');
  });
});
