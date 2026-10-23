// Authored, fictional pages shaped like the two kinds of page the site serves (a structure-only look on
// 17 October 2026): list pages with schema.org JSON-LD cards, and home pages with a listing block, a fact
// list and viewing rows. No real listing text or values are used.
export const ORIGIN = 'https://www.svenskfast.se';
export const IMAGE_HOST = 'https://i.sfcdn.se';

export interface CardInput {
  id?: number;
  kind?: 'bostadsratt' | 'hus';
  municipality?: string;
  street?: string;
  type?: string;
  rooms?: number;
  area?: number;
  availability?: string;
  image?: string | null;
  path?: string;
}

export const imageUrl = (id: number) =>
  `${IMAGE_HOST}/Resurs/Image/${id}/Large/639262842740000000/MDIyNnwwMDAyNDI0Nzk5NXw5Ng...jpg`;

// A collage photo at the Small size; `n` gives each its own id, stamp and name.
export const collagePhoto = (n: number) =>
  `${IMAGE_HOST}/Resurs/Image/40${n}000/Small/63854410348${n}000000/ExempelBild${n}Xyz...jpg`;

export const pathOf = ({
  id = 471704,
  kind = 'bostadsratt',
  municipality = 'goteborg',
  street = 'exempelgatan-1',
}: CardInput = {}) =>
  `/${kind}/vastra-gotaland/${municipality}/exempelomradet/${street}/${id}/`;

export function card(input: CardInput = {}) {
  const {
    id = 471704,
    street = 'Exempelgatan 1',
    type = 'Apartment',
    rooms = 3,
    area = 70.5,
    availability = 'https://schema.org/InStock',
    image = imageUrl(id),
  } = input;
  const url = `${ORIGIN}${input.path ?? pathOf(input)}`;
  return `<script type="application/ld+json">
                    ${JSON.stringify(
                      {
                        '@context': 'https://schema.org',
                        '@type': 'RealEstateListing',
                        '@id': `${url}#listing`,
                        url,
                        name: `Exempelområdet, ${street}`,
                        ...(image === null ? {} : { image }),
                        datePosted: '2026-10-17',
                        about: {
                          '@type': type,
                          name: `Exempelområdet, ${street}`,
                          address: {
                            '@type': 'PostalAddress',
                            streetAddress: street,
                            addressLocality: 'Exempelområdet',
                            postalCode: '42338',
                            addressCountry: 'SE',
                          },
                          numberOfRooms: rooms,
                          floorSize: {
                            '@type': 'QuantitativeValue',
                            value: area,
                            unitCode: 'MTK',
                          },
                        },
                        offers: {
                          '@type': 'Offer',
                          availability,
                          offeredBy: {
                            '@type': 'Organization',
                            name: 'Svensk Fastighetsförmedling',
                          },
                        },
                      },
                      null,
                      1,
                    )}
                    </script>`;
}

export function list(cards: CardInput[], total: number = cards.length) {
  const heading = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${ORIGIN}/bostad/vastra-gotaland/goteborg/#webpage`,
    url: `${ORIGIN}/bostad/vastra-gotaland/goteborg/`,
    name: `${total} Bostäder till salu - Göteborg — kommun`,
  });
  return `<html><head><title>${total} Bostäder till salu</title><script type="application/ld+json">${heading}</script></head><body>${cards
    .map(card)
    .join('\n')}</body></html>`;
}

export interface HomeInput {
  price?: string;
  fee?: string | null;
  floor?: string | null;
  lift?: 'Ja' | 'Nej' | null;
  ownership?: string;
  latitude?: string;
  longitude?: string;
  viewings?: {
    day: number;
    month: string;
    weekday: string;
    from: string;
    to: string;
  }[];
  withListing?: boolean;
  // Collage photo addresses in page order, as the Small size; the Medium and Large attributes follow from them.
  collage?: string[];
  // Floor plan addresses in the "Planritning" section, as the Large size.
  plans?: string[];
}

// Spaces inside numbers are the non-breaking space the site writes as &#160;.
export function home({
  price = '3995000',
  fee = '4&#160;102 kr',
  floor = '3 av 5',
  lift = 'Ja',
  ownership = 'Bostadsrätt',
  latitude = '57,70198',
  longitude = '11,91933',
  viewings = [],
  withListing = true,
  collage = [],
  plans = [],
}: HomeInput = {}) {
  const listing = JSON.stringify({
    '@context': 'https://schema.org/',
    '@type': 'RealEstateListing',
    category: 'Bostadsrätt till salu',
    product: {
      '@type': 'Product',
      name: 'Exempelområdet, Exempelgatan 1',
      description: 'Fri text som aldrig sparas.',
      seller: {
        '@type': 'RealEstateAgent',
        name: 'Svensk Fastighetsförmedling Exempelstad',
        employee: {
          '@type': 'Person',
          name: 'Mäklarens Namn',
          email: 'maklare@example.invalid',
        },
      },
      offers: { '@type': 'Offer', price, priceCurrency: 'SEK' },
      isRelatedTo: {
        '@type': 'Residence',
        floorSize: {
          '@type': 'QuantitativeValue',
          value: '70',
          unitCode: 'MTK',
        },
        numberOfRooms: '3',
        ownership,
        geo: { '@type': 'GeoCoordinates', latitude, longitude },
      },
    },
  });
  const rows = viewings
    .map(
      (
        v,
      ) => `<a href="#" class="summary__exhibitions--item summary__exhibition--item-link" data-target="1">
        <div class="flex"><div class="summary__exhibition--item-col1"><span class="calendar"> ${v.day}<br>${v.month} </span></div>
        <div class="summary__exhibition--item-col2"> ${v.weekday} ${v.from}-${v.to}
        <div class="summary__exhibition--register">Anm&#228;lan kr&#228;vs</div></div></div></a>`,
    )
    .join('\n');
  const cells = collage
    .map(
      (small) =>
        `<div class="col33"><img class="lazy-image" data-srcsmall="${small}" data-srcmedium="${small.replace('/Small/', '/Medium/')}" data-srclarge="${small.replace('/Small/', '/Medium/')}" /></div>`,
    )
    .join('');
  return `<html><head><title>Exempelgatan 1 | Svensk Fastighetsförmedling</title>${
    withListing ? `<script type="application/ld+json">${listing}</script>` : ''
  }<style>.a{}</style></head><body>
  <div class="summary__content"><div class="price"><div class="price__heading">Utg&#229;ngspris:&nbsp;</div></div>
  <span>Månadsavgift</span>: ${fee ?? ''}/månad
  <div class="summary__exhibitions--wrapper"><div class="summary__exhibitions--header">V&#228;lj visningstid</div>
  <div class="summary__exhibitions--row">${rows}</div></div></div>
  <div class="object-images__collage" id="collageWrapper">${cells}</div>
  <section class="object-images-wrapper object-images-wrapper--floorplan"><div id="planritning"><h2 class="h2">Planritning</h2></div>
  <div class="object-images__gallery object-images--floorplan__gallery jsOnPageImage">${plans
    .map(
      (large) =>
        `<div class="img-container" data-url-small="${large.replace('/Large/', '/Medium/')}" data-url-large="${large}"><img src="${large.replace('/Large/', '/Medium/')}" /></div>`,
    )
    .join('')}</div></section>
  <div id="bofakta-container">Om Bostaden Sammanfattning Typ: Bostadsr&#228;ttsl&#228;genhet Rum: 3, varav 2 sovrum
  Boarea: 70 m 2 L&#228;genhetsnummer: 2 Byggnads&#229;r: 1996${fee === null ? '' : ` M&#229;nadsavgift: ${fee}`}
  Uppl&#229;telseform: ${ownership}${floor === null ? '' : ` V&#229;ning: ${floor}`}${lift === null ? '' : ` Hiss: ${lift}`}
  Kommentar till boarean</div>
  <script>window.fri = "Hiss: Ja V&#229;ning: 9";</script></body></html>`;
}
