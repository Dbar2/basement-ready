# Basement Ready UI: Drawing Set

Locked Oct 30, 2026. David picked it over "Open Room" and "Grade Line" (boards in the private notes, `brand-ui/`). It sits on top of the Fresh Air brand (`brand/brand.md`): same colours, type and logo. Every value here is a token in `brand/tokens.css`. The living reference is `/dev/ui` on a dev server (`src/dev/UiReference.tsx`); the production build drops it.

**The idea:** every screen is one sheet of an architect's drawing set. The plan, the 3D and the photos are drawn on the sheet; hairlines divide it; three milestones run across the top. It looks like the permit set we hand over at the end, made friendly.

**One rule above the rest:** one clear thing per screen, and one primary action. If a screen needs two mint buttons, it is two screens.

## The sheet: layout and spacing

- **Grid:** 8 px. Gaps are 4, 8, 16, 24, 40 or 64 (`--space-1` … `--space-6`). Nothing in between.
- **Side margin:** `--gutter` (16 px on a phone, up to 56 px on desktop). Text never touches the edge.
- **Reading width:** running text stops at 62 characters. Ledes are one sentence; if it needs two, the second goes below the thing it explains.
- **The page:** after the upload there are two. The guide: the milestones on top → the basement → the thread → the ask bar. The home base: the goal → the milestones → Continue along the bottom. The website keeps the plain sheet: the title → the one thing → its action.
- **Desktop:** the one thing gets the width; supporting facts sit in a 320 px column on the right, divided by hairlines, never in boxes.
- **Phone (390):** one column. The one thing comes first after the title, before any controls that change it.
- **No cards.** A border, fill and corner together mark a separate object, and a sheet has very few: the drawing frame around a plan or the 3D, a photo, an input. Groups of content are separated by a hairline (`--line`) or an ink rule (`--line-ink`) with a heading, not by boxes.
- **Corners:** 4 px for photos, inputs and small frames; 6 px for buttons and drawing frames. Round shapes only for dots, radio marks and the record button.
- **No shadows** on the sheet. Only dialogs and menus that open over it get `--shadow-float`.

## Type scale

Hanken Grotesk for words, Geist Mono for figures.

| Token | Size | Use |
|---|---|---|
| `--text-display` | 34–60 px, 900, -0.045em, line-height 0.92 | The screen's title. One per screen. |
| `--text-h2` | 24–30 px, 800, -0.03em | A section on the sheet |
| `--text-h3` | 19 px, 800, -0.02em | A row's name, a list group |
| `--text-body` | 16 px, 400, line-height 1.5 | Everything you read |
| `--text-small` | 14 px, 400–600 | Captions, help under a field, the way back |
| `--text-figure` | 13 px Geist Mono | Measurements, money, counts, step numbers beside text |
| `--text-tiny` | 12 px Geist Mono | Plan labels, the title block |

- **Mono is for figures only:** `2.10 m`, `41.7 m²`, `$50k–$86k`, `9 of 14`, `03`. Never a sentence, a hint or a label. "Drag a wall to move it" is body text.
- **No labels above headings.** No small caps line, no uppercase kicker, no mono eyebrow over a title. If the context matters, it goes in the sentence under the title.
- **No uppercase** anywhere except unit abbreviations and the labels drawn inside a plan.
- **Headings are never highlighted.** The mint fill is for the action and the selected thing, not for words.
- Big figures (a total, "9 of 14") are Hanken 900 at h2 size, with the unit in Geist Mono beside them.

## One primary action per screen

- **Primary (`.btn-primary`):** solid mint, forest text 17 px 700, 6 px corners, 48 px tall, an arrow `→` when it moves on. No shadow, no lift on hover; it darkens to `--color-mint-press`. Its label says what happens ("Design it in 3D"), at most four words, and never wraps.
- **Secondary (`.link-quiet`):** an underlined text link in ink, the underline in ink too. "Fix a wall", "Download PDF", "Try the example".
- **Choices (`.btn-ghost`, `.chip`):** a hairline rectangle, 6 px corners (4 px for chips), ink text. Picked: ink fill, card text. Never mint, so they never compete with the primary.
- **Toggles (`.segmented`):** ink-framed rectangles, the picked one filled ink. For view switches only (3D / Plan, m / ft).
- **Destructive:** a text link in `--color-stop`, confirmed on the sheet.
- Tap targets are at least 44 × 44 px on a phone, even when the drawn control is smaller.

## The milestones

- Three, across the top of the guide: `Answer  Design  Build`, in Hanken 600 at 15 px. No numbers.
- The current one: ink, 800, with a 2 px ink underline that draws in from the left when it changes. Done ones: ink, with a ✓ before the name. Ones ahead: muted. They say where you are (`aria-current="step"`); the guide moves you on, so they aren't links (`src/guide/GuideScreen.tsx`, `src/guide/progress.ts`).
- Left of them, the logo's mark. Inside the app it always goes to the home base, never to the website.
- Below the bar, a 1 px ink rule: the top edge of the sheet.

## The guide

- The one screen after the upload (`src/guide/GuideScreen.tsx`). On a phone: the top bar, the visual pane (about 40% of the height), the thread, the ask bar, all inside the screen's height; only the thread scrolls. On a computer (from 1000 px): the basement on the left, the thread and the ask bar in a 440 px column on the right.
- **The visual pane** always shows the basement: the video while it measures, the plan with the fix marked, a drawing that explains a term, the plan to edit, the 3D, before and after. It is never empty: while the next one loads, the last one stays, with a progress line.
- **The guide's messages:** the mark, then 16 px text, three short sentences at most, then "Why I'm asking:" in small text. Only the newest message has choices: hairline buttons, and one mint button for the way on, with `→`.
- **Their messages:** ink blocks on the right, in card-coloured text.
- **Cards** under a message, for what buttons can't carry (a tape number, a window's size, the owner): a hairline frame, 6 px corners.
- **The ask bar:** "Ask anything about your basement" and a hairline Send button; voice where the browser has it.
- **Above the fold** at 390 × 844 and 1280 × 800: the current question, its choices and the visual, together, with no scroll.
- Class names are `gs-*`: the filming screen already owns `guide-*`.

## The home base

- `/scans/:id`, where the logo goes (`src/guide/Home.tsx`). The goal is the heading ("A legal second home downstairs"), with one muted line under it.
- The three milestones as hairline rows under an ink rule: a drawing (64 × 48, or 96 × 72 on a computer), the name, one line, and where it stands: Done ✓ in `--color-ok`, Next in `--color-fix`, Later muted.
- Then quiet links: Your book (PDF), Share with a designer, Scan another basement.
- Continue along the bottom, under an ink rule: the one mint button, named for the next milestone ("Continue with the permit").
- Until they've had their answer, `/scans/:id` opens the guide instead.

## Lists

- **Hairline-ruled rows** (`.ruled`): an ink rule on top of the list, a `--line` under each row. Name left (body 600), figure right (mono), a status word at the end.
- Groups inside a list get a `--text-h3` heading on its own line ("Ready", "To fix", "A designer confirms"), not a label in caps.
- **Status words**, not badges: `Ready` in `--color-ok`, `To fix` in `--color-fix`, `Stop` in `--color-stop`, `Check` in muted; with an 8 px square in the same colour before it. The square plus the word carry the meaning, never colour alone.
- Lists of four or more choices that do things become rows with a `→` on the right.

## Measurements

- Geist Mono, tabular figures, a normal space before the unit: `2.10 m`, `0.38 m²`, `$50k–$86k`.
- Costs are always rough ranges, rounded to $1k on screen ("$50k–$86k rough"); the book and the permit forms can show dollars.
- **Dimension lines:** 1 px ink, 6 px tick ends, the figure centred on the line in `--text-tiny` with a background knock-out. Use them on plans, the home photo and anywhere a length is the point.
- **Callout leaders:** 1 px ink from the thing to a horizontal shoulder, then the label on the shoulder. Used on photos and the 3D, never a floating badge.

## Plans

- Drawn on `--color-card` paper inside a hairline frame (4 px corners). Walls in ink, a new wall thinner, an unseen wall dashed in muted.
- Finds in their colours (`--find-*`), each with its text label. Rooms: a name in Hanken 800 and an area in mono.
- Labels drawn inside a plan (`STAIRS`, `DUCT · 1.64 m CLEAR`) may be set in mono capitals, like a drawing. That's the only place capitals appear.
- The plan draws itself in when it first appears (walls stroke in over `--dur-draw`), once.

## The 3D viewer

- A **light** frame: `--color-surface` fill, 1 px `--color-border` hairline, 6 px corners. Never a dark slab on the light sheet.
- Controls sit on the frame's top edge (view toggles left), the hint on the bottom edge in body small. Labels in the 3D are small card tags with a hairline border, no shadow, and they hide when they would overlap.
- The camera eases to a new view; it never spins on its own.

## Photos and staging

- Real photos, lightly brightened, 4 px corners, no filters, no gradient washes fading them into text.
- Anything an AI changed says **"Virtually staged"** in a caption line under the photo, in body small, muted. Nothing floats on top of a photo except a callout leader.
- Placeholders while a photo loads: a flat `--color-surface` block the photo's size, with one line of muted text if it takes more than a second. No shimmer.
- Camera screens (filming) are the one dark context: the live camera fills the screen, and the guide's panels sit on it in ink. Corners and type follow the same rules; nothing blinks.
- On the iPhone the camera view is the map (no mini map). Spots not filmed yet keep a still mint glow, never pulsing: it's how you see what's missing (David, Oct 30).

## Icons

- Line icons on a 20 px grid, 1.5 px ink stroke, square caps, drawn like plan symbols (a door swing, a window, stairs, a smoke alarm circle).
- Arrows are the text characters `→` and `←`.
- No filled icons, no sparkles, robots, magic wands or emoji.

## Motion: each section its own

| Section | Motion |
|---|---|
| Milestones | The current milestone's underline draws in from the left (`--dur-2`, `--ease-draw`). |
| Guide | Each new message rises into place once (`--dur-2`). |
| Home | The scroll story's own motion: the walk, the scan and the plan arrive one at a time as you scroll (`src/marketing/Home.tsx`). |
| Wait screen | The 3D assembles piece by piece as the scan reports; the time-left line fills; swiped cards leave sideways. |
| Plan | Walls stroke in once (`--dur-draw`, `--ease-draw`); a dragged wall's length updates live. |
| Layouts | Picking a layout draws its ink frame around it; the picture fades in from its plan. |
| 3D studio | The camera eases between views; a change crossfades the price and the checks. |
| Pictures | Each photo resolves from a blur of the 3D render to the photo. |
| Book | Pages come up one after another as they're ready. |
| Permit | Ticking an item fills its square; the count rolls to the new number. |

Never: pulsing dots, shimmer, glows, bouncing, parallax, or one effect everywhere. With `prefers-reduced-motion: reduce`, everything appears in place at once (`src/styles/global.css` turns every animation and transition off).

## Empty, loading and error states

- **Empty:** a hairline-framed area the size of what will be there, one sentence that says what will appear and how ("Love a few cards and your style shows here."), and at most one action.
- **Loading:** the thing's own outline, flat, with one muted sentence that says what's happening and roughly how long ("Drawing your plan, about 10 seconds"). A real progress line when we know the progress. No spinners on the sheet; no shimmer.
- **Errors:** what happened and what to do, in plain words, in `--color-stop` for the first sentence and ink for the rest, inside a hairline frame with a `--color-stop` border. One way out ("Try again"). Never "Something went wrong".
- **Notes and warnings:** a hairline box (4 px corners), `--color-fix` border for a warning, `--color-border` for a note. No coloured left stripes.

## Never

From David's rules and the audit:

- Orange, terracotta, cream with a serif or italic accent word, purple or indigo, gradients of any kind.
- AI-generated hero scenes. AI staging only on real photos, labelled "Virtually staged".
- A mono or uppercase label above a heading; a highlight on a heading.
- Rows of rounded, shadowed cards; a card inside a card.
- Frosted glass, `backdrop-filter`.
- Floating stat badges on photos.
- Coloured left-stripe (or top-stripe) callouts.
- Gradient washes fading images into text.
- Pulsing dots, shimmer skeletons, glows on buttons.
- Pale cyan buttons; pill-shaped buttons with words; more than one mint button on a screen.
- Mint as a line: no mint or mint-line underlines, thin borders or text. Mint-line is kept for focus rings and the thick selection stroke on a plan.
- Mono for sentences.
- A dark slab on the light sheet (the 3D included); dark mode by default.
- Status shown only by colour.
- "You qualify", "approved", or a cost to the dollar on screen.
