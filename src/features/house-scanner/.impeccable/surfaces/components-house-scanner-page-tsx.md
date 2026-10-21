---
version: 1
slug: "components-house-scanner-page-tsx"
primary_target: "components/house-scanner-page.tsx"
related_targets: []
---

# Shellter app

Scope: the whole Shellter app at `/shellter` (listings list and map, pin card and phone sheet, map options, pin guide, not located, detail drawer and page, filters, favorites, More menu, viewings, add link, settings, access screens, selection and hide flows). Mode: Operate.

Audience and job: Göteborg households, mostly on phones, scanning homes and deciding together. A member should read price, size, district, price drop, unknown facts, who saved it, and the next viewing in one pass.

Constraints: keep every function, route, URL state, copy, and the current mobile-first layouts (filter row, List/Map/Select toggle, full-screen phone map with bottom sheet, sticky selection bar). Mantine stays; styling stays theme-first in `theme/`. 44 px touch targets, WCAG AA, reduced motion. UI text may grow about 30% for a later Swedish option.

Decided with the user: category standard at Hemnet and Booli craft; deep teal palette with apricot; Nunito Sans; light, never dark or moody, more color presence than stark white with one accent; standalone brand.

On phones, Listings, Favorites, and More move to a bottom tab bar with icons (user request); wider screens keep them as a top row. Open: none.

## Direction contract

THESIS: Shellter is a Swedish property portal done to Hemnet and Booli craft: photo-led cards, price first, facts in one line, saves and viewings at a glance. It refuses the stark white portal with one accent and the old inherited linen look.

OWN-WORLD: Deep teal app bar over a mint-tinted ground; white cards with 14 px corners and a soft offset shadow; teal for action, selection, and saved-by-you; pale teal for saved by others; apricot only for NEW and viewings; green for price drops. Nunito Sans throughout, 800 for prices, tabular numerals.

STORY: A member opens Shellter on the tram, sees new homes flagged in apricot, reads price and facts without opening anything, stars one, hides two, and checks Thursday's viewing.

FIRST VIEWPORT: Phone. Full-width teal bar with the Shellter wordmark (back link on wider screens). Below on the mint ground: Match, Sort, Search, Filters; the count line with List, Map, Select; then the first photo card, price as the largest text on screen. A white bottom tab bar holds Listings, Favorites, and More with icons, the active tab in teal.

FORM: category standard (canon), chosen by the user after two rolls; seed:94096451aa9f2c0b

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
