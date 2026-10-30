// Free checks run in the page at every shot, before any model looks: sideways scroll, broken images,
// cut-off text, banned words, internal numbers, orange, mint text, low contrast, small tap targets, off-brand
// fonts. Each comes back with the element's box so the report can crop it.
import type { Page } from "playwright";

export type LintIssue = {
  rule: string;
  severity: "P0" | "P1" | "P2";
  category: "correctness" | "polish" | "brand" | "credibility" | "copy";
  title: string;
  what: string;
  fix: string;
  // Page coordinates in CSS pixels (document, not viewport).
  box?: { x: number; y: number; w: number; h: number };
};

// Runs in the page. Plain JS only: it's serialized as is.
function lintInPage(opts: { phone: boolean }) {
  const issues: any[] = [];
  const vw = innerWidth;
  const sx = scrollX;
  const sy = scrollY;
  const boxOf = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + sx), y: Math.round(r.y + sy), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    }
    return true;
  };
  const label = (el: Element) => {
    const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    return `<${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? ` class="${el.className.split(" ").slice(0, 2).join(" ")}"` : ""}>${t ? ` "${t.slice(0, 60)}"` : ""}`;
  };
  const add = (rule: string, severity: string, category: string, title: string, what: string, fix: string, el?: Element) =>
    issues.push({ rule, severity, category, title, what, fix, box: el ? boxOf(el) : undefined });

  // ---- Sideways scroll ----
  const docW = document.documentElement.scrollWidth;
  if (docW > vw + 1) {
    const wide = [...document.body.querySelectorAll("*")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.right > vw + 1 && r.width > 0 && r.width <= docW && visible(el);
      })
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
    // The innermost element that pokes out is the one to fix.
    const culprit = wide.find((el) => ![...el.children].some((c) => c.getBoundingClientRect().right > vw + 1)) ?? wide[0];
    add("sideways-scroll", opts.phone ? "P1" : "P2", "polish", "The page scrolls sideways", `The page is ${docW}px wide in a ${vw}px window${culprit ? `; ${label(culprit)} pokes out` : ""}.`, "Let it wrap or shrink to the window width.", culprit);
  }

  // ---- Broken images ----
  for (const img of [...document.images]) {
    if (img.complete && img.naturalWidth === 0 && img.getAttribute("src") && visible(img)) {
      add("broken-image", "P1", "polish", "An image didn't load", `${img.getAttribute("src")?.slice(0, 120)} shows as broken.`, "Fix the path or hide the image until it exists.", img);
    }
  }

  // ---- Text: banned words, internal numbers, leaked values ----
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set<string>();
  const rules: [RegExp, string, string, string, string, string][] = [
    [/\b(you|they) qualify\b/i, "you-qualify", "P1", "Says 'qualify'", "Brand rule: never say 'you qualify'. Say 'looks eligible if…' or 'a designer will confirm'.", "copy"],
    [/\b(approved|guaranteed)\b/i, "approved", "P2", "Says 'approved' or 'guaranteed'", "Brand rule: no fake certainty. Check this isn't claiming an approval we can't give.", "copy"],
    [/\b(undefined|NaN|null|Infinity)\b|\[object Object\]/, "leaked-value", "P0", "A programming value shows on screen", "A raw value like undefined, NaN or null is shown to the homeowner.", "correctness"],
    [/±\s*\d+(\.\d+)?\s*%|\b\d+(\.\d+)?\s*%\s*(error|confidence|accuracy|certain)|\bconfidence\b|expectedErrorPct|\berror\s*(rate|margin|pct)\b/i, "internal-stats", "P1", "Internal error statistics shown", "Brand rule: no internal error statistics to users. Say what we know in plain words.", "copy"],
  ];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.nodeValue ?? "").replace(/\s+/g, " ").trim();
    const el = n.parentElement;
    if (!text || !el || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName) || !visible(el)) continue;
    for (const [re, rule, sev, title, why, cat] of rules) {
      const m = text.match(re);
      if (!m) continue;
      const key = `${rule}:${text.slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      add(rule, sev, cat, title, `"${text.slice(0, 140)}" — ${why}`, rule === "leaked-value" ? "Hide the line or show a plain fallback." : "Reword it.", el);
    }
  }

  // ---- Cut-off text ----
  let clipped = 0;
  for (const el of [...document.body.querySelectorAll("h1,h2,h3,h4,p,span,a,button,label,li,td,th,div")]) {
    if (clipped >= 6) break;
    const hasText = [...el.childNodes].some((c) => c.nodeType === 3 && (c.nodeValue ?? "").trim().length > 1);
    if (!hasText || !visible(el)) continue;
    const s = getComputedStyle(el);
    const hidesX = ["hidden", "clip"].includes(s.overflowX) || s.textOverflow === "ellipsis";
    const hidesY = ["hidden", "clip"].includes(s.overflowY) || Number(s.webkitLineClamp) > 0;
    const overX = el.scrollWidth > el.clientWidth + 2;
    const overY = el.scrollHeight > el.clientHeight + 3;
    if ((hidesX && overX) || (hidesY && overY && el.clientHeight > 0)) {
      clipped++;
      add("cut-off-text", "P2", "polish", "Text is cut off", `${label(el)} doesn't fit its box (${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight}).`, "Let it wrap, or shorten it.", el);
    }
  }

  // ---- Colour: orange, mint as text, contrast ----
  const rgb = (c: string) => {
    const m = c.match(/rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const hsl = ({ r, g, b }: { r: number; g: number; b: number }) => {
    const R = r / 255, G = g / 255, B = b / 255;
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h = (h * 60 + 360) % 360;
    return { h, s, l };
  };
  const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
    const f = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (el: Element): { r: number; g: number; b: number } | null => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage && s.backgroundImage !== "none") return null; // over a picture or gradient: can't tell
      const c = rgb(s.backgroundColor);
      if (c && c.a > 0.9) return c;
    }
    return { r: 244, g: 246, b: 242 };
  };
  const orange = new Map<string, Element>();
  let lowContrast = 0;
  let mintText = 0;
  for (const el of [...document.body.querySelectorAll("*")]) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const props = el instanceof SVGElement ? [s.fill, s.stroke, s.color] : [s.color, s.backgroundColor, s.borderTopColor, s.outlineColor];
    for (const v of props) {
      const c = rgb(v ?? "");
      if (!c || c.a < 0.5) continue;
      const { h, s: sat, l } = hsl(c);
      if (h >= 10 && h <= 38 && sat >= 0.45 && l >= 0.25 && l <= 0.75) {
        const key = `${c.r},${c.g},${c.b}`;
        if (!orange.has(key)) orange.set(key, el);
      }
    }
    const hasText = [...el.childNodes].some((c) => c.nodeType === 3 && (c.nodeValue ?? "").trim().length > 1);
    if (!hasText || el instanceof SVGElement) continue;
    const fg = rgb(s.color);
    if (!fg) continue;
    if (mintText < 3 && fg.r === 75 && fg.g === 227 && fg.b === 138) {
      const bg = bgOf(el);
      if (bg && lum(bg) > 0.4) {
        mintText++;
        add("mint-text", "P1", "brand", "Mint used as text on a light background", `${label(el)} is mint (#4BE38A) text. Brand rule: mint is fill only (1.5:1 on light).`, "Use accent text #1F7A4A, or forest on a mint fill.", el);
      }
    }
    if (lowContrast >= 5) continue;
    const bg = bgOf(el);
    if (!bg) continue;
    const a = lum(fg), b = lum(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5) && fg.a > 0.5) {
      lowContrast++;
      add("contrast", ratio < 3 ? "P1" : "P2", "polish", "Low text contrast", `${label(el)}: ${ratio.toFixed(1)}:1 (needs ${large ? "3" : "4.5"}:1).`, "Use ink or ink-muted on this background.", el);
    }
  }
  for (const [key, el] of orange) add("orange", "P1", "brand", "Orange on screen", `rgb(${key}) on ${label(el)}. Brand rule: no orange or terracotta anything.`, "Use a brand token (forest, mint, fix #8C6A00 for warnings).", el);

  // ---- Fonts ----
  const off = new Map<string, Element>();
  for (const el of [...document.body.querySelectorAll("h1,h2,h3,p,a,button,label,li,span,input")]) {
    if (off.size >= 3) break;
    const hasText = el.tagName === "INPUT" || [...el.childNodes].some((c) => c.nodeType === 3 && (c.nodeValue ?? "").trim().length > 1);
    if (!hasText || !visible(el)) continue;
    const first = getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim();
    if (!/hanken grotesk|geist mono/i.test(first) && !off.has(first)) off.set(first, el);
  }
  for (const [font, el] of off) add("font", "P2", "brand", "Off-brand typeface", `${label(el)} is set in ${font}. Brand: Hanken Grotesk, with Geist Mono for measurements.`, "Use the brand font tokens.", el);
  if (!document.fonts.check("16px 'Hanken Grotesk'")) add("font-load", "P1", "brand", "Hanken Grotesk didn't load", "The brand font isn't loaded on this page, so text falls back to a system font.", "Check the Google Fonts link.");

  // ---- Small tap targets on a phone ----
  if (opts.phone) {
    let small = 0;
    for (const el of [...document.body.querySelectorAll("button, [role=button], [role=tab], input:not([type=hidden]), select, a.btn")]) {
      if (small >= 4 || !visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 32 || r.height < 32) {
        small++;
        add("tap-target", "P2", "polish", "Small tap target", `${label(el)} is ${Math.round(r.width)}×${Math.round(r.height)}px; aim for 44×44 on a phone.`, "Add padding to the control.", el);
      }
    }
  }
  return issues;
}

// The same word rules for text that isn't a web page (PDF pages). No boxes: the page is the place.
const TEXT_RULES: { re: RegExp; rule: string; severity: LintIssue["severity"]; category: LintIssue["category"]; title: string; why: string }[] = [
  { re: /\b(you|they) qualify\b/i, rule: "you-qualify", severity: "P1", category: "copy", title: "Says 'qualify'", why: "Brand rule: never say 'you qualify'. Say 'looks eligible if…' or 'a designer will confirm'." },
  { re: /\b(approved|guaranteed)\b/i, rule: "approved", severity: "P2", category: "copy", title: "Says 'approved' or 'guaranteed'", why: "Brand rule: no fake certainty. Check this isn't claiming an approval we can't give." },
  { re: /\b(undefined|NaN|Infinity)\b|\[object Object\]/, rule: "leaked-value", severity: "P0", category: "correctness", title: "A programming value is printed", why: "A raw value like undefined or NaN is in the document." },
  { re: /\b\d+(\.\d+)?\s*%\s*(error|confidence|accuracy)|\bconfidence\b|expectedErrorPct/i, rule: "internal-stats", severity: "P1", category: "copy", title: "Internal error statistics printed", why: "Brand rule: no internal error statistics to users." },
];

export function lintText(text: string): LintIssue[] {
  const out: LintIssue[] = [];
  for (const r of TEXT_RULES) {
    const lines = text.split("\n").filter((l) => r.re.test(l));
    if (!lines.length) continue;
    out.push({ rule: r.rule, severity: r.severity, category: r.category, title: r.title, what: `${lines.length} line${lines.length > 1 ? "s" : ""}, e.g. "${lines[0].trim().slice(0, 120)}" — ${r.why}`, fix: "Reword it." });
  }
  return out;
}

export const lint = (page: Page, phone: boolean) => page.evaluate(lintInPage, { phone }) as Promise<LintIssue[]>;

// The lines of a page that carry numbers (areas, heights, costs, counts), for the cross-screen check.
// SVG text (plans) is read too; innerText leaves it out.
export function numbersOf(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const lines = new Set<string>();
    const push = (t: string) => {
      const s = t.replace(/\s+/g, " ").trim();
      if (s.length >= 2 && s.length <= 220 && /\d/.test(s)) lines.add(s);
    };
    for (const l of document.body.innerText.split("\n")) push(l);
    for (const t of document.querySelectorAll("svg text")) push(t.textContent ?? "");
    for (const el of document.querySelectorAll("[aria-label]")) push(el.getAttribute("aria-label") ?? "");
    return [...lines].slice(0, 160);
  });
}
