// GET/POST /api/scans/:id/guide (ux-guide-build-spec.md). This first version is the contract's stub: the
// example's thread is fixed, and an action is echoed with a placeholder reply, so the shell, the visuals
// and the e2e can be built against it. Track B replaces it with the script, the glossary and Muse Spark.
import type { Context, Hono } from "hono";
import type { GuideAction, GuideMessage, GuideState } from "../../src/guide/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const at = "2026-10-31T12:00:00.000Z";

// The example basement at its answer: the verdict, the one fix marked on the plan, and the next questions.
export function sampleGuide(): GuideState {
  const messages: GuideMessage[] = [
    {
      id: "g-wait",
      from: "guide",
      text: "I found a window, the stairs and your furnace. Is there a door from the basement straight outside?",
      why: "a separate way in is one of the City's rules for a second home.",
      visual: { kind: "video" },
      at,
    },
    { id: "y-wait", from: "you", text: "Yes", at },
    {
      id: "g-answer",
      from: "guide",
      text: "Yes, your basement can be a second home, after one fix: a fire separation around the stairs, about $3k–$6k. All in, a contractor would charge roughly $49k–$85k, and you may get up to $4,620 back.",
      visual: { kind: "plan", mark: "fire_separation" },
      choices: [
        { label: "What's a fire separation?", action: { type: "explain", term: "fire_separation" } },
        { label: "Why that cost?", action: { type: "ask", text: "Why does it cost that much?" } },
        { label: "Show me what it could be", action: { type: "go", to: "design" }, primary: true },
      ],
      at,
    },
  ];
  return { step: "answer", milestone: "answer", done: { answer: false, design: false, build: false }, messages, visual: { kind: "plan", mark: "fire_separation" } };
}

// A real scan before track B: where the guide will start.
function startGuide(): GuideState {
  return {
    step: "wait.q:start",
    milestone: "answer",
    done: { answer: false, design: false, build: false },
    messages: [{ id: "g-start", from: "guide", text: "I'm measuring your basement from your video. Your answer comes first, then the pictures.", visual: { kind: "video" }, at }],
    visual: { kind: "video" },
  };
}

// What the stub says back. The visual follows the action where the contract makes it obvious.
function reply(state: GuideState, action: GuideAction): GuideState {
  const now = new Date().toISOString();
  const visual = action.type === "explain" ? { kind: "explain" as const, term: action.term } : action.type === "go" && action.to === "design" ? { kind: "planEdit" as const } : state.visual;
  const text = action.type === "explain" ? "Here's what that means, in a drawing." : "Got it. (The guide's script comes with track B.)";
  return { ...state, visual, messages: [...state.messages, { id: `g-${Date.now()}`, from: "guide", text, visual, at: now }] };
}

export function mountGuide(app: Hono) {
  const state = (c: Context) => {
    const id = c.req.param("id");
    if (id === "sample") return sampleGuide();
    // Real scans get the guide only once track B's script answers them: the iPhone app opens the guide
    // whenever this route answers, so until then a real scan's guide is "not found" and the app opens
    // the scan page instead. GUIDE_STUB=1 turns the stub on for real scans in development.
    return id && UUID.test(id) && process.env.GUIDE_STUB === "1" ? startGuide() : null;
  };

  app.get("/api/scans/:id/guide", (c) => {
    const s = state(c);
    return s ? c.json(s, 200, { "Cache-Control": "no-store" }) : c.json({ error: "Not found" }, 404);
  });

  app.post("/api/scans/:id/guide", async (c) => {
    const s = state(c);
    if (!s) return c.json({ error: "Not found" }, 404);
    const body = (await c.req.json().catch(() => null)) as { action?: GuideAction } | null;
    if (!body?.action?.type) return c.json({ error: "No action" }, 400);
    const next = reply(s, body.action);
    return c.json({ messages: next.messages.slice(s.messages.length), state: next }, 200, { "Cache-Control": "no-store" });
  });
}
