// "Where's the house?": type-ahead for any Ontario address (Waterloo Region's own list first, then
// Natural Resources Canada), then the house from above and what open public records already say.
// Every fact here is a question nobody has to answer later. Text typed but never picked is never
// dropped quietly: the field says what's wrong and what to do.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { aerialUrl, getProperty, searchAddress, type AddressHit, type AddressSearch, type Property } from "../api";

type Status = { tone: "info" | "warn"; text: string } | null;

export function AddressField({
  picked,
  onPick,
  onText,
  help,
}: {
  picked: AddressHit | null;
  onPick: (a: AddressHit | null) => void;
  onText?: (text: string) => void; // what's typed, picked or not
  help?: ReactNode;
}) {
  const [text, setText] = useState(picked ? `${picked.address}, ${picked.municipality}` : "");
  const [found, setFound] = useState<AddressSearch | null>(null);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const hits = found?.results ?? [];

  useEffect(() => {
    if (picked && text === `${picked.address}, ${picked.municipality}`) return;
    const q = text.trim();
    if (q.length < 2) {
      setFound(null);
      return;
    }
    const n = ++seq.current;
    // Long enough for a whole street name before we ask beyond Waterloo Region.
    const id = window.setTimeout(() => {
      void searchAddress(q).then((r) => {
        if (n !== seq.current) return;
        setFound(r);
        setActive(0);
        setOpen(true);
      });
    }, 250);
    return () => clearTimeout(id);
  }, [text, picked]);

  const choose = (a: AddressHit) => {
    setText(`${a.address}, ${a.municipality}`);
    setOpen(false);
    // Put the keyboard away so the house card and the next question have the screen.
    input.current?.blur();
    onPick(a);
  };

  // What to say under the field when nothing is picked.
  const typed = text.trim();
  let status: Status = null;
  if (!picked && found?.notCovered) status = { tone: "warn", text: found.notCovered.message };
  else if (!picked && found && !hits.length && typed.length >= 6)
    status = { tone: "warn", text: "We couldn't find that address. Check the number and street, and add the town, like “45 Elm Crescent, Ottawa”." };
  else if (!picked && hits.length && !focused && typed.length >= 2) status = { tone: "warn", text: "Pick your address from the list, so we use your municipality's rules." };
  const fromNrcan = hits.some((a) => a.source === "ontario");

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
          aria-describedby={status || help ? "addr-help" : undefined}
          aria-invalid={status?.tone === "warn" || undefined}
          onChange={(e) => {
            setText(e.target.value);
            onText?.(e.target.value);
            if (picked) onPick(null);
          }}
          onFocus={() => {
            setFocused(true);
            if (hits.length) setOpen(true);
          }}
          onBlur={() =>
            window.setTimeout(() => {
              setOpen(false);
              setFocused(false);
            }, 150)
          }
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
            {fromNrcan && (
              <li role="presentation" className="muted">
                <small>Addresses outside Waterloo Region: Natural Resources Canada</small>
              </li>
            )}
          </ul>
        )}
      </div>
      {(status || help) && (
        <p className="field-help" id="addr-help" role={status ? "status" : undefined} data-tone={status?.tone}>
          {status ? status.text : help}
        </p>
      )}
    </div>
  );
}

// The card's bold line, and a plain line under it when there's more to say.
function headline(p: Property, address: AddressHit): { head: ReactNode; more?: ReactNode } {
  if (p.inRegion === false)
    return { head: "Ontario's rules apply here.", more: `${address.municipality}'s own zoning isn't in Basement Ready yet, so ask the municipality to confirm it.` };
  if (p.residential === true) return { head: `Good start: homes in zone ${p.zone!.code} can have a basement apartment.` };
  if (p.residential === false) return { head: `Zone ${p.zone!.code} may not allow a basement apartment. We'll still check it for you.` };
  if (p.zoningMap)
    return {
      head: `We can't read ${address.municipality}'s zoning for you.`,
      more: (
        <>
          Look up your zone on the{" "}
          <a href={p.zoningMap.url} target="_blank" rel="noreferrer">
            {p.zoningMap.label}
          </a>
          .
        </>
      ),
    };
  return { head: "We'll use Ontario's rules here.", more: "Ask the municipality to confirm your zoning." };
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
  // The Region's open aerial photos and records cover Waterloo Region only.
  const inRegion = address.source !== "ontario";
  return (
    <div className="prop" aria-live="polite" data-photo={inRegion}>
      {inRegion && <img src={aerialUrl(address)} alt={`${address.address} from above`} className="prop-aerial" />}
      <div className="prop-body">
        {p === undefined ? (
          <p className="prop-head muted">Looking up public records…</p>
        ) : p ? (
          <>
            <p className="prop-head">{headline(p, address).head}</p>
            {headline(p, address).more && <p className="field-help">{headline(p, address).more}</p>}
            {p.inRegion !== false && (
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
            )}
          </>
        ) : (
          <p className="prop-head muted">We couldn't reach the public records. We'll check them during the scan.</p>
        )}
        <p className="prop-credit">
          {inRegion
            ? `Open data: Region of Waterloo${p?.zone && address.municipality === "Cambridge" ? " and the City of Cambridge" : ""}. Aerial photo: Region of Waterloo, 2024.`
            : "Address: Natural Resources Canada."}
        </p>
      </div>
    </div>
  );
}
