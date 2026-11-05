// Mirrors brand/tokens.css (the only place the app defines colours). Change both together.
export const C = {
  bg: "#F4F6F2", // the sheet
  card: "#FBFCFA", // paper inside a drawing frame
  surface: "#E6EBE4", // the 3D viewer, quiet fills
  border: "#D5DDD4", // hairlines
  ink: "#0F2A1E", // forest: text, frames, structure lines
  muted: "#4A5D52",
  mint: "#4BE38A", // fill only: the one button, selected things, scan points
  mintPress: "#3FCF7B",
  mintLine: "#2E9A5C", // mint-family lines on light
  accent: "#1F7A4A",
  ok: "#1F7A4A",
  fix: "#8C6A00",
  stop: "#B42318",
};

// SAM finds: outlines in video and highlights in 3D
export const FIND: Record<string, string> = {
  window: "#2F6FDB",
  exit: "#0F8B8D",
  stairs: "#B58A00",
  duct: "#6B7A86",
  beam: "#8A5A3C",
  mechanical: "#C2417A",
};
