// A question said aloud to the guide: the clip the browser recorded goes to the owner-only voice route,
// is converted to wav with ffmpeg and heard by Muse Voice Transcribe (stubbed here), and the words come
// back for the ask box. Never the browser's own recognizer.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const heardFrom: { path: string; riff: string; dir: string }[] = [];
vi.mock("../../server/meta", async (orig) => {
  const real = await orig<typeof import("../../server/meta")>();
  return {
    ...real,
    responses: vi.fn(() => {
      throw new Error("The voice route called a chat model");
    }),
    transcribe: vi.fn(async (wav: string) => {
      heardFrom.push({ path: wav, riff: readFileSync(wav).subarray(0, 4).toString(), dir: dirname(wav) });
      return { transcript: "  can I   rent it\n out? ", turns: [] };
    }),
  };
});

const { db, migrateDb, schema } = await import("../../server/db");
const { mountScanGate } = await import("../../server/privacy");
const { mountGuide } = await import("../../server/guide/routes");
const { VOICE_MAX_BYTES } = await import("../../server/guide/voice");
const { transcribe } = await import("../../server/meta");

const app = new Hono();
mountScanGate(app, async () => null);
mountGuide(app, async () => null);

// A second of tone, the way each browser records it.
const work = mkdtempSync(join(tmpdir(), "br-voice-test-"));
const clip = (name: string, codec: string) => {
  const out = join(work, name);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", codec, out]);
  return new Uint8Array(readFileSync(out));
};

let key: string | undefined;
beforeAll(() => {
  key = process.env.MODEL_API_KEY;
  process.env.MODEL_API_KEY = "test-key";
});
afterAll(() => {
  process.env.MODEL_API_KEY = key;
});

async function scan() {
  await migrateDb();
  const claimToken = `claim-voice-${Math.random().toString(36).slice(2)}`;
  const [b] = await db.insert(schema.basements).values({ claimToken, household: "relative", municipality: "waterloo-on" }).returning();
  const [s] = await db.insert(schema.scans).values({ basementId: b.id, status: "done", result: null }).returning();
  return { id: s.id, claims: encodeURIComponent(JSON.stringify([{ basementId: b.id, claimToken }])) };
}

const say = (id: string, body: Uint8Array, claims?: string, type = "audio/webm") =>
  app.request(`/api/scans/${id}/guide/voice`, { method: "POST", headers: { "content-type": type, ...(claims ? { "x-claims": claims } : {}) }, body });

describe("the guide's mic", () => {
  it("hears the owner's question, from Chrome's webm and Safari's mp4, through wav, and keeps nothing", async () => {
    const { id, claims } = await scan();
    for (const [body, type] of [
      [clip("q.webm", "libopus"), "audio/webm;codecs=opus"],
      [clip("q.m4a", "aac"), "audio/mp4"],
    ] as const) {
      const res = await say(id, body, claims, type);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ text: "can I rent it out?" });
    }
    expect(transcribe).toHaveBeenCalledTimes(2);
    // Muse Voice got a wav, and the temporary folder was gone once the words came back.
    for (const h of heardFrom) {
      expect(h.riff).toBe("RIFF");
      expect(existsSync(h.dir)).toBe(false);
    }
  });

  it("is the owner's only: anyone else gets the scan gate's 404, and the example doesn't listen", async () => {
    const { id } = await scan();
    const body = clip("s.m4a", "aac");
    expect((await say(id, body)).status).toBe(404);
    expect((await say(id, body, encodeURIComponent(JSON.stringify([])))).status).toBe(404);
    expect((await say("sample", body)).status).toBe(404);
  });

  it("refuses a clip that's too long, or empty, before anything is heard", async () => {
    const { id, claims } = await scan();
    const calls = vi.mocked(transcribe).mock.calls.length;
    expect((await say(id, new Uint8Array(VOICE_MAX_BYTES + 1), claims)).status).toBe(413);
    expect((await say(id, new Uint8Array(0), claims)).status).toBe(400);
    // Streamed with no length given: stopped at the cap as it comes in.
    const chunk = new Uint8Array(256 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctl) {
        if (sent > VOICE_MAX_BYTES * 2) return ctl.close();
        sent += chunk.byteLength;
        ctl.enqueue(chunk);
      },
    });
    const streamed = await app.request(`/api/scans/${id}/guide/voice`, { method: "POST", headers: { "content-type": "audio/webm", "x-claims": claims }, body: stream, duplex: "half" } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(vi.mocked(transcribe).mock.calls.length).toBe(calls);
  });

  it("needs the AI key, as a typed question does", async () => {
    const { id, claims } = await scan();
    process.env.MODEL_API_KEY = "";
    try {
      expect((await say(id, clip("k.m4a", "aac"), claims)).status).toBe(503);
    } finally {
      process.env.MODEL_API_KEY = "test-key";
    }
  });
});

describe("no speech recognizer in the browser", () => {
  it("nothing in src/ uses the browser's SpeechRecognition (it sends audio to Google or Apple)", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(f) ? [p] : [];
      });
    const using = files("src").filter((f) => /SpeechRecognition|webkitSpeech/.test(readFileSync(f, "utf8")));
    expect(using).toEqual([]);
  });
});
