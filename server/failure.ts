// Why a scan failed, in plain words, from the error it threw. The scan keeps it as "cause: detail", so
// the wait screen says what happened and whether trying again can help. The video is always kept, so
// "Try again" re-runs it without filming again.
export type Cause = "no_key" | "key" | "busy" | "service" | "video" | "timeout" | "unknown";

export const FAILURE: Record<Cause, { text: string; retry: boolean }> = {
  no_key: { text: "This server has no Meta key, so our AI service can't read videos. Your video is saved.", retry: false },
  key: { text: "Our AI service turned down this server's key. Your video is saved.", retry: false },
  busy: { text: "Our AI service is busy right now. Your video is saved: try again in a few minutes.", retry: true },
  service: { text: "Our AI service didn't answer. Your video is saved: try again in a minute.", retry: true },
  video: { text: "We couldn't read this video file. Film again, or upload an MP4 or MOV.", retry: false },
  timeout: { text: "This took far longer than it should. Your video is saved: try again.", retry: true },
  unknown: { text: "Something went wrong reading your video. It's saved, so you can try again.", retry: true },
};

export function causeOf(err: unknown): Cause {
  const m = err instanceof Error ? err.message : String(err);
  if (/MODEL_API_KEY is not set/.test(m)) return "no_key";
  if (/\b(Meta API|Upload|Transcribe|Muse Image) 40[13]\b/.test(m)) return "key";
  if (/\b429\b|rate limit/i.test(m)) return "busy";
  if (/ffmpeg|Invalid data found|moov atom|no frames/i.test(m)) return "video";
  if (/\b(Meta API|Upload|Transcribe|Muse Image) 5\d\d\b|fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|aborted|timed? ?out/i.test(m)) return "service";
  return "unknown";
}

export const stored = (cause: Cause, err: unknown) => `${cause}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 2000);

// The saved error back to its cause; errors from before causes were kept read as unknown.
export function failureOf(error: string | null): { cause: Cause; text: string; retry: boolean } {
  const cause = (/^([a-z_]+):/.exec(error ?? "")?.[1] ?? "unknown") as Cause;
  const known = cause in FAILURE ? cause : "unknown";
  return { cause: known, ...FAILURE[known] };
}
