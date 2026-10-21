---
name: Shellter
description: A light Göteborg property portal for households deciding together, built to Hemnet and Booli craft.
colors:
  teal: "#0f6e6a"
  teal-strong: "#0b5753"
  teal-deep: "#08403d"
  teal-pale: "#a9d8d2"
  teal-wash: "#dff1ef"
  mint-ground: "#eef5f3"
  surface: "#ffffff"
  hover: "#f2f8f7"
  sunk: "#d7eae6"
  line: "#cde2de"
  ink: "#142624"
  soft: "#4a5e5b"
  apricot: "#f29e4c"
  apricot-ink: "#2a1606"
  apricot-wash: "#fde6cf"
  good: "#1d7a4a"
typography:
  price:
    fontFamily: "Nunito Sans, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    letterSpacing: "-0.01em"
    fontFeature: "\"tnum\""
  wordmark:
    fontFamily: "Nunito Sans, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 800
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Nunito Sans, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
  title:
    fontFamily: "Nunito Sans, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
  body:
    fontFamily: "Nunito Sans, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: "Nunito Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  label:
    fontFamily: "Nunito Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
  tab-label:
    fontFamily: "Nunito Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
rounded:
  sm: "8px"
  md: "10px"
  lg: "14px"
  pill: "32px"
spacing:
  xs: "10px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "32px"
components:
  app-bar:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.surface}"
    height: "56px"
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
  button-primary-hover:
    backgroundColor: "{colors.teal-strong}"
  button-default:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
  button-default-hover:
    backgroundColor: "{colors.hover}"
  button-light:
    backgroundColor: "{colors.teal-wash}"
    textColor: "{colors.teal-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
  listing-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
  photo-placeholder:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.soft}"
  badge-new:
    backgroundColor: "{colors.apricot}"
    textColor: "{colors.apricot-ink}"
    rounded: "{rounded.pill}"
  badge-chip:
    backgroundColor: "{colors.teal-wash}"
    textColor: "{colors.teal-strong}"
    rounded: "{rounded.pill}"
  viewing-tag:
    backgroundColor: "{colors.apricot-wash}"
    textColor: "{colors.apricot-ink}"
    rounded: "{rounded.sm}"
    padding: "2px 10px"
  favorite-star:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  favorite-star-mine:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
  favorite-star-others:
    backgroundColor: "{colors.teal-pale}"
    textColor: "{colors.teal-deep}"
    rounded: "{rounded.pill}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  tab-bar-item:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.soft}"
    typography: "{typography.tab-label}"
    height: "64px"
  tab-bar-item-active:
    backgroundColor: "{colors.teal-wash}"
    textColor: "{colors.teal-strong}"
    width: "56px"
    height: "30px"
  map-marker:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "36px"
  map-marker-saved-by-me:
    backgroundColor: "{colors.teal-deep}"
    textColor: "{colors.surface}"
  map-marker-saved-by-household:
    backgroundColor: "{colors.teal-pale}"
    textColor: "{colors.ink}"
---

# Design System: Shellter

## Overview

**Creative North Star: "The Bright Calm Portal"** (proposed; the user has not named this world yet)

Shellter is a Swedish property portal held to the category standard: photo-led cards, price first, facts on one line, saves and viewings readable at a glance. The world is light and calm. A deep teal app bar sits over a mint-tinted ground, white cards rest on it with soft ambient shadows, and a single warm apricot marks what is new. It carries more colour than a stark white portal, and it is never dark, metallic, or moody.

Density follows the portal canon. A member scanning on a phone reads price, size, district, price change, who saved it, and the next viewing in one pass, so every colour carries a meaning rather than a mood. Teal means action, selection, and saved by you; pale teal means saved by another member; apricot means new; green means the price dropped. Nunito Sans throughout keeps the surface soft and relaxed without giving up legibility.

Shellter is a standalone brand. It shares nothing visual with the rest of bobbyinscoe.com beyond the link back to the workshop. The previous Libron and Arial, linen and moss world is retired and archived in `.impeccable/archive/`.

**Key Characteristics:**
- Deep teal app bar over a mint-tinted ground, white cards on top.
- The photo runs to the card's edges at 3:2; the price is the largest text on screen.
- Every colour is a signal: teal for action and your own saves, pale teal for others' saves, apricot for new and viewings, green for price drops.
- One soft face, Nunito Sans, with 800-weight tabular figures for prices.
- Phone first: 44 px touch targets, 16 px input text, a bottom tab bar with icons.

## Colors

A cool teal family on a mint ground, with one warm apricot and one green that each speak about a single fact.

### Primary
- **Deep Harbour Teal** (teal): The app bar, filled buttons, the active segment of List, Map, Select, the selected card's outline, focus rings, links, the text caret and form accents, and a star the member saved. Hover deepens to **Strong Teal** (teal-strong), which also colours text on teal washes and the active phone tab.
- **Deepest Teal** (teal-deep): Map pins the signed-in member saved, the batch-check badge on pins, and the star on a pale teal background.
- **Pale Sea Teal** (teal-pale): Saved by another member, on the photo star and on map pins. Also the scrollbar thumb.
- **Teal Wash** (teal-wash): Light buttons, amenity chips, and the pill behind the active phone tab icon.

Inside the Shellter scope the inherited Mantine primary scale, named `moss`, is repainted teal (moss-0 `#e6f3f1` through moss-9 `#08403d`, with moss-7 equal to teal). Every Mantine component that names the primary colour therefore renders teal.

### Secondary
- **Apricot** (apricot): The NEW flag only, with Apricot Ink (apricot-ink) text.
- **Apricot Wash** (apricot-wash): The viewing-time tag on cards and in the viewings list, with Apricot Ink text.

### Tertiary
- **Price-Drop Green** (good): The down arrow beside a reduced price. Nothing else is green.

### Neutral
- **Mint Ground** (mint-ground): The page background behind cards. It is also painted on the body while Shellter is mounted, so portals share it.
- **White Surface** (surface): Cards, panels, inputs, default buttons, the phone tab bar, the pin card and phone sheet, map controls.
- **Mint Hover** (hover): Hover fill on default buttons and menu items.
- **Sunk Mint** (sunk): The photo placeholder box.
- **Teal Line** (line): Input borders, the tab bar's top edge, fact-row dividers, the selection bar's top edge.
- **Deep Ink** (ink): Body text and prices.
- **Soft Ink** (soft): Dimmed labels, the struck-out old price, a price-rise arrow, inactive tab labels.

### Named Rules
**The Every Colour Is a Fact Rule.** Apricot, green, teal, and pale teal each mean one thing. Apricot is NEW and viewing times, green is a price drop, teal is your action or your save, pale teal is another member's save. Never use them as decoration.

**The Red Means Destructive Rule.** Mantine's light red appears only on destructive actions, such as "Leave this household", and on error alerts. It marks danger and is not a second accent.

## Typography

**Display Font:** Nunito Sans (with system-ui, sans-serif)
**Body Font:** Nunito Sans (with system-ui, sans-serif)

**Character:** One soft, rounded humanist sans, self-hosted as a variable font (weights 200 to 1000, latin and latin-ext subsets, OFL). Weight does the hierarchy work: 800 for prices, the wordmark, and h1 and h2; 700 for other headings, buttons, and tabs; 400 for reading.

### Hierarchy
- **Price** (800, 1.5rem, -0.01em, tabular numerals): The current asking price on cards and the pin card, and the largest text on the listings screen. The struck-out old price drops to 600 at 0.8em in Soft Ink. On phone compact cards the price steps down to 16 px.
- **Wordmark** (800, 1.25rem, -0.01em): "Shellter" in the app bar, in white.
- **Headline** (700, 18 px): Panel and section titles (h4 size) and the detail drawer title.
- **Title** (700, 16 px): Listing titles on cards and the pin card (h5 size).
- **Body** (400, 16 px, 1.55): Reading text, fact lines, notes.
- **Body small** (400, 14 px): Fact rows, the count line, secondary card text. Viewing tags use 14 px at 700 on cards and 16 px at 800 in the viewings list.
- **Label** (700, 14 px): Button labels; the theme sets every Button to weight 700. Badges keep Mantine's small uppercase badge type.
- **Tab label** (700, 13 px): The phone bottom tab bar.

### Named Rules
**The Unbroken Price Rule.** The current price never wraps mid-number. When a price has dropped on a narrow desktop card, the old price and arrow sit on one line and the new price moves whole to the next.

**The Tabular Figures Rule.** Prices and map pin labels use tabular numerals so amounts line up down a list.

## Layout

A single content column capped at 72rem and centred, with 12 px side padding on phones and 32 px from 62em up. The app bar spans the full width, aligns its content to the same 72rem column, and is at least 56 px tall.

Listing cards flow in an auto-fill grid with a 320 px minimum column and 16 px gaps: one column on a phone, three on a wide desktop. Cards in a row share a height, with the actions row pushed to the bottom. Viewing cards wrap in a flex row (basis 360 px, maximum 640 px), with a 96 px square thumbnail beside the time.

Spacing uses Mantine's default scale (xs 10, sm 12, md 16, lg 20, xl 32 px), which the Shellter theme does not override. The workspace stacks with 20 px gaps, tightening to 10 px on phones.

Phones (below 36em) change three things. Listings, Favorites, and More move into a fixed bottom tab bar, 64 px tall plus the safe area, and the content gains bottom padding so the last card clears it. The browse controls (Match, Sort, Search, Filters) form an even grid with 9rem minimum columns instead of a ragged row. The map goes full screen with the selected home as a bottom sheet, and the sticky selection bar stops just above the tab bar. Wider screens keep Listings, Favorites, and More as a top row of buttons.

The map is `clamp(430px, 70vh, 680px)` tall on desktop and `clamp(430px, 80svh, 680px)` on phones.

## Elevation & Depth

White surfaces lift off the mint ground with soft, cool ambient shadows tinted from Deep Ink. There are two levels plus a few fixed edge shadows. No hard offset shadows.

### Shadow Vocabulary
- **Resting** (`box-shadow: 0 1px 2px rgb(20 38 36 / 6%), 0 4px 14px rgb(20 38 36 / 7%)`): Listing cards, panels (every Paper), the map frame.
- **Raised** (`box-shadow: 0 2px 6px rgb(20 38 36 / 8%), 0 12px 32px rgb(20 38 36 / 16%)`): Anything floating over the map: the pin card, map controls, the zoom group.
- **Photo chip** (`box-shadow: 0 1px 4px rgb(20 38 36 / 22%)`): The star, hide button, and NEW flag on a photo.
- **Bottom edge** (`box-shadow: 0 -4px 16px rgb(20 38 36 / 6%)`): The phone tab bar. The selection bar uses the same shape at 8%.

### Named Rules
**The Cool Shadow Rule.** Shadows are tinted with Deep Ink, never neutral black, so depth stays in the teal family.

## Shapes

Gently rounded throughout. Inputs and buttons use 10 px corners (the theme's default radius, md). Cards, panels, the map, the pin card, and the selection bar's top corners use 14 px (lg). Viewing tags, thumbnails, and the selection checkbox's corner use 8 px (sm). Stars, badges, chips, and map pins are full pills. The active phone tab icon sits in a 56 by 30 px pill.

Listing photos are 3:2 and bleed to the card's top and side edges. The pin card's photo is 16:9; viewing and phone sheet thumbnails are square. A missing photo keeps the same box in Sunk Mint with a teal house icon and "No photo", so cards never change height.

## Components

### Buttons
Confident and rounded, always at weight 700.
- **Shape:** Gently rounded (10 px).
- **Primary:** Filled teal with white text, hover to Strong Teal. Used for the active view segment and the active top-row tab.
- **Default:** White with a Teal Line border and Deep Ink text, hover to Mint Hover.
- **Light:** Teal Wash with Strong Teal text.
- **Destructive:** Mantine light red, only for leaving a household or removing data.
- **Touch:** On coarse pointers every button, input, icon button, and close button is at least 44 px with 16 px text, applied through the theme.

### Chips
- **Amenity chips:** Light badges in Teal Wash with Strong Teal text, full pill.
- **NEW flag:** Apricot pill with Apricot Ink text on the photo's bottom-left corner. The top-left corner belongs to the selection checkbox, and the top-right to hide and the star.
- **Viewing tag:** Apricot Wash with Apricot Ink, 8 px corners, 2 by 10 px padding, bold.

### Cards / Containers
- **Corner Style:** 14 px.
- **Background:** White on the mint ground.
- **Shadow Strategy:** Resting; cards floating over the map use Raised.
- **Border:** Transparent at rest. A selected card gets a teal border and a 2 px teal outline inset by 1 px.
- **Internal Padding:** 16 px (12 px on phone compact cards). The photo cancels the padding to run edge to edge.
- **Order:** photo, price, title, facts, viewing tag, chips, status, actions.

### Inputs / Fields
- **Style:** White, 10 px corners, a Teal Line border instead of Mantine's grey.
- **Focus / Error:** Mantine's focus and error colours stay; focus resolves to teal through the remapped primary.
- **Touch:** 44 px tall with 16 px text. Number steppers hide on touch, so people type the number.

### Navigation
- **App bar:** Full-width teal, white wordmark at 800, and a white 600-weight back link with an icon on wider screens.
- **Wide screens:** Listings, Favorites, and More as a row of buttons with icons. The active one is filled teal; the rest are default.
- **Phone tab bar:** A white bar fixed to the bottom with a Teal Line top edge. Each tab stacks a 20 px line icon (house, star, ellipsis) over a 13 px label. Inactive tabs are Soft Ink. The active tab is Strong Teal with a Teal Wash pill behind the icon, and the Favorites star fills when active.

### Favorite Star
A round button on the photo's top-right corner, 44 px on touch. Unsaved: white with an outline star in Deep Ink. Saved by you: filled teal with a filled white star. Saved only by another member: pale teal with a Deepest Teal star.

### Map Pins
White pills with a 2 px teal border and 700-weight tabular labels, at least 36 px (44 px on touch). Pins you saved fill Deepest Teal with white text; pins another member saved fill pale teal. Clusters are 44 px with a 3 px border at weight 800. Hidden homes, when shown, are greyscale at half opacity. Batch-selected pins carry a 22 px Deepest Teal check badge.

### Pin Card and Phone Sheet
On desktop a white 14 px card with the Raised shadow floats at the map's lower-left, up to 320 px wide, with a 16:9 photo. On phones it becomes a sheet across the map's bottom edge, with a 72 px square thumbnail and 10 px top corners.

## Do's and Don'ts

### Do:
- **Do** keep the page light: mint ground (#eef5f3), white cards, a teal app bar.
- **Do** use teal for action, selection, focus, and the member's own saves, and pale teal only for another member's save.
- **Do** keep apricot for NEW and viewing times, and green for price drops.
- **Do** set prices in Nunito Sans 800 with tabular numerals, and keep the current price on one line.
- **Do** run listing photos edge to edge at 3:2, and keep the same box when a photo is missing.
- **Do** give every touch control 44 px and every touch input 16 px text.
- **Do** keep new Mantine components inside the Shellter scope so they pick up the teal remap and Nunito Sans; portals carry the scope through the theme.

### Don't:
- **Don't** make Shellter dark, metallic, or moody.
- **Don't** fall back to a stark white portal with one accent.
- **Don't** bring back the retired Libron and Arial, linen and moss look, or borrow styling from the rest of bobbyinscoe.com.
- **Don't** use red as an accent; it marks destructive actions and errors only.
- **Don't** use apricot or green for decoration, buttons, or headings.
- **Don't** move the NEW flag to the photo's top-left; that corner holds the selection checkbox.
- **Don't** use neutral black shadows or hard offset shadows.
