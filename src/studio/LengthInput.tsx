// A length from a tape, typed the way people read one: "7.3", "730 cm", "24' 6\"", "24 ft 6 in".
import { useId, useState } from "react";
import type { Units } from "../components/FloorPlan";

export function parseLength(text: string, units: Units): number | null {
  const t = text.trim().toLowerCase().replace(/,/g, ".");
  if (!t) return null;
  const feet = t.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/);
  if (feet) return Number(feet[1]) * 0.3048 + Number(feet[2] ?? 0) * 0.0254;
  const inches = t.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/);
  if (inches) return Number(inches[1]) * 0.0254;
  const cm = t.match(/^(\d+(?:\.\d+)?)\s*cm$/);
  if (cm) return Number(cm[1]) / 100;
  const mm = t.match(/^(\d+(?:\.\d+)?)\s*mm$/);
  if (mm) return Number(mm[1]) / 1000;
  const m = t.match(/^(\d+(?:\.\d+)?)\s*m?$/);
  if (m) return units === "ft" ? Number(m[1]) * 0.3048 : Number(m[1]);
  return null;
}

export function LengthInput({ label, units, onSubmit, cta }: { label: string; units: Units; onSubmit: (m: number) => void; cta: string }) {
  const id = useId();
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const submit = () => {
    const m = parseLength(text, units);
    if (m == null || m < 0.1 || m > 60) return setBad(true);
    setBad(false);
    setText("");
    onSubmit(Math.round(m * 1000) / 1000);
  };
  return (
    <form
      className="length-input"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div>
        <input id={id} className="input" inputMode="decimal" placeholder={units === "m" ? "7.30 m" : `24' 6"`} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={bad || undefined} />
        <button className="btn btn-ghost" type="submit" disabled={!text.trim()}>{cta}</button>
      </div>
      {bad && <p className="field-error">Type a length like {units === "m" ? "7.30 or 730 cm" : `24' 6"`}.</p>}
    </form>
  );
}
