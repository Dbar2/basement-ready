// The guide's shared contract (ux-guide-build-spec.md): what the visual pane shows, the cards under a message,
// what a tap or a sentence asks the server to do, and the thread's state. The server imports this file too.
// Changes go through the shell track (A) and the main session.

export type Milestone = "answer" | "design" | "build";
export type LookKey = "light" | "warm" | "deep" | "plain";
export type GlossaryTerm = "fire_separation" | "egress_window" | "ceiling_height" | "separate_entrance" | "smoke_co_alarms" | "permit_set" | "hired_out" | "tax_credit" | string;

// What the visual pane shows. One owner track per kind (see the tracks).
export type VisualRef =
  | { kind: "video" } // while it measures: their video/photos with finds (C)
  | { kind: "plan"; mark?: string } // the answer: plan with a check/fix id marked (C)
  | { kind: "explain"; term: GlossaryTerm } // a drawing that explains a term (C)
  | { kind: "planEdit" } // check the plan, editable (D)
  | { kind: "layouts"; designId: string } // clean 3D of a design, chips to switch (E)
  | { kind: "beforeAfter"; designId: string; look: LookKey | "custom"; angleId?: string } // (E)
  | { kind: "permit" }
  | { kind: "money" }
  | { kind: "builders" }; // the Build milestone (F)

// An inline card under a message, for input the buttons can't carry (F owns the card kinds).
export type CardRef = { kind: "tape" | "window" | "owner" | "waterMeter" | "upstairs" | "designer" | "moneyQuestion" | "buildPath" | "download"; id: string };

export type GuideAction =
  | { type: "answer"; questionId: string; value: unknown } // wait questions, money questions
  | { type: "confirmPlan" }
  | { type: "setWall"; wallId: string; lengthM: number }
  | { type: "chooseDesign"; designId: string }
  | { type: "setLook"; look: LookKey | "none" }
  | { type: "describe"; text: string } // a change in their words → server/model/describe.ts
  | { type: "permitItem"; itemId: string; value: unknown }
  | { type: "explain"; term: GlossaryTerm }
  | { type: "go"; to: Milestone | "home" }
  | { type: "ask"; text: string }; // free text → Muse Spark (or the glossary, or the example's script)

export type Choice = { label: string; action: GuideAction; primary?: boolean };
export type GuideMessage = { id: string; from: "guide" | "you"; text: string; why?: string; choices?: Choice[]; visual?: VisualRef; card?: CardRef; at: string };
export type StepId = string; // "wait.q:<id>", "wait.look", "answer", "design.plan", "design.layouts", "design.look", "build.permit:<item>", "build.money:<q>", "build.builders", "done"
export type GuideState = { step: StepId; milestone: Milestone; done: Record<Milestone, boolean>; messages: GuideMessage[]; visual: VisualRef };
