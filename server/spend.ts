// What each paid call costs, and a hook that hears about every one: server/meta.ts reports each model
// call, the pipeline reports its 3D areas. The API and the worker plug in the database ledger
// (server/limits.ts), so the live site's daily cap counts all of it; scripts spend without one.
export const PRICES = {
  samImage: 2.5 / 1000, // per image
  samVideoFrame: 0.2 / 1000, // per frame, 50-frame minimum per request
  samVideoMinFrames: 50,
  sparkIn: 1.25 / 1e6, // per token
  sparkOut: 4.25 / 1e6,
  // Muse Wonder (preview): text, pictures, video and sound in, by the token like Spark.
  wonderIn: 4 / 1e6,
  wonderOut: 20 / 1e6,
  museImage: 0.01, // per image
  // Estimates: transcription by the minute of audio, and one area of 3D on Modal's L40S (about 20 s of
  // work plus its share of start-up and idle). The Mac runner costs nothing.
  transcribeMinute: 0.006,
  scan3dArea: () => Number(process.env.SCAN3D_USD_PER_AREA ?? (/modal\.run/.test(process.env.SCAN3D_URL ?? "") ? 0.03 : 0)),
};

type Hook = (kind: string, usd: number) => void;
let hook: Hook = () => {};

export function onSpend(fn: Hook) {
  hook = fn;
}

export function charge(kind: string, usd: number) {
  if (!(usd > 0)) return;
  try {
    hook(kind, usd);
  } catch {
    // The ledger never fails a call that already happened.
  }
}
