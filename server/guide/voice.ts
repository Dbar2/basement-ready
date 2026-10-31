// Their question said aloud: the clip the browser recorded (MediaRecorder: webm/opus in Chrome, mp4/aac in
// Safari) to 16 kHz mono wav with ffmpeg, then Muse Voice Transcribe (server/meta.ts). Never the browser's
// own recognizer, which sends the audio to Google or Apple. The words go back into the ask box for them
// to send or edit; nothing is kept.
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { transcribe } from "../meta";

const run = promisify(execFile);

// About 30 s of the bigger of the two formats, with room to spare.
export const VOICE_MAX_BYTES = 2 * 1024 * 1024;
export const VOICE_MAX_SECONDS = 30;

export async function heard(clip: Uint8Array): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "br-voice-"));
  try {
    const src = join(dir, "clip");
    const wav = join(dir, "voice.wav");
    await writeFile(src, clip);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-t", String(VOICE_MAX_SECONDS), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-map_metadata", "-1", wav]);
    const { transcript } = await transcribe(wav);
    return transcript.replace(/\s+/g, " ").trim().slice(0, 500);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
