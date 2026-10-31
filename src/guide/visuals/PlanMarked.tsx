// The answer's visual: their measured plan, read only, with the one fix marked: a red outline on the place
// it applies to, a 1 px leader to a callout ("To fix · Fire separation"). The verdict sits on the frame's
// top edge and the area and ceiling on its bottom edge. `visual.mark` is a check id (server/model/checks.ts),
// a rule id, a fix category ("fire", "height", "egress", "exit") or a glossary term ("fire_separation");
// with none, or one we can't place, the plan shows without a mark. While the plan loads, its frame shows
// with one line saying so.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { checkDesign } from "../../../server/model/checks";
import { bounds, polygonArea } from "../../../server/model/geometry";
import type { Check, Existing, Fixture, Model, Pt } from "../../../server/model/types";
import { getScan, type ScanResult } from "../../api";
import { fmtArea, fmtLength } from "../../components/FloorPlan";
import { loadModel } from "../../studio/api";
import { frameOf, PlanSvg, type PlanLayer } from "../../studio/PlanSvg";
import type { VisualProps } from "../mount";
// PlanSvg draws with the studio's plan styles (src/studio/studio.css).
import "../../studio/studio.css";
import "../../styles/journey.css";

// PlanSvg's drawing space (src/studio/PlanSvg.tsx W and M): the overlay uses the same one.
const W = 1000;
const M = 84;

// Which checks and finds a fix category (server/model/fixes.ts CHECK_CATEGORY) or a glossary term points at.
type Category = { rules: RegExp; fixture?: Fixture["kind"]; words: string };
const FIRE: Category = { rules: /fire_separation|service_room/, fixture: "stairs", words: "Fire separation" };
const EGRESS: Category = { rules: /egress/, words: "Escape window" };
const HEIGHT: Category = { rules: /ceiling|clearance/, fixture: "duct", words: "Headroom" };
const CEILING: Category = { ...HEIGHT, words: "Ceiling height" };
const ENTRANCE: Category = { rules: /exit_from_suite|stair_width/, words: "Its own way in" };
const ALARMS: Category = { rules: /alarms/, words: "Alarms" };
const CATEGORY: Record<string, Category> = {
  fire: FIRE,
  fire_separation: FIRE,
  egress: EGRESS,
  window: EGRESS,
  egress_window: EGRESS,
  height: HEIGHT,
  headroom: HEIGHT,
  ceiling: CEILING,
  ceiling_height: CEILING,
  exit: ENTRANCE,
  entrance: ENTRANCE,
  separate_entrance: ENTRANCE,
  alarms: ALARMS,
  smoke_co_alarms: ALARMS,
};

type Target = { at: Pt; box: { minX: number; maxX: number; minZ: number; maxZ: number } | null; words: string };

// Where the mark goes: a failing check with a place on the plan first, then the find the fix is about.
export function placeMark(mark: string | undefined, existing: Existing, checks: Check[], result: ScanResult | null): Target | null {
  if (!mark) return null;
  const key = mark.toLowerCase();
  let cat: Category | undefined = CATEGORY[key];
  const group = result?.fixGroups?.find((g) => g.category === key || g.ruleIds?.includes(mark) || (cat && CATEGORY[g.category]?.rules === cat.rules));
  cat ??= group ? CATEGORY[group.category] : undefined;
  // A fire fix that's only the alarms isn't the drywall around the stairs.
  if (cat === FIRE && group?.ruleIds?.length && !group.ruleIds.some((r) => FIRE.rules.test(r))) cat = ALARMS;
  const failing = checks.filter((c) => c.ok === false && c.at);
  const rules = cat?.rules;
  const check =
    failing.find((c) => c.id === mark) ??
    failing.find((c) => c.ruleId === mark) ??
    (rules ? failing.find((c) => c.ruleId && rules.test(c.ruleId)) : undefined) ??
    (group ? failing.find((c) => c.ruleId && group.ruleIds?.includes(c.ruleId)) : undefined);
  // A check id or a rule id names its category through the check's rule.
  const rule = check?.ruleId;
  cat ??= rule ? [FIRE, EGRESS, HEIGHT, ENTRANCE, ALARMS].find((c) => c.rules.test(rule)) : undefined;
  const words = cat?.words ?? group?.title ?? check?.label ?? checks.find((c) => c.id === mark)?.label ?? mark;
  const fixture = cat?.fixture ? existing.fixtures.find((f) => f.kind === cat.fixture) : undefined;
  if (fixture) {
    const [sx, sz] = fixture.sizeM ?? [0.6, 0.6];
    const box = { minX: fixture.at[0] - sx / 2, maxX: fixture.at[0] + sx / 2, minZ: fixture.at[1] - sz / 2, maxZ: fixture.at[1] + sz / 2 };
    return { at: check?.at ?? fixture.at, box, words: words.charAt(0).toUpperCase() + words.slice(1) };
  }
  if (check?.at) return { at: check.at, box: null, words: words.charAt(0).toUpperCase() + words.slice(1) };
  return null;
}

const VERDICT: Record<ScanResult["verdict"], string> = { yes: "Yes", fix: "Yes, after fixes", no: "Not as it is" };

function verdictWords(r: ScanResult) {
  if (r.verdict !== "fix") return VERDICT[r.verdict];
  const n = r.fixGroups?.length ?? 0;
  return n ? `Yes, after ${n} fix${n === 1 ? "" : "es"}` : VERDICT.fix;
}

export function PlanMarked({ scanId, visual }: Pick<VisualProps<"plan">, "scanId" | "visual">) {
  const mark = visual.mark;
  const [model, setModel] = useState<Model | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The callout is nudged back inside the pane once it's measured.
  const rootRef = useRef<HTMLDivElement>(null);
  const calloutRef = useRef<HTMLParagraphElement>(null);
  const [nudge, setNudge] = useState({ x: 0, y: 0, upp: 1 });
  const planRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let gone = false;
    setError(null);
    loadModel(scanId)
      .then(({ model }) => !gone && setModel(model))
      .catch((e) => !gone && setError(e instanceof Error ? e.message : "We couldn't open your plan."));
    getScan(scanId)
      .then((s) => !gone && setResult(s.result))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [scanId]);

  const view = useMemo(() => {
    if (!model) return null;
    const e = model.existing;
    // Read only, so no "drag to place" on a guessed duct: PlanSvg adds it to every guessed fixture's label.
    const fixtures = e.fixtures.map((f) => (f.guess ? { ...f, guess: undefined } : f));
    const layer: PlanLayer = { walls: e.walls, openings: e.openings, rooms: e.rooms, fixtures };
    const frame = frameOf(layer);
    // The checks of their first design: where each rule's trouble is on the plan.
    const checks = model.designs[0] ? checkDesign(model.designs[0], e) : [];
    const target = placeMark(mark, e, checks, result);
    // PlanSvg's own scale, so the mark lands on what it draws.
    const wM = frame.maxX - frame.minX, dM = frame.maxZ - frame.minZ;
    const s = (W - 2 * M) / Math.max(wM, dM * 1.15);
    const ox = M + (W - 2 * M - wM * s) / 2;
    const H = Math.round(M * 2 + dM * s);
    const X = (x: number) => ox + (x - frame.minX) * s;
    const Z = (z: number) => M + (z - frame.minZ) * s;
    const area = e.rooms.reduce((n, r) => n + polygonArea(r.polygon), 0) || (() => {
      const b = bounds(e.walls.flatMap((w) => [w.a, w.b]));
      return (b.maxX - b.minX) * (b.maxZ - b.minZ);
    })();
    return { layer, frame, target, X, Z, H, area, ceiling: e.ceilingM };
  }, [model, mark, result]);

  useLayoutEffect(() => {
    const root = rootRef.current?.getBoundingClientRect();
    const box = calloutRef.current?.getBoundingClientRect();
    const plan = planRef.current?.getBoundingClientRect();
    if (!root || !box || !plan?.width) return;
    // Drawing units per screen pixel, so the leader can follow the callout.
    const upp = W / plan.width;
    const pad = 8;
    const x0 = box.left - nudge.x, y0 = box.top - nudge.y;
    const x = Math.min(0, root.right - pad - (x0 + box.width)) + Math.max(0, root.left + pad - x0);
    const y = Math.min(0, root.bottom - pad - (y0 + box.height)) + Math.max(0, root.top + pad - y0);
    if (Math.abs(x - nudge.x) > 0.5 || Math.abs(y - nudge.y) > 0.5 || Math.abs(upp - nudge.upp) > 0.01) setNudge({ x, y, upp });
  });

  if (error) {
    return (
      <div className="plan-marked" data-state="error">
        <p className="plan-marked-error" role="alert">
          <b>We couldn't open your plan.</b> {error}
        </p>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="plan-marked" data-state="loading">
        <div className="plan-marked-frame plan-marked-wait">
          <p className="plan-marked-note">Drawing your plan, a few seconds</p>
        </div>
      </div>
    );
  }

  const { layer, frame, target, X, Z, H } = view;
  const T = target ? { x: X(target.at[0]), y: Z(target.at[1]) } : null;
  const right = T ? T.x < W * 0.55 : true;
  // The callout sits off to the emptier side, a little below; the leader runs to its near edge.
  const C = T ? { x: Math.min(W - 40, Math.max(40, T.x + (right ? 150 : -150))), y: Math.min(H - 40, T.y + 90) } : null;

  return (
    <div className="plan-marked" ref={rootRef} data-state="ready" data-marked={target ? true : undefined}>
      {result && (
        <p className="plan-marked-verdict" data-verdict={result.verdict}>
          <i aria-hidden /> {verdictWords(result)}
        </p>
      )}
      <div className="plan-marked-frame">
        <div className="plan-marked-plan" ref={planRef} style={{ ["--ratio" as string]: `${W / H}` }}>
          <PlanSvg layer={layer} frame={frame} units="m" label={`Your basement's plan${target ? `, with the fix marked: ${target.words}` : ""}`} selected={null} onSelect={() => {}} roomNames />
          {target && T && C && (
            <>
              <svg className="plan-marked-mark" viewBox={`0 0 ${W} ${H}`} aria-hidden preserveAspectRatio="xMidYMid meet">
                {target.box ? (
                  <rect
                    x={X(target.box.minX) - 10}
                    y={Z(target.box.minZ) - 10}
                    width={X(target.box.maxX) - X(target.box.minX) + 20}
                    height={Z(target.box.maxZ) - Z(target.box.minZ) + 20}
                    className="plan-marked-outline"
                  />
                ) : (
                  <circle cx={T.x} cy={T.y} r={22} className="plan-marked-outline" />
                )}
                <path d={`M${T.x} ${T.y} L${C.x + nudge.x * nudge.upp} ${C.y + nudge.y * nudge.upp}`} className="plan-marked-leader" />
              </svg>
              <p
                ref={calloutRef}
                className="plan-marked-callout"
                data-side={right ? "right" : "left"}
                style={{ left: `${(C.x / W) * 100}%`, top: `${(C.y / H) * 100}%`, translate: `${nudge.x}px ${nudge.y}px` }}
              >
                <b>To fix</b>
                <span>{target.words}</span>
              </p>
            </>
          )}
        </div>
      </div>
      <p className="plan-marked-facts">
        <span className="mono">{fmtArea(view.area, "m")}</span>
        {view.ceiling ? (
          <>
            {" · ceiling "}
            <span className="mono">{fmtLength(view.ceiling, "m")}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
