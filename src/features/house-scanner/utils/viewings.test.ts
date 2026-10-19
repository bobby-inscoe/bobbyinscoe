import { describe, expect, it } from 'vitest';

import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import type {
  Listing,
  Viewing,
} from '@/features/house-scanner/types/contracts';
import {
  calendarFileName,
  formatViewing,
  groupByDay,
  hasViewingWithin,
  type UpcomingViewing,
  upcomingViewings,
  viewingCalendar,
  viewingsWithin,
} from '@/features/house-scanner/utils/viewings';

const base = SYNTHETIC_SNAPSHOT.listings[0];
// Saturday 17 October 2026, 11:00 in Stockholm.
const now = Date.parse('2026-10-17T09:00:00Z');
const hours = (n: number) => new Date(now + n * 3_600_000).toISOString();
const at = (start: string, end: string | null = null): Viewing => ({
  startsAt: start,
  endsAt: end,
});
const home = (title: string, viewings?: Viewing[]): Listing => ({
  ...base,
  id: `00000000-0000-4000-8000-${String(title.length).padStart(12, '0')}`,
  title,
  ...(viewings ? { viewings } : {}),
});

describe('which viewings are still ahead', () => {
  it('keeps a viewing that has not ended, sorted, and drops ones that are over', () => {
    const listing = home('Exempelgatan 1', [
      at(hours(30)),
      at(hours(-5), hours(-4)),
      at(hours(-0.5), hours(0.5)),
      at(hours(3)),
    ]);
    expect(upcomingViewings(listing, now).map((v) => v.startsAt)).toEqual([
      hours(-0.5),
      hours(3),
      hours(30),
    ]);
  });

  it('treats a viewing with no end as one hour long', () => {
    const listing = home('Exempelgatan 1', [at(hours(-0.5)), at(hours(-1.5))]);
    expect(upcomingViewings(listing, now).map((v) => v.startsAt)).toEqual([
      hours(-0.5),
    ]);
  });

  it('is empty for a listing with none', () => {
    expect(upcomingViewings(home('Exempelgatan 1'), now)).toEqual([]);
  });

  it('asks whether any falls within a number of days', () => {
    const listing = home('Exempelgatan 1', [at(hours(24 * 5))]);
    expect(hasViewingWithin(listing, 3, now)).toBe(false);
    expect(hasViewingWithin(listing, 7, now)).toBe(true);
    expect(hasViewingWithin(home('Exempelgatan 1'), 7, now)).toBe(false);
  });
});

describe('showing a viewing', () => {
  it('writes the weekday, date and Stockholm time, with the end when there is one', () => {
    expect(
      formatViewing(at('2026-10-24T13:00:00.000Z', '2026-10-24T14:00:00.000Z')),
    ).toBe('Sat 24 Oct, 15:00–16:00');
    expect(formatViewing(at('2026-11-01T14:00:00.000Z'))).toBe(
      'Sun 1 Nov, 15:00',
    );
  });
});

describe('the timeline', () => {
  const entries = (items: [string, Viewing][]): UpcomingViewing[] =>
    items.map(([title, viewing]) => ({ listing: home(title), viewing }));

  it('groups by Stockholm day with Today and Tomorrow, in time order', () => {
    const groups = groupByDay(
      entries([
        ['Late', at('2026-10-18T20:00:00Z')],
        ['Noon', at('2026-10-17T10:00:00Z')],
        ['Next week', at('2026-10-24T13:00:00Z')],
        ['Early', at('2026-10-18T06:00:00Z')],
      ]),
      now,
    );
    expect(groups.map((g) => g.label)).toEqual([
      'Today',
      'Tomorrow',
      'Sat 24 Oct',
    ]);
    expect(groups[1].entries.map((e) => e.listing.title)).toEqual([
      'Early',
      'Late',
    ]);
  });

  it('puts a viewing just after midnight in Stockholm on the next day, not on the UTC day', () => {
    const [group] = groupByDay(
      entries([['Midnight', at('2026-10-17T22:30:00Z')]]),
      now,
    );
    expect(group.label).toBe('Tomorrow');
  });

  it('counts viewings that start within a number of hours', () => {
    const list = entries([
      ['A', at(hours(2))],
      ['B', at(hours(47))],
      ['C', at(hours(49))],
    ]);
    expect(viewingsWithin(list, 48, now)).toBe(2);
    expect(viewingsWithin([], 48, now)).toBe(0);
  });
});

describe('the calendar file', () => {
  const listing = home('Exempelgatan 1, Göteborg; "tall"');
  const viewing = at('2026-10-24T13:00:00.000Z', '2026-10-24T14:30:00.000Z');
  const ics = viewingCalendar(listing, viewing, now);
  const lines = ics.split('\r\n');

  it('is a calendar with one event, CRLF line breaks and the start and end in UTC', () => {
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('BEGIN:VEVENT');
    expect(lines).toContain('DTSTART:20261024T130000Z');
    expect(lines).toContain('DTEND:20261024T143000Z');
    expect(lines).toContain('DTSTAMP:20261017T090000Z');
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('adds one hour when the source gave no end', () => {
    const open = viewingCalendar(listing, at('2026-10-24T13:00:00.000Z'), now);
    expect(open.split('\r\n')).toContain('DTEND:20261024T140000Z');
  });

  it('reminds a week before and a day before', () => {
    const triggers = lines.filter((l) => l.startsWith('TRIGGER'));
    expect(triggers).toEqual(['TRIGGER:-P7D', 'TRIGGER:-P1D']);
    expect(lines.filter((l) => l === 'BEGIN:VALARM')).toHaveLength(2);
    expect(lines.filter((l) => l === 'ACTION:DISPLAY')).toHaveLength(2);
  });

  it('escapes commas, semicolons and quotes in the title and keeps the link', () => {
    const summary = lines.find((l) => l.startsWith('SUMMARY'));
    expect(summary).toBe(
      'SUMMARY:Viewing: Exempelgatan 1\\, Göteborg\\; "tall"',
    );
    expect(lines.some((l) => l.startsWith('URL:https://'))).toBe(true);
  });

  it('gives the same id for the same viewing, so re-adding it replaces the event', () => {
    const again = viewingCalendar(listing, viewing, now + 60_000);
    const uid = (text: string) =>
      text.split('\r\n').find((l) => l.startsWith('UID:'));
    expect(uid(again)).toBe(uid(ics));
    expect(uid(ics)).toContain(listing.id);
  });

  it('folds lines longer than 75 characters', () => {
    const long = viewingCalendar(home('A'.repeat(200)), viewing, now);
    for (const line of long.split('\r\n'))
      expect(line.length).toBeLessThanOrEqual(75);
  });

  it('names the file from the address and the date', () => {
    expect(calendarFileName(listing, viewing)).toBe(
      'viewing-2026-10-24-exempelgatan-1-goteborg-tall.ics',
    );
  });
});
