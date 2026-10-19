// Authored, fictional answers shaped like the two JSON documents the site's own pages load (a
// structure-only look on 17 October 2026): the list of estates and the record of one estate.
// No real listing text or values are used.
export const PHOTO_HOST = 'https://storage.googleapis.com';
export const photoUrl = (size: string) =>
  `${PHOTO_HOST}/example-bucket/estate/${size}/photo.jpg`;

export function estate(over: Record<string, unknown> = {}) {
  return {
    id: 'estate-OBJ0000000000000001-exempelgatan-1',
    estateId: 'OBJ0000000000000001',
    primaryImage: {
      sizes: {
        thumbnail: photoUrl('thumbnail'),
        medium: photoUrl('medium'),
        full: photoUrl('full'),
      },
    },
    price: { hidePrice: false, startingPrice: 3_900_000, finalPrice: 0 },
    monthlyFee: 4250,
    numberOfRooms: 3,
    livingSpace: 70.5,
    constructionYear: 1945,
    address: {
      streetAddress: 'Exempelgatan 1',
      city: 'Göteborg',
      municipality: 'Göteborg',
      area: { name: 'Exempelområdet' },
      coordinates: { longitude: '11.95', latitude: '57.7' },
    },
    status: { slug: 'till-salu', name: 'Till salu' },
    type: 'lägenhet',
    description: 'Fri text som aldrig sparas.',
    ...over,
  };
}

export function list(
  estates: unknown[],
  { page = 1, numPages = 1, total = estates.length } = {},
) {
  return JSON.stringify({
    total,
    page,
    num_pages: numPages,
    estates,
    filter: { page: String(page) },
  });
}

export function record(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    estateId: 'OBJ0000000000000001',
    description: { long_text: 'Fri text som aldrig sparas.' },
    floorAndElevator: { floor: '3', total_floors: '5', elevator: 'Yes' },
    baseInformation: { tenure: 'Bostadsrätt', fee: 4250 },
    agent: { description: 'Mäklarens text.' },
    ...over,
  });
}
