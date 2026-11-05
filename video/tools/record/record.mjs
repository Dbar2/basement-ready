// Records the demo's screen footage from the live example basement, one short clip per shot.
//
//   node video/tools/record/record.mjs desktop            # every shot, in order, one session
//   node video/tools/record/record.mjs phone layouts looks  # from "layouts" on, just those shots
//
// Each shot saves the example's state (it lives in the browser) before it runs, so one shot can be
// re-recorded alone. Clips and their key moments land in video/public/footage/ (git-ignored).
import fs from "node:fs";
import path from "node:path";
import { Clip, FOOTAGE, SITE, byText, launch, press, settle, sleep, smoothScroll, waitText } from "./lib.mjs";

const [device = "desktop", ...only] = process.argv.slice(2);
const STATES = path.join(FOOTAGE, ".states");
fs.mkdirSync(STATES, { recursive: true });
const GUIDE = `${SITE}/scans/sample/guide`;
const phone = device === "phone";
const clipName = (shot) => (phone ? `phone-${shot}` : `desktop-${shot}`);

// The visual pane (left on a computer, on top on a phone).
async function visualBox(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".guide-visual, [class*='visual-pane'], [class*='guide-pane']");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

async function pressText(s, text, opts) {
  const h = await waitText(s.page, text);
  await press(s, h, opts);
}

// Thread scrolled to its end, eased, so a new reply reads in full.
async function threadToEnd(page, ms = 900) {
  const sel = await page.evaluate(() => {
    const cands = [...document.querySelectorAll("*")].filter((e) => {
      const cs = getComputedStyle(e);
      return (cs.overflowY === "auto" || cs.overflowY === "scroll") && e.scrollHeight > e.clientHeight + 4;
    });
    const t = cands.find((e) => e.textContent.includes("Why I'm asking") || e.textContent.includes("Why it matters"));
    if (!t) return null;
    t.setAttribute("data-rec-thread", "1");
    return "[data-rec-thread='1']";
  });
  if (!sel) return;
  await smoothScroll(page, { selector: sel, to: 1e7, ms }).catch(() => {});
}

const SHOTS = [
  {
    name: "home",
    async prep(s) {
      await s.page.goto(SITE + "/", { waitUntil: "networkidle" });
      await settle(s.page, 1500);
    },
    async run(s, c) {
      const { page } = s;
      c.mark("hero: 'Could your basement be a home?' with the example video");
      await sleep(2500);
      const vh = page.viewportSize().height;
      for (let i = 0; i < 3; i++) {
        await smoothScroll(page, { by: vh * 0.85, ms: 2600 });
        c.mark(`story, screen ${i + 2} settled`);
        await sleep(1900);
      }
      await smoothScroll(page, { to: 0, ms: 2600 });
      c.mark("back at the hero");
      await sleep(1200);
      const btn = await byText(page, "Try the example");
      c.mark("pointer on 'Try the example'");
      await press(s, btn, { pause: 700 });
      c.mark("clicked 'Try the example'");
      await waitText(page, "Not sure", 30000);
      await settle(page, 400);
      c.mark("guide open: example video and the first question");
      await sleep(2500);
    },
  },
  {
    name: "wait",
    async prep(s) {
      if (!s.page.url().includes("/guide")) {
        await s.page.goto(GUIDE, { waitUntil: "networkidle" });
      }
      await waitText(s.page, "Not sure", 30000);
      // SAM's outlines start a few seconds into the video.
      await sleep(phone ? 5000 : 4500);
    },
    async run(s, c) {
      const { page } = s;
      c.mark("video with SAM's outlines; question 'Is there a door from the basement straight outside?'");
      await sleep(5000);
      await pressText(s, "No");
      c.mark("answered 'No'");
      await sleep(400);
      await threadToEnd(page);
      c.mark("next question: bathroom or capped pipes (rough-in)");
      await sleep(3800);
      await pressText(s, "No");
      c.mark("answered 'No'");
      await sleep(400);
      await threadToEnd(page);
      c.mark("look question with swatches: Light oak, Warm wood, Deep green, Plain");
      await sleep(3500);
    },
  },
  {
    name: "answer",
    async prep(s) {
      await waitText(s.page, "Light oak", 30000);
    },
    async run(s, c) {
      const { page } = s;
      await sleep(800);
      await pressText(s, "Light oak");
      c.mark("picked 'Light oak'");
      await waitText(page, "Why that cost?", 30000);
      await sleep(300);
      await threadToEnd(page);
      await settle(page, 200);
      c.mark("verdict 'Yes, after 4 fixes': plan with the fire separation marked, $49k–$85k, up to $7,000 back");
      await sleep(5500);
    },
  },
  {
    name: "explain",
    async prep(s) {
      await waitText(s.page, "What's a fire separation?", 30000);
    },
    async run(s, c) {
      const { page } = s;
      await sleep(900);
      await pressText(s, "What's a fire separation?");
      c.mark("tapped 'What's a fire separation?'");
      await waitText(page, "Can I do it myself?", 30000);
      await sleep(300);
      await threadToEnd(page);
      await settle(page, 200);
      c.mark("section drawing 'A fire separation, in section' and the rule's source");
      await sleep(5000);
    },
  },
  {
    name: "plan",
    async prep(s) {
      await waitText(s.page, "Got it, show me what it could be →", 30000);
    },
    async run(s, c) {
      const { page } = s;
      await sleep(900);
      await pressText(s, "Got it, show me what it could be →");
      c.mark("tapped 'Got it, show me what it could be'");
      await waitText(page, "Looks right →", 30000);
      await sleep(300);
      await threadToEnd(page);
      await settle(page, 300);
      c.mark("'Is this your basement?' with the measured plan, two dashed walls, green knobs");
      await sleep(3500);
      // Drag the window's knob along its wall and back, slowly.
      const knob = await page.evaluate(() => {
        const cs = [...document.querySelectorAll("svg circle")].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 6 && r.width < 40);
        cs.sort((a, b) => b.y - a.y);
        const r = cs[0];
        return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      });
      if (knob) {
        const dx = phone ? -45 : -140;
        if (phone) {
          // Touch drag via pointer events is not available on touchscreen; the mouse drives it.
        }
        await page.mouse.move(knob.x, knob.y, { steps: 8 });
        await sleep(500);
        c.mark("pointer on the window's knob");
        await page.mouse.down();
        for (let i = 1; i <= 40; i++) {
          await page.mouse.move(knob.x + (dx * i) / 40, knob.y);
          await sleep(28);
        }
        await sleep(500);
        for (let i = 39; i >= 0; i--) {
          await page.mouse.move(knob.x + (dx * i) / 40, knob.y);
          await sleep(28);
        }
        await page.mouse.up();
        c.mark("window dragged along the wall and back");
        await sleep(2500);
      }
    },
  },
  {
    name: "layouts",
    async prep(s) {
      await waitText(s.page, "Looks right →", 30000);
    },
    async run(s, c) {
      const { page } = s;
      await sleep(900);
      await pressText(s, "Looks right →");
      c.mark("tapped 'Looks right'");
      await waitText(page, "Use One bedroom →", 30000);
      await sleep(300);
      await threadToEnd(page);
      c.mark("layouts in 3D: One bedroom recommended, camera easing in");
      await sleep(6000);
      try {
        await pressText(s, "Studio");
        c.mark("switched to 'Studio'");
        await sleep(4500);
        await pressText(s, "One bedroom");
        c.mark("back to 'One bedroom'");
        await sleep(4000);
      } catch {
        await sleep(3000);
      }
    },
  },
  {
    name: "looks",
    async prep(s) {
      await waitText(s.page, "Use One bedroom →", 30000);
    },
    async run(s, c) {
      const { page } = s;
      await sleep(900);
      await pressText(s, "Use One bedroom →");
      c.mark("tapped 'Use One bedroom'");
      await waitText(page, "Looks good →", 30000);
      await sleep(300);
      await threadToEnd(page);
      await settle(page, 800);
      c.mark("before / after ('After · virtually staged') side by side");
      await sleep(3500);
      // Drag the divider: towards the before, the after, then home.
      const box = await page.evaluate(() => {
        const el = [...document.querySelectorAll("img")].filter((i) => i.getBoundingClientRect().width > 200).map((i) => i.closest("div").getBoundingClientRect())[0];
        return el ? { x: el.x, y: el.y, w: el.width, h: el.height } : null;
      });
      if (box) {
        const y = box.y + box.h / 2;
        const mid = box.x + box.w / 2;
        const path = [mid, box.x + box.w * 0.82, box.x + box.w * 0.2, mid];
        await page.mouse.move(mid, y, { steps: 6 });
        await sleep(400);
        await page.mouse.down();
        for (let k = 1; k < path.length; k++) {
          const a = path[k - 1], b = path[k];
          for (let i = 1; i <= 45; i++) {
            const e = i / 45, ease = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
            await page.mouse.move(a + (b - a) * ease, y);
            await sleep(24);
          }
          c.mark(k === 1 ? "divider dragged: mostly before" : k === 2 ? "divider dragged: mostly after" : "divider back in the middle");
          await sleep(700);
        }
        await page.mouse.up();
        await sleep(2000);
      }
    },
  },
  {
    name: "build",
    async prep(s) {
      await waitText(s.page, "Looks good →", 30000);
    },
    async run(s, c) {
      const { page } = s;
      await sleep(900);
      await pressText(s, "Looks good →");
      c.mark("tapped 'Looks good'");
      await waitText(page, "Start →", 30000);
      await sleep(300);
      await threadToEnd(page);
      await settle(page, 300);
      c.mark("Build: the permit set, '2 of 15 ready', drawings and City forms ticked");
      await sleep(4500);
      await pressText(s, "Start →");
      c.mark("tapped 'Start'");
      await waitText(page, "Save", 30000);
      await sleep(300);
      await threadToEnd(page);
      c.mark("tape card: front-to-back wall, ceiling height, lowest beam");
      await sleep(2500);
    },
  },
  {
    name: "homebase",
    async prep(s) {
      await s.page.goto(`${SITE}/scans/sample`, { waitUntil: "networkidle" });
      await settle(s.page, 1200);
    },
    async run(s, c) {
      c.mark("home base: 'A legal second home downstairs', Answer done, Design done, Build next");
      await sleep(6000);
    },
  },
];

const start = only.length ? SHOTS.findIndex((x) => x.name === only[0]) : 0;
if (start < 0) throw new Error(`Unknown shot ${only[0]}`);
const list = only.length ? SHOTS.filter((x) => only.includes(x.name)) : SHOTS;
const stateFor = (shot) => path.join(STATES, `${device}-${shot}.json`);
const first = list[0];
const initial = first.name !== "home" && first.name !== "wait" && fs.existsSync(stateFor(first.name)) ? stateFor(first.name) : undefined;
const s = await launch(device, initial);
if (initial) {
  await s.page.goto(GUIDE, { waitUntil: "networkidle" });
  await settle(s.page, 800);
}
try {
  for (const shot of list) {
    console.log(`${device} ${shot.name}`);
    await s.context.storageState({ path: stateFor(shot.name) });
    await shot.prep(s);
    const clip = await new Clip(s, clipName(shot.name)).start();
    await shot.run(s, clip);
    await clip.stop();
  }
} finally {
  await s.browser.close();
}
