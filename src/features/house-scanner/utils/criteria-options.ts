// The choices behind the area, room, radius and municipality dropdowns. One list per control, so the
// listing filters and the saved search criteria offer the same steps.

const range = (from: number, to: number, step: number) =>
  Array.from(
    { length: Math.floor((to - from) / step) + 1 },
    (_, i) => from + i * step,
  );

/** Living area in m²: every 5 up to 150, then the sizes a big home usually has. */
export const AREA_OPTIONS = [...range(30, 150, 5), 175, 200] as const;

/** Room counts in halves, as brokers list them (2.5 rooms is common). */
export const ROOM_OPTIONS = [...range(1, 6, 0.5)] as const;

export const RADIUS_OPTIONS_KM = [5, 10, 15, 20, 30, 40, 50] as const;

const number = new Intl.NumberFormat('sv-SE');

export const formatArea = (value: number) => `${number.format(value)} m²`;
export const formatRooms = (value: number) =>
  `${number.format(value)} ${value === 1 ? 'room' : 'rooms'}`;
export const formatKm = (value: number) => `${number.format(value)} km`;

/**
 * Places the collector can read today. The collector lives outside the app bundle, so this list is
 * kept in step with `tools/house-scanner/source-adapters.ts` by hand: add a place here only after
 * an adapter reads it.
 */
export const MUNICIPALITIES: readonly { value: string; supported: boolean }[] =
  [
    { value: 'Göteborg', supported: true },
    { value: 'Mölndal', supported: false },
  ];

/** Brunnsparken, the anchor the search circle was designed around: [longitude, latitude]. */
export const BRUNNSPARKEN: readonly [number, number] = [11.9694, 57.7067];

const COORDINATE_TOLERANCE = 0.005;
export const isNear = (
  [longitude, latitude]: readonly [number, number],
  [otherLongitude, otherLatitude]: readonly [number, number],
) =>
  Math.abs(longitude - otherLongitude) < COORDINATE_TOLERANCE &&
  Math.abs(latitude - otherLatitude) < COORDINATE_TOLERANCE;
