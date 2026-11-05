// One live run on the real site, recorded end to end at 1920×1080: the home page → Check my basement →
// the demo house in Waterloo (no real address) → "Family, no rent" → upload a phone video → the wait
// screen with SAM's finds → the questions → the answer → Design → Build, as far as it goes.
// This makes a real scan and costs Meta credit (about $1–2): run it only when that's approved.
// Usage (from video/): node tools/record/live.mjs <video file> [clip name]
import { Clip, launch, settle, sleep, SITE, waitText, press, byText } from "./lib.mjs";

const [file, name = "live-run"] = process.argv.slice(2);
if (!file) throw new Error("Pass the video file to upload");

const s = await launch("desktop");
const { page } = s;
const now = () => new Date().toLocaleTimeString("en-CA", { timeZone: "America/Toronto", hour12: false });

// The answer to each question, by what it asks (the household is already "Family, no rent").
const ANSWERS = [
  [/door .*straight outside|separate way in|own way in/i, ["No"]],
  [/bathroom|capped pipes|rough-in/i, ["Not sure"]],
  [/which look|look do you like/i, ["Light oak"]],
  [/65 or older|disability/i, ["Yes"]],
  [/work on the suite started|work .* started/i, ["No"]],
  [/who.*for|for family|suite for/i, ["A suite for family"]],
];
// How long to hold on each screen before moving on, so the edit has room.
const HOLD = [
  [/second home|can be a|not as it is/i, 7000], // the answer
  [/is this your basement/i, 6000],
  [/layouts?|I drew/i, 8000],
  [/as you filmed it|drag to compare/i, 8000],
  [/permit set|drawn and filled/i, 6000],
];

async function newest() {
  return page.evaluate(() => {
    const msgs = [...document.querySelectorAll(".gs-msg")].filter((m) => !m.classList.contains("gs-you"));
    const m = msgs[msgs.length - 1];
    if (!m) return null;
    const buttons = [...m.querySelectorAll(".gs-choices button, button")]
      .filter((b) => b.offsetParent !== null)
      .map((b) => ({ text: b.textContent.replace(/\s+/g, " ").replace(/→/g, "").trim(), primary: b.classList.contains("btn-primary"), disabled: b.disabled }));
    return { id: msgs.length, text: m.textContent.replace(/\s+/g, " ").trim(), buttons };
  });
}

async function click(text) {
  const h = await byText(page, text).catch(async () => byText(page, `${text} →`));
  await press(s, h, { pause: 700 });
}

let clip;
try {
  await page.goto(SITE, { waitUntil: "networkidle" });
  await settle(page, 1200);
  clip = await new Clip(s, name).start();
  clip.mark("home page");
  await sleep(1500);
  await click("Check my basement");
  clip.mark("tapped 'Check my basement'");
  await sleep(1200);
  await press(s, await waitText(page, "Not in Ontario? Use a demo house in Waterloo", 20000), { pause: 700 });
  clip.mark("demo house in Waterloo (no address)");
  await sleep(1000);
  await press(s, await waitText(page, "Family, no rent", 20000), { pause: 700 });
  clip.mark("'Family, no rent'");
  await sleep(1000);
  const upload = await waitText(page, "Upload a video", 20000);
  for (let i = 0; i < 40 && (await upload.isDisabled()); i++) await sleep(250);
  const chooser = page.waitForEvent("filechooser", { timeout: 20000 });
  await press(s, upload, { pause: 700 });
  (await chooser).setFiles(file);
  console.log(`UPLOAD STARTED ${now()} ET`);
  clip.mark(`upload started ${now()} ET`);

  // The guide: answer each question; on anything else, take the way on after holding the screen.
  const t0 = Date.now();
  let handled = "";
  let stuckSince = 0;
  while (Date.now() - t0 < 13 * 60 * 1000) {
    await sleep(700);
    const m = await newest().catch(() => null);
    if (!m || !m.buttons.length) continue;
    const key = `${m.id}|${m.buttons.map((b) => b.text).join(",")}`;
    if (key === handled) {
      if (stuckSince && Date.now() - stuckSince > 9000) {
        const out = m.buttons.find((b) => /^(Later|Skip|Not sure|Not now)$/.test(b.text) && !b.disabled);
        if (out) {
          clip.mark(`no way on; '${out.text}'`);
          await click(out.text);
          handled = "";
          stuckSince = 0;
        }
      }
      continue;
    }
    if (m.buttons.some((b) => /Back to my basement/.test(b.text))) {
      clip.mark("the end of the guide");
      await sleep(5000);
      break;
    }
    const rule = ANSWERS.find(([re]) => re.test(m.text));
    const pick = rule && rule[1].find((t) => m.buttons.some((b) => b.text === t && !b.disabled));
    if (pick) {
      await sleep(2200);
      clip.mark(`Q: ${m.text.slice(0, 80)} → '${pick}'`);
      await click(pick);
      handled = key;
      stuckSince = 0;
      continue;
    }
    const primary = m.buttons.find((b) => b.primary && !b.disabled);
    if (primary) {
      const hold = HOLD.find(([re]) => re.test(m.text))?.[1] ?? 4000;
      clip.mark(`screen: ${m.text.slice(0, 90)}`);
      await sleep(hold);
      clip.mark(`pressed '${primary.text}'`);
      await click(primary.text);
      handled = key;
      stuckSince = 0;
      continue;
    }
    handled = key;
    stuckSince = Date.now();
    clip.mark(`waiting: ${m.text.slice(0, 80)} [${m.buttons.map((b) => b.text).join(" | ")}]`);
  }
  await page.screenshot({ path: `public/footage/${name}-last.png` });
} finally {
  if (clip) await clip.stop();
  await s.browser.close();
}
