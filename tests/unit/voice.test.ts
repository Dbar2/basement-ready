import { describe, expect, it } from "vitest";
import type { LineId } from "../../src/capture/script";
import { DIRECTION_MS, GAP_MS, NAG_REPEAT_MS, REPEAT_MS, TALK_MS, TalkMeter, VoiceQueue } from "../../src/capture/voice";

// Plays lines to the end (each takes `lineMs`), asking for lines on the way as `asks` says.
function run(q: VoiceQueue, asks: [number, LineId][], to: number, lineMs = 3000) {
  const said: { id: string; at: number }[] = [];
  let endsAt = -1;
  for (let t = 0; t <= to; t += 50) {
    for (const [at, id] of asks) if (at === t) q.request(id, t);
    if (q.playing && t >= endsAt) q.ended(t);
    const id = q.next(t);
    if (id) {
      said.push({ id, at: t });
      endsAt = t + lineMs;
    }
  }
  return said;
}

describe("the guide's voice queue", () => {
  it("leaves a gap of at least 6.5 s between any two lines, however many want to play", () => {
    const q = new VoiceQueue();
    // Everything at once, the way a busy first minute goes.
    const asks: [number, LineId][] = [
      [0, "intro"],
      [1000, "stairs_done"],
      [1500, "walls"],
      [2000, "too_dark"],
      [9000, "turn_left"],
      [11_000, "turn_right"],
      [12_000, "walls_done"],
      [12_050, "ceiling"],
      [13_000, "slow_down"],
      [20_000, "ceiling_done"],
      [20_050, "floor"],
      [21_000, "tilt_down"],
    ];
    const said = run(q, asks, 60_000, 3000);
    expect(said.length).toBeGreaterThan(3);
    for (let i = 1; i < said.length; i++) expect(said[i].at - (said[i - 1].at + 3000)).toBeGreaterThanOrEqual(GAP_MS);
    // Tasks are never lost, and nothing nags on top of them.
    expect(said.map((s) => s.id)).toEqual(expect.arrayContaining(["intro", "walls", "ceiling", "floor"]));
  });

  it("says a new task before praise, and praise before a nag", () => {
    const q = new VoiceQueue();
    q.request("slow_down", 0);
    q.request("walls_done", 0);
    q.request("ceiling", 0);
    expect(q.next(10)).toBe("ceiling");
  });

  it("drops praise and nags that waited behind a task", () => {
    const q = new VoiceQueue();
    q.request("walls", 0);
    expect(q.next(0)).toBe("walls");
    q.request("walls_done", 500);
    q.request("ceiling", 600);
    q.ended(3000);
    expect(q.next(3000 + GAP_MS)).toBe("ceiling");
    q.ended(12_000);
    expect(q.next(12_000 + GAP_MS)).toBeNull();
  });

  it("doesn't start anything while a line plays or during the gap", () => {
    const q = new VoiceQueue();
    q.request("intro", 0);
    expect(q.next(0)).toBe("intro");
    q.request("walls", 1000);
    expect(q.next(1000)).toBeNull();
    q.ended(4000);
    expect(q.next(4000 + GAP_MS - 1)).toBeNull();
    expect(q.next(4000 + GAP_MS)).toBe("walls");
  });

  it("gives every turn and tilt line one shared allowance", () => {
    const q = new VoiceQueue();
    q.request("turn_left", 0);
    expect(q.next(0)).toBe("turn_left");
    q.ended(2000);
    // Compass jitter flips the hint: right, then around, then up, all inside the allowance.
    expect(q.request("turn_right", 9000)).toBe(false);
    expect(q.request("turn_around", 10_000)).toBe(false);
    expect(q.request("tilt_up", DIRECTION_MS - 1)).toBe(false);
    expect(q.request("tilt_up", DIRECTION_MS)).toBe(true);
    expect(q.next(DIRECTION_MS)).toBe("tilt_up");
  });

  it("only keeps the newest direction waiting, and drops it once stale", () => {
    const q = new VoiceQueue();
    q.request("intro", 0);
    q.next(0);
    q.request("turn_left", 1000);
    q.request("turn_right", 1500);
    q.ended(4000);
    // 4 s + gap is long past a 3 s-old direction.
    expect(q.next(4000 + GAP_MS)).toBeNull();
    q.request("turn_right", 20_000);
    expect(q.next(20_000)).toBe("turn_right");
  });

  it("repeats the same line no sooner than 30 s, nags 45 s, unless the task really changed back", () => {
    const q = new VoiceQueue();
    q.request("window_found", 0);
    expect(q.next(0)).toBe("window_found");
    q.ended(1000);
    expect(q.request("window_found", REPEAT_MS - 1)).toBe(false);
    expect(q.request("window_found", REPEAT_MS)).toBe(true);

    q.reset();
    q.request("too_dark", 0);
    q.next(0);
    q.ended(2000);
    expect(q.request("too_dark", REPEAT_MS + 5000)).toBe(false);
    expect(q.request("too_dark", NAG_REPEAT_MS)).toBe(true);

    q.reset();
    q.request("walls", 0);
    q.next(0);
    q.ended(3000);
    expect(q.request("walls", 12_000)).toBe(false);
    expect(q.request("walls", 12_000, { again: true })).toBe(true);
    expect(q.next(12_000)).toBe("walls");
  });
});

describe("telling the homeowner's talk from the guide's echo", () => {
  const quiet = { speaking: false, lastEnd: -Infinity };

  it("needs about 1.5 s of steady talking, with short dips allowed", () => {
    const m = new TalkMeter();
    let heard = false;
    for (let t = 0; t <= TALK_MS + 100 && !heard; t += 100) heard = m.push(t !== 600 && t !== 700, t, quiet);
    expect(heard).toBe(true);
  });

  it("starts over after a real pause", () => {
    const m = new TalkMeter();
    for (let t = 0; t < 1000; t += 100) m.push(true, t, quiet);
    for (let t = 1000; t < 1600; t += 100) m.push(false, t, quiet);
    expect(m.push(true, 1600, quiet)).toBe(false);
    expect(m.push(true, 2400, quiet)).toBe(false);
  });

  it("ignores everything while the guide speaks and for half a second after", () => {
    const m = new TalkMeter();
    for (let t = 0; t <= 4000; t += 100) expect(m.push(true, t, { speaking: true, lastEnd: -Infinity })).toBe(false);
    for (let t = 4000; t < 4500; t += 100) expect(m.push(true, t, { speaking: false, lastEnd: 4000 })).toBe(false);
    // Counting starts only now, so it takes the full 1.5 s from here.
    expect(m.push(true, 4500, { speaking: false, lastEnd: 4000 })).toBe(false);
    expect(m.push(true, 5900, { speaking: false, lastEnd: 4000 })).toBe(false);
    expect(m.push(true, 6000, { speaking: false, lastEnd: 4000 })).toBe(true);
  });
});
