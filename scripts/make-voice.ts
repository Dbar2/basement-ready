// Makes the guide's voice clips from the lines in src/capture/script.ts, into public/voice/<line>.mp3.
// Needs OPENAI_API_KEY or ELEVENLABS_API_KEY in .env. About 1,100 characters in all: cents.
// Usage: pnpm tsx --env-file=.env scripts/make-voice.ts [--force]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { LINES } from "../src/capture/script";

const force = process.argv.includes("--force");
const out = "public/voice";
mkdirSync(out, { recursive: true });

// A warm, calm voice. ElevenLabs "Rachel" or OpenAI "nova" by default; override with VOICE_ID / OPENAI_VOICE.
async function speak(text: string): Promise<Buffer> {
  if (process.env.ELEVENLABS_API_KEY) {
    const voice = process.env.VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (process.env.OPENAI_API_KEY) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: process.env.OPENAI_VOICE ?? "nova",
        input: text,
        instructions: "Warm, calm and clear, like a friendly contractor walking someone through their basement. Unhurried.",
        response_format: "mp3",
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error("Set OPENAI_API_KEY or ELEVENLABS_API_KEY in .env");
}

for (const [id, text] of Object.entries(LINES)) {
  const file = `${out}/${id}.mp3`;
  if (existsSync(file) && !force) continue;
  writeFileSync(file, await speak(text));
  console.log(`${id}: ${text}`);
}
console.log(`Clips in ${out}/`);
