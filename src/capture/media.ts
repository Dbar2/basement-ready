// Camera, recorder and sensor helpers for the capture flow. No React here.

// Safari records MP4 (H.264 + AAC). Chrome records MP4 since v126 and WebM before that.
// The server transcodes with ffmpeg either way, so the order only picks the friendliest file.
const RECORDER_TYPES = [
  'video/mp4;codecs="avc1.640028,mp4a.40.2"',
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  "video/mp4;codecs=avc1",
  "video/mp4",
  'video/webm;codecs="vp9,opus"',
  'video/webm;codecs="vp8,opus"',
  "video/webm",
];

export function pickRecorderType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

export const baseType = (mime: string) => mime.split(";")[0].trim();
export const extensionFor = (mime: string) => (baseType(mime) === "video/mp4" ? "mp4" : "webm");
export const formatLabel = (mime: string) => (baseType(mime) === "video/mp4" ? "MP4" : baseType(mime) === "video/webm" ? "WebM" : "Video");

export const canRecord = () =>
  typeof window !== "undefined" &&
  typeof MediaRecorder !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia);

// 60 fps where the phone allows it: each frame is exposed for less time, so walking blurs it less.
// The server still samples a few frames a second; what 60 buys is sharper ones to pick from.
const VIDEO: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  frameRate: { ideal: 60 },
};

// "ultrawide" is the 0.5x lens: a basement's walls, ceiling and floor fit in far fewer frames.
export type Lens = "ultrawide" | "wide";
export type Camera = { stream: MediaStream; hasAudio: boolean; lens: Lens };

// Keep focus, exposure and white balance adjusting as you walk through the basement, where the browser
// allows it (Chrome on Android). Safari manages this itself and ignores the request.
async function tuneTrack(track: MediaStreamTrack | undefined) {
  if (!track || typeof track.getCapabilities !== "function") return;
  const caps = track.getCapabilities() as Record<string, unknown>;
  const modes = ["focusMode", "exposureMode", "whiteBalanceMode"]
    .filter((k) => Array.isArray(caps[k]) && (caps[k] as string[]).includes("continuous"))
    .map((k) => ({ [k]: "continuous" }));
  if (modes.length) await track.applyConstraints({ advanced: modes as unknown as MediaTrackConstraintSet[] }).catch(() => {});
}

const ULTRA_WIDE = /ultra ?wide/i;

// Swap to the 0.5x lens once permission is granted (device labels are only readable then).
//  - iPhone: a separate "Back Ultra Wide Camera" device, reopened by its id at the same 1080p / 60 fps;
//  - some Android phones: one camera whose zoom goes below 1.
// Anything that fails leaves the normal lens running. No new permission prompt: the camera is already allowed.
async function widest(stream: MediaStream): Promise<{ stream: MediaStream; lens: Lens; label: string }> {
  const track = stream.getVideoTracks()[0];
  if (!track) return { stream, lens: "wide", label: "" };
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
  const ultra = devices.find((d) => d.kind === "videoinput" && ULTRA_WIDE.test(d.label));
  if (ultra && track.getSettings().deviceId !== ultra.deviceId) {
    // A phone runs one camera at a time: let go of this one first, and keep the mic as it is.
    track.stop();
    const audio = stream.getAudioTracks();
    const reopen = (video: MediaTrackConstraints) =>
      navigator.mediaDevices.getUserMedia({ video }).then((v) => new MediaStream([...v.getVideoTracks(), ...audio]));
    try {
      const exact = { width: VIDEO.width, height: VIDEO.height, frameRate: VIDEO.frameRate, deviceId: { exact: ultra.deviceId } };
      return { stream: await reopen(exact), lens: "ultrawide", label: ultra.label };
    } catch (err) {
      console.warn("[camera] the 0.5x lens wouldn't open, using the normal one", err);
      const back = await reopen(VIDEO);
      return { stream: back, lens: "wide", label: back.getVideoTracks()[0]?.label ?? "" };
    }
  }
  const zoom = (typeof track.getCapabilities === "function" ? (track.getCapabilities() as { zoom?: { min?: number } }).zoom : undefined) ?? undefined;
  if (zoom?.min != null && zoom.min < 1) {
    const ok = await track
      .applyConstraints({ advanced: [{ zoom: Math.max(zoom.min, 0.5) } as MediaTrackConstraintSet] })
      .then(() => true, () => false);
    if (ok) return { stream, lens: "ultrawide", label: `${track.label} at zoom ${Math.max(zoom.min, 0.5)}` };
  }
  return { stream, lens: "wide", label: track.label };
}

export async function openCamera(): Promise<Camera> {
  if (!navigator.mediaDevices?.getUserMedia) {
    if (!window.isSecureContext) console.warn("[capture] getUserMedia needs HTTPS (or localhost). Falling back to upload.");
    throw new CameraProblem("unsupported");
  }
  let first: MediaStream;
  let hasAudio = true;
  try {
    first = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: true });
  } catch (err) {
    // A laptop with no microphone still has a camera: film without sound rather than fail.
    if (!(err instanceof DOMException && err.name === "NotFoundError")) throw toProblem(err);
    first = await navigator.mediaDevices.getUserMedia({ video: VIDEO }).catch((e) => {
      throw toProblem(e);
    });
    hasAudio = false;
  }
  const { stream, lens, label } = await widest(first).catch((err) => {
    stopStream(first);
    throw toProblem(err);
  });
  await tuneTrack(stream.getVideoTracks()[0]);
  const got = stream.getVideoTracks()[0]?.getSettings();
  console.info(`[camera] ${lens === "ultrawide" ? "0.5x ultra-wide" : "1x wide"} lens (${label || "unnamed"}), ${got?.width}×${got?.height} at ${got?.frameRate} fps`);
  return { stream, hasAudio: hasAudio && stream.getAudioTracks().length > 0, lens };
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

export type ProblemKind = "denied" | "no-camera" | "busy" | "unsupported" | "interrupted" | "failed";

export class CameraProblem extends Error {
  kind: ProblemKind;
  constructor(kind: ProblemKind, detail?: string) {
    super(detail ?? kind);
    this.kind = kind;
  }
}

export function toProblem(err: unknown): CameraProblem {
  if (err instanceof CameraProblem) return err;
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return new CameraProblem("denied", message);
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return new CameraProblem("no-camera", message);
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return new CameraProblem("busy", message);
  if (name === "TypeError" || name === "NotSupportedError") return new CameraProblem("unsupported", message);
  return new CameraProblem("failed", message);
}

export type Platform = "ios-safari" | "ios-other" | "android" | "desktop";

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? "ios-other" : "ios-safari";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

// iOS asks separately for motion. Must be called straight from a tap, before any await.
type OrientationWithPermission = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<PermissionState> };

export function requestMotion(): Promise<boolean> {
  if (typeof DeviceOrientationEvent === "undefined") return Promise.resolve(false);
  const ask = (DeviceOrientationEvent as OrientationWithPermission).requestPermission;
  if (typeof ask !== "function" || !detectPlatform().startsWith("ios")) return Promise.resolve(true);
  return ask.call(DeviceOrientationEvent).then((s) => s === "granted", () => false);
}

// How far the rear camera points above the horizon, as the sine of that angle (1 = straight up).
// The rear camera looks along the device's -z axis; its world-up component is -cos(beta)·cos(gamma).
export function cameraLift(beta: number, gamma: number) {
  const r = Math.PI / 180;
  return -Math.cos(beta * r) * Math.cos(gamma * r);
}

// MediaRecorder WebM files have no duration until the browser scans them. Seeking far forces it.
export function settleDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration)) return Promise.resolve(video.duration);
  return new Promise((resolve) => {
    const done = () => {
      if (!Number.isFinite(video.duration)) return;
      video.removeEventListener("durationchange", done);
      video.removeEventListener("timeupdate", done);
      video.currentTime = 0;
      resolve(video.duration);
    };
    video.addEventListener("durationchange", done);
    video.addEventListener("timeupdate", done);
    video.currentTime = 1e7;
  });
}

// Duration of a picked file, or 0 when this browser can't read it (HEVC in Chrome, for example).
export function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const finish = (sec: number) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(Number.isFinite(sec) && sec > 0 ? sec : 0);
    };
    const timer = window.setTimeout(() => finish(0), 8000);
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => void settleDuration(video).then(finish);
    video.onerror = () => finish(0);
    video.src = url;
  });
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

export function formatTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileStamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
