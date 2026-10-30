// One card, big: the whole picture, what it's finished with, and how SAM checked it.
import { useEffect, useRef } from "react";
import { STYLES, USES } from "../../server/ideas/styles";
import type { Card } from "./api";

type Action = { label: string; primary?: boolean; onClick: () => void };

export function CardDialog({ card, onClose, actions }: { card: Card; onClose: () => void; actions: Action[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Taking it off the page closes it; closing it here too would fire onClose on every remount.
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const t = card.tags;
  return (
    <dialog ref={ref} className="card-dialog" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-labelledby="card-dialog-title">
      <figure>
        <img src={card.url} alt={`${card.title}, virtually staged from your own video`} style={{ aspectRatio: String(card.aspect) }} />
        <figcaption className="mono">Virtually staged · {card.checked}</figcaption>
      </figure>
      <div className="card-dialog-body">
        <h2 id="card-dialog-title">{card.title}</h2>
        <dl>
          <dt>Style</dt>
          <dd>{STYLES[t.style].label}</dd>
          <dt>Floor</dt>
          <dd>{t.floor}</dd>
          <dt>Walls</dt>
          <dd>{t.walls}</dd>
          {t.use === "kitchen" && (
            <>
              <dt>Kitchen</dt>
              <dd>{t.kitchen}</dd>
            </>
          )}
          {t.use === "bathroom" && (
            <>
              <dt>Bathroom</dt>
              <dd>{t.bath}</dd>
            </>
          )}
          <dt>Shows</dt>
          <dd>
            {USES[t.use].label} · {card.view.toLowerCase()}
          </dd>
        </dl>
        <div className="card-dialog-actions">
          {actions.map((a) => (
            <button key={a.label} type="button" className={a.primary ? "btn btn-primary" : "btn btn-ghost"} onClick={a.onClick}>
              {a.label}
            </button>
          ))}
          <button type="button" className="link-quiet" onClick={onClose} autoFocus={!actions.length}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
