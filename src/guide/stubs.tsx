// Placeholders for the visual and card kinds a track hasn't delivered yet: they name the kind and show its
// ref, so the shell, the script and the e2e can run end to end before the real pieces land.
import type { CardProps } from "./mount";
import type { VisualRef } from "./types";

// Typed on any ref, so one stub stands in for every kind.
export function VisualStub({ visual }: { visual: VisualRef }) {
  const { kind, ...rest } = visual;
  return (
    <div className="gs-stub" data-stub={kind}>
      <p className="gs-stub-kind">{kind}</p>
      {Object.keys(rest).length > 0 && <p className="mono">{JSON.stringify(rest)}</p>}
    </div>
  );
}

export function CardStub({ card }: CardProps) {
  return (
    <div className="gs-card gs-stub" data-stub={card.kind}>
      <p className="gs-stub-kind">{card.kind} card</p>
      <p className="mono">{card.id}</p>
    </div>
  );
}
