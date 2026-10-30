// The guide's drawings, in the live map's own look (MapView): forest ground, light walls once filmed, glowing
// mint dashes where nobody has looked yet, the camera as a mint dot with its view cone. Each one loops calmly;
// with Reduce Motion it's the last frame, still.
import SwiftUI

struct GuideVisual: View {
  enum Kind {
    case stairs, walls, doorway, missedSpot

    var label: String {
      switch self {
      case .stairs: "Drawing: a phone held upright goes down the stairs into the basement, filming ahead."
      case .walls: "Drawing from above: the phone moves along each wall about 2 metres back, and each wall fills in once it's filmed."
      case .doorway: "Drawing from above: the phone stays in a room's doorway and pans across the room, and the room fills in."
      case .missedSpot: "Drawing from above: a missed part of the wall glows. The phone turns back to it and it fills in."
      }
    }
  }

  let kind: Kind
  var playing = true
  var freezeAt: Double?
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var start = Date()

  var body: some View {
    TimelineView(.animation(paused: !playing || reduceMotion || freezeAt != nil)) { context in
      // nil: the finished drawing.
      let t: Double? = reduceMotion ? nil : (freezeAt ?? max(0, context.date.timeIntervalSince(start)))
      Canvas { ctx, size in
        GuideDrawing.draw(kind, t: t, in: &ctx, size: size)
      }
    }
    .onChange(of: playing) { _, now in
      if now { start = .now }
    }
    .accessibilityElement()
    .accessibilityLabel(kind.label)
    .accessibilityAddTraits(.isImage)
  }
}

enum GuideDrawing {
  static let light = Brand.bg
  static let floorFill = Color(hex: 0x24432F) // the live map's floor
  static let filmed = Brand.mint.opacity(0.42) // the live map's filmed floor
  /// Every drawing is laid out in a 300 × 300 space; this is the part it uses, which is scaled to fit the card.
  static func bounds(_ kind: GuideVisual.Kind) -> CGRect {
    switch kind {
    case .stairs: CGRect(x: 10, y: 6, width: 280, height: 244)
    case .walls: CGRect(x: 18, y: 26, width: 264, height: 248)
    case .doorway: CGRect(x: 10, y: 26, width: 280, height: 240)
    case .missedSpot: CGRect(x: 18, y: 30, width: 264, height: 240)
    }
  }

  static func draw(_ kind: GuideVisual.Kind, t: Double?, in ctx: inout GraphicsContext, size: CGSize) {
    let b = bounds(kind), pad: CGFloat = 22
    let s = min((size.width - 2 * pad) / b.width, (size.height - 2 * pad) / b.height)
    guard s > 0 else { return }
    ctx.translateBy(x: (size.width - b.width * s) / 2 - b.minX * s, y: (size.height - b.height * s) / 2 - b.minY * s)
    ctx.scaleBy(x: s, y: s)
    switch kind {
    case .stairs: stairs(&ctx, t)
    case .walls: walls(&ctx, t)
    case .doorway: doorway(&ctx, t)
    case .missedSpot: missedSpot(&ctx, t)
    }
  }

  // MARK: 1. Start at the stairs (a cutaway from the side)

  static func stairs(_ ctx: inout GraphicsContext, _ time: Double?) {
    let period = 5.6
    let t = time.map { $0.truncatingRemainder(dividingBy: period) }
    let p = t.map { Ease.inOut(Ease.ramp($0, 0.6, 3.8)) } ?? 1
    let o = t.map { presence($0, period: period, fadeIn: 0.3, fadeOut: 0.6) } ?? 1

    let groundY: CGFloat = 70, ceilY: CGFloat = 94, floorY: CGFloat = 246
    let leftX: CGFloat = 16, farX: CGFloat = 284
    let topX: CGFloat = 96, bottomX: CGFloat = 212, openingEnd: CGFloat = 172
    let steps = 7
    let run = (bottomX - topX) / CGFloat(steps), rise = (floorY - groundY) / CGFloat(steps)

    // The ground floor, cut through, with the opening over the stairs.
    let slab = Path { p in
      p.addRect(CGRect(x: leftX, y: groundY, width: topX - leftX, height: ceilY - groundY))
      p.addRect(CGRect(x: openingEnd, y: groundY, width: farX - openingEnd, height: ceilY - groundY))
    }
    ctx.fill(slab, with: .color(light.opacity(0.14)))
    var ground = Path()
    ground.move(to: CGPoint(x: leftX, y: groundY))
    ground.addLine(to: CGPoint(x: topX, y: groundY))
    ground.move(to: CGPoint(x: openingEnd, y: groundY))
    ground.addLine(to: CGPoint(x: farX, y: groundY))
    ctx.stroke(ground, with: .color(light), style: StrokeStyle(lineWidth: 3, lineCap: .round))

    // The basement: walls and floor.
    var shell = Path()
    shell.move(to: CGPoint(x: leftX, y: groundY))
    shell.addLine(to: CGPoint(x: leftX, y: floorY))
    shell.addLine(to: CGPoint(x: farX, y: floorY))
    shell.addLine(to: CGPoint(x: farX, y: groundY))
    ctx.stroke(shell, with: .color(light), style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))

    // The stairs.
    var profile: [CGPoint] = [CGPoint(x: topX, y: groundY)]
    for i in 0..<steps {
      let x = topX + CGFloat(i) * run, y = groundY + CGFloat(i + 1) * rise
      profile.append(CGPoint(x: x, y: y))
      profile.append(CGPoint(x: x + run, y: y))
    }
    var mass = Path()
    mass.addLines(profile + [CGPoint(x: bottomX - 28, y: floorY), CGPoint(x: topX, y: groundY + 40)])
    mass.closeSubpath()
    ctx.fill(mass, with: .color(light.opacity(0.12)))
    ctx.stroke(polyline(profile), with: .color(light), style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))

    // What the phone has filmed: points on the far wall, then the floor.
    var dots: [CGPoint] = []
    for y in stride(from: 102.0, through: 238.0, by: 12) { dots.append(CGPoint(x: farX - 7, y: y)) }
    for x in stride(from: 268.0, through: 232.0, by: -12) { dots.append(CGPoint(x: x, y: floorY - 7)) }
    for (i, d) in dots.enumerated() {
      let when = 0.12 + 0.8 * Double(i) / Double(dots.count)
      let a = Ease.ramp(p, when, when + 0.06) * o
      if a > 0 { ctx.fill(circle(d, 2.8), with: .color(Brand.mint.opacity(a))) }
    }

    // The phone goes down the stairs, upright, filming ahead.
    let route = [CGPoint(x: 70, y: 24), CGPoint(x: 96, y: 24), CGPoint(x: 212, y: 198), CGPoint(x: 236, y: 198)]
    let at = along(route, p)
    var air = Path()
    air.addRect(CGRect(x: leftX, y: -40, width: farX - leftX, height: groundY + 40))
    air.addRect(CGRect(x: topX, y: groundY - 1, width: openingEnd - topX, height: ceilY - groundY + 2))
    air.addRect(CGRect(x: leftX, y: ceilY, width: farX - leftX, height: floorY - ceilY))
    var seeing = ctx
    seeing.clip(to: air)
    cone(&seeing, at: at, heading: 1.95, reach: 128, half: 0.48, opacity: o)
    ctx.stroke(polyline(partial(route, p)), with: .color(light.opacity(0.45 * o)), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round, dash: [1, 5]))
    let body = CGRect(x: at.x - 7, y: at.y - 12, width: 14, height: 24)
    ctx.fill(Path(roundedRect: body, cornerRadius: 3.5), with: .color(light.opacity(o)))
    ctx.fill(Path(roundedRect: body.insetBy(dx: 2.2, dy: 2.6), cornerRadius: 1.8), with: .color(Brand.mint.opacity(o)))

    var label = ctx
    label.opacity = 0.8
    label.draw(label.resolve(Text("Start").font(Brand.body(12, .semibold)).foregroundStyle(light)), at: CGPoint(x: 54, y: 24), anchor: .trailing)
  }

  // MARK: 2. Sweep each wall slowly, about 2 m back (from above)

  static func walls(_ ctx: inout GraphicsContext, _ time: Double?) {
    let period = 8.6
    let t = time.map { $0.truncatingRemainder(dividingBy: period) }
    let o = t.map { presence($0, period: period, fadeIn: 0.4, fadeOut: 0.8) } ?? 1

    let rect = CGRect(x: 28, y: 36, width: 244, height: 228)
    let inset: CGFloat = 50 // 2 m
    let outer = [CGPoint(x: rect.minX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.maxY), CGPoint(x: rect.minX, y: rect.maxY)]
    let inner = outer.enumerated().map { i, p in CGPoint(x: p.x + (i == 0 || i == 3 ? inset : -inset), y: p.y + (i < 2 ? inset : -inset)) }
    let outward = [CGPoint(x: 0, y: -1), CGPoint(x: 1, y: 0), CGPoint(x: 0, y: 1), CGPoint(x: -1, y: 0)]

    // The walk, one unit per wall: along the wall 2 m back, facing it, then a turn at the corner. It gives where
    // the camera is (on the inner loop), which way it faces, and the spot on the walls it faces (on the outer loop).
    let turnAt = 0.78
    func corner(_ k: Int) -> Double { Double(inset / (k % 2 == 0 ? rect.width : rect.height)) }
    func walk(_ w: Double) -> (at: Double, heading: Double, facing: Double, along: Double?) {
      let k = Int(w.rounded(.down)), f = w - Double(k)
      let here = corner(k), next = corner(k + 1)
      if f < turnAt {
        let m = f / turnAt
        return (Double(k) + m, Double(k) * .pi / 2, Double(k) + here + (1 - 2 * here) * m, m)
      }
      let r = Ease.inOut((f - turnAt) / (1 - turnAt))
      return (Double(k + 1), (Double(k) + r) * .pi / 2, Double(k + 1) - here + (here + next) * r, nil)
    }
    let w0 = 0.39 // halfway along the top wall
    let w = w0 + (t.map { 4 * Ease.inOut(Ease.ramp($0, 0.6, 6.6)) } ?? 4)
    let first = walk(w0), now = walk(w)
    let spread = 0.11 // the cone's width on the wall
    let start = first.facing - spread, end = min(now.facing + spread, start + 4)

    let room = Path(rect)
    ctx.fill(room, with: .color(floorFill))
    let done = polyline(loop(outer, start, end))
    var band = ctx
    band.clip(to: room)
    band.stroke(done, with: .color(Brand.mint.opacity(0.3 * o)), style: StrokeStyle(lineWidth: 80, lineCap: .butt, lineJoin: .miter))

    if start + 4 - end > 0.001 { glow(&ctx, polyline(loop(outer, end, start + 4)), time) }
    if o < 1 { glow(&ctx, done, time, opacity: 1 - o) }
    wall(&ctx, done, opacity: o)
    if now.at - first.at > 0.001 {
      ctx.stroke(polyline(loop(inner, first.at, now.at)), with: .color(light.opacity(0.45 * o)),
                 style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round, dash: [1, 5]))
    }

    let c = point(inner, now.at)
    var seeing = ctx
    seeing.clip(to: room)
    cone(&seeing, at: c, heading: now.heading, reach: 66, half: 0.5, opacity: o)
    dot(&ctx, at: c, opacity: o)

    // About 2 m: beside the cone, from the camera's path to the wall, while it walks along a wall.
    guard let m = now.along else { return }
    let k = Int(w.rounded(.down)) % 4
    let n = outward[k]
    let back = unit(CGPoint(x: inner[k].x - inner[(k + 1) % 4].x, y: inner[k].y - inner[(k + 1) % 4].y))
    let a = CGPoint(x: c.x + back.x * 32 + n.x * 5, y: c.y + back.y * 32 + n.y * 5)
    let b = CGPoint(x: c.x + back.x * 32 + n.x * (inset - 5), y: c.y + back.y * 32 + n.y * (inset - 5))
    let dimOpacity = o * min(Ease.ramp(m, 0.08, 0.2), 1 - Ease.ramp(m, 0.8, 0.95))
    if dimOpacity > 0 {
      var dim = ctx
      dim.opacity = dimOpacity
      let tick = CGPoint(x: -n.y * 5, y: n.x * 5)
      var line = Path()
      line.move(to: a)
      line.addLine(to: b)
      for end in [a, b] {
        line.move(to: CGPoint(x: end.x - tick.x, y: end.y - tick.y))
        line.addLine(to: CGPoint(x: end.x + tick.x, y: end.y + tick.y))
      }
      dim.stroke(line, with: .color(light.opacity(0.85)), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
      let mid = CGPoint(x: (a.x + b.x) / 2 + back.x * 20, y: (a.y + b.y) / 2 + back.y * 20)
      dim.draw(dim.resolve(Text("2 m").font(Brand.mono(13)).foregroundStyle(light)), at: mid, anchor: .center)
    }
  }

  // MARK: 3. No need to walk in: stand in the doorway and pan (from above)

  static func doorway(_ ctx: inout GraphicsContext, _ time: Double?) {
    let period = 7.0
    let t = time.map { $0.truncatingRemainder(dividingBy: period) }
    let swing = 70 * Double.pi / 180, half = 0.42
    var heading = 0.0, reached = swing, o = 1.0
    if let t {
      let across = Ease.inOut(Ease.ramp(t, 0.8, 3.8)), back = Ease.inOut(Ease.ramp(t, 3.8, 4.8))
      reached = -swing + 2 * swing * across
      heading = reached - swing * back
      o = presence(t, period: period, fadeIn: 0.4, fadeOut: 0.8)
    }
    let lo = -swing - half, hi = reached + half // what the cone has swept, edge to edge

    let room = CGRect(x: 54, y: 34, width: 192, height: 150)
    let doorL: CGFloat = 132, doorR: CGFloat = 168, wallY = room.maxY
    let c = CGPoint(x: 150, y: 196)

    // The basement outside the room, then the room.
    ctx.fill(Path(CGRect(x: 14, y: wallY, width: 272, height: 80)), with: .color(floorFill))
    ctx.fill(Path(room), with: .color(floorFill))
    var swept = Path()
    swept.move(to: c)
    swept.addArc(center: c, radius: 320, startAngle: .radians(lo - .pi / 2), endAngle: .radians(hi - .pi / 2), clockwise: false)
    swept.closeSubpath()
    var inRoom = ctx
    inRoom.clip(to: Path(room))
    inRoom.fill(swept, with: .color(Brand.mint.opacity(0.42 * o)))

    // The wall with the doorway in it, already filmed from outside.
    var front = Path()
    front.move(to: CGPoint(x: 14, y: wallY))
    front.addLine(to: CGPoint(x: doorL, y: wallY))
    front.move(to: CGPoint(x: doorR, y: wallY))
    front.addLine(to: CGPoint(x: 286, y: wallY))
    wall(&ctx, front)

    // The room's other walls fill in as the cone passes them.
    let corners = [CGPoint(x: room.minX, y: wallY), CGPoint(x: room.minX, y: room.minY), CGPoint(x: room.maxX, y: room.minY), CGPoint(x: room.maxX, y: wallY)]
    var samples: [CGPoint] = []
    for i in 0..<3 {
      for j in 0...60 where !(j == 0 && i > 0) {
        samples.append(lerp(corners[i], corners[i + 1], Double(j) / 60))
      }
    }
    let angles = samples.map { atan2(Double($0.x - c.x), Double(c.y - $0.y)) }
    let first = angles.firstIndex { $0 >= lo } ?? samples.count
    let last = angles.lastIndex { $0 <= hi } ?? -1
    if first > 0 { glow(&ctx, polyline(Array(samples[...min(first, samples.count - 1)])), time) }
    if last < samples.count - 1 { glow(&ctx, polyline(Array(samples[max(last, 0)...])), time) }
    if last > first {
      let done = polyline(Array(samples[first...last]))
      if o < 1 { glow(&ctx, done, time, opacity: 1 - o) }
      wall(&ctx, done, opacity: o)
    }

    // The door, swung open against the room's wall.
    var door = Path()
    door.move(to: CGPoint(x: doorR, y: wallY))
    door.addLine(to: CGPoint(x: doorR, y: wallY - (doorR - doorL)))
    door.addArc(center: CGPoint(x: doorR, y: wallY), radius: doorR - doorL, startAngle: .degrees(270), endAngle: .degrees(180), clockwise: true)
    ctx.stroke(door, with: .color(light.opacity(0.35)), lineWidth: 1.5)

    // They walked up to the door and stopped.
    var trail = Path()
    trail.move(to: CGPoint(x: c.x, y: 262))
    trail.addLine(to: CGPoint(x: c.x, y: c.y + 16))
    ctx.stroke(trail, with: .color(light.opacity(0.45)), style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [1, 5]))

    var seeing = ctx
    seeing.clip(to: Path(room).union(Path(CGRect(x: doorL, y: wallY - 1, width: doorR - doorL, height: 40))))
    cone(&seeing, at: c, heading: heading, reach: 210, half: half, opacity: o)
    dot(&ctx, at: c, opacity: o)

    var label = ctx
    label.opacity = 0.8
    label.draw(label.resolve(Text("Stand here").font(Brand.body(12, .semibold)).foregroundStyle(light)), at: CGPoint(x: c.x + 20, y: c.y + 8), anchor: .leading)
  }

  // MARK: 4. Missed a spot? It glows. Point back at it (from above)

  static func missedSpot(_ ctx: inout GraphicsContext, _ time: Double?) {
    let period = 7.0
    let t = time.map { $0.truncatingRemainder(dividingBy: period) }
    let room = CGRect(x: 28, y: 40, width: 244, height: 220)
    let gapTop = CGPoint(x: room.maxX, y: 118), gapBottom = CGPoint(x: room.maxX, y: 194)
    let patch = CGRect(x: 214, y: 112, width: room.maxX - 214, height: 88)
    let c = CGPoint(x: 116, y: 178)
    let away = -0.8
    let toward = atan2(Double(room.maxX - c.x), Double(c.y - (gapTop.y + gapBottom.y) / 2))

    var heading = toward, fill = 1.0, ring = 0.0, o = 1.0
    if let t {
      heading = away + (toward - away) * Ease.inOut(Ease.ramp(t, 1.6, 2.8))
      fill = Ease.inOut(Ease.ramp(t, 2.9, 3.9)) * (1 - Ease.ramp(t, 6.1, 6.8))
      ring = Ease.ramp(t, 3.85, 4.75)
      o = presence(t, period: period, fadeIn: 0.4, fadeOut: 0.7)
    }

    // Filmed floor, except the patch by the gap.
    ctx.fill(Path(room), with: .color(floorFill))
    var filmedFloor = Path(room)
    filmedFloor.addRect(patch)
    ctx.fill(filmedFloor, with: .color(filmed), style: FillStyle(eoFill: true))
    ctx.fill(Path(patch), with: .color(Brand.mint.opacity(0.42 * fill)))

    // Every wall but the gap.
    var walls = Path()
    walls.move(to: gapBottom)
    walls.addLine(to: CGPoint(x: room.maxX, y: room.maxY))
    walls.addLine(to: CGPoint(x: room.minX, y: room.maxY))
    walls.addLine(to: CGPoint(x: room.minX, y: room.minY))
    walls.addLine(to: CGPoint(x: room.maxX, y: room.minY))
    walls.addLine(to: gapTop)
    wall(&ctx, walls)

    // The gap glows until it's filmed, then fills in from the top.
    var gap = Path()
    gap.move(to: gapTop)
    gap.addLine(to: gapBottom)
    if fill < 1 { glow(&ctx, gap, time, opacity: 1 - fill) }
    if fill > 0 { wall(&ctx, gap.trimmedPath(from: 0, to: fill)) }
    if ring > 0, ring < 1 {
      let mid = CGPoint(x: room.maxX, y: (gapTop.y + gapBottom.y) / 2)
      var inRoom = ctx
      inRoom.clip(to: Path(room))
      inRoom.stroke(circle(mid, 10 + 34 * Ease.out(ring)), with: .color(Brand.mint.opacity(0.8 * (1 - ring))), lineWidth: 3)
    }

    var seeing = ctx
    seeing.clip(to: Path(room))
    cone(&seeing, at: c, heading: heading, reach: 172, half: 0.5, opacity: o)
    dot(&ctx, at: c, opacity: o)
  }

  // MARK: Pieces

  /// 0 → 1 as a loop starts, 1 → 0 as it ends.
  static func presence(_ t: Double, period: Double, fadeIn: Double, fadeOut: Double) -> Double {
    min(Ease.ramp(t, 0, fadeIn), 1 - Ease.ramp(t, period - fadeOut, period))
  }

  /// The camera's view cone and dot, as on the live map. Heading: radians clockwise from straight up.
  static func cone(_ ctx: inout GraphicsContext, at c: CGPoint, heading: Double, reach: CGFloat, half: Double, opacity: Double) {
    var cone = Path()
    cone.move(to: c)
    cone.addArc(center: c, radius: reach, startAngle: .radians(heading - .pi / 2 - half), endAngle: .radians(heading - .pi / 2 + half), clockwise: false)
    cone.closeSubpath()
    let tip = CGPoint(x: c.x + CGFloat(sin(heading)) * reach, y: c.y - CGFloat(cos(heading)) * reach)
    ctx.fill(cone, with: .linearGradient(Gradient(colors: [light.opacity(0.4 * opacity), light.opacity(0)]), startPoint: c, endPoint: tip))
  }

  static func dot(_ ctx: inout GraphicsContext, at c: CGPoint, opacity: Double) {
    ctx.fill(circle(c, 11), with: .color(light.opacity(opacity)))
    ctx.fill(circle(c, 8), with: .color(Brand.mint.opacity(opacity)))
  }

  static func wall(_ ctx: inout GraphicsContext, _ path: Path, opacity: Double = 1) {
    ctx.stroke(path, with: .color(light.opacity(opacity)), style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
  }

  /// An edge nobody has looked at yet: bright mint dashes with a soft halo that breathes. Still without a clock.
  static func glow(_ ctx: inout GraphicsContext, _ path: Path, _ time: Double?, opacity: Double = 1) {
    let clock = time ?? 0
    let pulse = time == nil ? 1 : 0.55 + 0.45 * (0.5 + 0.5 * sin(clock * 3))
    ctx.stroke(path, with: .color(Brand.mint.opacity(0.25 * pulse * opacity)), style: StrokeStyle(lineWidth: 10, lineCap: .round, lineJoin: .round))
    ctx.stroke(path, with: .color(Brand.mint.opacity(pulse * opacity)),
               style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round, dash: [7, 5], dashPhase: CGFloat(clock * 12)))
  }

  static func circle(_ c: CGPoint, _ r: CGFloat) -> Path { Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)) }

  static func polyline(_ points: [CGPoint]) -> Path {
    var p = Path()
    p.addLines(points)
    return p
  }

  static func lerp(_ a: CGPoint, _ b: CGPoint, _ f: Double) -> CGPoint {
    CGPoint(x: a.x + (b.x - a.x) * CGFloat(f), y: a.y + (b.y - a.y) * CGFloat(f))
  }

  static func unit(_ v: CGPoint) -> CGPoint {
    let l = max(0.0001, (v.x * v.x + v.y * v.y).squareRoot())
    return CGPoint(x: v.x / l, y: v.y / l)
  }

  /// A point on a closed four-sided loop: u runs 0 to 4, one side per unit, and wraps.
  static func point(_ r: [CGPoint], _ u: Double) -> CGPoint {
    let w = u.truncatingRemainder(dividingBy: 4)
    let k = min(Int(w), 3)
    return lerp(r[k], r[(k + 1) % 4], w - Double(k))
  }

  /// The loop from u = a to u = b, corners included.
  static func loop(_ r: [CGPoint], _ a: Double, _ b: Double) -> [CGPoint] {
    var points = [point(r, a)]
    var corner = a.rounded(.down) + 1
    while corner < b {
      points.append(point(r, corner))
      corner += 1
    }
    points.append(point(r, b))
    return points
  }

  /// The point a fraction f of the way along a route.
  static func along(_ route: [CGPoint], _ f: Double) -> CGPoint {
    partial(route, f).last ?? route[0]
  }

  /// The route up to a fraction f of its length.
  static func partial(_ route: [CGPoint], _ f: Double) -> [CGPoint] {
    let lengths = zip(route, route.dropFirst()).map { a, b in Double(((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y)).squareRoot()) }
    var left = lengths.reduce(0, +) * Ease.clamp(f)
    var points = [route[0]]
    for (i, length) in lengths.enumerated() {
      if left >= length {
        points.append(route[i + 1])
        left -= length
      } else {
        points.append(lerp(route[i], route[i + 1], length > 0 ? left / length : 0))
        break
      }
    }
    return points
  }
}
