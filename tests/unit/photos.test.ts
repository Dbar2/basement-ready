import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { jpegSize, pickFrames, renderPicks, type PhotoWork } from "../../server/concepts";
import { db, migrateDb, schema } from "../../server/db";
import { claimNext, enqueue, startWorker } from "../../server/jobs";
import { enqueuePhotos, photoInputs, photosSoFar, runPhotos, settlePhotos } from "../../server/photos";
import { photoSpaces } from "../../server/plans";

beforeAll(async () => {
  await migrateDb();
});

// The smallest JPEG header that says its size: SOI, then a baseline frame header of w x h.
const fakeJpeg = (w: number, h: number) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Muse Image and SAM, faked: each call takes a while; the log shows when each started and finished.
function fakeWork(opts: { editMs: (frame: number) => number; boxes?: (concept: string, call: number) => { x: number; y: number; w: number; h: number }[]; fail?: (frame: number) => boolean }) {
  let running = 0;
  const log = { maxRunning: 0, edits: 0, landed: [] as number[], saved: [] as number[], samRunning: 0, maxSam: 0 };
  let samCalls = 0;
  const frameOf = new Map<Buffer, number>();
  const work = (landed: PhotoWork["landed"]): PhotoWork => ({
    frame: async (n) => {
      const b = fakeJpeg(1280, 720);
      frameOf.set(b, n);
      return b;
    },
    edit: async (frame) => {
      const n = frameOf.get(frame)!;
      log.edits++;
      running++;
      log.maxRunning = Math.max(log.maxRunning, running);
      await sleep(opts.editMs(n));
      running--;
      if (opts.fail?.(n)) throw new Error("Muse Image 500");
      return Buffer.from(`edited ${n}`);
    },
    resize: async (img) => img,
    boxes: async (_jpeg, concept) => {
      log.samRunning++;
      log.maxSam = Math.max(log.maxSam, log.samRunning);
      await sleep(10);
      log.samRunning--;
      return opts.boxes?.(concept, samCalls++) ?? [{ x: 0.1, y: 0.2, w: 0.2, h: 0.1 }];
    },
    save: async (n) => void log.saved.push(n),
    landed: async (c) => {
      log.landed.push(c.n);
      await landed(c);
    },
  });
  return { work, log };
}

const pick = (frame: number, title = `Photo ${frame}`) => ({ frame, title, space: "bedroom" });
const window = { kind: "window", box: { x: 0.1, y: 0.2, w: 0.2, h: 0.1 } };

describe("photos: all at once, each announced as it lands", () => {
  it("reads a frame's size from its JPEG header", () => {
    expect(jpegSize(fakeJpeg(1280, 720))).toEqual([1280, 720]);
  });

  it("renders every pick in parallel and announces each the moment it's done", async () => {
    // Rooms with no window or stairs, and none added.
    const { work, log } = fakeWork({ editMs: (f) => (f === 100 ? 120 : f === 200 ? 30 : 70), boxes: () => [] });
    const started = Date.now();
    const out = await renderPicks([pick(100), pick(200), pick(300), pick(400)], () => [], () => "prompt", work(async () => {}));
    expect(log.maxRunning).toBe(4);
    expect(Date.now() - started).toBeLessThan(250); // one after another would be 290 ms
    // The quick one lands first, the slow one last; numbers stay in pick order for stable addresses.
    expect(log.landed[0]).toBe(2);
    expect(log.landed.at(-1)).toBe(1);
    expect(out.map((c) => c.n)).toEqual([1, 2, 3, 4]);
  });

  it("runs SAM's keep-in-place checks for a photo at the same time, and retries a photo that moved a window", async () => {
    const anchors = () => [
      { kind: "window", box: window.box },
      { kind: "stairs", box: { x: 0.6, y: 0.3, w: 0.2, h: 0.5 } },
    ];
    // First try: SAM finds nothing where the window was. Second try: everything in place.
    const { work, log } = fakeWork({
      editMs: () => 10,
      boxes: (concept, call) => (call < 2 ? [] : concept === "staircase" ? [{ x: 0.6, y: 0.3, w: 0.2, h: 0.5 }] : [window.box]),
    });
    const [c] = await renderPicks([pick(100)], anchors, () => "prompt", work(async () => {}));
    expect(log.maxSam).toBe(2);
    expect(log.edits).toBe(2);
    expect(c).toMatchObject({ kept: true, checked: "Windows and Stairs kept where they are, nothing added · checked by SAM 3.1" });
  });

  it("retries a photo that grew a window the room doesn't have, and labels it if it does it again", async () => {
    const { work, log } = fakeWork({ editMs: () => 5, boxes: (concept) => (concept === "basement window" ? [{ x: 0.7, y: 0.1, w: 0.1, h: 0.1 }] : []) });
    const [c] = await renderPicks([pick(100)], () => [], () => "prompt", work(async () => {}));
    expect(log.edits).toBe(2);
    expect(c).toMatchObject({ kept: false, checked: "A window or stairs appeared that aren't there: treat it as a mood, not a plan" });
  });

  it("keeps the other photos when one fails, and only fails when they all do", async () => {
    const one = fakeWork({ editMs: () => 5, fail: (f) => f === 200 });
    const out = await renderPicks([pick(100), pick(200), pick(300)], () => [], () => "prompt", one.work(async () => {}));
    expect(out.map((c) => c.frame)).toEqual([100, 300]);
    const all = fakeWork({ editMs: () => 5, fail: () => true });
    await expect(renderPicks([pick(100), pick(200)], () => [], () => "prompt", all.work(async () => {}))).rejects.toThrow("Muse Image 500");
  });

  it("without the 3D, finishes the still wide shot as the living space", () => {
    const picks = pickFrames([{ ...window, frame: 40, framesSeen: 20, track: [[40, 0.1, 0.2, 0.2, 0.1]] }], null, "renter", 600, null, null, 60.4, photoSpaces("rec_room", "renter"));
    expect(picks.map((p) => [p.title, p.frame])).toEqual([
      ["A guest room", 40],
      ["The rec room", 302],
    ]);
  });
});

async function newScan(opts: { status?: string; result?: unknown; wideAt?: number; household?: string } = {}) {
  const [basement] = await db.insert(schema.basements).values({ claimToken: "t", household: opts.household ?? "renter" }).returning();
  const [scan] = await db
    .insert(schema.scans)
    .values({ basementId: basement.id, status: opts.status ?? "running", startedAt: new Date(Date.now() - 55_000), inputs: { wideAt: opts.wideAt ?? 60.4 }, result: opts.result ?? null })
    .returning();
  return { basement, scan };
}

// What the scan streams before the photos start: the frame count, then SAM's finds.
async function streamFinds(scanId: string) {
  await db.insert(schema.scanEvents).values([
    { scanId, at: 4, type: "log", text: "Reading 600 frames from your video", data: { frameCount: 600 } },
    {
      scanId,
      at: 52,
      type: "find",
      text: "Found 1 window",
      data: { kind: "window", label: "Window", detections: [{ id: "window-1", kind: "window", label: "Window", concept: "basement window", frame: 40, seconds: 8, box: window.box, framesSeen: 20, confidence: 0.9, track: [[40, 0.1, 0.2, 0.2, 0.1]] }] },
    },
  ]);
}

const resultOf = async (scanId: string) => (await db.select().from(schema.scans).where(eq(schema.scans.id, scanId)))[0].result as any;
const eventsOf = async (scanId: string) => db.select().from(schema.scanEvents).where(eq(schema.scanEvents.scanId, scanId)).orderBy(schema.scanEvents.id);

describe("photos start with the finds, before the answer", () => {
  it("picks from the streamed finds, the wide shot and what they said they want, while the scan still runs", async () => {
    const { basement, scan } = await newScan();
    await streamFinds(scan.id);
    await db.insert(schema.answers).values({ basementId: basement.id, ruleId: "plans", value: "rec_room" });
    const f = (await photoInputs(scan.id))!;
    expect(f).toMatchObject({ frameCount: 600, wideAt: 60.4, plans: "rec_room", household: "renter", vision: null });
    expect(f.detections.map((d) => d.id)).toEqual(["window-1"]);
  });

  it("streams each photo as a photo event, and puts the set in the result once both are done (photos first)", async () => {
    const { basement, scan } = await newScan();
    await streamFinds(scan.id);
    await db.insert(schema.answers).values({ basementId: basement.id, ruleId: "plans", value: "rental" });
    const { work, log } = fakeWork({ editMs: (f) => (f === 40 ? 40 : 10) });
    await runPhotos(scan.id, { lastAttempt: true, work, plansWaitMs: 0 });
    expect(log.maxRunning).toBe(2);
    const events = await eventsOf(scan.id);
    const photos = events.filter((e) => e.type === "photo");
    expect(photos.map((e) => (e.data as any).n)).toEqual([2, 1]); // the wide shot was quicker
    expect(photos[0].data).toMatchObject({ n: 2, title: "Living and kitchen", url: expect.stringMatching(new RegExp(`^/api/scans/${scan.id}/concepts/2\\.jpg`)) });
    expect(photos[0].at).toBeGreaterThan(50); // scan time, for the wait screen
    expect(events.at(-1)!.type).toBe("photos");
    // No answer yet: nothing written. The scan finishing later takes the set and settles it.
    expect(await resultOf(scan.id)).toBeNull();
    const concepts = await photosSoFar(scan.id);
    expect(concepts).toMatchObject({ status: "done", items: [{ n: 1, title: "The bedroom" }, { n: 2, title: "Living and kitchen" }] });
    await db.update(schema.scans).set({ result: { id: scan.id, concepts: { status: "pending", items: [] } } }).where(eq(schema.scans.id, scan.id));
    await settlePhotos(scan.id);
    expect((await resultOf(scan.id)).concepts).toEqual(concepts);
  });

  it("fills in the result when the answer was out first", async () => {
    const { scan } = await newScan();
    await streamFinds(scan.id);
    const { work } = fakeWork({ editMs: () => 5 });
    // The scan wrote its answer while two photos were still out: they show as pending.
    await db.update(schema.scans).set({ status: "done", result: { id: scan.id, detections: [], frameCount: 600, household: "renter", concepts: { status: "pending", items: [] } } }).where(eq(schema.scans.id, scan.id));
    // A job queued before the answer still reads the scan's own reading now.
    await runPhotos(scan.id, { lastAttempt: true, work, plansWaitMs: 0 });
    expect((await resultOf(scan.id)).concepts.status).toBe("done");
  });

  it("is queued once per scan attempt", async () => {
    const { scan } = await newScan();
    expect(await enqueuePhotos(scan.id)).not.toBeNull();
    expect(await enqueuePhotos(scan.id)).toBeNull();
  });

  it("runs beside the scan that queued it: each kind of job has its own slot", async () => {
    let photosRan = false;
    let scanSawPhotos = false;
    const worker = startWorker(
      {
        scanT: async () => {
          await enqueue("photosT", {});
          for (let i = 0; i < 60 && !photosRan; i++) await sleep(25);
          scanSawPhotos = photosRan;
        },
        photosT: async () => {
          photosRan = true;
        },
      },
      { pollMs: 20, id: "test-worker" },
    );
    await enqueue("scanT", {});
    for (let i = 0; i < 100 && !scanSawPhotos; i++) await sleep(25);
    await worker.stop();
    expect(scanSawPhotos).toBe(true);
    expect(await claimNext("w", ["scanT", "photosT"])).toBeNull();
  });
});
