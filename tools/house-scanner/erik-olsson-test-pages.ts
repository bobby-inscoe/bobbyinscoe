// Authored, fictional pages shaped like the two kinds of page the site serves (a structure-only look on
// 17 October 2026): server-rendered result cards, and a listing page whose facts sit in the framework's
// streamed data. No real listing text or values are used.
export interface CardInput {
  slug?: string;
  lines: string[];
}

export const paragraphs = (lines: string[]) =>
  lines.map((line) => `<p class="chakra-text css-1">${line}</p>`).join('');

// A card has a wishlist button either way. Only a card with an address has a link; the framework also
// leaves an empty overlay link and style tags inside the content link.
export function card({ slug, lines }: CardInput) {
  const link = slug
    ? `<a class="chakra-link css-2" href="/homes/${slug}"></a>`
    : '';
  const content = slug
    ? `<a class="chakra-link css-2" href="/homes/${slug}"><style data-emotion="css x">.x{color:red}</style><div class="chakra-stack">${paragraphs(lines)}</div></a>`
    : `<div class="chakra-stack">${paragraphs(lines)}</div>`;
  return `<div class="group css-a"><div class="group css-b">${link}<button type="button" class="chakra-button" aria-label="Önskelista"></button>${content}</div></div>`;
}

export const search = (
  cards: CardInput[],
  total: number | string = cards.length,
) =>
  `<html><head><title>${total} bostäder till salu i Göteborg | Erik Olsson Fastighetsförmedling</title></head><body><style>.a{}</style>${cards.map(card).join('')}</body></html>`;

export const NB = ' ';
export const APARTMENT: CardInput = {
  slug: 'Lagenhet-3rum-Exempelgatan-1-Exempelomradet-Goteborg-kommun-9000001',
  lines: [
    'Exempelgatan 1',
    'Lägenhet, Exempelområdet, Göteborg',
    `3 rum • 70.5 m² • 4${NB}250${NB}kr / mån`,
    `3${NB}900${NB}000${NB}kr`,
    'Nästa visning: Söndag 1 november kl. 15:00',
  ],
};
export const HOUSE: CardInput = {
  slug: 'Radhus-5rum-Provgatan-7-Provomradet-Goteborg-kommun-9000002',
  lines: [
    'Provgatan 7',
    'Radhus, Provområdet, Göteborg',
    `5 rum • 113 + 58 m² • 121 m² tomt`,
    `6${NB}550${NB}000${NB}kr`,
  ],
};
export const VILLA: CardInput = {
  slug: 'Villa-Teststigen-3-Testomradet-Goteborg-kommun-9000003',
  lines: [
    'Teststigen 3',
    'Villa, Testområdet, Göteborg',
    `171 + 115 m² • 553.5 m² tomt`,
    'Inget utropspris',
  ],
};
// Pre-market homes show no street and have no link.
export const HIDDEN: CardInput = {
  lines: [
    'Lägenhet på 2 rum, Exempelområdet',
    'Lägenhet, Exempelområdet, Göteborg',
    `2 rum • 52.5 m² • 4${NB}326${NB}kr / mån`,
    'Inget utropspris',
  ],
};

export const IMAGE_ACCOUNT = 'AccountHash_1234567890';
export const PHOTO_ID = '11111111-2222-4333-8444-555555555555';
export const PLAN_ID = '66666666-7777-4888-8999-000000000000';

// The listing page streams its data as string chunks. The home object may be split across chunks.
// Its head names the image account in the address of the social preview image, as the real page does.
export function listingPage(home: unknown, split = 3, imageHost = true) {
  const object = JSON.stringify({ home });
  const text = `8:["$","div",null,${object}]\n`;
  const size = Math.ceil(text.length / split);
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size)
    chunks.push(text.slice(i, i + size));
  const head = imageHost
    ? `<head><meta property="og:image" content="https://imagedelivery.net/${IMAGE_ACCOUNT}/${PHOTO_ID}/w=1200,h=630,fit=cover,quality=90,format=auto"/></head>`
    : '<head></head>';
  return `<html>${head}<body>${chunks
    .map(
      (chunk) =>
        `<script>self.__next_f.push([1,${JSON.stringify(chunk)}])</script>`,
    )
    .join('')}</body></html>`;
}

export function home(
  over: Record<string, unknown> = {},
  base: Record<string, unknown> = {},
) {
  return {
    id: 9000001,
    status: { name: 'for_sale', title: 'Till salu' },
    images: [
      { is_floor_plan: true, cloudflare_image_id: PLAN_ID },
      { is_floor_plan: false, cloudflare_image_id: PHOTO_ID },
    ],
    provider_data: {
      advertiseOn: { hideAddress: false, hidePrice: false },
      baseInformation: {
        livingSpace: 70.5,
        monthlyFee: 4250,
        propertyType: 'Lägenhet',
        tenure: 'Bostadsrätt',
        objectAddress: {
          streetAddress: 'Exempelgatan 1',
          coordinate: { longitud: 11.95, latitud: 57.7 },
        },
        ...base,
      },
      interior: { numberOfRooms: 3 },
      floorAndElevator: { elevator: 'Yes', floor: 3, totalNumberOfFloors: 5 },
      price: { startingPrice: 3_900_000, finalPrice: 0 },
      balconyPatio: {
        balcony: true,
        patio: null,
        summary: 'Fri text om altan.',
      },
      ...over,
    },
  };
}
