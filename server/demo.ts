// The demo house, for anyone outside Ontario: the City of Waterloo's rules for a house that isn't real,
// with no address. The camera, the finds and the 3D work anywhere; only the rules need Ontario. Its
// result carries `demo: true`, so every page and paper it shows on says so, and nothing it makes is sent.
export const DEMO_MUNICIPALITY = "waterloo-on";

export const isDemo = (v: unknown) => v === true || v === "true" || v === "1";

export function labelled<T extends object | null>(result: T, demo: boolean): T {
  return demo && result ? { ...result, demo: true } : result;
}
