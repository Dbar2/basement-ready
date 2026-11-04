# Basement Ready: demo video script

Under 2:58, 1920×1080, 30 fps. Real footage of the live site (https://www.basementready.com, the example basement) fills most of the runtime; the drawings (Drawing Set style, `brand/ui.md`) are overlays and transitions on it: the pipeline strip, cards with figures counting up, the verdict stamp. Drawn-only time is the question section (about 15 s), the pipeline on its own (about 3 s) and the end card. One narrator (Chatterbox); one swappable music file (`public/music.wav`) whose lift lands on the verdict.

Organizers' rules folded in (Nov 4): say what was built this week in the first seconds; mostly real product footage, no slides; show live Meta calls with their model ids (the server log panel); plain model names, no logos; rights-clear music; hard cap 2:58.

Voice: plain, warm and confident. No hype, no accuracy figures, never "you qualify" or "approved". The line ids are the voice files (`public/voice/<id>.wav`, made by `tools/voice/make_vo.py` from `tools/voice/voice-lines.json`; `tools/voice/pick_takes.py` checks each take with Whisper).

| Line | Voiceover | Picture |
|---|---|---|
| L00 | Everything you'll see was built during the Meta AI Developer Hackathon, starting from an empty repo on October 28. | Live home page (real footage). Card over it: "Everything you'll see was built during the hackathon. It started from an empty repo on Oct 28, 2026." |
| L01 | Could your basement be a home? For your mom, for a grown kid, or a rental that helps with the mortgage. | The home page hero, "Could your basement be a home?"; the camera eases in on the headline. |
| L02 | In Ontario, zoning can't ban up to three homes on a serviced lot. But the first answer is the hard part. | Drawn (short): a house in section, the grade line, the basement below it in mint. "3 homes allowed on a serviced lot in Ontario", Planning Act s. 35.1. |
| L03 | The rules are spread across the Building Code, the Fire Code and city by-laws. And permit drawings alone can cost thousands, before anyone knows if it can work. | Drawn: the three rule books as a ruled list; "? m" dimension and "WINDOW ? m²" on the basement; "$2,000–$5,000" counts up. |
| L04 | Basement Ready starts with your phone. Film your basement once, walking slowly through each room. | The example's real phone video in a drawn phone; beside it the measured plan with the phone tracing its path. |
| L05 | Then Meta's models go to work. | The Meta models drawn as a pipeline for a moment: Your video → SAM 3.1 → MapAnything → Muse Wonder → Muse Spark → Muse Image, with their ids. It rises into a strip over the footage. |
| L06 | SAM 3.1 finds and tracks the windows, doors, stairs, ducts and beams, through the whole video. | Real wait screen: SAM's outlines over the example video. SAM 3.1 lit in the strip. |
| L07 | MapAnything turns that ordinary video into depth, so every wall, ceiling and window is measured. No LiDAR needed. | Real home page story: the phone's path, MapAnything's points, the scan assembling. Card: measured 7.56 × 5.52 m, 41.7 m², ceiling 2.08 m, 1.64 m under the duct (from the live plan). |
| L08 | Muse Wonder watches the whole take and names the rooms. Muse Spark checks the finds against the Ontario Building Code, and it can only claim what the video shows. | Real wait screen beside the live server log of Meta calls, one line per call with its model id (footage from a live run). |
| L09 | While it measures, the guide asks only what it can't see, and tells you why it's asking. | Real wait screen: the guide's questions with "Why I'm asking". |
| L10 | Then, the answer comes first. | Real answer screen; the verdict stamp "Yes, after 4 fixes" lands on it as the music lifts. |
| L11 | This basement in Waterloo can be a second home after four fixes. The first is a fire separation between the two homes. Each fix is marked on the measured plan, with a rough cost, and a source for every rule. | The camera eases in on the guide's verdict, then on the fire separation marked on the plan. |
| L12 | It finds the money that fits: a federal tax credit, a city grant and the Region's forgivable loan, each with how to apply. | Real home base; card over it: tax credit up to $7,000, City of Waterloo grant up to $20,000, Region forgivable loan up to $25,000, counting up. |
| L13 | Not sure what a fire separation is? Ask, and it draws it for you. | Real: "What's a fire separation?", the drawing in section with the rule's source. |
| L14 | Next, design it. Check that the plan is your basement, and fix any wall right on the drawing. | Real: "Is this your basement?" on the measured plan; the window dragged along the wall. |
| L15 | Pick a layout that keeps the stairs, the furnace and the window where they are, and look around it in 3D. | Real: the layouts in 3D, One bedroom recommended. |
| L16 | Muse Image restyles your own frames in the look you picked: your basement, before and after, labelled virtually staged. | Real: before and after, "After · virtually staged", the divider dragged. |
| L17 | Then, build it. The permit set is drawn and filled in from the scan, and it shows how much is ready. | Real: Build, the permit set, "2 of 15 ready". |
| L18 | The guide asks only for what it can't measure, like a few tape numbers and who owns the house. | Real: the tape-number card. |
| L19 | Then the money to apply for, and registered designers and trades to ask for quotes, all in one book you can hand to a designer. | Real: the home base: Build "up to $7,000 · builders", Your book (PDF), Share with a designer. |
| L20 | Your scan is private, and nothing is sent without you. It screens; the city decides, and a designer confirms the details. | Real home page story (the scan as one solid basement); card: private, nothing sent without you, it screens and the city decides. |
| L21 | See the example at basementready.com. | Real: the home page hero, Try the example clicked; then the end card: logo, Try the example, basementready.com, "Built for the Meta AI Developer Hackathon", model ids and credits. |

Scenes (`src/timeline.ts`): the question (L00–L03), film it once (L04), the Meta models (L05–L09), Answer (L10–L13), Design (L14–L16), Build (L17–L19), close (L20–L21).
