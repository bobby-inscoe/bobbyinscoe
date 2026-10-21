# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Households hunting for an apartment to buy in Göteborg. The first is the owner's own household; others join by invitation, and the owner wants that circle to grow through invites over the next year. Public signup stays off.

A household has up to ten members who search together. Each member wants to see what is for sale that fits the household's criteria, shortlist homes, take notes, plan viewings, and clear out homes they have ruled out.

Most use happens on a phone: quick checks on the go, between viewings, new listings on the tram. Desktop is the secondary scene.

## Product Purpose

Shellter gathers apartments for sale from several Göteborg broker sites into one catalog, filters it by each household's saved criteria, and gives the household one shared place to decide. Success means a household spends its time judging homes rather than visiting broker sites, and nobody misses a new listing that fits.

## Positioning

- One catalog across brokers, collected for the households, so a member does not check each broker site.
- Shared by household: favorites, notes, and viewings are visible to every member, while hides are personal.
- Honest about gaps: unknown facts stay unknown, estimated prices and positions are labeled as estimates, and homes without a precise position sit under "Not located" with no invented pin.
- Built around Göteborg: filters by the city's 96 official primärområden.

## Operating Context

- Routes live under `/shellter`: listings (list and map), favorites, viewings, add link, settings, and a listing detail page. Filters, sort, and list or map mode live in the URL.
- Members browse a list or map, filter, save favorites, hide homes in bulk (up to 500 at a time, with undo), review an area on the map, and add homes from a pasted link.
- Invitations: any member can create a link to start a separate household; an owner can invite people into their own. People set their own passwords and recover them by email.
- A demo with synthetic data lets a visitor explore without an account.
- The operator runs the collector from a private PC and handles admin. Collection follows each source's approval and pacing rules (see `instructions/house-scanner.md` and `tools/house-scanner/README.md`).

## Capabilities and Constraints

- Collector bounds: Göteborg, apartments, at least 60 m², asking price 2,000,000 to 6,000,000 SEK. Households narrow this further with their own criteria.
- A household's snapshot holds at most 1500 visible listings.
- Collected facts include price and price history, rooms, area, fee, outdoor space, glazing, floor, and position precision. Some sources leave facts unknown, and the product shows them as unknown.
- The interface is in English. Swedish may be added as a language option later; this is undecided. Prices are in SEK.
- Code, tables, and functions keep the house-scanner name. Users only see Shellter.
- Built with React and Mantine. Shellter has its own nested Mantine theme under the site's root theme, in `theme/`.

## Brand Commitments

- Name: Shellter, chosen because a turtle carries its home on its back. "ShellScout" is the fallback name.
- Shellter is a standalone brand. Apart from the link back to the workshop, it shares no look with the rest of bobbyinscoe.com.
- Visual stance (chosen 2026-10-21): the category standard for a property portal, built to the craft level of Hemnet and Booli. It stays light, with more color presence than a stark white portal with one accent, and is never dark, metallic, or moody. The previous look is archived in `.impeccable/archive/`.
- Timmy the turtle is a mascot idea, not a commitment. Design work should not depend on it. "Timmy's Picks" is an undecided slogan idea.

## Evidence on Hand

- Real listings come from the live catalog, which belongs to households and stays out of design work and commits.
- `mock/synthetic-household.ts` provides fictional listings for the demo, tests, and screenshots.
- `assets/neighborhoods.json` holds the primärområden polygons.
- There are no testimonials, user counts, or press. Do not invent them.

## Product Principles

1. Phone first. Every flow must work one-handed on a phone; desktop gets more room, not more features.
2. Never invent a fact. Unknown, estimated, and missing values look different from known ones.
3. The household decides together. Shared state is visible to every member; personal choices, such as hides, stay personal.
4. Fewer sites to check. Shellter replaces visits to broker sites rather than adding another inbox.

## Accessibility & Inclusion

Touch controls stay at least 44 px. Map clusters and pins work with the keyboard. Browser Back closes detail and filter views before leaving earlier results.
