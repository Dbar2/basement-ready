// Thin client for Meta Model API. Every model call in the app goes through here.
import { readFileSync } from "node:fs";

// META_API_BASE points at the Canada relay in production (see services/meta-relay); direct otherwise.
const BASE = process.env.META_API_BASE ?? "https://api.meta.ai/v1";

function auth(): Record<string, string> {
  if (process.env.RELAY_TOKEN) return { "x-relay-token": process.env.RELAY_TOKEN };
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new Error("MODEL_API_KEY is not set");
  return { Authorization: `Bearer ${key}` };
}

export async function responses(body: unknown): Promise<any> {
  const res = await fetch(`${BASE}/responses`, {
    method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Meta API ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
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
  const res = await fetch(`${BASE}/files`, { method: "POST", headers: auth(), body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`Upload ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).id;
}

// SAM 3.1 on a whole video for one concept ("basement window"). Returns raw special-token text.
export async function samVideo(concept: string, fileId: string): Promise<string> {
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
  const res = await fetch(`${BASE}/asr/transcribe`, { method: "POST", headers: auth(), body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`Transcribe ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  return { transcript: json.transcript ?? "", turns: json.turns ?? [] };
}

// Which models this key can reach from where the server runs. Logged at boot.
export async function listModels(): Promise<string[]> {
  const res = await fetch(`${BASE}/models`, { headers: auth() });
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
  const res = await fetch(`${BASE}/images/edits`, { method: "POST", headers: auth(), body: form, signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Muse Image ${res.status}: ${text.slice(0, 300)}`);
  const b64 = JSON.parse(text).data?.[0]?.b64_json;
  if (!b64) throw new Error("Muse Image returned no image");
  return Buffer.from(b64, "base64");
}

