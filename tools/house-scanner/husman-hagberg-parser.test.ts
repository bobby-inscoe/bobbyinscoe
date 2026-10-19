import { readHusmanHagbergSearchPage } from '@house-scanner-tools/husman-hagberg-parser';
import {
  hhHome,
  hhList,
  PHOTO_ID,
  REF,
} from '@house-scanner-tools/husman-hagberg-test-pages';
import { assertAdapterOutput } from '@house-scanner-tools/live-run';
import {
  HUSMAN_HAGBERG_ORIGIN,
  sourceRegistry,
} from '@house-scanner-tools/source-registry';
import { describe, expect, it } from 'vitest';

const observedAt = new Date('2026-10-17T09:00:00.000Z');
const context = {
  origin: HUSMAN_HAGBERG_ORIGIN,
  observedAt,
  receivedBefore: 0,
  municipality: 'Göteborg',
};

function page(body: string, over: Partial<typeof context> = {}) {
  const read = readHusmanHagbergSearchPage(body, { ...context, ...over });
  if (read.kind !== 'page') throw new Error(`Page failed: ${read.reason}`);
  return read;
}
const one = (over: Record<string, unknown>) =>
  page(hhList([hhHome(over)])).observations[0];
const address = (over: Record<string, unknown>) => ({
  ...hhHome().address,
  ...over,
});
const details = (over: Record<string, unknown>) => ({
  ...hhHome().details,
  ...over,
});

describe('Husman Hagberg list', () => {
  it('reads a home into a contract observation with the photo and the broker position', () => {
    const [observation] = page(hhList([hhHome()])).observations;
    expect(observation).toMatchObject({
      sourceListingId: REF,
      episodeId: 'listed',
      sourceUrl: `https://www.husmanhagberg.se/estate/${REF}/`,
      title: 'Exempelgatan 1',
      observedAt: observedAt.toISOString(),
      coordinates: {
        latitude: 57.71,
        longitude: 11.97,
        precision: 'address',
        source: 'husman-hagberg-list',
      },
      evidence: [],
      photo: {
        url: `https://media.husmanhagberg.se/images/M00000/${PHOTO_ID}-672x448.jpg`,
        attribution: 'Husman Hagberg',
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
      groundFloor: false,
      lift: null,
      outdoor: null,
      glazed: null,
    });
    expect(
      Date.parse(observation.photo?.expiresAt ?? '') - observedAt.getTime(),
    ).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('passes the contract and the Husman Hagberg policy checks', () => {
    const policy = sourceRegistry().find(
      (entry) => entry.policy.sourceId === 'husman-hagberg',
    )?.policy;
    if (!policy) throw new Error('Husman Hagberg is not in the registry.');
    const [observation] = page(hhList([hhHome()])).observations;
    expect(() => assertAdapterOutput(policy, observation)).not.toThrow();
  });

  it('reads a house with unknown tenure and skips holiday homes, commercial property and unknown types', () => {
    const read = page(
      hhList([
        hhHome({ objectReference: 'OBJ1', estateType: 'House' }),
        hhHome({ objectReference: 'OBJ2', estateType: 'Cottage' }),
        hhHome({ objectReference: 'OBJ3', estateType: 'CommercialProperty' }),
        hhHome({ objectReference: 'OBJ4', estateType: 'Plot' }),
        hhHome({ objectReference: 'OBJ5', estateType: undefined }),
      ]),
    );
    expect(read.observations.map((o) => o.sourceListingId)).toEqual(['OBJ1']);
    expect(read.observations[0].facts).toMatchObject({
      propertyType: 'house',
      tenure: 'unknown',
      groundFloor: null,
    });
    expect(read.skipped).toBe(4);
  });

  it('marks shown coming-soon homes upcoming, and skips homes taken in but not shown, and any other status', () => {
    const read = page(
      hhList([
        hhHome({
          objectReference: 'OBJ1',
          statusId: 'TakenIn',
          showAsComing: true,
        }),
        hhHome({ objectReference: 'OBJ2', statusId: 'TakenIn' }),
        hhHome({ objectReference: 'OBJ3', statusId: 'Sold' }),
        hhHome({ objectReference: 'OBJ4', statusId: undefined }),
        hhHome({
          objectReference: 'OBJ5',
          statusId: 'Sold',
          showAsComing: true,
        }),
      ]),
    );
    expect(
      read.observations.map((o) => [o.sourceListingId, o.facts.status]),
    ).toEqual([['OBJ1', 'upcoming']]);
    expect(read.itemCount).toBe(5);
    expect(read.skipped).toBe(4);
  });

  it('treats a zero, missing or hidden price, and a zero fee, area and room count as unknown, never zero', () => {
    expect(
      one({
        startingPrice: 0,
        monthlyFee: 0,
        livingSpace: 0,
        numberOfRooms: null,
      }).facts,
    ).toMatchObject({
      askingPriceSek: null,
      baseFeeSek: null,
      livingAreaM2: null,
      rooms: null,
    });
    expect(one({ startingPrice: null }).facts.askingPriceSek).toBeNull();
    expect(
      one({ details: details({ advertiseOn: { hidePrice: true } }) }).facts
        .askingPriceSek,
    ).toBeNull();
  });

  it.each([
    [3, false],
    [2, false],
    [1, null],
    [0, true],
    [null, null],
    ['BV', true],
    ['', null],
  ])('reads floor %j as groundFloor %j', (floor, groundFloor) => {
    expect(
      one({ details: details({ floorAndElevator: { floor } }) }).facts
        .groundFloor,
    ).toBe(groundFloor);
  });

  it('reads no floor when the record has none', () => {
    expect(
      one({ details: details({ floorAndElevator: null }) }).facts.groundFloor,
    ).toBeNull();
    expect(one({ details: null }).facts.groundFloor).toBeNull();
  });

  it('keeps the position as a number, labels a title without a house number approximate, and drops bad points', () => {
    expect(
      one({ address: address({ streetAddress: 'Exempelvägen' }) }).coordinates,
    ).toMatchObject({ precision: 'approximate_area' });
    for (const [latitude, longitude] of [
      [null, '11.9'],
      ['abc', '11.9'],
      ['0', '0'],
      ['95', '11.9'],
      ['57.7', '190'],
    ])
      expect(
        one({ address: address({ latitude, longitude }) }).coordinates,
      ).toBeNull();
  });

  it('uses the area and no position when the broker hides the address', () => {
    const observation = one({
      details: details({ advertiseOn: { hideAddress: true } }),
    });
    expect(observation.title).toBe('Exempelområdet');
    expect(observation.coordinates).toBeNull();
    expect(JSON.stringify(observation)).not.toContain('Exempelgatan');
  });

  it('skips a home with neither street nor area', () => {
    const read = page(
      hhList([hhHome({ address: address({ streetAddress: '', area: null }) })]),
    );
    expect(read.observations).toHaveLength(0);
    expect(read.skipped).toBe(1);
  });

  it('keeps only the partition municipality; other places count as skipped', () => {
    const read = page(
      hhList([
        hhHome({ objectReference: 'OBJ1' }),
        hhHome({
          objectReference: 'OBJ2',
          address: address({ municipality: 'Mölndal' }),
        }),
        hhHome({
          objectReference: 'OBJ3',
          address: address({ municipality: null }),
        }),
        hhHome({
          objectReference: 'OBJ4',
          address: address({ municipality: ' GÖTEBORG ' }),
        }),
      ]),
    );
    expect(read.observations.map((o) => o.sourceListingId)).toEqual([
      'OBJ1',
      'OBJ4',
    ]);
    expect(read.skipped).toBe(2);
  });

  it('drops homes whose reference is not a plain id, and repeated references', () => {
    const read = page(
      hhList([
        hhHome({ objectReference: 'bad id!' }),
        hhHome({ objectReference: '../x' }),
        hhHome({ objectReference: 12 }),
        hhHome({ objectReference: 'OBJ5' }),
        hhHome({ objectReference: 'OBJ5' }),
      ]),
    );
    expect(read.observations.map((o) => o.sourceListingId)).toEqual(['OBJ5']);
    expect(read.skipped).toBe(4);
  });

  it('shows no photo unless it is a picture on the broker image host', () => {
    const thumb = (url: unknown) => ({
      list2x: { url },
      list: { url },
    });
    for (const url of [
      null,
      'https://evil.example/images/M1/MED1-672x448.jpg',
      'http://media.husmanhagberg.se/images/M1/MED1-672x448.jpg',
      'https://media.husmanhagberg.se/images/M1/../x.jpg',
      'https://media.husmanhagberg.se/other/MED1.jpg',
    ])
      expect(one({ thumb: thumb(url) }).photo).toBeNull();
    expect(one({ thumb: null }).photo).toBeNull();
  });

  it('falls back to the smaller picture', () => {
    expect(
      one({
        thumb: {
          list: {
            url: 'https://media.husmanhagberg.se/images/M1/MED1-336x224.jpg',
          },
        },
      }).photo?.url,
    ).toBe('https://media.husmanhagberg.se/images/M1/MED1-336x224.jpg');
  });

  it('accepts a byte order mark and reports one page when the list matches the count', () => {
    const read = page(`﻿${hhList([hhHome()])}`);
    expect(read.observations).toHaveLength(1);
    expect(read.more).toEqual({ kind: 'none' });
    expect(read.total).toBe(1);
  });

  it('reports a list shorter than its count as ended before the total', () => {
    const read = page(hhList([hhHome()], 300));
    expect(read.more).toEqual({
      kind: 'unknown',
      reason: 'empty-page-before-total',
    });
    expect(read.total).toBe(300);
  });

  it('fails coverage for anything that is not a non-empty list, never an empty result', () => {
    const fail = (body: string) => readHusmanHagbergSearchPage(body, context);
    expect(fail('<html>maintenance</html>')).toEqual({
      kind: 'failed',
      reason: 'invalid-embedded-data',
    });
    expect(fail('[]')).toEqual({ kind: 'failed', reason: 'unexpected-shape' });
    expect(fail('{"error":"x"}')).toEqual({
      kind: 'failed',
      reason: 'unexpected-shape',
    });
    expect(fail('{"estates":[],"count":0}')).toEqual({
      kind: 'failed',
      reason: 'no-results-list',
    });
    expect(fail(' '.repeat(3_000_001))).toEqual({
      kind: 'failed',
      reason: 'too-large',
    });
  });

  it('never carries free text from the answer into the observation', () => {
    const [observation] = page(hhList([hhHome()])).observations;
    expect(JSON.stringify(observation)).not.toContain('aldrig sparas');
  });
});

describe('Husman Hagberg viewing times', () => {
  const viewing = (
    startTime: string,
    endTime: string | null,
    showOnInternet = true,
  ) => ({
    date: startTime,
    startTime,
    endTime,
    commentary: 'Bokad visning',
    bookableFromInternet: true,
    bookingUrl: 'https://bokavisning.example.invalid/x',
    showOnInternet,
  });

  it('reads the list as Stockholm wall-clock time labelled Z, keeps the order, and drops the booking text', () => {
    const observation = one({
      viewings: [
        viewing('2026-10-25T13:30:00Z', '2026-10-25T14:00:00Z'),
        viewing('2026-10-22T17:00:00Z', '2026-10-22T17:30:00Z'),
      ],
    });
    expect(observation.viewings).toEqual([
      // Summer time, two hours ahead of UTC.
      {
        startsAt: '2026-10-22T15:00:00.000Z',
        endsAt: '2026-10-22T15:30:00.000Z',
      },
      // Winter time from 25 October, one hour ahead.
      {
        startsAt: '2026-10-25T12:30:00.000Z',
        endsAt: '2026-10-25T13:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(observation)).not.toContain('example.invalid');
    expect(JSON.stringify(observation)).not.toContain('Bokad');
  });

  it('keeps only viewings shown on the internet, and leaves the key out when none are left or readable', () => {
    expect(
      one({
        viewings: [
          viewing('2026-10-22T17:00:00Z', null, false),
          viewing('2026-10-23T17:00:00Z', null),
        ],
      }).viewings,
    ).toEqual([{ startsAt: '2026-10-23T15:00:00.000Z', endsAt: null }]);
    for (const viewings of [
      undefined,
      [],
      'soon',
      [viewing('2026-10-22T17:00:00Z', null, false)],
      [viewing('2026-10-01T17:00:00Z', null)],
      [viewing('nonsense', null), null, 'x'],
    ])
      expect(one({ viewings })).not.toHaveProperty('viewings');
  });
});
