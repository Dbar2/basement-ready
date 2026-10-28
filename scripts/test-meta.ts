// Day-1 smoke test: one call to each Meta model we plan to use.
// Run with `pnpm test:meta` after putting MODEL_API_KEY in .env.
// Costs a few cents. Outputs land in tmp/ (git-ignored).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const BASE = "https://api.meta.ai/v1";
const KEY = process.env.MODEL_API_KEY;
const OUT = "tmp/test-meta";
mkdirSync(OUT, { recursive: true });

if (!KEY) {
  console.error("MODEL_API_KEY is empty. Paste your key into .env and run again.");
  process.exit(1);
}

const auth = { Authorization: `Bearer ${KEY}` };
const results: { name: string; ok: boolean; ms: number; note: string }[] = [];

async function step(name: string, fn: () => Promise<string>) {
  const t = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: Date.now() - t, note });
    console.log(`PASS  ${name} (${Date.now() - t} ms)  ${note}`);
  } catch (err) {
    const note = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, ms: Date.now() - t, note });
    console.log(`FAIL  ${name} (${Date.now() - t} ms)  ${note}`);
  }
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

// Pulls the text out of a Responses API result.
function outputText(resp: any): string {
  if (typeof resp.output_text === "string") return resp.output_text;
  return (resp.output ?? [])
    .filter((o: any) => o.type === "message")
    .flatMap((o: any) => o.content ?? [])
    .filter((c: any) => c.type === "output_text")
    .map((c: any) => c.text)
    .join("");
}

const dataUrl = (path: string, mime: string) =>
  `data:${mime};base64,${readFileSync(path).toString("base64")}`;

const imagePath = `${OUT}/basement.webp`;
const videoPath = `${OUT}/basement.mp4`;
const wavPath = `${OUT}/voice.wav`;

await step("Muse Spark 1.3 (text)", async () => {
  const r = await post("/responses", {
    model: "muse-spark-1.3",
    input: "Reply with exactly: basement ready",
  });
  return JSON.stringify(outputText(r).trim());
});

await step("Muse Image 1.0 (generate test basement)", async () => {
  const r = await post("/responses", {
    model: "muse-image-1.0",
    input:
      "Realistic phone photo of an unfinished Ontario basement: concrete floor, exposed joists, " +
      "a low rectangular metal duct across the ceiling, one small basement window high on the wall, " +
      "wooden stairs on the left, a furnace in the corner. Dim, natural lighting.",
  });
  const img = (r.output ?? []).find((o: any) => o.type === "image_generation_call");
  if (!img?.result) throw new Error("no image in response");
  writeFileSync(imagePath, Buffer.from(img.result, "base64"));
  return imagePath;
});

await step("SAM 3.1 (image, 'window')", async () => {
  if (!existsSync(imagePath)) throw new Error("needs the Muse Image test image");
  const r = await post("/responses", {
    model: "sam-3.1",
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "window" },
          { type: "input_image", image_url: dataUrl(imagePath, "image/webp") },
        ],
      },
    ],
    metadata: { include_confidence: "true", mask_encoding: "one_bit" },
  });
  const text = outputText(r);
  writeFileSync(`${OUT}/sam-image.txt`, text);
  const boxes = (text.match(/<\|box;/g) ?? []).length;
  return `${boxes} window box(es); raw output in ${OUT}/sam-image.txt`;
});

await step("SAM 3.1 (video tracking, 'duct')", async () => {
  if (!existsSync(imagePath)) throw new Error("needs the Muse Image test image");
  // A slow push-in over the still image stands in for a phone video.
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-loop", "1", "-i", imagePath,
    "-vf", "scale=1280:-2,zoompan=z='min(zoom+0.002,1.2)':d=60:s=1280x720:fps=20",
    "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath,
  ]);
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("file", new Blob([readFileSync(videoPath)], { type: "video/mp4" }), "basement.mp4");
  const up = await fetch(`${BASE}/files`, { method: "POST", headers: auth, body: form });
  const upText = await up.text();
  if (!up.ok) throw new Error(`upload ${up.status} ${upText.slice(0, 300)}`);
  const fileId = JSON.parse(upText).id;
  const r = await post("/responses", {
    model: "sam-3.1",
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "duct" },
          { type: "input_video", file_id: fileId },
        ],
      },
    ],
    metadata: { mask_encoding: "one_bit" },
  });
  const text = outputText(r);
  writeFileSync(`${OUT}/sam-video.txt`, text);
  const frames = new Set(text.match(/<\d+f>/g) ?? []).size;
  return `masks on ${frames} frame(s); raw output in ${OUT}/sam-video.txt`;
});

await step("Muse Spark 1.3 (vision on the basement photo)", async () => {
  if (!existsSync(imagePath)) throw new Error("needs the Muse Image test image");
  const r = await post("/responses", {
    model: "muse-spark-1.3",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "List what you can see that matters for turning this basement into a legal second unit. One line each.",
          },
          { type: "input_image", image_url: dataUrl(imagePath, "image/webp") },
        ],
      },
    ],
  });
  const text = outputText(r).trim();
  writeFileSync(`${OUT}/spark-vision.txt`, text);
  return text.split("\n").slice(0, 3).join(" | ");
});

await step("Muse Spark 1.3 (video input)", async () => {
  if (!existsSync(videoPath)) throw new Error("needs the test video");
  const r = await post("/responses", {
    model: "muse-spark-1.3",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "In one sentence, what room is this and what is on the ceiling?" },
          { type: "input_video", video_url: dataUrl(videoPath, "video/mp4") },
        ],
      },
    ],
  });
  return JSON.stringify(outputText(r).trim().slice(0, 160));
});

await step("Muse Voice Transcribe 1.0", async () => {
  const aiff = `${OUT}/voice.aiff`;
  execFileSync("say", ["-o", aiff, "This is where I'd want the kitchen. My mom would sleep in this room."]);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-i", aiff, "-ac", "1", "-ar", "16000",
    "-c:a", "pcm_s16le", "-map_metadata", "-1", wavPath,
  ]);
  const form = new FormData();
  form.append(
    "request",
    new Blob([JSON.stringify({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: "ENDPOINTING" })], {
      type: "application/json",
    }),
  );
  form.append("audio", new Blob([readFileSync(wavPath)], { type: "audio/wav" }), "voice.wav");
  const res = await fetch(`${BASE}/asr/transcribe`, { method: "POST", headers: auth, body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return JSON.stringify(JSON.parse(text).transcript);
});

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed. Details in ${OUT}/`);
