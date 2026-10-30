// What the overlay draws, gathered while filming and read by the renderer 60 times a second:
// - the point cloud: ARKit's feature points, coloured from the camera picture, kept once per 3 cm
// - the walls: ARKit's vertical planes, painted in from where they were first found
// - the map: floor, ceiling and the gaps nobody has looked at, from the coverage map
// Each part has its own lock and a version number, so the renderer only copies what changed.
import CoreVideo
import Foundation
import simd

struct CloudPoint: Sendable {
  var p: SIMD4<Float> // world xyz, and when it was added (seconds of uptime)
  var c: SIMD4<UInt8> // its colour from the picture
}

final class PointCloud: @unchecked Sendable {
  static let voxel: Float = 0.03
  static let capacity = 250_000

  private let lock = NSLock()
  private var points: [CloudPoint] = []
  private var taken = Set<Int64>()

  init() { points.reserveCapacity(20_000) }

  var count: Int {
    lock.lock()
    defer { lock.unlock() }
    return points.count
  }

  // New points, one per 3 cm voxel: a spot filmed again doesn't pile up.
  @discardableResult
  func add(_ new: [(SIMD3<Float>, SIMD4<UInt8>)], at time: Double) -> Int {
    lock.lock()
    defer { lock.unlock() }
    var added = 0
    for (p, c) in new where points.count < Self.capacity && p.x.isFinite && p.y.isFinite && p.z.isFinite {
      let k = (p / Self.voxel).rounded(.down)
      guard abs(k.x) < 1_000_000, abs(k.y) < 1_000_000, abs(k.z) < 1_000_000 else { continue }
      let key = (Int64(k.x) & 0x1FFFFF) | ((Int64(k.y) & 0x1FFFFF) << 21) | ((Int64(k.z) & 0x1FFFFF) << 42)
      guard taken.insert(key).inserted else { continue }
      points.append(CloudPoint(p: SIMD4(p, Float(time)), c: c))
      added += 1
    }
    return added
  }

  // Points from `start` on, for the renderer's append-only buffer.
  func copy(from start: Int, into body: (UnsafeBufferPointer<CloudPoint>) -> Void) {
    lock.lock()
    defer { lock.unlock() }
    guard start < points.count else { return }
    points.withUnsafeBufferPointer { all in body(UnsafeBufferPointer(rebasing: all[start...])) }
  }
}

// A wall ARKit found: its outline in the world, when it was first found, and the spot it paints out from.
struct WallMesh: Sendable {
  var outline: [SIMD3<Float>] // world space, in order around the edge
  var seed: SIMD3<Float>
  var born: Double
}

final class PlaneStore: @unchecked Sendable {
  private let lock = NSLock()
  private var walls: [UUID: WallMesh] = [:]
  private(set) var version = 0

  func upsert(_ plane: PlaneObs, at time: Double) {
    guard plane.vertical, plane.boundary.count >= 3 else { return }
    let outline = plane.boundary.map { v -> SIMD3<Float> in
      let w = plane.transform * SIMD4(v, 1)
      return SIMD3(w.x, w.y, w.z)
    }
    lock.lock()
    let old = walls[plane.id]
    walls[plane.id] = WallMesh(outline: outline, seed: old?.seed ?? outline.reduce(.zero, +) / Float(outline.count), born: old?.born ?? time)
    version += 1
    lock.unlock()
  }

  func remove(_ id: UUID) {
    lock.lock()
    if walls.removeValue(forKey: id) != nil { version += 1 }
    lock.unlock()
  }

  func snapshot() -> (version: Int, walls: [WallMesh]) {
    lock.lock()
    defer { lock.unlock() }
    return (version, Array(walls.values))
  }
}

// The latest coverage map, for the renderer.
final class MapStore: @unchecked Sendable {
  private let lock = NSLock()
  private var map: MapSnapshot?
  private var version = 0

  func set(_ m: MapSnapshot) {
    lock.lock()
    map = m
    version += 1
    lock.unlock()
  }

  func snapshot() -> (version: Int, map: MapSnapshot?) {
    lock.lock()
    defer { lock.unlock() }
    return (version, map)
  }
}

// One picture with where the camera was, for the renderer: ARKit's current frame, or the replay's.
struct LiveFrame: @unchecked Sendable {
  var image: CVPixelBuffer
  var cameraToWorld: simd_float4x4
  var geometry: ImageGeometry
}

// Everything the overlay needs from a take while it's filmed.
final class OverlayFeed: @unchecked Sendable {
  // Times in the cloud and the walls are seconds from here, small enough for the GPU's floats.
  let epoch = ProcessInfo.processInfo.systemUptime
  func now() -> Double { ProcessInfo.processInfo.systemUptime - epoch }

  let cloud = PointCloud()
  let walls = PlaneStore()
  let map = MapStore()
  private let lock = NSLock()
  private var stored: LiveFrame?
  // ARKit's frames come straight from the session (the renderer holds one only while drawing it).
  var current: (@Sendable () -> LiveFrame?)?

  func publish(_ f: LiveFrame) {
    lock.lock()
    stored = f
    lock.unlock()
  }

  func latest() -> LiveFrame? {
    if let current { return current() }
    lock.lock()
    defer { lock.unlock() }
    return stored
  }
}
