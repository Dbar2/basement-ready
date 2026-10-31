// The guide's shared contract (the UX guide build spec, Oct 31): what the thread, the visual pane and the
// server's script say to each other. Imported by the server from this same file.
export type Milestone = "answer" | "design" | "build";
export type LookKey = "light" | "warm" | "deep" | "plain";
export type GlossaryTerm = "fire_separation" | "egress_window" | "ceiling_height" | "separate_entrance" | "smoke_co_alarms" | "permit_set" | "hired_out" | "tax_credit" | string;

// What the visual pane shows. One owner track per kind.
export type VisualRef =
  | { kind: "video" }
  | { kind: "plan"; mark?: string }
  | { kind: "explain"; term: GlossaryTerm }
  | { kind: "planEdit" }
  | { kind: "layouts"; designId: string }
  | { kind: "beforeAfter"; designId: string; look: LookKey | "custom"; angleId?: string }
  | { kind: "permit" }
  | { kind: "money" }
  | { kind: "builders" };

// An inline card under a message, for input the buttons can't carry.
export type CardRef = { kind: "tape" | "window" | "owner" | "waterMeter" | "upstairs" | "designer" | "moneyQuestion" | "buildPath" | "download"; id: string };

export type GuideAction =
  | { type: "answer"; questionId: string; value: unknown }
  | { type: "confirmPlan" }
  | { type: "setWall"; wallId: string; lengthM: number }
  | { type: "chooseDesign"; designId: string }
  | { type: "setLook"; look: LookKey | "none" }
  | { type: "describe"; text: string }
  | { type: "permitItem"; itemId: string; value: unknown }
  | { type: "explain"; term: GlossaryTerm }
  | { type: "go"; to: Milestone | "home" }
  | { type: "ask"; text: string };

export type Choice = { label: string; action: GuideAction; primary?: boolean };
export type GuideMessage = { id: string; from: "guide" | "you"; text: string; why?: string; choices?: Choice[]; visual?: VisualRef; card?: CardRef; at: string };
export type StepId = string; // "wait.q:<id>", "wait.look", "answer", "design.plan", "design.layouts", "design.look", "build.permit:<item>", "build.money:<q>", "build.builders", "done"
export type GuideState = { step: StepId; milestone: Milestone; done: Record<Milestone, boolean>; messages: GuideMessage[]; visual: VisualRef };
