import type {
  Listing,
  Viewing,
} from '@/features/house-scanner/types/contracts';

const ZONE = 'Europe/Stockholm';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Most sources give a start only; a viewing is about an hour long.
const DEFAULT_LENGTH = HOUR;

export interface UpcomingViewing {
  listing: Listing;
  viewing: Viewing;
}

const endOf = (viewing: Viewing) =>
  viewing.endsAt === null
    ? Date.parse(viewing.startsAt) + DEFAULT_LENGTH
    : Date.parse(viewing.endsAt);

/** The listing's viewings that have not ended, earliest first. */
export function upcomingViewings(listing: Listing, now: number): Viewing[] {
  return (listing.viewings ?? [])
    .filter((viewing) => endOf(viewing) > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function hasViewingWithin(
  listing: Listing,
  days: number,
  now: number,
): boolean {
  return upcomingViewings(listing, now).some(
    (viewing) => Date.parse(viewing.startsAt) <= now + days * DAY,
  );
}

const dateParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE });

// "Sat 24 Oct": the weekday, day and month without the comma Intl puts after the weekday.
const dayText = (ms: number) => dateParts.format(new Date(ms)).replace(',', '');

/** "Sat 24 Oct, 15:00–16:00" in Stockholm time, or "Sat 24 Oct, 15:00" when there is no end. */
export function formatViewing(viewing: Viewing): string {
  const start = Date.parse(viewing.startsAt);
  const end =
    viewing.endsAt === null ? '' : `–${clock.format(new Date(viewing.endsAt))}`;
  return `${dayText(start)}, ${clock.format(new Date(start))}${end}`;
}

export interface ViewingDay {
  day: string;
  label: string;
  entries: UpcomingViewing[];
}

/** Viewings grouped by Stockholm calendar day, in time order, labelled Today and Tomorrow where they are. */
export function groupByDay(
  entries: UpcomingViewing[],
  now: number,
): ViewingDay[] {
  const today = dayKey.format(new Date(now));
  const tomorrow = dayKey.format(new Date(now + DAY));
  const days = new Map<string, ViewingDay>();
  for (const entry of [...entries].sort((a, b) =>
    a.viewing.startsAt.localeCompare(b.viewing.startsAt),
  )) {
    const start = Date.parse(entry.viewing.startsAt);
    const day = dayKey.format(new Date(start));
    const group = days.get(day) ?? {
      day,
      label:
        day === today
          ? 'Today'
          : day === tomorrow
            ? 'Tomorrow'
            : dayText(start),
      entries: [],
    };
    group.entries.push(entry);
    days.set(day, group);
  }
  return [...days.values()];
}

/** How many of the viewings start within the next number of hours. */
export function viewingsWithin(
  entries: UpcomingViewing[],
  hours: number,
  now: number,
): number {
  return entries.filter(
    (entry) => Date.parse(entry.viewing.startsAt) <= now + hours * HOUR,
  ).length;
}

// ---- calendar file ----

const utc = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
const escapeText = (text: string) =>
  text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

// Lines are limited to 75 characters; a longer one continues on the next line after a space.
function fold(line: string): string[] {
  const out = [line.slice(0, 75)];
  for (let at = 75; at < line.length; at += 74)
    out.push(` ${line.slice(at, at + 74)}`);
  return out;
}

const reminder = (trigger: string, text: string) => [
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  `DESCRIPTION:${text}`,
  `TRIGGER:${trigger}`,
  'END:VALARM',
];

/**
 * An iCalendar event for one viewing, with a reminder a week before and another a day before. The id is stable,
 * so adding the same viewing twice replaces the event. A reminder whose time has already passed is ignored by
 * the calendar app.
 */
export function viewingCalendar(
  listing: Listing,
  viewing: Viewing,
  now: number,
): string {
  const start = Date.parse(viewing.startsAt);
  const where = [listing.title, listing.facts.municipality]
    .filter(Boolean)
    .join(', ');
  const title = escapeText(`Viewing: ${listing.title}`);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//House Scanner//Viewings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${listing.id}-${utc(start)}@house-scanner`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(endOf(viewing))}`,
    `SUMMARY:${title}`,
    `LOCATION:${escapeText(where)}`,
    `DESCRIPTION:${escapeText(`Listing: ${listing.sourceUrls[0]}`)}`,
    `URL:${listing.sourceUrls[0]}`,
    ...reminder('-P7D', `${title} in one week`),
    ...reminder('-P1D', `${title} tomorrow`),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.flatMap(fold).join('\r\n')}\r\n`;
}

/** "viewing-2026-10-24-exempelgatan-1.ics": the Stockholm date and the address without accents. */
export function calendarFileName(listing: Listing, viewing: Viewing): string {
  const slug = listing.title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `viewing-${dayKey.format(new Date(viewing.startsAt))}-${slug}.ics`;
}
