// Fabric colours a piece can take, named so the photo prompt can say them. The mood board (session 2)
// can pass its own.
export const FABRICS: { name: string; hex: string }[] = [
  { name: "oat", hex: "#D9CFBF" },
  { name: "stone grey", hex: "#B4B9AB" },
  { name: "sage", hex: "#8EA38C" },
  { name: "forest green", hex: "#2F4A3A" },
  { name: "charcoal", hex: "#4A4F4C" },
  { name: "ink blue", hex: "#34405A" },
];
export const colourHex = (c: string | undefined) => (c ? (FABRICS.find((f) => f.name === c)?.hex ?? (/^#[0-9a-f]{6}$/i.test(c) ? c : null)) : null);
