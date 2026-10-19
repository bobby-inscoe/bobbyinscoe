import {
  finishViewings,
  viewingFromLabelledWallClock,
  viewingFromLocal,
  viewingFromSwedishText,
} from '@house-scanner-tools/viewing-time';
import { describe, expect, it } from 'vitest';

const now = new Date('2026-10-17T09:00:00Z');

describe('viewing times', () => {
  it.each([
    // Summer time until 03:00 on Sunday 25 October 2026, winter time after.
    ['2026-10-24T15:00', '2026-10-24T13:00:00.000Z'],
    ['2026-10-25T15:00', '2026-10-25T14:00:00.000Z'],
    ['2026-11-01T15:00:00', '2026-11-01T14:00:00.000Z'],
    ['2027-03-28T12:00', '2027-03-28T10:00:00.000Z'],
    ['2027-01-12T09:30', '2027-01-12T08:30:00.000Z'],
  ])('reads local time %s as Stockholm time', (local, utc) => {
    expect(viewingFromLocal(local)).toEqual({ startsAt: utc, endsAt: null });
  });

  it('gives an end from an ISO duration, or from a second local time', () => {
    expect(viewingFromLocal('2026-10-24T15:00', 'PT1H')).toEqual({
      startsAt: '2026-10-24T13:00:00.000Z',
      endsAt: '2026-10-24T14:00:00.000Z',
    });
    expect(viewingFromLocal('2026-10-24T15:00', 'PT45M')?.endsAt).toBe(
      '2026-10-24T13:45:00.000Z',
    );
    expect(
      viewingFromLocal('2026-10-24T15:00', '2026-10-24T16:30')?.endsAt,
    ).toBe('2026-10-24T14:30:00.000Z');
    // An end that is not after the start, or is not understood, is left out.
    expect(
      viewingFromLocal('2026-10-24T15:00', '2026-10-24T14:00')?.endsAt,
    ).toBe(null);
    expect(viewingFromLocal('2026-10-24T15:00', 'soon')?.endsAt).toBeNull();
  });

  it.each([
    'nonsense',
    '',
    null,
    42,
    '2026-13-01T10:00',
    '2026-02-30T10:00',
    // Clocks jump from 02:00 to 03:00 on 29 March 2026, so 02:30 does not exist.
    '2026-03-29T02:30',
  ])('refuses a local time it cannot place: %s', (value) => {
    expect(viewingFromLocal(value)).toBeNull();
  });

  it('reads a time labelled Z as Stockholm wall-clock time, as Boneo and Husman Hagberg send it', () => {
    // Bjurfors lists this viewing at 13:15 on its own page; Boneo labels the same 13:15 with a Z.
    expect(
      viewingFromLabelledWallClock(
        '2026-10-25T13:15:00.000Z',
        '2026-10-25T14:15:00.000Z',
      ),
    ).toEqual({
      startsAt: '2026-10-25T12:15:00.000Z',
      endsAt: '2026-10-25T13:15:00.000Z',
    });
    expect(viewingFromLabelledWallClock('2026-10-24T15:00:00Z')).toEqual({
      startsAt: '2026-10-24T13:00:00.000Z',
      endsAt: null,
    });
  });

  it('refuses a time with an offset or none, so a feed that starts sending real UTC fails loudly', () => {
    expect(
      viewingFromLabelledWallClock('2026-10-31T14:00:00+01:00'),
    ).toBeNull();
    expect(viewingFromLabelledWallClock(undefined)).toBeNull();
    expect(viewingFromLabelledWallClock('Saturday')).toBeNull();
  });

  it.each([
    ['Söndag 1 november kl. 15:00', '2026-11-01T14:00:00.000Z'],
    ['Torsdag 22 oktober kl. 17:00', '2026-10-22T15:00:00.000Z'],
    ['söndag 25 oktober kl. 11:45', '2026-10-25T10:45:00.000Z'],
    ['Lördag 9 januari kl. 12:00', '2027-01-09T11:00:00.000Z'],
  ])('reads %s, finding the year from the weekday', (text, utc) => {
    expect(viewingFromSwedishText(text, now)).toEqual({
      startsAt: utc,
      endsAt: null,
    });
  });

  it('drops a Swedish date whose weekday fits no near year, or that has no time', () => {
    expect(
      viewingFromSwedishText('Måndag 1 november kl. 15:00', now),
    ).toBeNull();
    expect(viewingFromSwedishText('Söndag 1 november', now)).toBeNull();
    expect(
      viewingFromSwedishText('Söndag 32 november kl. 15:00', now),
    ).toBeNull();
    expect(viewingFromSwedishText('Nästa visning', now)).toBeNull();
  });

  it('keeps future viewings sorted and without repeats, at most ten, and nothing when none are left', () => {
    const at = (day: number) => ({
      startsAt: `2026-10-${String(day).padStart(2, '0')}T10:00:00.000Z`,
      endsAt: null,
    });
    const many = Array.from({ length: 14 }, (_v, i) => at(18 + i));
    expect(finishViewings([at(30), at(18), at(18), at(16)], now)).toEqual([
      at(18),
      at(30),
    ]);
    expect(finishViewings(many, now)).toHaveLength(10);
    expect(finishViewings([at(16), at(15)], now)).toBeUndefined();
    expect(finishViewings([], now)).toBeUndefined();
  });
});
