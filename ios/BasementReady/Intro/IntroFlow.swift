// What shows before the start screen: the launch animation on every cold launch, then the filming guide on
// the first one. The guide opens again from the start screen ("How to film").
//
// Debug builds take launch arguments, so the screens can be checked without a person:
//   -BRSkipIntro        no launch animation and no first-run guide (UI tests use this)
//   -BRShowGuide        the guide at once, no launch animation, seen before or not (wins over -BRSkipIntro)
//   -BRGuidePage <n>    open the guide on page n, 1 to 4
//   -BRResetGuide       forget that the guide was seen, as on a first launch
//   -BRFreezeAt <s>     hold the launch animation and the guide's drawings at s seconds, for screenshots
import SwiftUI

/// Remembers whether this phone has seen the filming guide.
struct GuideFlag {
  static let key = "seenFilmingGuide"
  let defaults: UserDefaults

  init(_ defaults: UserDefaults = .standard) { self.defaults = defaults }

  var seen: Bool {
    get { defaults.bool(forKey: Self.key) }
    nonmutating set { defaults.set(newValue, forKey: Self.key) }
  }
}

/// What to show when the app opens.
struct IntroPlan: Equatable {
  var playLaunch = true
  var showGuide = false
  var guidePage = 0
  var freezeAt: Double?
  var resetGuide = false

  static func make(seenGuide: Bool, arguments: [String]) -> IntroPlan {
    var plan = IntroPlan(showGuide: !seenGuide)
    #if DEBUG
    let args = IntroArguments(all: arguments)
    if args.has("-BRResetGuide") {
      plan.resetGuide = true
      plan.showGuide = true
    }
    if args.has("-BRSkipIntro") {
      plan.playLaunch = false
      plan.showGuide = false
    }
    if args.has("-BRShowGuide") {
      plan.playLaunch = false
      plan.showGuide = true
    }
    if let page = args.value("-BRGuidePage").flatMap(Int.init) {
      plan.guidePage = min(max(page - 1, 0), GuideContent.pages.count - 1)
    }
    plan.freezeAt = args.value("-BRFreezeAt").flatMap(Double.init)
    #endif
    return plan
  }
}

#if DEBUG
/// Debug-only launch arguments. A flag followed by NO, 0 or false is off.
struct IntroArguments {
  let all: [String]

  func has(_ name: String) -> Bool {
    guard let i = all.firstIndex(of: name) else { return false }
    let next = i + 1 < all.count ? all[i + 1].lowercased() : ""
    return !["no", "0", "false"].contains(next)
  }

  func value(_ name: String) -> String? {
    guard let i = all.firstIndex(of: name), i + 1 < all.count else { return nil }
    return all[i + 1]
  }
}
#endif

@MainActor
final class IntroFlow: ObservableObject {
  static let shared = IntroFlow()

  @Published private(set) var showingLaunch: Bool
  /// On a first launch the guide is already there under the launch animation, so it fades straight into it.
  @Published private(set) var showingGuide: Bool
  @Published private(set) var guideByHand = false
  @Published private(set) var guidePage: Int
  let freezeAt: Double?
  private let flag: GuideFlag

  init(arguments: [String] = ProcessInfo.processInfo.arguments, flag: GuideFlag = GuideFlag()) {
    let plan = IntroPlan.make(seenGuide: flag.seen, arguments: arguments)
    if plan.resetGuide { flag.seen = false }
    self.flag = flag
    showingLaunch = plan.playLaunch
    showingGuide = plan.showGuide
    guidePage = plan.guidePage
    freezeAt = plan.freezeAt
  }

  func launchFinished() {
    guard showingLaunch else { return }
    withAnimation(.easeOut(duration: LaunchTimeline.fadeOut)) { showingLaunch = false }
  }

  func openGuide() {
    guideByHand = true
    guidePage = 0
    let reduceMotion = UIAccessibility.isReduceMotionEnabled
    withAnimation(reduceMotion ? .easeOut(duration: 0.2) : .smooth(duration: 0.4)) { showingGuide = true }
  }

  func closeGuide() {
    flag.seen = true
    withAnimation(.easeOut(duration: 0.3)) { showingGuide = false }
  }
}

/// RootView's hook: the launch animation and the guide over whatever the app is showing.
struct IntroOverlays: ViewModifier {
  @ObservedObject private var flow = IntroFlow.shared
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  func body(content: Content) -> some View {
    let onForest = flow.showingLaunch
    return ZStack {
      content
        .accessibilityHidden(flow.showingLaunch || flow.showingGuide)
      if flow.showingGuide {
        FilmingGuide(startPage: flow.guidePage, playing: !flow.showingLaunch, freezeAt: flow.freezeAt) { flow.closeGuide() }
          .accessibilityHidden(flow.showingLaunch)
          .transition(flow.guideByHand && !reduceMotion ? .move(edge: .bottom) : .opacity)
          .zIndex(1)
      }
      if flow.showingLaunch {
        LaunchView(freezeAt: flow.freezeAt) { flow.launchFinished() }
          .transition(.opacity)
          .zIndex(2)
      }
    }
    // A light status bar while the forest launch shows; the screens underneath ask for light mode.
    .transformPreference(PreferredColorSchemeKey.self) { if onForest { $0 = .dark } }
  }
}

extension View {
  func introFlow() -> some View { modifier(IntroOverlays()) }
}
