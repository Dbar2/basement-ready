import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { CLIPS, clipId, LINE_KIND, LINES, type LineId } from "../../src/capture/script";
import { DIRECTION_MS, GAP_MS, NAG_REPEAT_MS, REPEAT_MS, Variants, VoiceQueue } from "../../src/capture/voice";

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

describe("reacting to what the camera sees, without crowding the tasks", () => {
  it("puts the clock and tasks first, then remarks about what's on camera, then nags, then encouragement", () => {
    const q = new VoiceQueue();
    q.request("encourage", 0);
    q.request("slow_down", 0);
    q.request("furnace_found", 0);
    q.request("time_minute", 0);
    expect(q.next(10)).toBe("time_minute");

    const r = new VoiceQueue();
    r.request("encourage", 0);
    r.request("turn_around", 0);
    r.request("plumbing_found", 0);
    expect(r.next(10)).toBe("plumbing_found");
    r.ended(2000);
    // Both waited out the gap: the direction and the cheer are stale by now.
    expect(r.next(2000 + GAP_MS)).toBeNull();

    const c = new VoiceQueue();
    c.request("encourage", 0);
    c.request("turn_around", 0);
    expect(c.next(10)).toBe("turn_around");
  });

  it("drops a remark about a find once the camera has moved on", () => {
    const q = new VoiceQueue();
    q.request("intro", 0);
    q.next(0);
    q.request("furnace_found", 1000);
    q.ended(4000);
    // 6 s after it was found is the most a remark waits.
    expect(q.next(4000 + GAP_MS)).toBeNull();
    q.request("heater_found", 20_000);
    expect(q.next(20_000)).toBe("heater_found");
  });

  it("counts the map's 'that side isn't filmed' lines against the same direction allowance", () => {
    const q = new VoiceQueue();
    q.request("turn_around", 0);
    expect(q.next(0)).toBe("turn_around");
    q.ended(2500);
    expect(q.request("turn_left", 10_000)).toBe(false);
    expect(q.request("turn_left", DIRECTION_MS)).toBe(true);
  });

  it("never says the clock and a remark back to back without the gap", () => {
    const asks: [number, LineId][] = [
      [0, "map_ready"],
      [500, "furnace_found"],
      [600, "time_half"],
      [700, "new_space"],
      [800, "encourage"],
    ];
    const said = run(new VoiceQueue(), asks, 40_000, 2500);
    for (let i = 1; i < said.length; i++) expect(said[i].at - (said[i - 1].at + 2500)).toBeGreaterThanOrEqual(GAP_MS);
  });
});

describe("two or three ways of saying a line", () => {
  it("takes turns through the variants, starting from the first each take", () => {
    const v = new Variants();
    const n = LINES.furnace_found.length;
    expect(n).toBeGreaterThanOrEqual(2);
    const picks = Array.from({ length: n + 1 }, () => v.pick("furnace_found"));
    expect(picks.slice(0, n)).toEqual(Array.from({ length: n }, (_, i) => i));
    expect(picks[n]).toBe(0);
    expect(v.pick("intro")).toBe(0);
    expect(v.pick("intro")).toBe(0);
    v.reset();
    expect(v.pick("furnace_found")).toBe(0);
  });

  it("names a clip for every variant, and every clip exists in public/voice", () => {
    for (const id of Object.keys(LINES) as LineId[]) {
      LINES[id].forEach((text, i) => expect(CLIPS[clipId(id, i)]).toBe(text));
    }
    const missing = Object.keys(CLIPS).filter((c) => !existsSync(`public/voice/${c}.mp3`));
    expect(missing).toEqual([]);
  });

  it("keeps lines short, and reactions come in two or three versions", () => {
    for (const [id, variants] of Object.entries(LINES) as [LineId, readonly string[]][]) {
      // Tasks may run a little longer; everything said in passing stays under 15 words.
      for (const text of variants) expect(text.split(/\s+/).length).toBeLessThanOrEqual(LINE_KIND[id] === "task" ? 17 : 14);
      if (LINE_KIND[id] === "react" || LINE_KIND[id] === "cheer" || LINE_KIND[id] === "time") expect(variants.length).toBeGreaterThanOrEqual(2);
      expect(variants.length).toBeLessThanOrEqual(3);
    }
  });
});
