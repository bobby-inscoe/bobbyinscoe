---
name: Shellter
description: A household's shared apartment search for Göteborg, in sand, shell, and moss.
colors:
  shell-moss: "#526044"
  shell-moss-deep: "#414e37"
  shell-moss-dark: "#303d2c"
  moss-pale: "#cdd1b9"
  moss-wash: "#f4f5ee"
  sand: "#e9e4d8"
  shell: "#fcfaf4"
  shell-shade: "#f3eddf"
  shell-line: "#dfd0af"
  ink: "#383a2e"
  ink-dimmed: "#67695a"
  rust-focus: "#854a31"
typography:
  display:
    fontFamily: "Libron, Georgia, \"Times New Roman\", serif"
    fontSize: "1.625rem"
    fontWeight: 400
    lineHeight: 1.35
  headline:
    fontFamily: "Libron, Georgia, \"Times New Roman\", serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.45
  title:
    fontFamily: "Libron, Georgia, \"Times New Roman\", serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  none: "0px"
  xs: "2px"
  sm: "4px"
  md: "8px"
  xl: "32px"
spacing:
  xs: "10px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.shell-moss}"
    textColor: "{colors.shell}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.shell-moss-deep}"
  button-default:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: "36px"
  badge-light:
    backgroundColor: "{colors.moss-wash}"
    textColor: "{colors.shell-moss}"
    rounded: "{rounded.xl}"
  input:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "36px"
  listing-card:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "16px"
  photo-placeholder:
    backgroundColor: "{colors.shell-shade}"
    textColor: "{colors.ink-dimmed}"
  map-marker:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    size: "36px"
  map-marker-saved-by-me:
    backgroundColor: "{colors.shell-moss-dark}"
    textColor: "{colors.shell}"
  map-marker-saved-by-household:
    backgroundColor: "{colors.moss-pale}"
---

# Design System: Shellter

## Overview

**Creative North Star: "The Shell"**

Shellter is a quiet shell around noisy listings. Broker sites shout; Shellter gathers the same homes onto warm sand and shell neutrals and lets one green, Shell Moss, mark what matters: the action to take, the view you are in, the homes your household saved. Everything else stays calm enough that a price, a missing fact, or a viewing time reads at a glance on a phone.

The system is built on Mantine and nests its own theme under the Bobby Inscoe root theme. It inherits the moss and flax palettes, Libron headings, and Arial body text, then points Mantine's surface, border, and primary variables at Shellter's own tokens so every portal (menus, drawers, selects) carries the same look. Density is moderate: cards breathe at 16 px padding, and every touch control grows to 44 px on a coarse pointer.

The confirmed direction is warmer and more tactile than what ships today. Cards are currently square and flat with hairline borders; the chosen path is soft layering and friendlier controls. New work moves toward that direction without breaking the palette, the type pairing, or the touch rules.

**Key Characteristics:**
- Warm sand page, shell-white surfaces, olive-brown ink. No pure white or black.
- One accent family, Shell Moss, carrying action, selection, and "saved".
- Libron serif for names of things (wordmark, home titles, sheet titles); Arial for facts, prices, and controls.
- Unknown and estimated values look different from known ones and are never dressed up as facts.
- 44 px minimum touch targets on touch screens, enforced by the theme.

## Colors

A warm, low-contrast neutral field with a single moss green that does all the signalling.

### Primary
- **Shell Moss** (shell-moss): Primary filled buttons, the active tab and view toggle, the selected card outline, links, focus outlines inside Shellter, and the marker border on the map.
- **Shell Moss Deep** (shell-moss-deep): Hover state of filled primary buttons.
- **Shell Moss Dark** (shell-moss-dark): Pins and stars for homes saved by you, and the batch-selection check badge on map markers.
- **Moss Pale** (moss-pale): Fill for pins that another household member saved. Pale against dark is how "theirs" and "mine" are told apart.
- **Moss Wash** (moss-wash): Light badges (Balcony, Lift, NEW) and the light primary variant.

### Neutral
- **Sand** (sand): The page body behind everything.
- **Shell** (shell): Cards, sheets, drawers, inputs, default buttons, the map pin card, and the face of an unsaved marker.
- **Shell Shade** (shell-shade): Photo placeholders, so a card without a photo keeps its 3:2 shape and still reads as a picture slot.
- **Shell Line** (shell-line): Every border and divider: card edges, fact rows, the selection bar's top rule, the map frame.
- **Ink** (ink): All primary text.
- **Ink Dimmed** (ink-dimmed): Secondary text: fact labels, counts, property type, "No photo", the demo footer.
- **Rust Focus** (rust-focus): The site-wide focus ring for links and buttons outside Shellter's own overrides. Shellter's custom controls use Shell Moss instead.

### Named Rules
**The One Green Rule.** Shell Moss is the only hue that signals. Status, saved state, selection, and primary action all speak through moss shades; no second accent color is introduced.

**The Mine-Versus-Ours Rule.** Saved by you is dark moss; saved by another member is pale moss; unsaved is shell. Any new surface that shows saves uses the same three steps.

## Typography

**Display Font:** Libron (with Georgia, "Times New Roman", serif)
**Body Font:** Arial (with Helvetica, sans-serif)

**Character:** A bookish serif names the homes; a plain grotesque states their facts. The serif is used at regular weight only, so it reads as a label on a shell rather than a headline.

### Hierarchy
- **Display** (400, 1.625rem, 1.35): The page title and the Shellter wordmark. On a phone the page title drops to Mantine's `lg` size.
- **Headline** (400, 1.125rem, 1.45): Section and drawer titles.
- **Title** (400, 1rem, 1.5): Home titles on cards and pin cards.
- **Body** (400, 1rem, 1.6): Running text and facts. Prices and fact lines are set bold in body size; the old price in a price drop is struck through and smaller.
- **Label** (500, 0.875rem, 1.4): Buttons, field labels, badges, and fact-row text.

### Named Rules
**The Serif Names, Sans States Rule.** Libron is for names (the product, a home, a sheet). Numbers, prices, and controls are always Arial.

**The 16 px Touch Rule.** On a coarse pointer, inputs and buttons use 16 px text so mobile browsers do not zoom the page on focus.

## Layout

A single centered column with a top bar (back link, wordmark), a tab row (Listings, Favorites, More), browse controls (Match, Sort, Search, Filters), a count line with the List / Map / Select toggle, then content.

- **Listing list:** a wrapping flex row of cards, each `flex: 1 1 320px` and capped at 480 px, with a 16 px gap. Cards in a row share a height; the action row sits at the bottom.
- **Viewings:** the same wrapping pattern at 360 px basis, capped at 640 px.
- **Facts:** a two-column label/value list (labels 7 to 10 rem), divided by Shell Line hairlines.
- **Map:** a bordered stage `clamp(430px, 70vh, 680px)` tall, with map controls floating top-left and the selected home's pin card floating bottom-left (320 px wide).
- **Phone (below 36em):** cards become compact, photo-led, full width. Map mode takes over the screen as a fixed shell; the pin card becomes a sheet on the bottom edge with a 72 px square thumbnail; map controls move to the top-right. The batch selection bar sticks to the bottom and respects the safe-area inset.
- **Spacing rhythm:** Mantine's scale (10 / 12 / 16 / 20 / 32 px). The workspace gap is 20 px on desktop and 10 px on a phone.

## Elevation & Depth

Today Shellter is almost entirely flat. Surfaces separate by tone (shell on sand) and a Shell Line hairline. Two things lift: the map pin card, which floats over the map with an ambient shadow, and cluster markers, which carry a 3 px shell halo so they stand off the map tiles. The map controls panel uses a translucent shell with a 12 px blur, falling back to solid shell when the user asks for reduced transparency.

The confirmed direction is **softly layered**: light ambient shadows on cards and sheets to give the shell a sense of depth. That direction is not yet built, and no card shadow token exists yet. When it is added, it should stay as soft as the pin card's shadow or softer, and tonal separation remains the primary cue.

### Shadow Vocabulary
- **Floating card** (`box-shadow: 0 2px 10px rgb(0 0 0 / 18%)`): The map pin card, the one panel that floats over content.
- **Cluster halo** (`box-shadow: 0 0 0 3px var(--mantine-color-flax-0)`): Separates cluster markers from the map.

### Named Rules
**The Tone Before Shadow Rule.** A surface must read as separate by tone and border alone. Shadows add softness; they never carry the separation by themselves.

## Shapes

Mostly gentle 4 px corners (Mantine `sm`) on buttons, inputs, and the map control panel. Listing cards and the map frame are square today. Badges and map markers are full pills (32 px radius). On a phone the pin card sheet rounds its top corners at 8 px. Photos are 3:2 everywhere, 16:9 in the pin card, and a 72 px square in the phone sheet, so cards never jump while images load.

The warm and tactile direction implies softer corners on cards and sheets. Like the shadows, that change is a direction rather than shipped fact.

## Components

### Buttons
Warm and tactile in intent; plain and sturdy in today's build.
- **Shape:** gently rounded (4 px), small size, 500 weight.
- **Primary:** Shell Moss fill with shell text. Used for the active tab, the active view (List / Map), and the main action in a pin card ("Open original listing").
- **Default:** shell fill, ink text, Shell Line border. The workhorse: inactive tabs, Filters, Select, Details, card actions.
- **Subtle:** no fill or border, for low-priority actions such as More in a compact card.
- **Hover / Focus:** primary darkens to Shell Moss Deep. Focus shows a 2 px outline.
- **Touch:** on a coarse pointer, every button, close button, and action icon is at least 44 px.

### Chips
- **Style:** light badges, Moss Wash fill, Shell Moss text, pill shape. Outline badges for secondary labels.
- **Use:** amenities (Balcony, Lift, Glazed), NEW, and similar flags. On a phone, badges wrap instead of truncating.

### Cards / Containers
- **Corner Style:** square today.
- **Background:** Shell on the Sand page.
- **Shadow Strategy:** none today; see Elevation & Depth.
- **Border:** 1 px Shell Line. Selected cards add a Shell Moss border and outline.
- **Internal Padding:** 16 px; 12 px on a compact phone card, where the photo bleeds to the card edges.
- **Overlays:** hide and favorite controls sit in round shell buttons on the photo's top-right corner; the selection checkbox sits top-left in selection mode, so entering the mode never reflows the grid.

### Inputs / Fields
- **Style:** shell fill, Shell Line border, 4 px corners, label above in label style.
- **Focus:** Mantine's primary-colored border, which resolves to Shell Moss.
- **Touch:** 44 px tall with 16 px text on a coarse pointer. Number steppers hide on touch, where people type the number.

### Navigation
- **Tabs:** a row of buttons (Listings, Favorites, More). The active one is filled Shell Moss; the rest are default.
- **View toggle:** List / Map / Select on the count line, same filled-versus-default treatment.
- **Back:** browser Back closes detail and filter views before leaving results.

### Map Markers
Shellter's signature component. Pill-shaped markers with a 2 px Shell Moss border on a shell face, at least 36 px (44 px on touch). Fill shows who saved the home (see the Mine-Versus-Ours Rule); a cluster shows a bold count with a shell halo. In selection mode a small dark-moss check badge (or a dash for a partial group) sits on the marker's corner. Hidden homes shown on purpose are greyed and half transparent. Keyboard focus draws a 3 px ink outline with an 8 px offset.

### Pin Card
The selected home on the map. Desktop: a floating shell card bottom-left, Libron title with a close button, 16:9 photo, price, facts, and actions. Phone: a sheet on the map's bottom edge with a 72 px square thumbnail beside the title and price, facts and 44 px actions below.

## Do's and Don'ts

### Do:
- **Do** take every color from the Shellter tokens or the root moss and flax palettes; component files contain no hex values.
- **Do** keep Shell Moss as the only signalling hue, with the dark / pale / shell steps for saved by you / saved by others / unsaved.
- **Do** keep touch targets at 44 px on a coarse pointer and 16 px text in touch inputs.
- **Do** set home names in Libron at regular weight and all numbers in Arial.
- **Do** keep photo slots at a fixed ratio (3:2 on cards) and show a Shell Shade placeholder when a photo is missing.
- **Do** show unknown, estimated, and approximate values in words ("Price unknown", "Approximate area only", "Missing info: ...") instead of hiding or guessing them.

### Don't:
- **Don't** introduce pure white (#fff) or pure black surfaces; Shell and Ink are the extremes.
- **Don't** add a second accent color for status or decoration.
- **Don't** set prices, sizes, or controls in the serif.
- **Don't** let a shadow be the only thing separating a surface from the page.
- **Don't** place an invented pin for a home without a precise position; it belongs under "Not located".
- **Don't** style Shellter from outside its theme folder, or let its rules reach other projects on the site.
