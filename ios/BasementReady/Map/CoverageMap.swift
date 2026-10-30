// The live map of the basement, from ARKit's own planes, feature points and camera positions: no
// model calls. A top-down grid of 25 cm cells in ARKit's world (x right, z toward you at the start,
// y up), so the direction they faced when they started is "up" on the map.
//
// - Floor: floor planes, feature points at floor height, and where they walked.
// - Walls: vertical planes (solid) and tall clusters of points.
// - Gaps: edges of the known floor with nothing behind them. Bright until the camera has looked at
//   that spot at wall height; then quiet (seen, but open or too plain to find).
// - Ceiling: a floor cell's ceiling counts as filmed once its spot on the ceiling was in the picture
//   within 6 m, or feature points were found up there.
import Foundation
import simd

struct Cell: Hashable, Sendable {
  var x: Int32
  var z: Int32
  func offset(_ d: Dir) -> Cell { Cell(x: x + d.dx, z: z + d.dz) }
}

enum Dir: Int, CaseIterable, Sendable {
  case north, east, south, west // map up (−z), right (+x), down (+z), left (−x)
  var dx: Int32 { self == .east ? 1 : self == .west ? -1 : 0 }
  var dz: Int32 { self == .south ? 1 : self == .north ? -1 : 0 }
  var bit: UInt8 { 1 << UInt8(rawValue) }
}

struct PlaneObs: Sendable {
  var id: UUID
  var vertical: Bool
  var transform: simd_float4x4 // anchor-to-world
  var boundary: [SIMD3<Float>] // ARPlaneGeometry.boundaryVertices, in anchor space
}

struct CameraObs: Sendable {
  var transform: simd_float4x4 // camera-to-world
  var intrinsics: SIMD4<Float> // fx, fy, cx, cy
  var resolution: SIMD2<Float> // sensor landscape size
  var tracked: Bool
}

struct Segment: Sendable, Equatable {
  var a: SIMD2<Float>
  var b: SIMD2<Float>
  var length: Float { simd_distance(a, b) }
}

struct MapPin: Sendable, Identifiable {
  var id: String // "window-2"
  var key: String
  var label: String
  var at: SIMD2<Float>
}

struct CoverageStats: Sendable, Equatable {
  var floorAreaM2: Float = 0
  var wallsFound = 0
  var ceilingCovered: Float = 0 // share of the known floor whose ceiling was filmed
  var unseenGapM: Float = 0
  var unseenBearingDeg: Float? // where the nearest unseen gap is, from where the camera faces; − is left
  var ceilingOpenNearby = false // much of the ceiling within 2.5 m isn't filmed yet
  var pitchDeg: Float = 0 // + looking up
}

struct MapSnapshot: Sendable {
  var cellSize: Float
  var floorCovered: [Cell] = [] // ceiling filmed
  var floorOpen: [Cell] = [] // ceiling not filmed yet
  var clutter: [Cell] = []
  var walls: [Segment] = []
  var gapsUnseen: [Segment] = []
  var gapsSeen: [Segment] = []
  var camera: SIMD2<Float>?
  var heading: Float = 0 // radians, clockwise from map up
  var trail: [SIMD2<Float>] = []
  var pins: [MapPin] = []
  var boundsMin = SIMD2<Float>(-2.5, -2.5)
  var boundsMax = SIMD2<Float>(2.5, 2.5)
  var floorY: Float? // world height of the floor and ceiling, once known
  var ceilingY: Float?
  var stats = CoverageStats()
}

final class CoverageMap {
  let cellSize: Float
  private struct CellData {
    var heights: [Float] = [] // newest feature-point heights here (world y), at most `maxHeights`
    var walked = false
    var ceilingSeen = false
    var edgesViewed: UInt8 = 0
  }
  private static let maxHeights = 24
  // A room seen from its doorway counts, so a look reaches across a whole room.
  private static let viewRange: Float = 6
  private static let wallHeightAboveFloor: Float = 1.0
  private static let wallReach = 3

  private var cells: [Cell: CellData] = [:]
  private var planes: [UUID: PlaneObs] = [:]
  private var planeFloor: [UUID: (y: Float, cells: [Cell])] = [:]
  private var wallSegments: [UUID: Segment] = [:]
  private var wallCells: [UUID: [Cell]] = [:]
  private var recentY: [Float] = []
  private var recentYNext = 0
  private(set) var trail: [SIMD2<Float>] = []
  private(set) var pins: [MapPin] = []
  private var camera: CameraObs?

  // Derived on every update.
  private(set) var floorY: Float?
  private(set) var ceilingY: Float?
  private var knownFloor = Set<Cell>()
  private var occluders = Set<Cell>()
  private var wallish = Set<Cell>()
  private var clutterCells = Set<Cell>()

  init(cellSize: Float = 0.25) {
    self.cellSize = cellSize
  }

  func cell(_ p: SIMD2<Float>) -> Cell {
    Cell(x: Int32((p.x / cellSize).rounded(.down)), z: Int32((p.y / cellSize).rounded(.down)))
  }

  func center(_ c: Cell) -> SIMD2<Float> {
    SIMD2(Float(c.x) + 0.5, Float(c.z) + 0.5) * cellSize
  }

  // ---------- what ARKit tells us ----------

  func upsert(_ plane: PlaneObs) {
    planes[plane.id] = plane
    let world = plane.boundary.map { plane.transform * SIMD4($0, 1) }
    guard world.count >= 3 else { return }
    if plane.vertical {
      // The wall's run along the floor: its outline, flattened, between its two ends.
      let n = SIMD2(plane.transform.columns.1.x, plane.transform.columns.1.z)
      guard simd_length(n) > 0.3 else { return }
      let normal = simd_normalize(n)
      let along = SIMD2(-normal.y, normal.x)
      let origin = SIMD2(plane.transform.columns.3.x, plane.transform.columns.3.z)
      let ts = world.map { simd_dot(SIMD2($0.x, $0.z) - origin, along) }
      let seg = Segment(a: origin + along * ts.min()!, b: origin + along * ts.max()!)
      wallSegments[plane.id] = seg
      var hit: [Cell] = []
      let steps = max(1, Int(seg.length / (cellSize * 0.4)))
      for i in 0...steps {
        let c = cell(seg.a + (seg.b - seg.a) * (Float(i) / Float(steps)))
        if hit.last != c { hit.append(c) }
      }
      wallCells[plane.id] = hit
    } else {
      let poly = world.map { SIMD2($0.x, $0.z) }
      planeFloor[plane.id] = (y: plane.transform.columns.3.y, cells: rasterize(poly))
    }
  }

  func remove(planeID: UUID) {
    planes[planeID] = nil
    planeFloor[planeID] = nil
    wallSegments[planeID] = nil
    wallCells[planeID] = nil
  }

  func addPin(key: String, label: String, id: String) {
    guard let cam = camera else { return }
    let p = SIMD2(cam.transform.columns.3.x, cam.transform.columns.3.z)
    let f = Self.flatForward(cam.transform)
    pins.append(MapPin(id: id, key: key, label: label, at: p + f * 1.5))
  }

  // One look: where the camera is, and the feature points it sees (world space).
  func observe(_ cam: CameraObs, points: [SIMD3<Float>]) {
    camera = cam
    let pos3 = SIMD3(cam.transform.columns.3.x, cam.transform.columns.3.y, cam.transform.columns.3.z)
    let pos = SIMD2(pos3.x, pos3.z)
    if cam.tracked {
      if trail.last.map({ simd_distance($0, pos) > 0.15 }) ?? true { trail.append(pos) }
      cells[cell(pos), default: CellData()].walked = true
    }
    for p in points where p.x.isFinite && p.y.isFinite && p.z.isFinite {
      let c = cell(SIMD2(p.x, p.z))
      var d = cells[c] ?? CellData()
      if d.heights.count >= Self.maxHeights { d.heights.removeFirst() }
      d.heights.append(p.y)
      cells[c] = d
      if recentY.count < 4000 {
        recentY.append(p.y)
      } else {
        recentY[recentYNext] = p.y
        recentYNext = (recentYNext + 1) % recentY.count
      }
    }
    estimateLevels(cameraY: pos3.y)
    derive()
    if cam.tracked { markViews(cam, from: pos3) }
  }

  // ---------- floor and ceiling heights ----------

  private func estimateLevels(cameraY: Float) {
    let sorted = recentY.count >= 200 ? recentY.sorted() : []
    let pct = { (q: Float) -> Float? in sorted.isEmpty ? nil : sorted[min(sorted.count - 1, Int(Float(sorted.count) * q))] }
    var floor: Float?
    for p in planeFloor.values where cameraY - p.y > 0.6 && p.cells.count >= 4 { floor = min(floor ?? p.y, p.y) }
    if let low = pct(0.03), cameraY - low > 0.6 { floor = min(floor ?? low, low) }
    // Only ever lower: going down the stairs, the floor upstairs stops counting.
    floorY = min(floorY ?? .infinity, floor ?? (cameraY - 1.4))
    let f = floorY!
    var ceil: Float?
    for p in planeFloor.values where p.y - f > 1.7 { ceil = max(ceil ?? p.y, p.y) }
    if ceil == nil, let high = pct(0.97), high - f > 1.8 { ceil = high }
    ceilingY = min(max(ceil ?? f + 2.3, f + 1.8), f + 3.2)
  }

  // ---------- the grid's meaning, from the raw evidence ----------

  private func derive() {
    guard let f = floorY, let top = ceilingY else { return }
    var floor = Set<Cell>()
    for p in planeFloor.values where abs(p.y - f) < 0.15 { floor.formUnion(p.cells) }
    var tall = Set<Cell>(), clutter = Set<Cell>()
    for (c, d) in cells {
      if d.walked {
        floor.insert(c)
        for dir in Dir.allCases { floor.insert(c.offset(dir)) }
      }
      var low = 0, mid = 0, high = 0
      for y in d.heights {
        let h = y - f
        if h < 0.12 { low += 1 } else if h > 0.3, y < top - 0.2 { mid += 1; if h > 1.4 { high += 1 } }
      }
      if low >= 2 { floor.insert(c) }
      if mid >= 4 { clutter.insert(c) }
      if high >= 3 { tall.insert(c) }
    }
    knownFloor = Self.close(floor)
    occluders = tall
    for cs in wallCells.values { occluders.formUnion(cs) }
    wallish = occluders.union(clutter)
    clutterCells = clutter
  }

  // Fills one-cell holes and notches, so small gaps between floor planes don't read as missing floor.
  private static func close(_ s: Set<Cell>) -> Set<Cell> {
    var grown = s
    for c in s { for d in Dir.allCases { grown.insert(c.offset(d)) } }
    return grown.filter { c in s.contains(c) || Dir.allCases.filter { s.contains(c.offset($0)) }.count >= 3 }
  }

  // An edge of the known floor with nothing found behind it. Floor planes stop short of the walls, so
  // a wall within 75 cm past the edge closes it too.
  private func isGap(_ c: Cell, _ d: Dir) -> Bool {
    guard !knownFloor.contains(c.offset(d)), !wallish.contains(c) else { return false }
    var probe = c
    for _ in 0..<Self.wallReach {
      probe = probe.offset(d)
      if wallish.contains(probe) { return false }
    }
    return true
  }

  // ---------- what the camera has looked at ----------

  private func markViews(_ cam: CameraObs, from pos: SIMD3<Float>) {
    guard let f = floorY, let top = ceilingY else { return }
    let toCamera = cam.transform.inverse
    let origin = cell(SIMD2(pos.x, pos.z))
    let r = Int32((Self.viewRange / cellSize).rounded(.up))
    for dz in -r...r {
      for dx in -r...r {
        let c = Cell(x: origin.x + dx, z: origin.z + dz)
        guard knownFloor.contains(c) else { continue }
        let mid = center(c)
        if !(cells[c]?.ceilingSeen ?? false), sees(SIMD3(mid.x, top, mid.y), cam, toCamera, pos), clear(origin, c) {
          cells[c, default: CellData()].ceilingSeen = true
        }
        for d in Dir.allCases where isGap(c, d) && (cells[c]?.edgesViewed ?? 0) & d.bit == 0 {
          let edge = mid + SIMD2(Float(d.dx), Float(d.dz)) * (cellSize / 2)
          if sees(SIMD3(edge.x, f + Self.wallHeightAboveFloor, edge.y), cam, toCamera, pos), clear(origin, c) {
            cells[c, default: CellData()].edgesViewed |= d.bit
          }
        }
      }
    }
    // Points found on the ceiling mean that bit of ceiling was filmed too.
    for (c, d) in cells where !d.ceilingSeen && d.heights.contains(where: { $0 > top - 0.25 }) {
      cells[c]!.ceilingSeen = true
    }
  }

  // In the picture, in front of the camera and within range.
  func sees(_ p: SIMD3<Float>, _ cam: CameraObs, _ toCamera: simd_float4x4, _ pos: SIMD3<Float>) -> Bool {
    guard simd_distance(p, pos) <= Self.viewRange else { return false }
    let q = toCamera * SIMD4(p, 1)
    guard q.z < -0.2 else { return false } // ARKit cameras look down −z
    let u = cam.intrinsics.x * (q.x / -q.z) + cam.intrinsics.z
    let v = cam.intrinsics.w - cam.intrinsics.y * (q.y / -q.z)
    let mx = cam.resolution.x * 0.04, my = cam.resolution.y * 0.04
    return u > mx && u < cam.resolution.x - mx && v > my && v < cam.resolution.y - my
  }

  // No wall between the camera's cell and this one (cells strictly between, on the grid).
  private func clear(_ a: Cell, _ b: Cell) -> Bool {
    let n = Int(max(abs(b.x - a.x), abs(b.z - a.z)))
    guard n > 1 else { return true }
    for i in 1..<n {
      let k = Float(i) / Float(n)
      let c = Cell(x: a.x + Int32((Float(b.x - a.x) * k).rounded()), z: a.z + Int32((Float(b.z - a.z) * k).rounded()))
      if c != b, occluders.contains(c) { return false }
    }
    return true
  }

  // ---------- for the screen ----------

  func snapshot() -> MapSnapshot {
    var s = MapSnapshot(cellSize: cellSize)
    s.floorY = floorY
    s.ceilingY = ceilingY
    s.trail = trail
    s.pins = pins
    s.walls = wallSegments.values.filter { $0.length >= 0.3 }
    s.clutter = Array(clutterCells)
    var lo = SIMD2<Float>(repeating: .infinity), hi = SIMD2<Float>(repeating: -.infinity)
    func grow(_ p: SIMD2<Float>) {
      lo = simd_min(lo, p)
      hi = simd_max(hi, p)
    }
    var covered = 0
    for c in knownFloor {
      if cells[c]?.ceilingSeen ?? false {
        s.floorCovered.append(c)
        covered += 1
      } else {
        s.floorOpen.append(c)
      }
      let m = center(c)
      grow(m - cellSize)
      grow(m + cellSize)
    }
    for p in trail { grow(p) }
    for w in s.walls { grow(w.a); grow(w.b) }

    var pos: SIMD2<Float>?
    var heading: Float = 0
    if let cam = camera {
      let p = SIMD2(cam.transform.columns.3.x, cam.transform.columns.3.z)
      pos = p
      grow(p)
      let fw = Self.flatForward(cam.transform)
      heading = atan2(fw.x, -fw.y)
      let look = -SIMD3(cam.transform.columns.2.x, cam.transform.columns.2.y, cam.transform.columns.2.z)
      s.stats.pitchDeg = asin(max(-1, min(1, look.y))) * 180 / .pi
    }
    s.camera = pos
    s.heading = heading

    // Gaps, and which way the nearest unseen ones are.
    var bins = [Float](repeating: 0, count: 12)
    for c in knownFloor {
      for d in Dir.allCases where isGap(c, d) {
        let m = center(c)
        let h = cellSize / 2
        let seg: Segment
        switch d {
        case .north: seg = Segment(a: m + SIMD2(-h, -h), b: m + SIMD2(h, -h))
        case .south: seg = Segment(a: m + SIMD2(-h, h), b: m + SIMD2(h, h))
        case .east: seg = Segment(a: m + SIMD2(h, -h), b: m + SIMD2(h, h))
        case .west: seg = Segment(a: m + SIMD2(-h, -h), b: m + SIMD2(-h, h))
        }
        if (cells[c]?.edgesViewed ?? 0) & d.bit != 0 {
          s.gapsSeen.append(seg)
        } else {
          s.gapsUnseen.append(seg)
          if let pos {
            let v = (seg.a + seg.b) / 2 - pos
            let dist = simd_length(v)
            if dist < 6, dist > 0.01 {
              let rel = Self.wrapDeg((atan2(v.x, -v.y) - heading) * 180 / .pi)
              bins[min(11, Int((rel + 180) / 30))] += 1 / (dist + 0.5)
            }
          }
        }
      }
    }
    if let best = bins.indices.max(by: { bins[$0] < bins[$1] }), bins[best] > 1.2 {
      s.stats.unseenBearingDeg = Float(best) * 30 - 165
    }

    s.stats.floorAreaM2 = Float(knownFloor.count) * cellSize * cellSize
    s.stats.wallsFound = s.walls.filter { $0.length >= 0.6 }.count
    s.stats.ceilingCovered = knownFloor.isEmpty ? 0 : Float(covered) / Float(knownFloor.count)
    s.stats.unseenGapM = Float(s.gapsUnseen.count) * cellSize
    if let pos {
      let near = knownFloor.filter { simd_distance(center($0), pos) < 2.5 }
      let open = near.filter { !(cells[$0]?.ceilingSeen ?? false) }.count
      s.stats.ceilingOpenNearby = near.count >= 6 && Float(open) / Float(near.count) > 0.4
    }
    if lo.x.isFinite {
      // At least 5 m across, so the first steps don't fill the screen.
      let mid = (lo + hi) / 2
      let half = simd_max((hi - lo) / 2, SIMD2(2.5, 2.5))
      s.boundsMin = mid - half
      s.boundsMax = mid + half
    }
    return s
  }

  // ---------- helpers ----------

  // Which way the camera faces, flat on the floor. Pointing straight up or down, the top of the phone
  // (held upright, that's the sensor's −x) shows the way instead.
  static func flatForward(_ t: simd_float4x4) -> SIMD2<Float> {
    let look = -SIMD2(t.columns.2.x, t.columns.2.z)
    if simd_length(look) > 0.35 { return simd_normalize(look) }
    let top = -SIMD2(t.columns.0.x, t.columns.0.z)
    return simd_length(top) > 0.01 ? simd_normalize(top) : SIMD2(0, -1)
  }

  static func wrapDeg(_ d: Float) -> Float {
    var x = d.truncatingRemainder(dividingBy: 360)
    if x > 180 { x -= 360 }
    if x <= -180 { x += 360 }
    return x
  }

  // Cells whose centres fall inside the polygon (even-odd rule).
  func rasterize(_ poly: [SIMD2<Float>]) -> [Cell] {
    guard let first = poly.first else { return [] }
    var lo = first, hi = first
    for p in poly {
      lo = simd_min(lo, p)
      hi = simd_max(hi, p)
    }
    let a = cell(lo), b = cell(hi)
    guard (b.x - a.x) * (b.z - a.z) < 40_000 else { return [] } // a runaway plane, not a basement
    var out: [Cell] = []
    for z in a.z...b.z {
      for x in a.x...b.x {
        let c = Cell(x: x, z: z)
        let p = center(c)
        var inside = false
        var j = poly.count - 1
        for i in 0..<poly.count {
          let pi = poly[i], pj = poly[j]
          if (pi.y > p.y) != (pj.y > p.y), p.x < (pj.x - pi.x) * (p.y - pi.y) / (pj.y - pi.y) + pi.x { inside.toggle() }
          j = i
        }
        if inside { out.append(c) }
      }
    }
    return out
  }
}
