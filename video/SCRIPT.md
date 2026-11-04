# Basement Ready: demo video script

About 2:50, 1920×1080, 30 fps. One narrator (Chatterbox), a warm instrumental bed (one swappable file, `public/music.wav`) with a lift at the answer, motion graphics drawn in the Drawing Set style (`brand/ui.md`), and real footage of the live site walking the example basement end to end.

Voice: plain, warm and confident, like a good contractor who's also a neighbour. No hype words, no accuracy figures, never "you qualify" or "approved". The line ids are the voice files (`public/voice/<id>.wav`, made by `tools/voice/make_vo.py` from `voice-lines.json`).

## 1. The question (0:00–0:24)

| Line | Voiceover | Picture |
|---|---|---|
| L01 | Could your basement be a home? For your mom, for a grown kid, or a rental that helps with the mortgage. | A house drawn in section on the sheet, the grade line, then the basement below it. Title: "Could your basement be a home?" |
| L02 | In Ontario, zoning can't ban up to three homes on a serviced lot. But the first answer is the hard part. | The house gets three doors, one per home, counting 1 → 3. |
| L03 | The rules are spread across the Building Code, the Fire Code and city by-laws. And permit drawings alone can cost thousands, before anyone knows if it can work. | Three rule sheets slide in and fan out; a ceiling-height dimension line and a window egress outline draw over the basement; "$2,000–$5,000" counts up. |

## 2. Film it once (0:24–0:33)

| Line | Voiceover | Picture |
|---|---|---|
| L04 | Basement Ready starts with your phone. Film your basement once, walking slowly through each room. | A drawn phone traces a dotted path through a plan; frames drop along the path. |

## 3. The Meta models (0:33–1:05)

| Line | Voiceover | Picture |
|---|---|---|
| L05 | Then Meta's models go to work. | The pipeline draws itself: Video → SAM 3.1 → MapAnything → Muse Wonder → Muse Spark → the answer, with Muse Image branching to the pictures. |
| L06 | SAM 3.1 finds and tracks the windows, doors, stairs, ducts and beams, through the whole video. | SAM 3.1 node lights; real frames of the example with SAM's outlines in their find colours. |
| L07 | MapAnything turns that ordinary video into depth, so every wall, ceiling and window is measured. No LiDAR needed. | MapAnything node; dimension lines draw onto a plan; real footage of the 3D scan assembling. |
| L08 | Muse Wonder watches the whole take and names the rooms. Muse Spark checks the finds against the Ontario Building Code, and it can only claim what the video shows. | Wonder and Spark nodes; rule rows tick: ceiling, window, separation. |
| L09 | While it measures, the guide asks only what it can't see, and tells you why it's asking. | Real footage: the wait screen, SAM's finds over the example video, one question with "Why I'm asking". |

## 4. Answer (1:05–1:35): the music lifts

| Line | Voiceover | Picture |
|---|---|---|
| L10 | Then, the answer comes first. | The milestones Answer · Design · Build draw in; the Answer underline draws. A verdict stamp lands. |
| L11 | This basement in Waterloo can be a second home after one fix: a fire separation between the two homes. It's marked on the measured plan, with a rough cost, and a source for every rule. | Real footage: the verdict, the plan with the fix marked, the rough cost. |
| L12 | It finds the money that fits: a federal tax credit, a city grant and the Region's forgivable loan, each with how to apply. | Ruled list draws in: tax credit up to $7,000, City of Waterloo grant up to $20,000, Region forgivable loan up to $25,000, figures counting up. |
| L13 | Not sure what a fire separation is? Ask, and it draws it for you. | Real footage: the fire separation explainer drawing. |

## 5. Design (1:35–2:05)

| Line | Voiceover | Picture |
|---|---|---|
| L14 | Next, design it. Check that the plan is your basement, and fix any wall right on the drawing. | Design underline draws; real footage: "Is this your basement?" on the measured plan. |
| L15 | Pick a layout that keeps the stairs, the furnace and the window where they are, and look around it in 3D. | Real footage: the layouts in 3D. |
| L16 | Muse Image restyles your own frames in the look you picked: your basement, before and after, labelled virtually staged. | Real footage: before and after, "Virtually staged". |

## 6. Build (2:05–2:35)

| Line | Voiceover | Picture |
|---|---|---|
| L17 | Then, build it. The permit set is drawn and filled in from the scan, and it shows how much is ready. | Build underline draws; permit sheets slide in one after another; the ready count rolls. Real footage: the permit set. |
| L18 | The guide asks only for what it can't measure, like a few tape numbers and who owns the house. | Real footage: the guide's ask for tape numbers. |
| L19 | Then the money to apply for, and registered designers and trades to ask for quotes, all in one book you can hand to a designer. | Real footage: money, builders, the book. |

## 7. Close (2:35–2:52)

| Line | Voiceover | Picture |
|---|---|---|
| L20 | Your scan is private, and nothing is sent without you. It screens; the city decides, and a designer confirms the details. | The home base footage, then a quiet line: "It screens. The city decides." |
| L21 | See the example at basementready.com. | End card: the logo, basementready.com, "Built for the Meta AI Developer Hackathon", credits (Voice: Chatterbox by Resemble AI; Music: Meta MusicGen). |
