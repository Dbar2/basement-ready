// A picture that loads in place: the real frame, blurred, already in the picture's shape, sharpening
// into the restyled one the moment it arrives. No spinner, no jump.
import { useLayoutEffect, useRef, useState } from "react";

export function Picture({ from, src, aspect, alt, className = "" }: { from: string; src?: string | null; aspect: number; alt: string; className?: string }) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const img = useRef<HTMLImageElement>(null);
  // A cached picture can finish before React listens for it.
  useLayoutEffect(() => {
    if (src && img.current?.complete && img.current.naturalWidth) setLoaded(src);
  }, [src]);
  const ready = Boolean(src) && loaded === src;
  return (
    <div className={`pic ${className}`} style={{ aspectRatio: String(aspect || 16 / 9) }} data-ready={ready || undefined}>
      <img className="pic-from" src={from} alt={ready ? "" : alt} aria-hidden={ready || undefined} draggable={false} decoding="async" />
      {src && <img ref={img} className="pic-to" src={src} alt={ready ? alt : ""} draggable={false} decoding="async" onLoad={() => setLoaded(src)} />}
    </div>
  );
}
