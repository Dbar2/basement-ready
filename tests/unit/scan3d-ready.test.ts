// Whether a scan gets its 3D: the readiness check waits out a cold Modal start instead of giving up
// after 3 s, and still gives up at once on a wrong token. No network: fetch is a stub.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readyWaitMs, scan3dReady } from "../../server/scan3d";

const MODAL = "https://someone--basement-ready-scan3d-scan3d-web.us-east.modal.run";
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const refused = () => Promise.reject(new TypeError("fetch failed"));
// Answers only when the caller gives up on it, like a request queued behind a cold start.
const hangs = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));

afterEach(() => vi.restoreAllMocks());

describe("the 3D service readiness check", () => {
  it("waits minutes for Modal, seconds for the Mac runner", () => {
    expect(readyWaitMs(MODAL)).toBe(180_000);
    expect(readyWaitMs("http://127.0.0.1:8790")).toBe(3000);
    expect(readyWaitMs(undefined)).toBe(3000);
  });

  it("asks /health with the token, and says yes once a starting container answers", async () => {
    const get = vi.fn().mockImplementationOnce(refused).mockImplementationOnce(refused).mockResolvedValueOnce(new Response("starting", { status: 503 })).mockResolvedValueOnce(ok());
    expect(await scan3dReady({ url: MODAL, token: "t", waitMs: 5000, retryMs: 1, get })).toBe(true);
    expect(get).toHaveBeenCalledTimes(4);
    expect(get.mock.calls[0][0]).toBe(`${MODAL}/health`);
    expect(get.mock.calls[0][1].headers).toEqual({ Authorization: "Bearer t" });
  });

  it("gives up at once on a wrong token, and says why", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const get = vi.fn().mockResolvedValue(new Response("missing or wrong bearer token", { status: 401 }));
    expect(await scan3dReady({ url: MODAL, token: "wrong", waitMs: 5000, retryMs: 1, get })).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
    expect(said.mock.calls[0][0]).toMatch(/status 401/);
  });

  it("gives up when nothing answers in the time allowed", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const get = vi.fn(hangs);
    const started = Date.now();
    expect(await scan3dReady({ url: MODAL, token: "t", waitMs: 60, retryMs: 10, get })).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(said.mock.calls[0][0]).toMatch(/no answer/);
  });

  it("keeps asking a service that's down until the wait runs out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const get = vi.fn(refused);
    expect(await scan3dReady({ url: "http://127.0.0.1:8790", token: "t", waitMs: 60, retryMs: 10, get })).toBe(false);
    expect(get.mock.calls.length).toBeGreaterThan(1);
  });

  it("asks nothing without a service address or token", async () => {
    const get = vi.fn(ok);
    expect(await scan3dReady({ url: "", token: "t", get })).toBe(false);
    expect(await scan3dReady({ url: MODAL, token: "", get })).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });
});
