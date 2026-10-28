// Reads a tape measurement typed however people write it: 2.1 m, 210 cm, 6'11", 6 ft 11 in, 83 in.
export function parseLength(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (!t) return null;
  const ftIn = t.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/);
  if (ftIn) return round(Number(ftIn[1]) * 0.3048 + Number(ftIn[2] ?? 0) * 0.0254);
  const inches = t.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/);
  if (inches) return round(Number(inches[1]) * 0.0254);
  const cm = t.match(/^(\d+(?:\.\d+)?)\s*cm$/);
  if (cm) return round(Number(cm[1]) / 100);
  const mm = t.match(/^(\d+(?:\.\d+)?)\s*mm$/);
  if (mm) return round(Number(mm[1]) / 1000);
  const m = t.match(/^(\d+(?:\.\d+)?)\s*m?$/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 4) return round(n); // metres
    if (n >= 100 && n <= 400) return round(n / 100); // a bare number this big is centimetres
  }
  return null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
