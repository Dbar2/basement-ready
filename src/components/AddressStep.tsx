// "Where's the house?": type-ahead from the Region's own address list, then the house from above
// and what public records already say. Every fact here is a question nobody has to answer later.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { aerialUrl, getProperty, searchAddress, type AddressHit, type Property } from "../api";

export function AddressField({ picked, onPick, help }: { picked: AddressHit | null; onPick: (a: AddressHit | null) => void; help?: ReactNode }) {
  const [text, setText] = useState(picked ? `${picked.address}, ${picked.municipality}` : "");
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (picked && text === `${picked.address}, ${picked.municipality}`) return;
    const q = text.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const n = ++seq.current;
    const id = window.setTimeout(() => {
      void searchAddress(q).then((r) => {
        if (n !== seq.current) return;
        setHits(r);
        setActive(0);
        setOpen(true);
      });
    }, 120);
    return () => clearTimeout(id);
  }, [text, picked]);

  const choose = (a: AddressHit) => {
    setText(`${a.address}, ${a.municipality}`);
    setOpen(false);
    // Put the keyboard away so the house card and the next question have the screen.
    input.current?.blur();
    onPick(a);
  };

  return (
    <div className="addr" data-open={open && hits.length > 0}>
      <label htmlFor="addr-input">Your address</label>
      <div className="addr-box">
        <input
          ref={input}
          id="addr-input"
          className="input"
          placeholder="Start typing, e.g. 120 Avondale"
          value={text}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && hits.length > 0}
          aria-controls="addr-list"
          aria-activedescendant={open && hits[active] ? `addr-${active}` : undefined}
          aria-describedby={help ? "addr-help" : undefined}
          onChange={(e) => {
            setText(e.target.value);
            if (picked) onPick(null);
          }}
          onFocus={() => hits.length && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!open || !hits.length) return;
            if (e.key === "ArrowDown") setActive((i) => Math.min(hits.length - 1, i + 1));
            else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
            else if (e.key === "Enter") {
              e.preventDefault();
              choose(hits[active]);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        {open && hits.length > 0 && (
          <ul className="addr-list" id="addr-list" role="listbox">
            {hits.map((a, i) => (
              <li
                key={`${a.address}|${a.municipality}`}
                id={`addr-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(a);
                }}
              >
                <b>{a.address}</b> <span>{a.municipality}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {help && (
        <p className="field-help" id="addr-help">
          {help}
        </p>
      )}
    </div>
  );
}

function headline(p: Property) {
  if (p.residential === true) return `Good start: homes in zone ${p.zone!.code} can have a basement apartment.`;
  if (p.residential === false) return `Zone ${p.zone!.code} may not allow a basement apartment. We'll still check it for you.`;
  return "We'll check the zoning for this address.";
}

export function PropertyCard({ address, onLoad }: { address: AddressHit; onLoad?: () => void }) {
  const [p, setP] = useState<Property | null | undefined>(undefined);
  useEffect(() => {
    setP(undefined);
    void getProperty(address).then(setP);
  }, [address]);
  // The card grows once the records arrive; let the sheet bring what's below it back into view.
  useEffect(() => {
    if (p !== undefined) onLoad?.();
  }, [p]);
  const b = p?.building;
  return (
    <div className="prop" aria-live="polite">
      <img src={aerialUrl(address)} alt={`${address.address} from above`} className="prop-aerial" />
      <div className="prop-body">
        {p === undefined ? (
          <p className="prop-head muted">Looking up public records…</p>
        ) : p ? (
          <>
            <p className="prop-head">{headline(p)}</p>
            <ul className="prop-facts">
              {p.zone && <li>Zone {p.zone.code}{p.zone.label && p.zone.label.toUpperCase() !== p.zone.code.toUpperCase() ? ` · ${p.zone.label.toLowerCase()}` : ""}</li>}
              {p.lotAreaM2 && <li>Lot {p.lotAreaM2.toLocaleString("en-CA")} m²</li>}
              {b?.storeys && (
                <li>
                  House: {b.storeys} storey{b.storeys === 1 ? "" : "s"}
                  {b.floorAreaM2 ? ` · ${b.floorAreaM2} m²` : ""}
                </li>
              )}
              <li>{p.unitsRegistered ? `${p.unitsRegistered} apartment${p.unitsRegistered === 1 ? "" : "s"} already registered` : "No apartment registered yet"}</li>
            </ul>
          </>
        ) : (
          <p className="prop-head muted">We couldn't reach the public records. We'll check them during the scan.</p>
        )}
        <p className="prop-credit">Public records: Region of Waterloo and the City of {address.municipality}. Aerial photo: Region of Waterloo, 2026.</p>
      </div>
    </div>
  );
}
