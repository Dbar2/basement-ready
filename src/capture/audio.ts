// One AudioContext for the whole capture: the guide's clips and the mic meter share it. Two contexts,
// or the phone's own speech voice, make iOS switch audio routes mid-take, which can pause the camera
// and mic for a moment. iOS also suspends ("interrupted") the context for a call or Siri; while the
// capture wants sound, it is resumed as soon as the phone allows.

type Ctx = AudioContext;
type WithWebkit = Window & { webkitAudioContext?: typeof AudioContext };

let ctx: Ctx | null = null;
let wanted = false;
let retry = 0;

function resume() {
  if (!ctx || !wanted || ctx.state === "running" || (ctx.state as string) === "closed") return;
  void ctx.resume().catch(() => {});
}

function watch(c: Ctx) {
  c.onstatechange = () => {
    if (c.state === "running") return;
    resume();
    // An interrupted context refuses to resume until the call or Siri is over: keep trying quietly.
    clearInterval(retry);
    retry = window.setInterval(() => {
      if (!wanted || c.state === "running") clearInterval(retry);
      else resume();
    }, 1000);
  };
  // Any tap is a gesture iOS accepts for a resume.
  window.addEventListener("pointerdown", resume, { passive: true });
  document.addEventListener("visibilitychange", () => !document.hidden && resume());
}

// The shared context, made on first use. Call it first from inside a tap: iOS only starts audio there.
export function audioContext(): Ctx | null {
  if (ctx) return ctx;
  const C = window.AudioContext ?? (window as WithWebkit).webkitAudioContext;
  if (!C) return null;
  try {
    ctx = new C();
  } catch {
    return null;
  }
  watch(ctx);
  return ctx;
}

// While on, a suspended or interrupted context gets resumed.
export function keepAudio(on: boolean) {
  wanted = on;
  if (on) {
    audioContext();
    resume();
  }
}

type WithSession = Navigator & { audioSession?: { type: string } };

// Safari 17+: mix our playback with the mic instead of ducking it. Call before getUserMedia.
export function prepareAudioSession() {
  const session = (navigator as WithSession).audioSession;
  if (!session) return;
  try {
    session.type = "play-and-record";
  } catch {
    // Older Safari: fine, the clips still play.
  }
}
