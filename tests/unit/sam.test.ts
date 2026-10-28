import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bestFrame, parseSam } from "../../server/sam";

describe("parseSam", () => {
  it("groups boxes into tracks across frames", () => {
    const text = [
      "<0f>0<|box;x1=10;y1=20;x2=30;y2=40;w=100;h=100|><|mask;x=0;y=0;data=1,1,!|>,1<|box;x1=50;y1=50;x2=60;y2=70;w=100;h=100|><|mask;x=0;y=0;data=1,1,!|>",
      "<1f>0<|box;x1=11;y1=20;x2=35;y2=45;w=100;h=100;c=0.9|><|mask;x=0;y=0;data=9,9,0,1|>",
    ].join("\n");
    const tracks = parseSam(text);
    expect(tracks.map((t) => [t.id, t.frames.length])).toEqual([[0, 2], [1, 1]]);
    expect(tracks[0].frames[1].box).toMatchObject({ x1: 11, x2: 35, c: 0.9 });
  });

  it("ignores digits inside mask data", () => {
    const text = "<0f>0<|box;x1=1;y1=1;x2=5;y2=5;w=10;h=10|><|mask;x=0;y=0;data=139,250,7<|>";
    expect(parseSam(text)).toHaveLength(1);
  });

  it("returns nothing for an empty result", () => {
    expect(parseSam("")).toEqual([]);
  });

  it("picks the biggest, most confident frame as proof", () => {
    const [t] = parseSam("<0f>0<|box;x1=0;y1=0;x2=10;y2=10;w=100;h=100;c=0.9|>\n<1f>0<|box;x1=0;y1=0;x2=40;y2=40;w=100;h=100;c=0.5|>");
    expect(bestFrame(t).frame).toBe(1);
  });

  it("parses a real SAM 3.1 video response", () => {
    const fixture = new URL("../fixtures/sam-video-duct.txt", import.meta.url);
    const tracks = parseSam(readFileSync(fixture, "utf8"));
    expect(tracks.length).toBeGreaterThan(0);
    expect(tracks[0].frames.length).toBeGreaterThan(10);
  });
});
