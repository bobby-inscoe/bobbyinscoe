// Authored, fictional answer shaped like the JSON the site's own search loads (a structure-only look on
// 17 October 2026): { estates: [...], count }. No real listing text or values are used.
export const REF = 'OBJ0000000000000000001';
export const PHOTO_ID = 'MED0000000000000000001';

export function hhHome(over: Record<string, unknown> = {}) {
  return {
    objectReference: REF,
    estateType: 'HousingCooperative',
    address: {
      latitude: '57.71000',
      longitude: '11.97000',
      streetAddress: 'Exempelgatan 1',
      zipCode: null,
      city: 'Göteborg',
      municipality: 'Göteborg',
      area: 'Exempelområdet',
    },
    livingSpace: 70.5,
    numberOfRooms: 3,
    startingPrice: 3_900_000,
    monthlyFee: 4250.0,
    statusId: 'ForSale',
    showAsComing: false,
    isComingLight: false,
    bidding: false,
    dateChanged: '2026-10-16T16:03:43.61Z',
    thumb: {
      list: {
        url: `https://media.husmanhagberg.se/images/M00000/${PHOTO_ID}-336x224.jpg`,
        w: 336,
        h: 224,
      },
      list2x: {
        url: `https://media.husmanhagberg.se/images/M00000/${PHOTO_ID}-672x448.jpg`,
        w: 672,
        h: 448,
      },
    },
    viewings: [],
    details: {
      advertiseOn: { hideAddress: false, hidePrice: false },
      baseInformation: { propertyType: 'Lägenhet' },
      floorAndElevator: { floor: 3, elevator: null },
      description: { sellingHeading: 'Fri text som aldrig sparas.' },
    },
    ...over,
  };
}

// The reference and the address both change with n, so each home is its own listing.
export function numbered(n: number, over: Record<string, unknown> = {}) {
  const home = hhHome();
  return hhHome({
    objectReference: `OBJ${String(n).padStart(19, '0')}`,
    address: { ...home.address, streetAddress: `Gata ${n}` },
    ...over,
  });
}

export const hhList = (homes: unknown[], count = homes.length) =>
  JSON.stringify({ estates: homes, count });
