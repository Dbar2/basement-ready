// The big live map, drawn from a MapSnapshot. On the dark map:
// - mint fill: floor whose ceiling is filmed; hatched: ceiling not filmed yet
// - solid light lines: walls found
// - bright dashed mint: an edge nobody has looked at yet; faint dashes: looked at, nothing found
// - the camera: a mint dot with its view cone, and the trail behind it
import SwiftUI

struct MapView: View {
  let map: MapSnapshot?
  var fit: EdgeInsets = EdgeInsets(top: 24, leading: 20, bottom: 24, trailing: 20)

  private static let floorFill = Color(hex: 0x24432F)
  private static let light = Brand.bg

  var body: some View {
    TimelineView(.animation(minimumInterval: 1 / 15)) { time in
      Canvas { ctx, size in
        ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Brand.ink))
        guard let map, map.camera != nil else { return }
        draw(map, in: &ctx, size: size, pulse: time.date.timeIntervalSinceReferenceDate)
      }
    }
    .overlay {
      if map?.camera == nil {
        Text("Starting the map…").font(Brand.body(17, .medium)).foregroundStyle(Self.light.opacity(0.7))
      }
    }
    .accessibilityElement()
    .accessibilityLabel(accessibilityText)
  }

  private var accessibilityText: String {
    guard let s = map?.stats else { return "Map of your basement, starting." }
    return "Map of your basement: about \(Int(s.floorAreaM2.rounded())) square metres, \(s.wallsFound) walls found, ceiling \(Int((s.ceilingCovered * 100).rounded())) percent filmed."
  }

  private func draw(_ map: MapSnapshot, in ctx: inout GraphicsContext, size: CGSize, pulse: Double) {
    let area = CGRect(x: fit.leading, y: fit.top, width: max(10, size.width - fit.leading - fit.trailing), height: max(10, size.height - fit.top - fit.bottom))
    let span = map.boundsMax - map.boundsMin
    let scale = min(area.width / CGFloat(span.x), area.height / CGFloat(span.y))
    let origin = CGPoint(x: area.midX - CGFloat(span.x) * scale / 2, y: area.midY - CGFloat(span.y) * scale / 2)
    func pt(_ p: SIMD2<Float>) -> CGPoint {
      CGPoint(x: origin.x + CGFloat(p.x - map.boundsMin.x) * scale, y: origin.y + CGFloat(p.y - map.boundsMin.y) * scale)
    }
    let cs = CGFloat(map.cellSize) * scale
    func rect(_ c: Cell) -> CGRect {
      CGRect(origin: pt(SIMD2(Float(c.x), Float(c.z)) * map.cellSize), size: CGSize(width: cs + 0.5, height: cs + 0.5))
    }

    // Floor, then mint where the ceiling's been filmed, then hatching where it hasn't.
    var open = Path()
    for c in map.floorOpen { open.addRect(rect(c)) }
    var covered = Path()
    for c in map.floorCovered { covered.addRect(rect(c)) }
    ctx.fill(open, with: .color(Self.floorFill))
    ctx.fill(covered, with: .color(Brand.mint.opacity(0.42)))
    if !map.floorOpen.isEmpty {
      var hatch = ctx
      hatch.clip(to: open)
      let b = open.boundingRect
      var lines = Path()
      var x = b.minX - b.height
      while x < b.maxX {
        lines.move(to: CGPoint(x: x, y: b.maxY))
        lines.addLine(to: CGPoint(x: x + b.height, y: b.minY))
        x += 9
      }
      hatch.stroke(lines, with: .color(Self.light.opacity(0.22)), lineWidth: 1.2)
    }

    // Clutter: points at wall height that aren't a wall plane (furniture, shelves, plain walls).
    for c in map.clutter {
      let r = rect(c)
      ctx.fill(Path(ellipseIn: CGRect(x: r.midX - 1.6, y: r.midY - 1.6, width: 3.2, height: 3.2)), with: .color(Self.light.opacity(0.45)))
    }

    // Edges: looked at but nothing found, then the ones nobody has looked at yet.
    var seen = Path()
    for g in map.gapsSeen {
      seen.move(to: pt(g.a))
      seen.addLine(to: pt(g.b))
    }
    ctx.stroke(seen, with: .color(Self.light.opacity(0.3)), style: StrokeStyle(lineWidth: 1.5, dash: [3, 4]))
    var unseen = Path()
    for g in map.gapsUnseen {
      unseen.move(to: pt(g.a))
      unseen.addLine(to: pt(g.b))
    }
    let glow = 0.55 + 0.45 * (0.5 + 0.5 * sin(pulse * 3))
    ctx.stroke(unseen, with: .color(Brand.mint.opacity(0.25 * glow)), style: StrokeStyle(lineWidth: 9, lineCap: .round))
    ctx.stroke(unseen, with: .color(Brand.mint.opacity(glow)), style: StrokeStyle(lineWidth: 3, lineCap: .round, dash: [7, 5], dashPhase: CGFloat(pulse * 12)))

    // Walls found.
    var walls = Path()
    for w in map.walls {
      walls.move(to: pt(w.a))
      walls.addLine(to: pt(w.b))
    }
    ctx.stroke(walls, with: .color(Self.light), style: StrokeStyle(lineWidth: 4, lineCap: .round))

    // Where they've walked.
    if map.trail.count > 1 {
      var trail = Path()
      trail.move(to: pt(map.trail[0]))
      for p in map.trail.dropFirst() { trail.addLine(to: pt(p)) }
      ctx.stroke(trail, with: .color(Self.light.opacity(0.45)), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round, dash: [1, 5]))
    }

    // Finds, each with its name.
    for pin in map.pins {
      let p = pt(pin.at)
      ctx.fill(Path(ellipseIn: CGRect(x: p.x - 6, y: p.y - 6, width: 12, height: 12)), with: .color(Brand.find(pin.key)))
      ctx.stroke(Path(ellipseIn: CGRect(x: p.x - 6, y: p.y - 6, width: 12, height: 12)), with: .color(Self.light), lineWidth: 2)
      let label = ctx.resolve(Text(pin.label).font(Brand.body(12, .semibold)).foregroundStyle(Self.light))
      ctx.draw(label, at: CGPoint(x: p.x, y: p.y - 15), anchor: .bottom)
    }

    // The camera: its view cone, then the dot.
    if let cam = map.camera {
      let c = pt(cam)
      let reach = max(46, 2.2 * scale)
      let half = 0.5 // radians, about the phone's view in portrait
      var cone = Path()
      cone.move(to: c)
      cone.addArc(center: c, radius: reach, startAngle: .radians(Double(map.heading) - .pi / 2 - half), endAngle: .radians(Double(map.heading) - .pi / 2 + half), clockwise: false)
      cone.closeSubpath()
      ctx.fill(cone, with: .linearGradient(Gradient(colors: [Self.light.opacity(0.38), Self.light.opacity(0)]), startPoint: c,
                                           endPoint: CGPoint(x: c.x + sin(CGFloat(map.heading)) * reach, y: c.y - cos(CGFloat(map.heading)) * reach)))
      ctx.fill(Path(ellipseIn: CGRect(x: c.x - 11, y: c.y - 11, width: 22, height: 22)), with: .color(Self.light))
      ctx.fill(Path(ellipseIn: CGRect(x: c.x - 8, y: c.y - 8, width: 16, height: 16)), with: .color(Brand.mint))
    }

    // One metre, for scale.
    let bar = CGPoint(x: area.minX, y: area.maxY)
    var scaleBar = Path()
    scaleBar.move(to: CGPoint(x: bar.x, y: bar.y - 5))
    scaleBar.addLine(to: bar)
    scaleBar.addLine(to: CGPoint(x: bar.x + scale, y: bar.y))
    scaleBar.addLine(to: CGPoint(x: bar.x + scale, y: bar.y - 5))
    ctx.stroke(scaleBar, with: .color(Self.light.opacity(0.6)), lineWidth: 1.5)
    ctx.draw(ctx.resolve(Text("1 m").font(Brand.mono(12)).foregroundStyle(Self.light.opacity(0.7))), at: CGPoint(x: bar.x + scale + 6, y: bar.y), anchor: .leading)
  }
}
