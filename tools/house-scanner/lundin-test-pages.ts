// Authored, fictional answer shaped like the JSON the site's own list page loads (a structure-only look
// on 17 October 2026): one array of every object the broker has. No real listing text or values are used.
export const GUID = 'OBJ0000000000000000001';
export const IMAGE_GUID = 'MED0000000000000000001';

export function lundinHome(over: Record<string, unknown> = {}) {
  return {
    ImageUrl: null,
    ImageGuid: IMAGE_GUID,
    City: 'Göteborg',
    Address: 'Exempelgatan 1',
    Price: 3_900_000.0,
    Rent: 4250.0,
    Area: 70.5,
    Guid: GUID,
    Type: 'CMBoLgh',
    Status: 'Till salu',
    Date: '2026-10-16T13:57:59',
    Location: 'Exempelområdet',
    ParentLocation: 'Innerstaden',
    IsUpComing: false,
    IsSold: false,
    Heading: '3:a Exempelområdet',
    Descr: 'Fri text som aldrig sparas.',
    Rooms: 3.0,
    DescrUrl: `/beskrivning/${GUID}/exempelgatan-1`,
    SubHeading: '<span class="price">Pris: 3 900 000 kr</span>',
    ObjectType: 'Lägenhet',
    ...over,
  };
}

// The id and the address both change with n, so each home is its own listing.
export function numbered(n: number, over: Record<string, unknown> = {}) {
  const guid = `OBJ${String(n).padStart(19, '0')}`;
  return lundinHome({
    Guid: guid,
    Address: `Gata ${n}`,
    DescrUrl: `/beskrivning/${guid}/gata-${n}`,
    ...over,
  });
}

export const lundinList = (homes: unknown[]) => JSON.stringify(homes);
