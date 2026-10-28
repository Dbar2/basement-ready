# Basement Ready brand: Fresh Air

Locked Oct 28, 2026. This replaces "Fresh Plaster," which was rejected: its terracotta accent and soft serif read as Anthropic and AI-template. Every screen, the demo video and the 3D assets use `brand/tokens.css`. A raw hex code anywhere else is a bug.

**Personality:** confident, warm, practical.
**Idea:** "your basement, scanned, then what it could become." Real footage with a scan drawn over it, then a cutaway of the finished home.
**Visual references:** `brand/explorations/AD-green.png` (the locked direction), and A and D, which it combines.

## Palette

| Role | Token | Hex | Use |
|---|---|---|---|
| Background | `--color-bg` | `#F4F6F2` | Light green-grey white. Never pure white. |
| Card | `--color-card` | `#FBFCFA` | Raised cards |
| Surface | `--color-surface` | `#E6EBE4` | Panels, the 3D viewer frame |
| Border | `--color-border` | `#D5DDD4` | Hairlines |
| Ink | `--color-ink` | `#0F2A1E` | Deep forest green: all text, the logo, structural lines in cutaways |
| Ink muted | `--color-ink-muted` | `#4A5D52` | Secondary text |
| Mint | `--color-mint` | `#4BE38A` | **Fill only:** the primary button, scan glow and points, selected states. Forest text goes on top. Never as text or thin lines on light backgrounds (1.5:1). |
| Mint line | `--color-mint-line` | `#2E9A5C` | Mint-family lines, rings and large UI on light backgrounds |
| Accent text | `--color-accent-text` | `#1F7A4A` | Green links and small highlighted text |
| OK / Fix / Stop | `--color-ok` / `--color-fix` / `--color-stop` | `#1F7A4A` / `#8C6A00` / `#B42318` | Verdict states, set with `data-verdict` |

**What the scan finds:** window `#2F6FDB`, exit `#0F8B8D`, stairs `#B58A00`, duct `#6B7A86`, beam `#8A5A3C`, furnace or panel `#C2417A`. Each always comes with a text label, never colour alone.

**Contrast:** all text pairs pass WCAG AA (checked Oct 28):
- ink on background: 14.1:1
- muted text: 6.5:1
- accent text: 4.9:1
- forest on mint: 9.2:1
- mint line (large UI): 3.3:1
- fix: 4.6:1
- stop: 6.1:1

## Type

```html
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;800;900&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
```

- **Hanken Grotesk 800–900** (display): headlines, set tight (`letter-spacing: -0.045em`, `line-height: 0.92`). Big and heavy, like the reference. No italics.
- **Hanken Grotesk 400–600** (body): explanations, cards and buttons.
- **Geist Mono** (measurements): `Ceiling 2.10 m`, `Window 0.28 m²`, costs, rule references, step numbers.

## Voice

Plain, warm and honest, like a good contractor who's also a neighbour. Short sentences. Say what we know and what we don't. Never hype.

- **Headline:** "Could your basement be a home?"
- **CTA:** "Scan my basement"
- **Error:** "We couldn't see the ceiling clearly. Point your phone up for a few seconds and we'll measure it."
- **Honesty:** "You look eligible if the suite is for your mom. Here's what to check next."

Rules:
- Never say "you qualify" or "approved." Say "looks eligible if…" or "a designer will confirm."
- Costs are always "rough," with a range.
- Every rule links to its source.

## Logo

- **Mark:** the B of Basement with a house cut out of its lower half and a door at the base: the home inside the basement (`brand/logo/mark.svg`).
- **Lockup:** the mark plus "Basement Ready" in Hanken Grotesk 800, in forest green.
- **Clearspace:** half the mark's width on every side. **Minimum size:** 20 px tall.
- It sits on the background, card or mint, or reversed in card colour on forest. Never directly on a photo.

## Imagery

- **Real footage first:** the homeowner's own basement, bright and honest. No stock photos of workers.
- **Scan overlay:** mint and forest points and thin forest callout lines with mono measurements, drawn over the real photo or video.
- **Cutaway:** a cross-section of the basement below a grass line, with soil around it and a forest-green structural outline. Interiors in warm daylight, white walls, oak floors and sage cabinets.
- Brand placeholder images in `public/img/` were made with GPT image. Replace them with David's own basement and Muse Image renders before the demo.

## Banned

Global:
- purple or indigo gradients
- glassmorphism card grids
- emoji in headings
- Inter as the only typeface
- sparkle, robot or magic-wand icons
- pastel-on-pastel palettes
- stock blob illustrations
- a dark hero on a light site

Basement Ready:
- **Orange or terracotta anything, and cream with a serif or italic accent word.** It reads as Anthropic and AI-template.
- **The split hero** with a form on the left and a picture on the right
- **The generic contractor look:** navy and safety orange, hard hats, tool clip-art, "Call now for a free quote!", stock workers
- **Neon sci-fi scanner looks:** cyan HUD grids, matrix rain, dark mode by default
- **Real-estate portal styling:** listing grids, blue underlined links
- **Fake certainty:** "Approved" stamps or checkmarks on anything unconfirmed
