// A picture and the real frame it was made from, one over the other, with a line to slide between them:
// the frame ("before") on the left of the line, the picture ("after") on the right. Every picture is its
// frame restyled at the frame's own size (server/views/routes.ts beforeUrl), so the two line up exactly.
// Drag anywhere on it, or use the arrow keys.
import { useState } from "react";
import "./views.css";

export function BeforeAfter({ before, after, alt, ratio, start = 50 }: { before: string; after: string; alt: string; ratio?: string; start?: number }) {
  const [at, setAt] = useState(start);
  return (
    <div className="before-after" style={ratio ? { aspectRatio: ratio } : undefined}>
      <img className="ba-img" src={after} alt={alt} draggable={false} loading="lazy" />
      <img className="ba-img" src={before} alt="Before: the frame from your video" draggable={false} loading="lazy" style={{ clipPath: `inset(0 ${100 - at}% 0 0)` }} />
      <span className="ba-line" style={{ left: `${at}%` }} aria-hidden="true" />
      <span className="ba-tag" data-side="before" aria-hidden="true">
        Before
      </span>
      <span className="ba-tag" data-side="after" aria-hidden="true">
        After
      </span>
      <input className="ba-range" type="range" min={0} max={100} value={at} onChange={(e) => setAt(Number(e.target.value))} aria-label="Slide between the frame from your video and the picture" />
    </div>
  );
}
