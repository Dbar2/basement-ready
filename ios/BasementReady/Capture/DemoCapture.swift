// Debug builds only: a pretend walk around an 8 × 6 m basement, so the filming screen, map, guide,
// voice and upload can be tried in the simulator, which has no ARKit. It writes a small real video
// and capture.json with the same contract as a real take. Launch with -BRDemoWalk to use it.
#if DEBUG
import CoreImage
import CoreVideo
import Foundation
import simd

final class DemoCapture: CaptureSource, @unchecked Sendable {
  static var requested: Bool { ProcessInfo.processInfo.arguments.contains("-BRDemoWalk") }

  private let queue = DispatchQueue(label: "demo-capture")
  private let send: @Sendable (CaptureEvent) -> Void
  private var timer: DispatchSourceTimer?
  private var map = CoverageMap()
  private var log = CaptureLog(device: DeviceModel.identifier, imageResolution: (640, 480))
  private var video: VideoWriter?
  private var folder: URL?
  private var t: Double = 0
  private var seen = Set<Int>() // walls already turned into planes
  private let floorID = UUID()
  private var floorLo = SIMD2<Float>(repeating: .infinity)
  private var floorHi = SIMD2<Float>(repeating: -.infinity)
  private let ci = CIContext()
  private var stopped = false

  // The room: x −4…4, z −7…−1, floor at y 0, ceiling at 2.3 m. The stairs come down at the origin.
  private let room = (minX: Float(-4), maxX: Float(4), minZ: Float(-7), maxZ: Float(-1), ceiling: Float(2.3))
  private let k = SIMD4<Float>(500, 500, 320, 240)

  init(send: @escaping @Sendable (CaptureEvent) -> Void) {
    self.send = send
  }

  func start() throws {
    let folder = try Take.newFolder()
    try queue.sync {
      self.folder = folder
      self.video = try VideoWriter(url: folder.appending(path: "video.mp4"), width: 640, height: 480)
    }
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now(), repeating: .milliseconds(100))
    timer.setEventHandler { [weak self] in self?.tick() }
    timer.resume()
    self.timer = timer
  }

  // (seconds, x, z, heading° clockwise from up, pitch°): a slow loop along the walls.
  private let path: [(Double, Float, Float, Float, Float)] = [
    (0, 0, 0, 0, -20), (6, 0, -1.6, 0, -10), (12, 0, -2.5, -60, 0), (20, -2.5, -2.5, -90, 0),
    (28, -2.5, -4, -90, 5), (34, -2.5, -5.5, -20, 0), (42, -2.5, -5.5, -20, 60), (48, 0, -5.5, 0, 0),
    (56, 2.5, -5.5, 60, 0), (64, 2.5, -4, 90, 0), (70, 2.5, -2.5, 120, 0), (76, 2.5, -2.5, 120, 60),
    (84, 0, -4, 180, 55), (92, -3.4, -6.4, 135, 0), (200, -3.4, -6.4, 135, 0),
  ]

  private func pose(at t: Double) -> simd_float4x4 {
    let i = max(0, (path.firstIndex { $0.0 > t } ?? path.count) - 1)
    let a = path[i], b = path[min(i + 1, path.count - 1)]
    let k = b.0 > a.0 ? Float((t - a.0) / (b.0 - a.0)) : 0
    let mix = { (x: Float, y: Float) in x + (y - x) * min(1, max(0, k)) }
    let yaw = mix(a.3, b.3) * .pi / 180, pitch = mix(a.4, b.4) * .pi / 180
    let pos = SIMD3<Float>(mix(a.1, b.1), 1.4, mix(a.2, b.2))
    let forward = SIMD3<Float>(sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch))
    let right = simd_normalize(SIMD3<Float>(cos(yaw), 0, sin(yaw)))
    let up = simd_cross(right, forward)
    // ARKit camera axes with the phone upright: x is the phone's down, y its right, z out the screen.
    return simd_float4x4(SIMD4(-up, 0), SIMD4(right, 0), SIMD4(-forward, 0), SIMD4(pos, 1))
  }

  private func tick() {
    guard !stopped else { return }
    t += 0.1
    let T = pose(at: t)
    let cam = CameraObs(transform: T, intrinsics: k, resolution: SIMD2(640, 480), tracked: t > 1)
    for i in 0..<3 {
      log.frames.append(FrameRecord(t: t - 0.1 + Double(i) / 30, transform: T, intrinsics: k, tracking: t > 1 ? "normal" : "limited:initializing"))
    }
    if let buffer = frame(T) { video?.append(buffer, at: t - 0.1) }

    // What ARKit would find: the floor around where they've been, walls once looked at, some points.
    let pos = SIMD2(T.columns.3.x, T.columns.3.z)
    floorLo = simd_min(floorLo, simd_max(pos - 2.2, SIMD2(room.minX, room.minZ)))
    floorHi = simd_max(floorHi, simd_min(pos + 2.2, SIMD2(room.maxX, room.maxZ)))
    let (lo, hi) = (floorLo, floorHi)
    map.upsert(PlaneObs(id: floorID, vertical: false, transform: matrix_identity_float4x4,
                        boundary: [SIMD3(lo.x, 0, lo.y), SIMD3(hi.x, 0, lo.y), SIMD3(hi.x, 0, hi.y), SIMD3(lo.x, 0, hi.y)]))
    let walls: [(SIMD2<Float>, SIMD2<Float>)] = [
      (SIMD2(room.minX, room.minZ), SIMD2(room.maxX, room.minZ)), (SIMD2(room.maxX, room.minZ), SIMD2(room.maxX, -1)),
      (SIMD2(room.minX, -1), SIMD2(room.minX, room.minZ)), (SIMD2(room.minX, -1), SIMD2(-1, -1)), (SIMD2(1, -1), SIMD2(room.maxX, -1)),
    ]
    let inverse = T.inverse
    for (n, w) in walls.enumerated() where !seen.contains(n) {
      let mid = (w.0 + w.1) / 2
      if map.sees(SIMD3(mid.x, 1, mid.y), cam, inverse, SIMD3(T.columns.3.x, 1.4, T.columns.3.z)) {
        seen.insert(n)
        let along = simd_normalize(w.1 - w.0), len = simd_distance(w.0, w.1)
        let normal = SIMD2(-along.y, along.x)
        let x = SIMD3(along.x, 0, along.y), y = SIMD3(normal.x, 0, normal.y)
        let anchor = simd_float4x4(SIMD4(x, 0), SIMD4(y, 0), SIMD4(simd_cross(x, y), 0), SIMD4(mid.x, 1.2, mid.y, 1))
        map.upsert(PlaneObs(id: UUID(), vertical: true, transform: anchor, boundary: [SIMD3(-len / 2, 0, -1), SIMD3(len / 2, 0, -1), SIMD3(len / 2, 0, 1), SIMD3(-len / 2, 0, 1)]))
      }
    }
    var points: [SIMD3<Float>] = []
    for _ in 0..<60 {
      let p = SIMD3(Float.random(in: room.minX...room.maxX), [0, room.ceiling, Float.random(in: 0.4...2)].randomElement()!, Float.random(in: room.minZ...room.maxZ))
      if map.sees(p, cam, inverse, SIMD3(T.columns.3.x, 1.4, T.columns.3.z)) { points.append(p) }
    }
    if Int(t * 10) % 2 == 0 {
      map.observe(cam, points: points)
      let still = t > 92
      send(.update(CaptureUpdate(elapsed: t, tracking: t > 1 ? .normal : .initializing, map: map.snapshot(), still: still, depth: false)))
    }
  }

  // A plain picture that changes with where the camera points, so the video isn't blank.
  private func frame(_ T: simd_float4x4) -> CVPixelBuffer? {
    var buffer: CVPixelBuffer?
    CVPixelBufferCreate(nil, 640, 480, kCVPixelFormatType_32BGRA, [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &buffer)
    guard let buffer else { return nil }
    let hue = CGFloat(atan2(T.columns.2.x, T.columns.2.z) / (2 * .pi) + 0.5)
    let a = CIColor(red: 0.3 + 0.4 * hue, green: 0.35, blue: 0.3 + 0.3 * (1 - hue))
    let image = CIFilter(name: "CILinearGradient", parameters: [
      "inputPoint0": CIVector(x: 0, y: 0), "inputPoint1": CIVector(x: 640, y: 480), "inputColor0": a, "inputColor1": CIColor(red: 0.9, green: 0.92, blue: 0.88),
    ])!.outputImage!.cropped(to: CGRect(x: 0, y: 0, width: 640, height: 480))
    ci.render(image, to: buffer)
    return buffer
  }

  func stop() async throws -> Take {
    let (video, log, folder, snap) = queue.sync { () -> (VideoWriter?, CaptureLog, URL?, MapSnapshot) in
      stopped = true
      timer?.cancel()
      return (self.video, self.log, self.folder, map.snapshot())
    }
    guard let video, let folder else { throw CaptureError.video("Nothing was filmed.") }
    try await video.finish()
    let url = folder.appending(path: "capture.json")
    try log.encoded().write(to: url)
    return Take(folder: folder, video: video.url, capture: url, depth: nil, duration: t, frames: log.frames.count, floorAreaM2: snap.stats.floorAreaM2,
                wallsFound: snap.stats.wallsFound, ceilingCovered: snap.stats.ceilingCovered, wideAt: nil, device: log.device)
  }

  func cancel() {
    queue.sync {
      stopped = true
      timer?.cancel()
      video?.cancel()
      if let folder { try? FileManager.default.removeItem(at: folder) }
    }
  }

  func jpeg() async -> Data? { nil } // no live finds in the pretend walk

  func pin(key: String, label: String, id: String) {
    queue.async { self.map.addPin(key: key, label: label, id: id) }
  }
}
#endif
