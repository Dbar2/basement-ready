// What the QA run looks at: every screen of the journey, the 3D views from fixed cameras, the plan
// drawn over the scan, and every permit sheet and book page. Pure data, so the plan is testable and
// `--only` can pick from it before a browser starts.

export type Browser = "chromium" | "webkit";
export type Viewport = "phone" | "desktop";
export type Camera = "eye" | "above" | "corner";
export type Kind = "page" | "3d" | "overlay" | "pdf";
export type Group = "journey" | "3d" | "docs" | "marketing";

export const VIEWPORTS: Record<Viewport, { width: number; height: number; deviceScaleFactor: number; isMobile: boolean; hasTouch: boolean }> = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};
export const BROWSERS: Browser[] = ["chromium", "webkit"];
export const CAMERAS: Camera[] = ["eye", "above", "corner"];

export const CAMERA_LABEL: Record<Camera, string> = {
  eye: "eye level (1.5 m), inside the room, looking across it",
  above: "from straight above, ceiling cut away",
  corner: "a three-quarter view from above one corner, ceiling cut away",
};

// One logical screen. Its shots are the screen in each browser and size (and, for 3D, each camera).
export type Screen = {
  id: string;
  title: string;
  group: Group;
  kind: Kind;
  // Where it lives; "{scan}" is the scan id. Workspace tabs share /scans/{scan}.
  route: string;
  // What the screen is meant to show, for the reviewer.
  purpose: string;
  // Checks for this screen on top of the shared checklist.
  checks: string[];
  // Review order when the budget runs short: lower goes first.
  priority: number;
  // Shot in every browser and size unless narrowed here.
  browsers?: Browser[];
  viewports?: Viewport[];
  // Left out unless named with --only or --all.
  optIn?: boolean;
  // What the capture itself does to this screen, so the reviewer doesn't report it.
  captureNote?: string;
};

const S = (s: Screen) => s;

export const SCREENS: Screen[] = [
  S({
    id: "home",
    title: "Home page",
    group: "journey",
    kind: "page",
    route: "/",
    priority: 1,
    purpose:
      "The landing page. Headline 'Could your basement be a home?', the scroll story of the example basement scanned in 3D, how it works, and the 'Scan my basement' button. A judge's first impression.",
    checks: ["The hero reads in one glance and the main button is obvious.", "Any staged or AI-made picture is labelled 'Virtually staged'."],
    captureNote:
      "The scroll story's 3D stage is pinned while you scroll, so a full-page capture shows its stretch of the page as empty space between captions. That gap is the capture, not the page; the 'Home page scroll story' screen shows the story step by step.",
  }),
  S({
    id: "home-story",
    title: "Home page scroll story (3D)",
    group: "3d",
    kind: "3d",
    route: "/",
    priority: 3,
    purpose:
      "The home page's 3D story of the example basement: the real scan, then the finished home inside it. Shot at each scroll step and from fixed cameras.",
    checks: ["The scan sits on the floor and the walls stand straight.", "Furniture is inside the room, on the floor, not through walls.", "Labels point at the right things."],
  }),
  S({
    id: "wait",
    title: "Wait screen (scan running)",
    group: "journey",
    kind: "page",
    route: "/scans/{scan}",
    priority: 2,
    purpose:
      "While the scan runs: the video with what the model found boxed on it, the stages (reading video, finding things, measuring rooms, checking the rules), a time left, and questions asked while it checks. For the example it says it's a recorded scan, replayed.",
    checks: ["Boxes and labels sit on the right objects in the frame.", "The time left and the stages agree with each other.", "No internal model names, error codes or confidence numbers shown to the homeowner."],
    captureNote: "Shot a few seconds in, with the first question up; it's one moment of a moving screen.",
  }),
  S({
    id: "workspace-plan",
    title: "Workspace: Your plan",
    group: "journey",
    kind: "page",
    route: "/scans/{scan}",
    priority: 1,
    purpose:
      "The answer. The verdict headline (e.g. 'Yes, your basement can be a second home after 1 fix'), what has to change and roughly what it costs, the scanned basement in 3D and as a floor plan, and what was found (windows, exit, stairs, ducts).",
    checks: [
      "The verdict never says 'you qualify' or 'approved'; it says what we know and what a designer confirms.",
      "Costs are rough ranges.",
      "Area, ceiling height and room sizes match the plan and the other screens.",
      "The 3D and the plan show the same basement.",
    ],
  }),
  S({
    id: "workspace-ideas",
    title: "Workspace: Ideas",
    group: "journey",
    kind: "page",
    route: "/scans/{scan}",
    priority: 4,
    purpose: "Ideas for the space: 'Make it yours', finished-basement pictures (virtually staged), styles and layouts.",
    checks: ["Every staged picture says 'Virtually staged'.", "The pictures keep the real windows and stairs of this basement."],
  }),
  S({
    id: "workspace-permit",
    title: "Workspace: Permit",
    group: "journey",
    kind: "page",
    route: "/scans/{scan}",
    priority: 2,
    purpose: "'Your permit package': the sheets, what's still needed before it can be submitted (a readiness count), and the download.",
    checks: ["The readiness count matches the items listed.", "Nothing claims the permit is approved."],
  }),
  S({
    id: "workspace-money",
    title: "Workspace: Money",
    group: "journey",
    kind: "page",
    route: "/scans/{scan}",
    priority: 4,
    purpose: "'Money you can get': grants and loans that may apply, how much, and how to apply, each with its source.",
    checks: ["Amounts and program names are consistent and sourced.", "No promise that they qualify."],
  }),
  S({
    id: "workspace-build",
    title: "Workspace: Build",
    group: "journey",
    kind: "page",
    route: "/scans/{scan}",
    priority: 5,
    purpose: "'Who builds it?': designers and builders, the timeline, and doing parts yourself.",
    checks: ["No generic contractor look (hard hats, 'Call now for a free quote!')."],
  }),
  S({
    id: "plan-confirm",
    title: "Is this your basement? (plan confirm)",
    group: "journey",
    kind: "page",
    route: "/scans/{scan}/plan",
    priority: 1,
    purpose:
      "The measured floor plan drawn cleanly with what was found (doors, windows, stairs, ducts). The owner fixes what's off and says yes; every design is drawn on this plan.",
    checks: ["Walls close into rooms, with no gaps, overlaps or doubled walls.", "Dimensions add up and match the area shown.", "Windows, doors and stairs sit on walls where they belong."],
  }),
  S({
    id: "studio",
    title: "Studio: your basement, designed",
    group: "journey",
    kind: "page",
    route: "/scans/{scan}/studio",
    priority: 1,
    purpose:
      "The chosen design inside the real scan in 3D, with the plan, the checks (code rules), finishes, 'Describe a change', and what the materials cost. Edits keep checks and cost in step.",
    checks: ["Furniture sits on the floor, inside the walls.", "The check count and the cost agree with the book and quote.", "The 3D isn't blank, black or mid-load."],
  }),
  S({
    id: "pictures",
    title: "Pictures of the design",
    group: "journey",
    kind: "page",
    route: "/scans/{scan}/pictures",
    priority: 2,
    purpose: "'Your design, from where you stood': pictures of the design from the scan's real camera angles, all agreeing with each other and the plan.",
    checks: ["Pictures keep the real windows and stairs in the right places.", "They look like real rooms a judge would believe.", "They're labelled 'Virtually staged'."],
  }),
  S({
    id: "ideas",
    title: "Swipe your style",
    group: "journey",
    kind: "page",
    route: "/scans/{scan}/ideas",
    priority: 4,
    purpose: "Swipe a style deck made from the scan's angles, watch a mood board build, then pick a layout card.",
    checks: ["Cards and buttons fit the phone screen.", "The layouts match the basement's shape."],
  }),
  S({
    id: "book",
    title: "The book",
    group: "journey",
    kind: "page",
    route: "/scans/{scan}/book",
    priority: 2,
    purpose:
      "Everything in one place: the design, pictures, mood board, the quote by trade with sources, permit readiness, money, and the steps from applying to moving in, with its PDF.",
    checks: ["The quote total equals its trades.", "Numbers match the studio, permit and money screens.", "Costs are rough ranges with sources."],
  }),
  S({
    id: "brief",
    title: "Designer brief",
    group: "journey",
    kind: "page",
    route: "/scans/{scan}/brief",
    priority: 5,
    purpose: "The one-page plan to hand a designer, laid out for paper: decision, suggested layout, what has to change and costs, what they want, what's still to confirm, money and how to apply.",
    checks: ["It fits and reads like a printed page."],
  }),
  S({
    id: "scan-3d",
    title: "The scanned basement in 3D (workspace)",
    group: "3d",
    kind: "3d",
    route: "/scans/{scan}",
    priority: 2,
    purpose: "The basement as it really is: one surface fused from the video, in the colours the camera saw, from fixed cameras.",
    checks: ["The floor is flat and level; walls are upright.", "No floating fragments, holes through walls or doubled walls.", "Labels sit on the right things (window, exit, stairs, duct)."],
  }),
  S({
    id: "layout-3d",
    title: "Starting layout in the room (workspace 3D)",
    group: "3d",
    kind: "3d",
    route: "/scans/{scan}",
    priority: 2,
    purpose: "The workspace's 'A starting layout in your real room': the suggested layout (bedroom, bathroom, kitchen, living) furnished inside the basement's walls, with room labels and areas, from fixed cameras.",
    checks: ["Furniture sits on the floor, inside the walls, at sensible sizes, not overlapping other furniture.", "Room labels sit in their rooms and their areas look right for the space.", "Stairs, window and door are where the plan has them."],
  }),
  S({
    id: "studio-3d",
    title: "Studio 3D from fixed cameras",
    group: "3d",
    kind: "3d",
    route: "/scans/{scan}/studio",
    priority: 2,
    purpose: "The design inside the real scan, from fixed cameras.",
    checks: ["Furniture sits on the floor and inside the walls, at sensible sizes.", "New walls line up with the scan's walls.", "No impossible geometry."],
  }),
  S({
    id: "pictures-3d",
    title: "Pictures 3D from fixed cameras",
    group: "3d",
    kind: "3d",
    route: "/scans/{scan}/pictures",
    priority: 6,
    purpose: "The scene the design pictures are drawn from, seen from fixed cameras.",
    checks: ["Furniture on the floor, walls straight, windows where the scan has them."],
    // The pictures page draws into a hidden canvas meant to be laid over the photos (src/views/AngleRender.tsx):
    // from our cameras it's mostly invisible occluders, so it's only shot when asked for.
    optIn: true,
    captureNote: "Drawn from the page's hidden render canvas, which is made to be laid over the real photos: invisible walls and an empty background are expected.",
  }),
  S({
    id: "plan-overlay",
    title: "Plan over the scan (top-down)",
    group: "3d",
    kind: "overlay",
    route: "/scans/{scan}",
    priority: 2,
    browsers: ["chromium"],
    viewports: ["desktop"],
    purpose:
      "The confirmed plan's walls (magenta lines, thickness to scale), doors and windows (blue and teal ticks) and stairs or ducts (outlined boxes), drawn over a top-down render of the scan cut at about 1.2 m.",
    checks: ["Plan walls run along the scan's walls, not through the middle of the room or outside it.", "Openings sit where the scan shows gaps or windows.", "Stairs box covers the scanned stairs."],
  }),
  S({
    id: "permit-pdf",
    title: "Permit set (PDF pages)",
    group: "docs",
    kind: "pdf",
    route: "/scans/{scan}",
    priority: 3,
    browsers: ["chromium"],
    viewports: ["desktop"],
    purpose: "The permit drawings as downloaded: cover and key plan, floor plans at 1:50 on 11x17, sections, notes, and the city's forms.",
    checks: ["Title blocks complete and aligned; sheet numbers in order.", "Dimensions legible and consistent between sheets.", "Text doesn't collide with drawings."],
  }),
  S({
    id: "book-pdf",
    title: "The book (PDF pages)",
    group: "docs",
    kind: "pdf",
    route: "/scans/{scan}/book",
    priority: 4,
    browsers: ["chromium"],
    viewports: ["desktop"],
    purpose: "The book as a PDF: the same sections as the book page, laid out for print.",
    checks: ["Pages aren't cut off; pictures aren't stretched.", "Numbers match the book page."],
  }),
  ...["how-it-works", "cities", "for-pros", "faq", "about"].map((p) =>
    S({
      id: `page-${p}`,
      title: `Marketing: /${p}`,
      group: "marketing",
      kind: "page",
      route: `/${p}`,
      priority: 7,
      optIn: true,
      purpose: `The /${p} page of the marketing site.`,
      checks: [],
    }),
  ),
];

// The home story is shot at each scroll step, like scripts/landing-stills.ts.
export const STORY_STEPS = [1, 2, 3, 4, 5, 6];

export type Shot = {
  id: string; // unique and file-safe: screen.browser.viewport[.camera|.step|.page]
  screen: string;
  title: string;
  kind: Kind;
  group: Group;
  browser: Browser;
  viewport: Viewport;
  scan: string;
  route: string;
  camera?: Camera;
  step?: number;
};

export type PlanOptions = {
  scans: string[];
  browsers?: Browser[];
  viewports?: Viewport[];
  only?: string[];
  all?: boolean;
};

// Screen ids may be given whole, by group ("3d", "docs"), or with a trailing * ("workspace-*").
export function matches(screen: Screen, only: string[] | undefined, all = false): boolean {
  if (!only || only.length === 0) return all || !screen.optIn;
  return only.some((o) => {
    const t = o.trim();
    if (!t) return false;
    if (t === screen.group) return true;
    if (t.endsWith("*")) return screen.id.startsWith(t.slice(0, -1));
    return t === screen.id;
  });
}

export function selectScreens(opts: Pick<PlanOptions, "only" | "all">): Screen[] {
  return SCREENS.filter((s) => matches(s, opts.only, opts.all));
}

const sameScan = (scan: string) => (scan === "sample" ? "" : `@${scan}`);

// Every shot the run takes, in journey order. PDF pages are unknown until the PDF exists, so a pdf
// screen is one shot here and becomes one image per page at capture time.
export function buildPlan(opts: PlanOptions): Shot[] {
  const browsers = opts.browsers?.length ? opts.browsers : BROWSERS;
  const viewports = opts.viewports?.length ? opts.viewports : (Object.keys(VIEWPORTS) as Viewport[]);
  const shots: Shot[] = [];
  for (const scan of opts.scans) {
    for (const screen of selectScreens(opts)) {
      if (screen.route.includes("{scan}") === false && scan !== opts.scans[0]) continue; // marketing and home once
      const route = screen.route.replace("{scan}", scan);
      const tag = route.includes(scan) ? sameScan(scan) : "";
      for (const browser of browsers.filter((b) => !screen.browsers || screen.browsers.includes(b))) {
        for (const viewport of viewports.filter((v) => !screen.viewports || screen.viewports.includes(v))) {
          const base = { screen: screen.id, title: screen.title, kind: screen.kind, group: screen.group, browser, viewport, scan, route };
          const id = `${screen.id}${tag}.${browser}.${viewport}`;
          if (screen.kind === "3d") {
            if (screen.id === "home-story") for (const step of STORY_STEPS) shots.push({ ...base, id: `${id}.step${step}`, step });
            for (const camera of CAMERAS) shots.push({ ...base, id: `${id}.${camera}`, camera });
          } else {
            shots.push({ ...base, id });
          }
        }
      }
    }
  }
  return shots;
}

export const screenById = (id: string) => SCREENS.find((s) => s.id === id);
