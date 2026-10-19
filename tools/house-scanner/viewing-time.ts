import type { Viewing } from '@/features/house-scanner/types/contracts';

// Brokers publish viewing times as Swedish wall-clock time, so the conversion to UTC happens here and
// nowhere else. Anything that cannot be placed exactly is dropped: a missing viewing is better than a wrong one.

const ZONE = 'Europe/Stockholm';
const MAX_VIEWINGS = 10;
const DAY_MS = 86_400_000;
// A viewing is never announced further ahead than this, so a weekday that only fits a later year is a misread.
const HORIZON_MS = 120 * DAY_MS;
const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** Wall-clock fields in Stockholm at a UTC instant, read back as if they were UTC. */
function wallClock(utcMs: number) {
  const fields = Object.fromEntries(
    parts.formatToParts(new Date(utcMs)).map((p) => [p.type, Number(p.value)]),
  );
  return Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second,
  );
}

/** The UTC instant of a Stockholm wall-clock time, or null when that time does not exist. */
function stockholmToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number | null {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  )
    return null;
  let utc = wall - (wallClock(wall) - wall);
  utc = wall - (wallClock(utc) - utc);
  // A time inside the hour the clocks skip forward does not round-trip.
  return wallClock(utc) === wall ? utc : null;
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;
const DURATION = /^PT(?:(\d{1,2})H)?(?:(\d{1,3})M)?$/;

function localMs(value: unknown): number | null {
  const match = typeof value === 'string' ? LOCAL.exec(value) : null;
  return match === null
    ? null
    : stockholmToUtc(
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
      );
}

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * A viewing from a local start with no zone ("2026-10-24T15:00"), and an optional end given as an ISO
 * duration ("PT1H") or a second local time. An end that is not after the start is left out.
 */
export function viewingFromLocal(
  start: unknown,
  end?: unknown,
): Viewing | null {
  const startMs = localMs(start);
  if (startMs === null) return null;
  let endMs: number | null = null;
  const duration = typeof end === 'string' ? DURATION.exec(end) : null;
  if (duration !== null && (duration[1] || duration[2]))
    endMs =
      startMs +
      (Number(duration[1] ?? 0) * 60 + Number(duration[2] ?? 0)) * 60_000;
  else endMs = localMs(end);
  return {
    startsAt: iso(startMs),
    endsAt: endMs !== null && endMs > startMs ? iso(endMs) : null,
  };
}

/**
 * Some feeds write Stockholm wall-clock time with a trailing Z: Boneo and Husman Hagberg give
 * "2026-10-25T13:15:00.000Z" for a viewing Bjurfors' own page lists at 13:15. The zone letter is dropped and the
 * time read as Stockholm time. Times with an offset are refused, so a feed that starts to send real UTC fails
 * loudly instead of shifting every viewing.
 */
export function viewingFromLabelledWallClock(
  start: unknown,
  end?: unknown,
): Viewing | null {
  const bare = (value: unknown) =>
    typeof value === 'string' ? value.replace(/(?:\.\d+)?Z$/, '') : null;
  return viewingFromLocal(bare(start), bare(end));
}

const MONTHS = [
  'januari',
  'februari',
  'mars',
  'april',
  'maj',
  'juni',
  'juli',
  'augusti',
  'september',
  'oktober',
  'november',
  'december',
];
// Indexed by Date#getUTCDay.
const WEEKDAYS = [
  'söndag',
  'måndag',
  'tisdag',
  'onsdag',
  'torsdag',
  'fredag',
  'lördag',
];
const SWEDISH = new RegExp(
  `(?:(${WEEKDAYS.join('|')})\\s+)?(\\d{1,2})\\s+(${MONTHS.join('|')})\\s+kl\\.?\\s*(\\d{1,2})[:.](\\d{2})`,
  'i',
);

/**
 * "Söndag 1 november kl. 15:00". The text has no year, so it is the first of this year and the next whose
 * weekday matches, that is not already over and is within four months. Without a weekday the date must be within a day of now or ahead.
 */
export function viewingFromSwedishText(
  text: string,
  now: Date,
): Viewing | null {
  const match = SWEDISH.exec(text);
  if (match === null) return null;
  const weekday = match[1]?.toLowerCase();
  const day = Number(match[2]);
  const month = MONTHS.indexOf(match[3].toLowerCase()) + 1;
  const thisYear = new Date(wallClock(now.getTime())).getUTCFullYear();
  for (const year of [thisYear, thisYear + 1]) {
    const ms = stockholmToUtc(
      year,
      month,
      day,
      Number(match[4]),
      Number(match[5]),
    );
    if (
      ms === null ||
      ms < now.getTime() - DAY_MS ||
      ms > now.getTime() + HORIZON_MS
    )
      continue;
    if (
      weekday !== undefined &&
      WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] !== weekday
    )
      continue;
    return { startsAt: iso(ms), endsAt: null };
  }
  return null;
}

/** Future viewings, sorted, without repeats and at most ten. Undefined when none are left, so the key is omitted. */
export function finishViewings(
  viewings: Viewing[],
  now: Date,
): Viewing[] | undefined {
  const seen = new Set<string>();
  const kept = viewings
    .filter((viewing) => Date.parse(viewing.startsAt) > now.getTime())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .filter((viewing) => {
      if (seen.has(viewing.startsAt)) return false;
      seen.add(viewing.startsAt);
      return true;
    })
    .slice(0, MAX_VIEWINGS);
  return kept.length > 0 ? kept : undefined;
}
