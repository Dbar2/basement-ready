// The launch animation, on every cold launch: the B draws itself, a house rises into its lower half and cuts
// out, the door drops in, then "Basement Ready". It carries on from the forest launch screen and cross-fades
// into the app. A tap skips it. With Reduce Motion it's the finished mark with a short fade.
import SwiftUI

enum Ease {
  static func clamp(_ x: Double) -> Double { min(1, max(0, x)) }
  /// 0 before a, 1 after b, straight between.
  static func ramp(_ t: Double, _ a: Double, _ b: Double) -> Double { clamp((t - a) / (b - a)) }
  static func inOut(_ x: Double) -> Double {
    let x = clamp(x)
    return x < 0.5 ? 4 * x * x * x : 1 - pow(-2 * x + 2, 3) / 2
  }
  static func out(_ x: Double) -> Double { 1 - pow(1 - clamp(x), 3) }
}

enum LaunchTimeline {
  /// When the cross-fade into the app starts.
  static let total = 1.35
  /// The same with Reduce Motion: a short fade in, a moment to read it.
  static let stillTotal = 0.9
  static let fadeOut = 0.25
}

/// Where each part of the mark is, t seconds in. Every part runs 0 (not there yet) to 1 (in place).
struct LaunchFrame: Equatable {
  var outline = 1.0 // how much of the B's outline is drawn
  var stroke = 0.0 // the outline's opacity; it hands over to the fill
  var fill = 1.0 // the B's fill
  var house = 1.0 // how far the house has risen into the B
  var glow = 0.0 // mint in the house before it settles into a cut-out
  var door = 1.0
  var word = 1.0 // "Basement Ready"
  var opacity = 1.0 // everything (the Reduce Motion fade)

  static let finished = LaunchFrame()

  static func at(_ t: Double) -> LaunchFrame {
    var f = LaunchFrame()
    f.outline = Ease.inOut(Ease.ramp(t, 0, 0.45))
    f.stroke = 1 - Ease.ramp(t, 0.45, 0.6)
    f.fill = Ease.out(Ease.ramp(t, 0.28, 0.55))
    f.house = Ease.out(Ease.ramp(t, 0.5, 0.86))
    f.glow = t < 0.5 ? 0 : 1 - Ease.ramp(t, 0.84, 1.02)
    f.door = Ease.out(Ease.ramp(t, 0.9, 1.12))
    f.word = Ease.out(Ease.ramp(t, 1.0, 1.3))
    return f
  }

  /// Reduce Motion: the finished mark, fading in. Nothing moves.
  static func still(_ t: Double) -> LaunchFrame {
    var f = LaunchFrame()
    f.opacity = Ease.ramp(t, 0, 0.25)
    return f
  }
}

struct LaunchView: View {
  var freezeAt: Double? = nil
  let onDone: () -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var start: Date?
  @State private var finished = false

  var body: some View {
    ZStack {
      Brand.ink.ignoresSafeArea()
      TimelineView(.animation(paused: freezeAt != nil || finished)) { context in
        let t = freezeAt ?? start.map { context.date.timeIntervalSince($0) } ?? 0
        let frame = reduceMotion ? LaunchFrame.still(t) : LaunchFrame.at(t)
        VStack(spacing: 26) {
          LaunchMark(frame: frame)
            .frame(width: 100, height: 120)
          Text("Basement Ready")
            .font(Brand.display(30))
            .kerning(-0.8)
            .foregroundStyle(Brand.card)
            .opacity(frame.word)
            .offset(y: (1 - frame.word) * 8)
        }
        .opacity(frame.opacity)
        .offset(y: -10)
      }
    }
    .contentShape(Rectangle())
    .onTapGesture { finish() }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Basement Ready")
    .accessibilityHint("Double-tap to skip")
    .accessibilityAddTraits(.isButton)
    .onAppear { if start == nil { start = .now } }
    .task {
      guard freezeAt == nil else { return }
      try? await Task.sleep(for: .seconds(reduceMotion ? LaunchTimeline.stillTotal : LaunchTimeline.total))
      finish()
    }
  }

  private func finish() {
    guard !finished else { return }
    finished = true
    onDone()
  }
}

/// The mark mid-animation, in the light colour on forest.
private struct LaunchMark: View {
  let frame: LaunchFrame

  var body: some View {
    Canvas { ctx, size in
      ctx.concatenate(MarkGeometry.fit(CGRect(origin: .zero, size: size)))
      let light = Brand.card
      if frame.outline == 1, frame.stroke == 0, frame.fill == 1, frame.house == 1, frame.glow == 0, frame.door == 1 {
        // In place: the exact mark.
        ctx.fill(MarkGeometry.mark, with: .color(light), style: FillStyle(eoFill: true))
        return
      }
      let letter = MarkGeometry.letter
      // The B's outline draws itself in.
      if frame.outline > 0, frame.stroke > 0 {
        ctx.stroke(letter.trimmedPath(from: 0, to: frame.outline), with: .color(light.opacity(frame.stroke)),
                   style: StrokeStyle(lineWidth: 2.4, lineCap: .round, lineJoin: .round))
      }
      // It fills, and the house rises into it from below: mint first, then a cut-out.
      var inside = ctx
      inside.clip(to: letter)
      if frame.fill > 0 { inside.fill(letter, with: .color(light.opacity(frame.fill))) }
      if frame.house > 0 {
        let house = MarkGeometry.house.offsetBy(dx: 0, dy: (1 - frame.house) * 64)
        inside.fill(house, with: .color(Brand.ink))
        if frame.glow > 0 { inside.fill(house, with: .color(Brand.mint.opacity(frame.glow))) }
      }
      // The door drops in.
      if frame.door > 0 {
        var room = ctx
        room.clip(to: MarkGeometry.house)
        room.fill(MarkGeometry.door.offsetBy(dx: 0, dy: -(1 - frame.door) * 14), with: .color(light.opacity(Ease.clamp(frame.door * 1.8))))
      }
    }
  }
}
