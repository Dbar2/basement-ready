# Basement Ready: idea and plan

Meta Global AI Developer Hackathon, indie track. Summary of the "Chat review and verification" session (Oct 19–28, 2026). Written Oct 28, 2026.

**Status today (Wed Oct 28):** accepted, idea chosen, name not registered, **no code yet**. Building started Oct 27. Submissions are due **Wed Nov 4 at 9 PM ET**, so about 7 days are left.

---

## 1. The idea in one line

**Film your basement and find out if it can become a second home: what has to change, roughly what it costs, what it could look like in 3D, what money you can get, and who nearby can build it.**

- **Who it's for:** a Waterloo homeowner thinking "could the basement be an apartment for Mom?" or "could we rent it out to help with the mortgage?"
- **The problem:** Ontario allows up to three homes on most lots, but people don't know:
  - that a basement finish and a second unit are different permit routes
  - what their basement needs to qualify (exit windows, fire separation, ceiling height, separate entrance)
  - what it costs
  - which grants fit their plan; they're scattered, conflicting and sometimes cancelled
  - who to call
- **Theme:** Build for Your World. It's your field (Ontario permits and renovation), and it's about housing, a big problem.
- **Why it's new for you:** Gablebird stops where a basement becomes a second unit. This covers that gap in a fresh codebase.

---

## 2. How we got here

| Idea | Why it was dropped |
|---|---|
| Backyard site plan from video (the other chat's pitch) | Lot lines aren't visible in video, phone video has no scale, and the demo is dull |
| 3D scan to permit | Apple's RoomPlan does the scanning, not Meta, and it repeats Gablebird |
| Deck staging in your yard / AR deck quote | Meta's own Muse Image demo already does staging, and it's too niche |
| "Show Me" (auto-shop video checks) | You don't know cars and can't film it |
| "Is This Right?" (check work before it's covered) | Too niche |
| Sample the World (tap an object, get its sound, make a beat) | Fun, but Impact (30%) is too low |
| What's That Noise? (diagnose house sounds) | Diagnosing by sound is unproven and risky |
| **Basement to second home** | **Chosen Oct 19.** You then added the grant check, rough quotes, local pros, a scan that looks cool, and a 3D/AR design explorer |

Research report: `/Volumes/Crucial X9/Active Documents/ChatGPT/divinedesigner/reports/Meta hackathon idea research.md`

---

## 3. Hackathon facts (from the Participant Guide, Oct 26)

**Dates (all ET)**
- Building: Oct 27 to Nov 4
- **Today, Oct 28, 12–1 PM:** "Best Practices for Verifiable Agents" workshop. That's this project's trust rule.
- Oct 30, 12–1 PM: Fireworks workshop on Muse open models
- Office hours: weekdays 10–11 AM in Discord #office-hours
- Nov 3: last day for troubleshooting help
- **Nov 4, 9 PM: submission deadline**
- Nov 5–8: judging
- Nov 9, 12 PM: finals (top 5 per track) and winners
- Nov 16: community vote winner

**Rules**
- The repo must be **public**: no API keys, no Gablebird code, rule packs or Micton photos.
- **New work only.** The demo can show only what was built during the event, and the README must say so.
- No code, data or assets you don't have rights to. Don't scrape Google reviews; link to them.
- Banned project types include "basic RAG" and "simple image analyzers." The agent has to visibly do work.
- Submit a **3-minute video**, the public repo and a **live hosted product**.
- Everything you share is non-confidential and Meta gets a permanent licence to it. Film only a basement you're allowed to show, and hide the address.

**Judging**
- Stage 1 is pass/fail: fits a theme and really uses Meta's models.
- Stage 2 scores 0–10 on four things:

| Category | Weight | How this project scores |
|---|---|---|
| Impact | 30% | Housing supply, families, rent. Strong. |
| Use of Meta tooling | 25% | SAM checks Spark's claims and Muse Image's render, plus MapAnything 3D. Unusual. |
| Demo | 25% | Scan reveal, then the 3D walk-through of your own future suite. |
| Technical depth | 20% | Agent with evidence, 3D reconstruction, live rule checks. |

- Stage 3 is the top 5 per track, judged live from the videos.

**Prizes:** indie 1st place is $150k (down to $25k for 5th). Bonus prizes to aim for:
- **Best Agentic Use-Case ($5k):** a natural fit
- **Best Build on Meta Open Weights ($10k):** run the agent on Muse Spark Open through Baseten (`meta-models/muse-spark-open-1026`)
- **Most Viral on X ($20k):** engagement on your demo post until Nov 8
- **Community Vote ($10k):** share the gallery link
- Best Creative Build ($5k, Muse Image/Wonder): possible, not a focus

---

## 4. The experience, step by step

1. **Start.** "Could your basement be a second home?" and one button: **Film my basement**. Two quick taps first:
   - **Who's it for:** a parent or relative, a renter, or not sure. This changes which grants fit.
   - **Address:** this sets the city's rules.
2. **Film (60–90 s).** An on-screen checklist: stairs, every window, the ceiling, the furnace room, any outside door. You talk while filming: "kitchen here," "Mom sleeps here."
3. **The scan reveal.** This has to look great, because it's the first thing judges see.
   - The basement builds itself in 3D, point by point, and the camera flies through it.
   - SAM outlines light up by type: windows, ducts, stairs, furnace, panel.
   - Measurements pop in: *"Ceiling 2.03 m, under the duct 1.88 m."*
4. **The answer, dream first.**
   - At the top: your own basement as the finished suite.
   - Then the verdict: *"Yes, if you fix 3 things"* or *"Not as a separate home, but you can finish it as part of your house."* Each permit route gets one sentence.
5. **Fix cards (3–5).** Each card shows:
   - **What:** for example, "the bedroom needs a window you can climb out of"
   - **Proof:** the video frame with that item outlined
   - **Why:** the rule in plain words, with a source link
   - **Rough cost**

   If something can't be seen, it asks one question instead of guessing.
6. **3D design explorer** (in the browser, on any device):
   - your real basement as a clean 3D room, with the scan as a ghost layer
   - 2–3 layouts that Spark proposes and that pass the rules
   - walk-through or top view
   - drag the kitchen, bed, bath or walls, and the rules re-check live
   - tap a wall or ceiling to see its layers (fire-rated drywall, insulation, framing) and what each costs
   - materials and cost update with every change
7. **Rough quote.** A total range with a breakdown, labelled "an estimate, not a quote."
8. **Money you may qualify for.** For each program: whether it fits *your* plan, its conditions, the source and the date checked.
   - Federal Multigenerational Home Renovation Tax Credit (~$7k back): fits a suite for a relative who is 65+ or has a disability
   - Region of Waterloo Ontario Renovates (forgivable loan up to $25k): needs an income-qualified tenant at a capped rent
   - City of Waterloo ARU grant: first come, first served (amount not confirmed on the City's page)
   - The federal $80k suite loan is shown as **cancelled** (Budget 2025). This is a good demo moment.
   - It never says "you qualify." It says "you look eligible if…" plus the next step.
9. **Get it done.**
   - Registered designers (Ontario BCIN registry) and builders nearby, with links to their reviews. No paid ranking and no "we recommend."
   - **Send my brief:** a one-page PDF with your scope, photos, fix list and rough quote, so a pro can quote without a first visit.
10. **View in AR** (stretch). Place the finished suite at real size and walk around it.
    - iPhone Safari can't do live web AR, so on iPhone it's view-only.
    - Android Chrome can do live AR.

**What it isn't:**
- It doesn't make permit drawings or fill in City forms.
- It doesn't give approvals or financial advice.
- It doesn't cover garden suites.
- During the event it covers **Waterloo only**.

---

## 5. How it works underneath

| Part | Job |
|---|---|
| **Muse Voice Transcribe** | Turns what you said while filming into notes: what you want, and where |
| **SAM 3.1** | Finds and tracks windows, stairs, ducts, beams, furnace, panel and doors across the video |
| **MapAnything** (Meta Reality Labs, Apache 2.0) | Builds a measured 3D model from ordinary phone video, with no LiDAR. Supplies ceiling heights and window sizes. Runs on a GPU (Modal credits). |
| **Muse Spark** (or Spark Open on Baseten) | The agent in charge: reads the city's zoning and the building code's second-unit rules, decides what to look for, asks follow-up questions, proposes layouts, prices fixes from a cost table, and checks grant pages live |
| **Muse Image** | Renders the chosen layout from a real frame of your basement |
| **3D viewer** (three.js, your own code) | Explorer, live rule checks, costs, AR export |

**The trust rule (the core idea):**
- Spark can't claim anything SAM hasn't found in actual frames. Anything unproven becomes a question or a "confirm on site."
- After Muse Image renders, SAM checks that the real windows, stairs and beams didn't move, and the render is redone if they did.
- So SAM checks both the agent's claims and the picture. That's the "beyond a basic integration" story for judges.

**Data (public only):**
- City of Waterloo zoning by-law (ARU rules)
- Ontario Building Code second-unit requirements
- the Region, City and federal grant pages
- a simple cost table per fix
- the BCIN designer registry (check its terms of use)

**For judges:** a "Try a sample basement" button with a video you provide, since they don't have a basement in Waterloo.

---

## 6. Scope: what to cut if time runs short

| Must (the demo) | Should | Stretch |
|---|---|---|
| Film → 3D scan reveal with SAM outlines and measurements | Drag objects with live rule checks | View in AR |
| Verdict and fix cards, each with proof | Construction layer view | More finishes to swap |
| 3D walk-through of 2 layouts | Muse Image render with SAM check | Android live AR |
| Materials and cost per layout | Grants with live re-check | |
| Brief PDF and local pros list | | |
| Hosted live, plus the sample basement | | |

---

## 7. Build plan: 7 days left (proposed; never agreed in the chat)

| Day | Focus | Done when |
|---|---|---|
| **Wed Oct 28 (today)** | Setup and risk tests. Make a public repo in this folder. Make test calls to Spark, SAM 3.1, Muse Image and Voice Transcribe from Waterloo. Film a 60 s test video of a real basement. Attend the 12 PM workshop. Gather the source pages. | Every model answers. You know whether SAM can see in a dim basement. |
| **Thu Oct 29** | Capture pipeline: video → frames → SAM detections with frame evidence → MapAnything 3D → measurements. **Decide go/no-go on MapAnything.** If no-go, use one tape measurement plus a 2D frame view. | Test video in, labelled 3D (or 2D) scene out |
| **Fri Oct 30** | The agent: rules, the evidence rule, follow-up questions, verdict, fix cards, cost table. Test Spark Open on Baseten against the API version. | The verdict on the test basement is right, with proof on every claim |
| **Sat Oct 31** | 3D explorer: the room from the scan, 2 Spark layouts, walk and top views, cost per layout | You can walk your basement as a suite |
| **Sun Nov 1** | Grant check (source, date, cancelled flag), local pros, brief PDF, Muse Image render with SAM check | The full flow runs end to end, roughly |
| **Mon Nov 2** | Make the scan reveal look great. Add the sample-basement mode. **Deploy live.** Then Should-tier items if time allows. | A stranger can use the live link |
| **Tue Nov 3** | Film the real demo and cut the 3-minute video. Write the README ("built during the event," model list, how to run). Last day for help. | Video and README are done |
| **Wed Nov 4** | Buffer. Final checks: repo public with no keys, video link works. **Submit early**; the hard deadline is 9 PM ET. | Submitted |
| Nov 5–8 | Post the demo on X (counts until Nov 8) and share the community-vote link | |
| Mon Nov 9 | Finals, 12 PM ET | |

**Day-1 risks to test (from the chat):**
1. Can you call Meta's API from Canada? The fallback is open weights on Baseten or Modal.
2. Does SAM 3.1 find egress windows and ducts in a dim basement?
3. Does MapAnything give usable sizes in a dim basement? The fallback is a tape measurement.
4. Does Spark get Waterloo's second-unit rules right?
5. Does Muse Image keep the structure in place?
6. Ask at office hours whether MapAnything counts as Meta tooling.

---

## 8. Decisions still open

1. **Name.** Finalists with .com and .ca free, rechecked Oct 28 at ~10 AM ET:
   - **Basement Ready** (this folder's name)
   - Suite Right (the earlier pick)
   - Lower Suite
   - Spare Story
   - Lowerhaus

   Register the one you choose today. sparefloor.com was taken overnight.
2. **The hero story for the demo:** a suite for Mom (the tax credit fits) or a rental (the Region loan fits). It shapes the whole video.
3. **The render.** Gablebird's rule is no AI images. Here it's an edit of your own footage, checked by SAM. Is that OK?
4. **Local pros:** designers only, or builders too? And how do you order them without it reading as a recommendation?
5. **Anything missing?** For example, permit timelines or how much of the mortgage the rent could cover. Or is it already too much?
6. **Solo or a team?** Teams can have up to 4 people.

---

## 9. Your to-dos (only you can do these; status unknown)

- [ ] Claim the $150 Meta credits through the form. It needs a card on file; set a $150 spend limit. Deadline Nov 4.
- [ ] Request Baseten credits ($100, 2,000 spots) and Modal credits ($100, first 1,000 people)
- [ ] Join the Discord and post in #intros
- [ ] Line up the basement to film, with the owner's OK, and hide the address
- [ ] Register the domain
- [ ] Write the one firsthand line on why this matters to you

---

## 10. Competition (checked Oct 27)

- **Maxable (California):** closest. It researches your property and matches you with designers and builders. California only, mostly garages and backyards, no scanning.
- **SecondDoor (Ontario):** builds legal basement and backyard suites
- **Villa and Abodu (California):** backyard units
- **Lucen (Calgary):** quotes $45k–85k+ for a legal basement suite
- **City of Toronto:** piloting an AI pre-check of permit documents. It checks your paperwork, not whether your house can take a suite.
- **The gap:** nobody turns a phone scan into "can this be a suite, what will it cost, which grants fit, and who can build it."

**Facts to recheck before the video:** the grant amounts and conditions (last checked Oct 19; some City and Region pages conflict) and the three-units rule.
