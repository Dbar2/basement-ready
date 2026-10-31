// The guide's marks in a message's text (server/guide/script.ts writes them): **bold** for what it's
// asking, and [a source](https://…) for where a rule comes from. GuideScreen draws each message through
// rich(); anything else is plain text.
import type { ReactNode } from "react";

const MARK = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

export function rich(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(MARK)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(
      m[1] != null ? (
        <strong key={m.index}>{m[1]}</strong>
      ) : (
        <a key={m.index} href={m[3]} target="_blank" rel="noopener noreferrer">
          {m[2]}
        </a>
      ),
    );
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
