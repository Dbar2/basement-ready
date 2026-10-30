// The start sheet's photo take: the chosen photos in a grid, room by room. Each photo has a room chip
// (move it to another room, or a new one), arrows to change its place in the room, and a remove button.
// Rooms can be renamed ("Room 1" becomes "Family room"). Photos are numbered in the order they're sent,
// so "photo 3" on the wait screen is the third one here.
import { MAX_PHOTOS, MIN_PHOTOS_3D } from "../api";
import "../styles/photos.css";

export type Picked = {
  id: number;
  file: File;
  blob: Blob | null; // the small upright JPEG (src/capture/photos.ts); null while it's made, or when this browser can't read it
  url: string | null; // its thumbnail
  room: number;
  state: "working" | "ready" | "raw"; // raw: sent as it is, the server reads it
};
export type PhotoTakeDraft = { photos: Picked[]; rooms: string[] };

export const MAX_ROOMS = 8; // server/rooms.ts
export const defaultRoom = (i: number) => `Room ${i + 1}`;
const isDefault = (name: string) => /^Room \d+$/.test(name);

// The photos as they'll be sent: room by room, in their order within each room.
export function inRoomOrder(take: PhotoTakeDraft): Picked[] {
  return take.rooms.flatMap((_, r) => take.photos.filter((p) => p.room === r));
}

// Each room's name as sent: typed, or "Room N"; two rooms never share one.
export function roomNames(take: PhotoTakeDraft): string[] {
  const seen = new Set<string>();
  return take.rooms.map((n, i) => {
    let name = n.trim() || defaultRoom(i);
    for (let k = 2; seen.has(name.toLowerCase()); k++) name = `${n.trim() || defaultRoom(i)} ${k}`;
    seen.add(name.toLowerCase());
    return name;
  });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Props = {
  take: PhotoTakeDraft;
  onChange: (take: PhotoTakeDraft) => void;
  onAdd: (room: number) => void; // opens the photo library for this room
  onRemove: (p: Picked) => void;
  onBack: () => void;
  note: string | null;
};

export function PhotoPicker({ take, onChange, onAdd, onRemove, onBack, note }: Props) {
  const order = inRoomOrder(take);
  const number = new Map(order.map((p, i) => [p.id, i + 1]));
  const full = take.photos.length >= MAX_PHOTOS;

  const setRoom = (p: Picked, value: string) => {
    if (value === "new") {
      onChange({ rooms: [...take.rooms, defaultRoom(take.rooms.length)], photos: take.photos.map((x) => (x.id === p.id ? { ...x, room: take.rooms.length } : x)) });
    } else onChange({ ...take, photos: take.photos.map((x) => (x.id === p.id ? { ...x, room: Number(value) } : x)) });
  };
  // Swap with its neighbour in the same room.
  const move = (p: Picked, by: -1 | 1) => {
    const mine = take.photos.flatMap((x, i) => (x.room === p.room ? [i] : []));
    const at = mine.indexOf(take.photos.indexOf(p));
    const other = mine[at + by];
    if (other === undefined) return;
    const photos = [...take.photos];
    [photos[mine[at]], photos[other]] = [photos[other], photos[mine[at]]];
    onChange({ ...take, photos });
  };
  const rename = (r: number, name: string) => onChange({ ...take, rooms: take.rooms.map((n, i) => (i === r ? name.slice(0, 40) : n)) });
  // An empty room can go; the rooms after it move up, and "Room 3" becomes "Room 2".
  const dropRoom = (r: number) =>
    onChange({
      rooms: take.rooms.filter((_, i) => i !== r).map((n, i) => (isDefault(n) ? defaultRoom(i) : n)),
      photos: take.photos.map((p) => (p.room > r ? { ...p, room: p.room - 1 } : p)),
    });

  return (
    <div className="photo-picker">
      <button className="link-quiet photo-back" onClick={onBack}>
        <span aria-hidden>←</span> Address and who it's for
      </button>
      <h2 id="sheet-title">Your photos</h2>
      <p className="sheet-lede">One from each corner of each room, plus the windows, the stairs and the furnace. 5 to 20 photos.</p>
      {note && <p className="photo-note" role="status">{note}</p>}
      {take.rooms.map((name, r) => {
        const mine = take.photos.filter((p) => p.room === r);
        const short = MIN_PHOTOS_3D - mine.length;
        return (
          <section className="photo-room" key={r} aria-label={name || defaultRoom(r)}>
            <header className="photo-room-head">
              <input
                className="photo-room-name"
                value={name}
                placeholder={defaultRoom(r)}
                maxLength={40}
                aria-label={`Name of room ${r + 1}`}
                onChange={(e) => rename(r, e.target.value)}
                onBlur={(e) => !e.target.value.trim() && rename(r, defaultRoom(r))}
              />
              <span className="mono photo-room-count">
                {plural(mine.length, "photo")}
                {short > 0 && mine.length > 0 ? ` · ${short} more for its 3D` : ""}
              </span>
              {mine.length === 0 && take.rooms.length > 1 && (
                <button className="link-quiet photo-room-drop" onClick={() => dropRoom(r)}>
                  Remove room
                </button>
              )}
            </header>
            <ul className="photo-grid">
              {mine.map((p, i) => (
                <li key={p.id} className="photo-tile" data-state={p.state}>
                  {p.url ? <img src={p.url} alt={`Photo ${number.get(p.id)}`} /> : <span className="photo-raw mono">{p.state === "working" ? "" : p.file.name.split(".").pop()?.toUpperCase()}</span>}
                  <span className="photo-n mono" aria-hidden>{number.get(p.id)}</span>
                  <button className="photo-remove" aria-label={`Remove photo ${number.get(p.id)}`} onClick={() => onRemove(p)}>
                    <svg viewBox="0 0 24 24" aria-hidden><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
                  </button>
                  <div className="photo-tools">
                    <select className="photo-chip" value={r} aria-label={`Room for photo ${number.get(p.id)}`} onChange={(e) => setRoom(p, e.target.value)}>
                      {take.rooms.map((n, k) => (
                        <option key={k} value={k}>{n.trim() || defaultRoom(k)}</option>
                      ))}
                      {take.rooms.length < MAX_ROOMS && <option value="new">New room</option>}
                    </select>
                    <button className="photo-move" aria-label={`Move photo ${number.get(p.id)} earlier`} disabled={i === 0} onClick={() => move(p, -1)}>‹</button>
                    <button className="photo-move" aria-label={`Move photo ${number.get(p.id)} later`} disabled={i === mine.length - 1} onClick={() => move(p, 1)}>›</button>
                  </div>
                </li>
              ))}
              {!full && (
                <li>
                  <button className="photo-add" onClick={() => onAdd(r)}>
                    <span aria-hidden>+</span> Add photos
                  </button>
                </li>
              )}
            </ul>
          </section>
        );
      })}
      {!full && take.rooms.length < MAX_ROOMS && (
        <button className="btn btn-ghost photo-another" onClick={() => onAdd(take.rooms.length)}>
          <span aria-hidden>+</span> Another room
        </button>
      )}
    </div>
  );
}
