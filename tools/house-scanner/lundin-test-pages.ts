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

// Authored home page in the shape of the public page (/beskrivning/<Guid>/<slug>) seen on 22 October 2026:
// preview photos in #sectionimages and plans in #section-planimages. Only the ids matter; the rest is filler.
export const PAGE_PHOTOS = [
  'MED0000000000000000011',
  '../x',
  'MED0000000000000000012',
  'MED0000000000000000013',
  'MED0000000000000000014',
  'MED0000000000000000015',
];
export const PAGE_PLANS = ['MED0000000000000000021', 'MED0000000000000000022'];

const photoFigure = (id: string) => `
  <figure class="object-image" data-id="${id}">
    <picture><img data-src="/dc/${id}.jpg?width=900&height=900&mode=max&scale=down" alt="Bild"></picture>
  </figure>`;
const planFigure = (id: string, n: number) => `
  <figure class="object-image object-image-plan">
    <picture><img data-src="/dc/${id}.jpg?width=700&height=435&mode=max&scale=down" alt="Planritning ${n}"></picture>
    <a href="#images" class="all-images">Förstora</a>
  </figure>`;

export function lundinHomePage(guid = GUID, images = true) {
  return `<!DOCTYPE html><html><head><title>Exempelgatan 1 - Lundin</title>
<link rel="canonical" href="https://www.lundin.se/beskrivning/${guid.toLowerCase()}/exempelgatan-1">
</head><body>
<section class="intro full-image"><figure class="object-image" data-id="MED0000000000000000099"></figure></section>
${
  images
    ? `<section id="sectionimages" class="section-images flex"><h2>Bilder</h2><div class="flex items6">${PAGE_PHOTOS.map(photoFigure).join('')}
</div></section>
<div id="section-planimages" class="section-images"><h2>Planritning</h2><div class="flex">${PAGE_PLANS.map(planFigure).join('')}
</div></div>`
    : ''
}
<div id="descr" class="desccontent"><span class="heading">Pris/Bud:</span> <span>3 900 000 kr</span></div>
</body></html>`;
}
