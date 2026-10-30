// The guide's drawings: plan-symbol line drawings in ink on the sheet, like the rest of the drawing set.
// 1.5 pt lines with square caps; thin lines and dashes for paths and sightlines; a wall drawn thick once it's
// filmed (the live map fills in the same way). Mint only as a fill, on the spot that was missed. Each drawing
// strokes in once and holds. With Reduce Motion it's the finished drawing, still.
import SwiftUI

struct GuideVisual: View {
  enum Kind {
    case stairs, walls, doorway, missedSpot

    var label: String {
      switch self {
      case .stairs: "Drawing: a phone held upright at the top of the basement stairs, with an arrow down the stairs."
      case .walls: "Plan drawing: the phone goes round the room about 2 metres from the walls. Each wall it has filmed is drawn thick."
      case .doorway: "Plan drawing: the phone stands in a room's doorway and pans across it, and the room's walls are drawn thick."
      case .missedSpot: "Plan drawing: one stretch of wall is marked in mint, not filmed yet. The phone turns back to point at it."
      }
    }
  }

  let kind: Kind
  var playing = true
  var freezeAt: Double?
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var start: Date?
  @State private var drawn = false

  var body: some View {
    TimelineView(.animation(paused: !playing || drawn || reduceMotion || freezeAt != nil)) { context in
      // nil: the finished drawing. Before its sheet has been shown, an empty one.
      let t: Double? = reduceMotion || drawn ? nil : (freezeAt ?? start.map { context.date.timeIntervalSince($0) } ?? 0)
      Canvas { ctx, size in
        Sketch.of(kind).draw(at: t, in: &ctx, size: size)
      }
    }
    .task(id: playing) { await strokeIn() }
    .accessibilityElement()
    .accessibilityLabel(kind.label)
    .accessibilityAddTraits(.isImage)
  }

  /// Draws once, the first time the sheet is shown; it's still there when you come back.
  private func strokeIn() async {
    guard playing, !drawn, !reduceMotion, freezeAt == nil else { return }
    let begun = start ?? .now
    if start == nil { start = begun }
    let left = Sketch.of(kind).length - Date.now.timeIntervalSince(begun)
    do {
      if left > 0 { try await Task.sleep(for: .seconds(left)) }
    } catch {
      return
    }
    drawn = true
  }
}

/// A drawing as a list of marks, each drawn in over its own stretch of time.
struct Sketch {
  enum Mark {
    case line(Path, width: CGFloat, dash: [CGFloat]) // drawn in along its length
    case wall(Path) // a filmed wall: thick ink, drawn in along its length
    case fill(Path, Color) // fades in
    case label(String, at: CGPoint, anchor: UnitPoint) // a figure, mono 12
  }

  struct Step {
    let mark: Mark
    let from: Double
    let to: Double
  }

  /// The part of the 300 × 300 layout the drawing uses; it's scaled to fit, but lines stay their own width.
  let bounds: CGRect
  private(set) var steps: [Step] = []
  var length: Double { steps.map(\.to).max() ?? 0 }

  static let line: CGFloat = 1.5
  static let thin: CGFloat = 1
  static let dash: [CGFloat] = [4, 4]

  mutating func add(_ mark: Mark, _ from: Double, _ to: Double) {
    steps.append(Step(mark: mark, from: from, to: to))
  }

  func draw(at t: Double?, in ctx: inout GraphicsContext, size: CGSize) {
    let pad: CGFloat = 12
    let s = min((size.width - 2 * pad) / bounds.width, (size.height - 2 * pad) / bounds.height)
    guard s > 0 else { return }
    let fit = CGAffineTransform(translationX: (size.width - bounds.width * s) / 2 - bounds.minX * s,
                                y: (size.height - bounds.height * s) / 2 - bounds.minY * s).scaledBy(x: s, y: s)
    for step in steps {
      let p = t.map { Ease.plan(Ease.ramp($0, step.from, step.to)) } ?? 1
      guard p > 0 else { continue }
      switch step.mark {
      case .line(let path, let width, let dash):
        ctx.stroke(path.applying(fit).trimmedPath(from: 0, to: p), with: .color(Brand.ink),
                   style: StrokeStyle(lineWidth: width, lineCap: dash.isEmpty ? .square : .butt, lineJoin: .miter, dash: dash))
      case .wall(let path):
        ctx.stroke(path.applying(fit).trimmedPath(from: 0, to: p), with: .color(Brand.ink),
                   style: StrokeStyle(lineWidth: 5, lineCap: .square, lineJoin: .miter))
      case .fill(let path, let color):
        ctx.fill(path.applying(fit), with: .color(color.opacity(p)))
      case .label(let text, let at, let anchor):
        var figure = ctx
        figure.opacity = p
        figure.draw(figure.resolve(Text(text).font(Brand.mono(12)).foregroundStyle(Brand.ink)), at: at.applying(fit), anchor: anchor)
      }
    }
  }

  static func of(_ kind: GuideVisual.Kind) -> Sketch {
    switch kind {
    case .stairs: stairs()
    case .walls: walls()
    case .doorway: doorway()
    case .missedSpot: missedSpot()
    }
  }

  // MARK: 1. Start at the stairs (a section)

  static func stairs() -> Sketch {
    var s = Sketch(bounds: CGRect(x: 0, y: 30, width: 300, height: 240))
    let groundY: CGFloat = 84, slabY: CGFloat = 104, floorY: CGFloat = 262
    let leftX: CGFloat = 8, farX: CGFloat = 292, topX: CGFloat = 104, bottomX: CGFloat = 220, openEnd: CGFloat = 178
    let steps = 7
    let run = (bottomX - topX) / CGFloat(steps), rise = (floorY - groundY) / CGFloat(steps)

    // The basement, cut through: walls and floor, then the ground floor slab with the stair opening.
    s.add(.line(polyline([CGPoint(x: leftX, y: groundY), CGPoint(x: leftX, y: floorY), CGPoint(x: farX, y: floorY), CGPoint(x: farX, y: groundY)]),
                width: line, dash: []), 0, 0.55)
    let slabs = [CGRect(x: leftX, y: groundY, width: topX - leftX, height: slabY - groundY),
                 CGRect(x: openEnd, y: groundY, width: farX - openEnd, height: slabY - groundY)]
    s.add(.line(Path { p in slabs.forEach { p.addRect($0) } }, width: line, dash: []), 0.1, 0.55)
    s.add(.line(Path { p in slabs.forEach { p.addPath(hatch($0, spacing: 7)) } }, width: thin, dash: []), 0.45, 0.8)

    // The stairs.
    var profile = [CGPoint(x: topX, y: groundY)]
    for i in 0..<steps {
      let x = topX + CGFloat(i) * run, y = groundY + CGFloat(i + 1) * rise
      profile.append(CGPoint(x: x, y: y))
      profile.append(CGPoint(x: x + run, y: y))
    }
    s.add(.line(polyline(profile), width: line, dash: []), 0.3, 0.85)
    s.add(.line(polyline([CGPoint(x: topX, y: groundY + 34), CGPoint(x: bottomX - 36, y: floorY)]), width: thin, dash: []), 0.55, 0.85)

    // The phone at the top, upright, and the way down.
    let phone = CGRect(x: 67, y: 38, width: 14, height: 24)
    s.add(.line(Path(roundedRect: phone, cornerRadius: 3), width: line, dash: []), 0.75, 0.95)
    s.add(.fill(circle(CGPoint(x: phone.midX, y: phone.minY + 5), 1.6), Brand.ink), 0.9, 1)
    let route = [CGPoint(x: 88, y: 50), CGPoint(x: 108, y: 50), CGPoint(x: 214, y: 214), CGPoint(x: 246, y: 214)]
    s.add(.line(polyline(route), width: thin, dash: dash), 0.95, 1.55)
    s.add(.line(arrow(to: route[3], from: route[2]), width: thin, dash: []), 1.5, 1.6)
    return s
  }

  // MARK: 2. Sweep each wall slowly, about 2 m back (a plan)

  static func walls() -> Sketch {
    var s = Sketch(bounds: CGRect(x: 22, y: 32, width: 256, height: 236))
    let room = CGRect(x: 30, y: 40, width: 240, height: 220)
    let tl = CGPoint(x: room.minX, y: room.minY), tr = CGPoint(x: room.maxX, y: room.minY)
    let br = CGPoint(x: room.maxX, y: room.maxY), bl = CGPoint(x: room.minX, y: room.maxY)
    s.add(.line(polyline([tl, tr, br, bl, tl]), width: line, dash: []), 0, 0.5)

    // The way round, 2 m in from the walls; each wall is drawn thick as it's filmed.
    let walk = [CGPoint(x: 150, y: 80), CGPoint(x: 230, y: 80), CGPoint(x: 230, y: 220), CGPoint(x: 70, y: 220), CGPoint(x: 70, y: 150)]
    s.add(.line(circle(walk[0], 3), width: thin, dash: []), 0.45, 0.5) // where the walk starts
    s.add(.line(polyline([CGPoint(x: walk[0].x + 3, y: walk[0].y)] + walk.dropFirst()), width: thin, dash: dash), 0.5, 1.45)
    s.add(.wall(polyline([tl, tr])), 0.55, 0.8)
    s.add(.wall(polyline([tr, br])), 0.8, 1.05)
    s.add(.wall(polyline([br, bl])), 1.05, 1.3)

    // The phone on the last wall, and what it sees.
    let phone = walk[4]
    s.add(.fill(circle(phone, 5), Brand.ink), 1.45, 1.55)
    s.add(.line(polyline([CGPoint(x: room.minX, y: 124), phone, CGPoint(x: room.minX, y: 176)]), width: thin, dash: []), 1.5, 1.7)

    // About 2 m, between the way round and the bottom wall.
    let a = CGPoint(x: 190, y: 220), b = CGPoint(x: 190, y: room.maxY)
    var dimension = polyline([a, b])
    dimension.addPath(tick(a))
    dimension.addPath(tick(b))
    s.add(.line(dimension, width: thin, dash: []), 1.5, 1.7)
    s.add(.label("2 m", at: CGPoint(x: 198, y: 240), anchor: .leading), 1.6, 1.75)
    return s
  }

  // MARK: 3. No need to walk in: stand in the doorway and pan (a plan)

  static func doorway() -> Sketch {
    var s = Sketch(bounds: CGRect(x: 10, y: 30, width: 280, height: 232))
    let room = CGRect(x: 60, y: 40, width: 180, height: 150)
    let doorL: CGFloat = 132, doorR: CGFloat = 168, wallY = room.maxY
    s.add(.line(polyline([CGPoint(x: doorL, y: wallY), CGPoint(x: room.minX, y: wallY), CGPoint(x: room.minX, y: room.minY),
                          CGPoint(x: room.maxX, y: room.minY), CGPoint(x: room.maxX, y: wallY), CGPoint(x: doorR, y: wallY)]),
                width: line, dash: []), 0, 0.5)
    // The hall outside.
    var hall = polyline([CGPoint(x: 16, y: wallY), CGPoint(x: room.minX, y: wallY)])
    hall.addPath(polyline([CGPoint(x: room.maxX, y: wallY), CGPoint(x: 284, y: wallY)]))
    hall.addPath(polyline([CGPoint(x: 16, y: 256), CGPoint(x: 284, y: 256)]))
    s.add(.line(hall, width: line, dash: []), 0.1, 0.5)

    // The door, open into the room.
    s.add(.line(polyline([CGPoint(x: doorR, y: wallY), CGPoint(x: doorR, y: wallY - (doorR - doorL))]), width: line, dash: []), 0.4, 0.55)
    var swing = Path()
    swing.move(to: CGPoint(x: doorR, y: wallY - (doorR - doorL)))
    swing.addArc(center: CGPoint(x: doorR, y: wallY), radius: doorR - doorL, startAngle: .degrees(270), endAngle: .degrees(180), clockwise: true)
    s.add(.line(swing, width: thin, dash: []), 0.5, 0.7)

    // Walk up to the doorway and stop there; pan across the room.
    let phone = CGPoint(x: 150, y: 204)
    s.add(.line(polyline([CGPoint(x: phone.x, y: 248), CGPoint(x: phone.x, y: phone.y + 10)]), width: thin, dash: dash), 0.55, 0.75)
    s.add(.fill(circle(phone, 5), Brand.ink), 0.75, 0.85)
    let r: CGFloat = 70
    var pan = Path()
    pan.addArc(center: phone, radius: r, startAngle: .degrees(215), endAngle: .degrees(325), clockwise: false)
    let left = point(phone, r, 215), right = point(phone, r, 325)
    pan.addPath(arrow(to: right, from: point(phone, r, 318)))
    pan.addPath(arrow(to: left, from: point(phone, r, 222)))
    s.add(.line(pan, width: thin, dash: []), 0.85, 1.2)

    // The room's walls, drawn thick as the pan films them.
    s.add(.wall(polyline([CGPoint(x: room.minX, y: wallY), CGPoint(x: room.minX, y: room.minY),
                          CGPoint(x: room.maxX, y: room.minY), CGPoint(x: room.maxX, y: wallY)])), 1.1, 1.7)
    return s
  }

  // MARK: 4. Missed a spot? Point back at it (a plan)

  static func missedSpot() -> Sketch {
    var s = Sketch(bounds: CGRect(x: 22, y: 32, width: 264, height: 236))
    let room = CGRect(x: 30, y: 40, width: 240, height: 220)
    let gapTop = CGPoint(x: room.maxX, y: 112), gapBottom = CGPoint(x: room.maxX, y: 188)

    // The missed stretch, marked in mint under the line.
    s.add(.fill(Path(CGRect(x: room.maxX - 8, y: gapTop.y, width: 16, height: gapBottom.y - gapTop.y)), Brand.mint), 0.9, 1.05)
    s.add(.line(Path(room), width: line, dash: []), 0, 0.45)
    s.add(.wall(polyline([gapBottom, CGPoint(x: room.maxX, y: room.maxY), CGPoint(x: room.minX, y: room.maxY),
                          CGPoint(x: room.minX, y: room.minY), CGPoint(x: room.maxX, y: room.minY), gapTop])), 0.3, 0.95)

    // The phone turns back to it.
    let phone = CGPoint(x: 120, y: 172)
    s.add(.fill(circle(phone, 5), Brand.ink), 1.0, 1.1)
    let r: CGFloat = 26
    var turn = Path()
    turn.addArc(center: phone, radius: r, startAngle: .degrees(225), endAngle: .degrees(345), clockwise: false)
    turn.addPath(arrow(to: point(phone, r, 345), from: point(phone, r, 335)))
    s.add(.line(turn, width: thin, dash: []), 1.05, 1.4)
    s.add(.line(polyline([gapTop, phone, gapBottom]), width: thin, dash: [3, 3]), 1.35, 1.65)
    return s
  }

  // MARK: Pieces

  static func polyline(_ points: [CGPoint]) -> Path {
    var p = Path()
    p.addLines(points)
    return p
  }

  static func circle(_ c: CGPoint, _ r: CGFloat) -> Path {
    Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
  }

  /// A point at an angle (degrees, clockwise from +x on screen) round a centre.
  static func point(_ c: CGPoint, _ r: CGFloat, _ degrees: Double) -> CGPoint {
    let a = degrees * .pi / 180
    return CGPoint(x: c.x + r * CGFloat(cos(a)), y: c.y + r * CGFloat(sin(a)))
  }

  /// An open arrowhead at the tip, pointing away from the tail.
  static func arrow(to tip: CGPoint, from tail: CGPoint, size: CGFloat = 7) -> Path {
    let a = atan2(Double(tip.y - tail.y), Double(tip.x - tail.x))
    var p = Path()
    p.move(to: CGPoint(x: tip.x - size * CGFloat(cos(a - 0.5)), y: tip.y - size * CGFloat(sin(a - 0.5))))
    p.addLine(to: tip)
    p.addLine(to: CGPoint(x: tip.x - size * CGFloat(cos(a + 0.5)), y: tip.y - size * CGFloat(sin(a + 0.5))))
    return p
  }

  /// A dimension tick: the architect's short 45° slash.
  static func tick(_ at: CGPoint) -> Path {
    polyline([CGPoint(x: at.x - 4, y: at.y + 4), CGPoint(x: at.x + 4, y: at.y - 4)])
  }

  /// Section hatching for a cut slab: 45° lines inside the rect.
  static func hatch(_ r: CGRect, spacing: CGFloat) -> Path {
    var p = Path()
    var c = r.minX + r.minY + spacing
    while c < r.maxX + r.maxY {
      let x0 = max(r.minX, c - r.maxY), x1 = min(r.maxX, c - r.minY)
      if x1 > x0 {
        p.move(to: CGPoint(x: x0, y: c - x0))
        p.addLine(to: CGPoint(x: x1, y: c - x1))
      }
      c += spacing
    }
    return p
  }
}
