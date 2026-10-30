// The launch animation, on every cold launch, on the light sheet: the B's outline strokes in like a plan
// wall and fills, a house rises into its lower half (mint for a moment, the scan glow) and settles into a
// cut-out, the door drops in, then "Basement Ready" and a short ink rule under it. It carries on from the
// launch screen (the same light colour) and cross-fades into the app. A tap skips it. With Reduce Motion it's
// the finished mark and rule with a short fade.
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
  /// How a line is drawn in on the sheet: cubic-bezier(0.65, 0, 0.35, 1).
  static func plan(_ x: Double) -> Double { bezier(x, 0.65, 0, 0.35, 1) }

  /// A CSS-style cubic-bezier timing curve from (0, 0) to (1, 1).
  static func bezier(_ x: Double, _ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double) -> Double {
    let x = clamp(x)
    if x == 0 || x == 1 { return x }
    func curve(_ u: Double, _ a: Double, _ b: Double) -> Double { 3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u }
    var lo = 0.0, hi = 1.0, u = x
    for _ in 0..<24 {
      let v = curve(u, x1, x2)
      if abs(v - x) < 1e-6 { break }
      if v < x { lo = u } else { hi = u }
      u = (lo + hi) / 2
    }
    return curve(u, y1, y2)
  }
}

enum LaunchTimeline {
  /// When the cross-fade into the app starts.
  static let total = 1.44
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
  var rule = 1.0 // the ink rule under it, drawn left to right
  var opacity = 1.0 // everything (the Reduce Motion fade)

  static let finished = LaunchFrame()

  static func at(_ t: Double) -> LaunchFrame {
    var f = LaunchFrame()
    f.outline = Ease.plan(Ease.ramp(t, 0, 0.45))
    f.stroke = 1 - Ease.ramp(t, 0.5, 0.56)
    f.fill = Ease.out(Ease.ramp(t, 0.3, 0.52))
    f.house = Ease.out(Ease.ramp(t, 0.54, 0.82))
    f.glow = t < 0.54 ? 0 : 1 - Ease.ramp(t, 0.8, 0.94)
    f.door = Ease.out(Ease.ramp(t, 0.88, 1.04))
    f.word = Ease.out(Ease.ramp(t, 0.96, 1.2))
    f.rule = Ease.plan(Ease.ramp(t, 1.22, 1.42))
    return f
  }

  /// Reduce Motion: the finished mark and rule, fading in. Nothing moves.
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
      Brand.bg.ignoresSafeArea()
      TimelineView(.animation(paused: freezeAt != nil || finished)) { context in
        let t = freezeAt ?? start.map { context.date.timeIntervalSince($0) } ?? 0
        let frame = reduceMotion ? LaunchFrame.still(t) : LaunchFrame.at(t)
        VStack(spacing: 0) {
          LaunchMark(frame: frame)
            .frame(width: 120, height: 144)
          Text("Basement Ready")
            .heading(32)
            .foregroundStyle(Brand.ink)
            .opacity(frame.word)
            .padding(.top, Space.s4)
          Rectangle()
            .fill(Brand.ink)
            .frame(width: 56 * frame.rule, height: 1)
            .frame(width: 56, alignment: .leading)
            .padding(.top, Space.s5)
        }
        .opacity(frame.opacity)
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

/// The mark mid-animation, in ink on the sheet.
private struct LaunchMark: View {
  let frame: LaunchFrame

  var body: some View {
    Canvas { ctx, size in
      let fit = MarkGeometry.fit(CGRect(origin: .zero, size: size))
      ctx.concatenate(fit)
      if frame.outline == 1, frame.stroke == 0, frame.fill == 1, frame.house == 1, frame.glow == 0, frame.door == 1 {
        // In place: the exact mark.
        ctx.fill(MarkGeometry.mark, with: .color(Brand.ink), style: FillStyle(eoFill: true))
        return
      }
      let letter = MarkGeometry.letter
      // The B's outline strokes in, 1.5 pt like a plan wall.
      if frame.outline > 0, frame.stroke > 0 {
        ctx.stroke(letter.trimmedPath(from: 0, to: frame.outline), with: .color(Brand.ink.opacity(frame.stroke)),
                   style: StrokeStyle(lineWidth: 1.5 / fit.a, lineCap: .square, lineJoin: .miter))
      }
      // The fill follows, and the house rises into it from below: mint for a moment, then a cut-out.
      var inside = ctx
      inside.clip(to: letter)
      if frame.fill > 0 { inside.fill(letter, with: .color(Brand.ink.opacity(frame.fill))) }
      if frame.house > 0 {
        let house = MarkGeometry.house.offsetBy(dx: 0, dy: (1 - frame.house) * 64)
        inside.fill(house, with: .color(Brand.bg))
        if frame.glow > 0 { inside.fill(house, with: .color(Brand.mint.opacity(frame.glow))) }
      }
      // The door drops in.
      if frame.door > 0 {
        var room = ctx
        room.clip(to: MarkGeometry.house)
        room.fill(MarkGeometry.door.offsetBy(dx: 0, dy: -(1 - frame.door) * 12), with: .color(Brand.ink.opacity(Ease.clamp(frame.door * 1.8))))
      }
    }
  }
}
