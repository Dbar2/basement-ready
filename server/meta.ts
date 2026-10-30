// Thin client for Meta Model API. Every model call in the app goes through here: each one's cost is
// reported to server/spend.ts for the daily cap, and tests can record and replay it (server/replay.ts).
import { readFileSync, statSync } from "node:fs";
import { serviceFetch } from "./replay";
import { charge, PRICES } from "./spend";

// META_API_BASE points at the Canada relay in production (see services/meta-relay); direct otherwise.
const BASE = process.env.META_API_BASE ?? "https://api.meta.ai/v1";

function auth(): Record<string, string> {
  if (process.env.RELAY_TOKEN) return { "x-relay-token": process.env.RELAY_TOKEN };
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error("MODEL_API_KEY is not set");
  return { Authorization: `Bearer ${key}` };
}

// Every call to Meta goes out here, so tests can record and replay them (server/replay.ts).
const call = (route: string, init: RequestInit = {}) => serviceFetch("meta", BASE, route, init, auth);

export async function responses(body: unknown, signal?: AbortSignal): Promise<any> {
  const res = await call("/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Meta API ${res.status}: ${text.slice(0, 300)}`);
  const r = JSON.parse(text);
  // Spark and Wonder bill by the token; SAM by the frame, counted where it's called.
  const cost = tokenCost(String((body as { model?: string }).model), r.usage);
  if (cost) charge(cost.kind, cost.usd);
  return r;
}

// What a Spark or Wonder answer cost, from its token counts. Null for a model billed some other way.
export function tokenCost(model: string, usage: { input_tokens?: number; output_tokens?: number } | undefined) {
  const tokens = (inn: number, out: number) => (usage?.input_tokens ?? 0) * inn + (usage?.output_tokens ?? 0) * out;
  if (/spark/.test(model)) return { kind: "spark", usd: tokens(PRICES.sparkIn, PRICES.sparkOut) };
  if (/wonder/.test(model)) return { kind: "wonder", usd: tokens(PRICES.wonderIn, PRICES.wonderOut) };
  return null;
}

// Pulls the text out of a Responses API result.
export function outputText(resp: any): string {
  if (typeof resp.output_text === "string") return resp.output_text;
  return (resp.output ?? [])
    .filter((o: any) => o.type === "message")
    .flatMap((o: any) => o.content ?? [])
    .filter((c: any) => c.type === "output_text")
    .map((c: any) => c.text)
    .join("");
}

export async function uploadFile(path: string, mime: string, name: string): Promise<string> {
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("file", new Blob([readFileSync(path)], { type: mime }), name);
  const res = await call("/files", { method: "POST", body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`Upload ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).id;
}

// SAM 3.1 on a whole video for one concept ("basement window"). Returns raw special-token text.
// `frames` is the video's length in frames, for the cost.
export async function samVideo(concept: string, fileId: string, frames = 0): Promise<string> {
  const r = await responses({
    model: "sam-3.1",
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: concept },
          { type: "input_video", file_id: fileId },
        ],
      },
    ],
    metadata: { include_confidence: "true", mask_encoding: "one_bit" },
  });
  charge("sam_video", Math.max(PRICES.samVideoMinFrames, frames) * PRICES.samVideoFrame);
  return outputText(r);
}

// SAM 3.1 on a single image (a data URL) for one concept. Returns raw special-token text.
export async function samImage(concept: string, imageUrl: string): Promise<string> {
  const r = await responses({
    model: "sam-3.1",
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: concept },
          { type: "input_image", image_url: imageUrl },
        ],
      },
    ],
    metadata: { include_confidence: "true", mask_encoding: "one_bit" },
  });
  charge("sam_image", PRICES.samImage);
  return outputText(r);
}

export async function transcribe(wavPath: string): Promise<{ transcript: string; turns: { startMs: number; endMs: number; transcript: string }[] }> {
  const form = new FormData();
  form.append(
    "request",
    new Blob([JSON.stringify({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: "ENDPOINTING" })], {
      type: "application/json",
    }),
  );
  form.append("audio", new Blob([readFileSync(wavPath)], { type: "audio/wav" }), "voice.wav");
  const res = await call("/asr/transcribe", { method: "POST", body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`Transcribe ${res.status}: ${text.slice(0, 300)}`);
  // 16 kHz mono 16-bit WAV: 32,000 bytes a second.
  charge("transcribe", (statSync(wavPath).size / 32000 / 60) * PRICES.transcribeMinute);
  const json = JSON.parse(text);
  return { transcript: json.transcript ?? "", turns: json.turns ?? [] };
}

// Which models this key can reach from where the server runs. Logged at boot.
export async function listModels(): Promise<string[]> {
  const res = await call("/models");
  if (!res.ok) throw new Error(`models ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()).data ?? []).map((m: { id: string }) => m.id);
}

export const dataUrl = (path: string, mime: string) =>
  `data:${mime};base64,${readFileSync(path).toString("base64")}`;

// Muse Image: edit a photo by instruction (OpenAI-style images/edits). Returns the new image's bytes.
// $0.01 an image. `size` sets the aspect ratio only; the server picks the pixels (up to 1600 px).
export async function museEdit(image: Buffer, mime: string, prompt: string, size: string): Promise<Buffer> {
  const form = new FormData();
  form.append("model", "muse-image-1.0");
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", size);
  form.append("image", new Blob([new Uint8Array(image)], { type: mime }), mime === "image/png" ? "frame.png" : "frame.jpg");
  const res = await call("/images/edits", { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Muse Image ${res.status}: ${text.slice(0, 300)}`);
  charge("muse_image", PRICES.museImage);
  const b64 = JSON.parse(text).data?.[0]?.b64_json;
  if (!b64) throw new Error("Muse Image returned no image");
  return Buffer.from(b64, "base64");
}

