// Debug builds only: plays a recorded take back as if it were ARKit, so the whole filming screen can
// be tried in the simulator with no person: the camera picture, the poses and their timing, the
// overlay, coverage, the guide's voice, live finds and the upload.
//
// A take is a folder with a video (.mp4 or .mov) and its capture.json (ios/CAPTURE.md). What ARKit
// would have seen comes from, best first:
// - sensors.jsonl, which the app writes next to every real take (ARKit's own points and planes)
// - geometry.json, the open spaces of a Blender test basement (ios/Fixtures/<id>/): points are rays
//   cast from the true camera path, and walls are "found" once enough rays have hit them
// Launch with -BRReplay <folder> (and -BRReplayGeometry <file>, -BRReplaySpeed 2, -BRReplayLoop if
// wanted: a loop plays the take again and again, for long runs that watch memory and frame times).
#if DEBUG
import AVFoundation
import CoreVideo
import Foundation
import simd

final class ReplayCapture: CaptureSource, @unchecked Sendable {
  static var requested: URL? {
    UserDefaults.standard.string(forKey: "BRReplay").map { URL(fileURLWithPath: ($0 as NSString).expandingTildeInPath) }
  }

  let feed = OverlayFeed()
  let perf = CapturePerf()
  let take: URL
  private let speed: Double
  private let loop = ProcessInfo.processInfo.arguments.contains("-BRReplayLoop")
  private let send: @Sendable (CaptureEvent) -> Void
  private let queue = DispatchQueue(label: "replay", qos: .userInteractive)

  // Queue-confined.
  private var pipeline: CapturePipeline?
  private var reader: AVAssetReader?
  private var output: AVAssetReaderTrackOutput?
  private var asset: AVAsset?
  private var track: AVAssetTrack?
  private var loopOffset: Double = 0
  private var lastT: Double = 0
  private var timer: DispatchSourceTimer?
  private var poses: ReplayPoses?
  private var sensors: SensorPlayback?
  private var world: ReplayWorld?
  private var detector = PlaneDetector()
  private var stopped = false
  private var rng = SplitMix(seed: 7)
  private(set) var finished = false

  init(take: URL, send: @escaping @Sendable (CaptureEvent) -> Void) {
    self.take = take
    self.send = send
    speed = max(0.25, min(8, UserDefaults.standard.double(forKey: "BRReplaySpeed").nonZero ?? 1))
  }

  func start() throws {
    let files = (try? FileManager.default.contentsOfDirectory(at: take, includingPropertiesForKeys: nil)) ?? []
    guard let videoURL = files.first(where: { ["mp4", "mov"].contains($0.pathExtension.lowercased()) }) else {
      throw CaptureError.video("No video in the replay folder \(take.path).")
    }
    let poses = try ReplayPoses(url: take.appending(path: "capture.json"))
    let sensors = SensorPlayback(url: take.appending(path: "sensors.jsonl"))
    let geometryURL = UserDefaults.standard.string(forKey: "BRReplayGeometry").map { URL(fileURLWithPath: $0) } ?? take.appending(path: "geometry.json")
    let world = sensors == nil ? ReplayWorld(url: geometryURL) : nil

    let folder = try Take.newFolder()
    let pipeline = CapturePipeline(folder: folder, feed: feed, perf: perf, copyFrames: true, keepSensors: false, send: send)
    queue.sync {
      self.pipeline = pipeline
      self.poses = poses
      self.sensors = sensors
      self.world = world
    }
    // The video opens off the main thread; the frames start once it's ready.
    let interval = 1 / Double(max(1, poses.fps)) / speed
    let send = self.send
    Task.detached { [weak self] in
      let asset = AVURLAsset(url: videoURL)
      do {
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw CaptureError.video("The replay video has no picture.") }
        let (reader, output) = try Self.open(asset, track)
        self?.begin(asset: asset, track: track, reader: reader, output: output, interval: interval)
      } catch {
        send(.failed(error.localizedDescription))
      }
    }
  }

  private static func open(_ asset: AVAsset, _ track: AVAssetTrack) throws -> (AVAssetReader, AVAssetReaderTrackOutput) {
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
      kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any],
    ])
    output.alwaysCopiesSampleData = false
    reader.add(output)
    guard reader.startReading() else { throw CaptureError.video(reader.error?.localizedDescription ?? "The replay video can't be read.") }
    return (reader, output)
  }

  private func begin(asset: AVAsset, track: AVAssetTrack, reader: AVAssetReader, output: AVAssetReaderTrackOutput, interval: Double) {
    queue.async { [self] in
      guard !stopped else { return }
      self.asset = asset
      self.track = track
      self.reader = reader
      self.output = output
      let timer = DispatchSource.makeTimerSource(queue: queue)
      timer.schedule(deadline: .now(), repeating: interval, leeway: .milliseconds(2))
      timer.setEventHandler { [weak self] in self?.tick() }
      timer.resume()
      self.timer = timer
    }
  }

  private func tick() {
    guard !stopped, let pipeline, let output, let poses else { return }
    let began = ProcessInfo.processInfo.systemUptime
    guard let sample = output.copyNextSampleBuffer(), let image = CMSampleBufferGetImageBuffer(sample) else {
      if loop, let asset, let track, let (reader, output) = try? Self.open(asset, track) {
        // Again from the top, carrying on the take's clock.
        self.reader = reader
        self.output = output
        loopOffset += lastT + 1 / Double(max(1, poses.fps))
        if sensors != nil { sensors = SensorPlayback(url: take.appending(path: "sensors.jsonl")) }
        return
      }
      // The end of the take: the last picture stays up until Done.
      timer?.cancel()
      finished = true
      return
    }
    let t = CMSampleBufferGetPresentationTimeStamp(sample).seconds
    lastT = t
    let pose = poses.at(t)
    var g = poses.geometry
    let scale = Float(CVPixelBufferGetWidth(image)) / g.resolution.x
    if abs(scale - 1) > 0.01 {
      g.intrinsics *= scale
      g.resolution *= scale
    }
    feed.publish(LiveFrame(image: image, cameraToWorld: pose.transform, geometry: g))
    defer { perf.frame(lag: 0, handler: ProcessInfo.processInfo.systemUptime - began) }
    guard let step = pipeline.frame(image, timestamp: loopOffset + t, cameraToWorld: pose.transform, geometry: g, tracking: pose.tracking) else { return }
    guard step.look else { return }

    var points: [SIMD3<Float>] = []
    if sensors != nil {
      points = sensors!.points(upTo: t)
      for e in sensors!.planes(upTo: t) {
        if let p = e.plane { pipeline.plane(p, at: step.t) } else if let id = e.gone { pipeline.removePlane(id, at: step.t) }
      }
    } else if let world, pose.tracking == "normal" {
      let pos = SIMD3(pose.transform.columns.3.x, pose.transform.columns.3.y, pose.transform.columns.3.z)
      let rot = simd_float3x3(SIMD3(pose.transform.columns.0.x, pose.transform.columns.0.y, pose.transform.columns.0.z),
                              SIMD3(pose.transform.columns.1.x, pose.transform.columns.1.y, pose.transform.columns.1.z),
                              SIMD3(pose.transform.columns.2.x, pose.transform.columns.2.y, pose.transform.columns.2.z))
      for _ in 0..<260 {
        let px = SIMD2(Float(rng.unit()) * g.resolution.x, Float(rng.unit()) * g.resolution.y)
        guard let hit = world.cast(pos, rot * g.ray(px)) else { continue }
        let noise = SIMD3(Float(rng.unit() - 0.5), Float(rng.unit() - 0.5), Float(rng.unit() - 0.5)) * 0.02
        points.append(hit.point + noise)
        if let plane = detector.hit(hit, world: world) { pipeline.plane(plane, at: step.t) }
      }
    }
    pipeline.look(t: step.t, image: image, cameraToWorld: pose.transform, geometry: g, tracking: Self.kind(pose.tracking), points: points)
  }

  static func kind(_ tracking: String) -> Tracking {
    switch tracking {
    case "normal": .normal
    case "notAvailable": .unavailable
    case "limited:excessiveMotion": .tooFast
    case "limited:insufficientFeatures": .featureless
    case "limited:relocalizing": .relocalizing
    default: .initializing
    }
  }

  func stop() async throws -> Take {
    let pipeline = queue.sync { () -> CapturePipeline? in
      stopped = true
      timer?.cancel()
      reader?.cancelReading()
      return self.pipeline
    }
    guard let pipeline else { throw CaptureError.video("Nothing was filmed.") }
    return try await pipeline.stop(depth: nil, depthURL: nil)
  }

  func cancel() {
    let pipeline = queue.sync { () -> CapturePipeline? in
      stopped = true
      timer?.cancel()
      reader?.cancelReading()
      return self.pipeline
    }
    pipeline?.cancel()
  }

  func jpeg() async -> Data? {
    let pipeline = queue.sync { self.pipeline }
    return await pipeline?.jpeg()
  }

  func pin(key: String, label: String, id: String) {
    queue.async { self.pipeline?.pin(key: key, label: label, id: id) }
  }
}

// capture.json's poses, by time.
struct ReplayPoses {
  struct Pose {
    var t: Double
    var transform: simd_float4x4
    var tracking: String
  }
  var frames: [Pose]
  var geometry: ImageGeometry
  var fps: Int

  init(url: URL) throws {
    let data = try Data(contentsOf: url)
    guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let res = json["imageResolution"] as? [Double], res.count == 2,
          let raw = json["frames"] as? [[String: Any]], !raw.isEmpty else { throw CaptureError.video("The replay's capture.json can't be read.") }
    let rotation = (json["rotationCW"] as? Int) ?? ["portrait": 90, "landscapeRight": 0, "landscapeLeft": 180, "portraitUpsideDown": 270][json["orientation"] as? String ?? "portrait"] ?? 90
    var frames: [Pose] = []
    var k = SIMD4<Float>(1, 1, 0, 0)
    for f in raw {
      guard let t = f["t"] as? Double, let m = f["transform"] as? [Double], m.count == 16 else { continue }
      let c = m.map(Float.init)
      let T = simd_float4x4(SIMD4(c[0], c[1], c[2], c[3]), SIMD4(c[4], c[5], c[6], c[7]), SIMD4(c[8], c[9], c[10], c[11]), SIMD4(c[12], c[13], c[14], c[15]))
      if frames.isEmpty, let i = f["intrinsics"] as? [Double], i.count == 4 { k = SIMD4(i.map(Float.init)) }
      frames.append(Pose(t: t, transform: T, tracking: f["tracking"] as? String ?? "normal"))
    }
    frames.sort { $0.t < $1.t }
    self.frames = frames
    geometry = ImageGeometry(resolution: SIMD2(Float(res[0]), Float(res[1])), intrinsics: k, rotationCW: rotation)
    let span = (frames.last?.t ?? 1) - (frames.first?.t ?? 0)
    // The video's rate: the app writes every ARKit frame (60 a second) and keeps every other one.
    fps = min(30, max(1, Int((Double(frames.count - 1) / max(span, 0.001)).rounded())))
  }

  // The pose nearest `t`.
  func at(_ t: Double) -> Pose {
    var lo = 0, hi = frames.count - 1
    while lo < hi {
      let mid = (lo + hi) / 2
      if frames[mid].t < t { lo = mid + 1 } else { hi = mid }
    }
    if lo > 0, abs(frames[lo - 1].t - t) < abs(frames[lo].t - t) { return frames[lo - 1] }
    return frames[lo]
  }
}

// A real take's sensors.jsonl, played back in time order.
struct SensorPlayback {
  struct PlaneEvent {
    var t: Double
    var plane: PlaneObs?
    var gone: UUID?
  }
  private var looks: [(t: Double, points: [SIMD3<Float>])] = []
  private var events: [PlaneEvent] = []
  private var lookNext = 0
  private var eventNext = 0

  init?(url: URL) {
    guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
    for line in text.split(separator: "\n") {
      guard let o = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any], let t = o["t"] as? Double else { continue }
      if let p = o["p"] as? [Double] {
        let f = p.map(Float.init)
        looks.append((t, stride(from: 0, to: f.count - 2, by: 3).map { SIMD3(f[$0], f[$0 + 1], f[$0 + 2]) }))
      } else if let id = (o["plane"] as? String).flatMap(UUID.init(uuidString:)), let m = o["m"] as? [Double], m.count == 16, let b = o["b"] as? [Double] {
        let c = m.map(Float.init)
        let T = simd_float4x4(SIMD4(c[0], c[1], c[2], c[3]), SIMD4(c[4], c[5], c[6], c[7]), SIMD4(c[8], c[9], c[10], c[11]), SIMD4(c[12], c[13], c[14], c[15]))
        let f = b.map(Float.init)
        let boundary = stride(from: 0, to: f.count - 2, by: 3).map { SIMD3(f[$0], f[$0 + 1], f[$0 + 2]) }
        events.append(PlaneEvent(t: t, plane: PlaneObs(id: id, vertical: o["v"] as? Bool ?? false, transform: T, boundary: boundary)))
      } else if let id = (o["gone"] as? String).flatMap(UUID.init(uuidString:)) {
        events.append(PlaneEvent(t: t, gone: id))
      }
    }
    if looks.isEmpty && events.isEmpty { return nil }
  }

  mutating func points(upTo t: Double) -> [SIMD3<Float>] {
    var out: [SIMD3<Float>] = []
    while lookNext < looks.count, looks[lookNext].t <= t + 0.001 {
      out += looks[lookNext].points
      lookNext += 1
    }
    return out
  }

  mutating func planes(upTo t: Double) -> [PlaneEvent] {
    var out: [PlaneEvent] = []
    while eventNext < events.count, events[eventNext].t <= t + 0.001 {
      out.append(events[eventNext])
      eventNext += 1
    }
    return out
  }
}

// A Blender test basement's open spaces (rooms, doorways, the stairwell) as boxes in ARKit's world.
// Everything outside them is solid, so a ray from the camera hits the first wall, floor or ceiling.
struct ReplayWorld {
  struct Box {
    var lo: SIMD3<Float>
    var hi: SIMD3<Float>
    func contains(_ p: SIMD3<Float>, margin: Float = 0.001) -> Bool {
      all(p .> lo - margin) && all(p .< hi + margin)
    }
  }
  struct Hit {
    var point: SIMD3<Float>
    var normal: SIMD3<Float> // back into the open space
    var face: Int // box * 6 + axis * 2 + (going +)
  }
  var boxes: [Box]

  init?(url: URL) {
    guard let data = try? Data(contentsOf: url),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let raw = json["boxes"] as? [[String: Any]] else { return nil }
    // Blender is z-up: (x, y, z) → ARKit (x, z, −y).
    boxes = raw.compactMap { b in
      guard let lo = b["min"] as? [Double], let hi = b["max"] as? [Double], lo.count == 3, hi.count == 3 else { return nil }
      return Box(lo: SIMD3(Float(lo[0]), Float(lo[2]), Float(-hi[1])), hi: SIMD3(Float(hi[0]), Float(hi[2]), Float(-lo[1])))
    }
    if boxes.isEmpty { return nil }
  }

  func cast(_ origin: SIMD3<Float>, _ dir: SIMD3<Float>, maxDistance: Float = 7) -> Hit? {
    guard var b = boxes.firstIndex(where: { $0.contains(origin) }) else { return nil }
    var p = origin
    var travelled: Float = 0
    for _ in 0..<12 {
      let box = boxes[b]
      var tExit = Float.infinity
      var axis = 0
      for i in 0..<3 where abs(dir[i]) > 1e-6 {
        let t = ((dir[i] > 0 ? box.hi[i] : box.lo[i]) - p[i]) / dir[i]
        if t < tExit {
          tExit = max(0, t)
          axis = i
        }
      }
      guard tExit.isFinite else { return nil }
      let q = p + dir * tExit
      travelled += tExit
      if travelled > maxDistance { return nil }
      let probe = q + dir * 0.01
      if let next = boxes.indices.first(where: { $0 != b && boxes[$0].contains(probe, margin: 0) }) {
        p = probe
        travelled += 0.01
        b = next
        continue
      }
      var n = SIMD3<Float>(repeating: 0)
      n[axis] = dir[axis] > 0 ? -1 : 1
      return Hit(point: q, normal: n, face: b * 6 + axis * 2 + (dir[axis] > 0 ? 1 : 0))
    }
    return nil
  }
}

// ARKit finds a plane once it has seen enough of it; this does the same from the replay's ray hits.
struct PlaneDetector {
  private struct Face {
    var lo = SIMD3<Float>(repeating: .infinity)
    var hi = SIMD3<Float>(repeating: -.infinity)
    var hits = 0
    var sentAt = 0
    var normal = SIMD3<Float>(0, 1, 0)
  }
  private var faces: [Int: Face] = [:]

  // A plane to add or grow, now and then.
  mutating func hit(_ h: ReplayWorld.Hit, world: ReplayWorld) -> PlaneObs? {
    var f = faces[h.face] ?? Face()
    f.lo = simd_min(f.lo, h.point)
    f.hi = simd_max(f.hi, h.point)
    f.hits += 1
    f.normal = h.normal
    defer { faces[h.face] = f }
    guard f.hits >= 15, f.hits - f.sentAt >= (f.sentAt == 0 ? 0 : 12) else { return nil }
    f.sentAt = f.hits
    let center = (f.lo + f.hi) / 2, half = (f.hi - f.lo) / 2
    let id = UUID(uuid: Self.uuid(h.face))
    if abs(f.normal.y) > 0.5 {
      let T = simd_float4x4(SIMD4(1, 0, 0, 0), SIMD4(0, 1, 0, 0), SIMD4(0, 0, 1, 0), SIMD4(center, 1))
      return PlaneObs(id: id, vertical: false, transform: T, boundary: [SIMD3(-half.x, 0, -half.z), SIMD3(half.x, 0, -half.z), SIMD3(half.x, 0, half.z), SIMD3(-half.x, 0, half.z)])
    }
    let n = f.normal
    let along = SIMD3<Float>(-n.z, 0, n.x)
    let up = simd_cross(along, n)
    let T = simd_float4x4(SIMD4(along, 0), SIMD4(n, 0), SIMD4(up, 0), SIMD4(center, 1))
    let ha = abs(simd_dot(half, along)), hv = half.y
    return PlaneObs(id: id, vertical: true, transform: T, boundary: [SIMD3(-ha, 0, -hv), SIMD3(ha, 0, -hv), SIMD3(ha, 0, hv), SIMD3(-ha, 0, hv)])
  }

  private static func uuid(_ n: Int) -> uuid_t {
    var bytes = [UInt8](repeating: 0, count: 16)
    bytes[0] = 0x0B
    withUnsafeBytes(of: Int64(n).littleEndian) { for (i, b) in $0.enumerated() { bytes[8 + i] = b } }
    return (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7], bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15])
  }
}

// Repeatable randomness, so a replay sees the same points every time.
struct SplitMix {
  var state: UInt64
  init(seed: UInt64) { state = seed }
  mutating func next() -> UInt64 {
    state &+= 0x9E37_79B9_7F4A_7C15
    var z = state
    z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
    z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
    return z ^ (z >> 31)
  }
  mutating func unit() -> Double { Double(next() >> 11) / Double(1 << 53) }
}

private extension Double {
  var nonZero: Double? { self == 0 ? nil : self }
}
#endif
