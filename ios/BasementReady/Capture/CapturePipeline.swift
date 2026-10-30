// One take's bookkeeping, fed by the real camera (ARCapture) or a replayed take (ReplayCapture):
// - every frame: its capture.json record, and every other one goes into the video (copied first,
//   so the camera's own buffer goes straight back to it)
// - five times a second: the points for the point cloud, and a look for the coverage map
// The caller's frame handler only copies numbers and returns. The map, the video encoder and the
// live-finds JPEG each have their own queue, and a map that's still busy is skipped, never queued:
// a frame handler that falls behind is what made ARKit stop sending frames (filming froze at 0:06).
import CoreImage
import CoreVideo
import Foundation
import simd

struct FrameStep {
  var t: Double // seconds on the video's timeline
  var look: Bool // time for the cloud and the map
}

final class CapturePipeline: @unchecked Sendable {
  static let lookEvery: Double = 0.2

  let folder: URL
  let feed: OverlayFeed
  let perf: CapturePerf
  private let send: @Sendable (CaptureEvent) -> Void
  private let copyFrames: Bool
  private let lidar: Bool

  // Shared with stop(), cancel() and jpeg(), under `lock`.
  private let lock = NSLock()
  private var video: VideoWriter?
  private var log: CaptureLog?
  private var stopped = false
  private var jpegWaiters: [CheckedContinuation<Data?, Never>] = []
  private var videoPending = 0
  private var mapBusy = false
  private(set) var videoDroppedBusy = 0
  private(set) var mapRuns = 0
  var mapDelay: Double = 0 // tests: a map as slow as an unoptimised build on a phone

  // The caller's queue only.
  private var startTimestamp: Double?
  private var lastT: Double = 0
  private var lastLookT: Double = -1
  private var lastVideoT: Double = -1
  private var frameCount = 0
  private var motion: [(t: Double, pos: SIMD3<Float>, look: SIMD3<Float>)] = []
  private var pendingPlanes: [UUID: PlaneObs] = [:]
  private var removedPlanes = Set<UUID>()
  private let copier = PixelCopier()
  private let sensors: SensorLog?

  // The map's queue only.
  private let map = CoverageMap()

  private let mapQueue = DispatchQueue(label: "map", qos: .userInitiated)
  private let videoQueue = DispatchQueue(label: "video", qos: .userInitiated)
  private let jpegQueue = DispatchQueue(label: "jpeg", qos: .utility)
  private let ciContext = CIContext(options: [.cacheIntermediates: false])

  init(folder: URL, feed: OverlayFeed, perf: CapturePerf, copyFrames: Bool, lidar: Bool = false, keepSensors: Bool = true, send: @escaping @Sendable (CaptureEvent) -> Void) {
    self.folder = folder
    self.feed = feed
    self.perf = perf
    self.copyFrames = copyFrames
    self.lidar = lidar
    self.send = send
    sensors = keepSensors ? SensorLog(url: folder.appending(path: "sensors.jsonl")) : nil
    perf.extra = { [weak self] in self?.perfText() ?? "" }
  }

  private func perfText() -> String {
    lock.lock()
    defer { lock.unlock() }
    return "video=\(video?.framesWritten ?? 0)/\(video?.framesDropped ?? 0)+\(videoDroppedBusy) frames=\(log?.frames.count ?? 0) cloud=\(feed.cloud.count)"
  }

  // ---------- on the caller's queue ----------

  // Every frame. Nil if it's out of order, or the take has stopped.
  func frame(_ image: CVPixelBuffer, timestamp: Double, cameraToWorld T: simd_float4x4, geometry g: ImageGeometry, tracking: String) -> FrameStep? {
    lock.lock()
    let isStopped = stopped
    lock.unlock()
    if isStopped { return nil }
    if startTimestamp == nil {
      // The video file opens on its own queue (it takes ~100 ms); this frame's picture follows it there.
      let url = folder.appending(path: "video.mp4"), w = CVPixelBufferGetWidth(image), h = CVPixelBufferGetHeight(image)
      videoQueue.async { [self] in
        do {
          let v = try VideoWriter(url: url, width: w, height: h, rotationCW: g.rotationCW)
          lock.withLock { video = v }
        } catch {
          lock.withLock { stopped = true }
          send(.failed(error.localizedDescription))
        }
      }
      lock.lock()
      log = CaptureLog(device: DeviceModel.identifier, imageResolution: (Int(g.resolution.x), Int(g.resolution.y)), arkitStartTime: timestamp, rotationCW: g.rotationCW)
      lock.unlock()
      startTimestamp = timestamp
    }
    let t = timestamp - startTimestamp!
    guard t >= lastT || frameCount == 0 else { return nil }
    lastT = t
    frameCount += 1

    lock.lock()
    log?.frames.append(FrameRecord(t: t, transform: T, intrinsics: g.intrinsics, tracking: tracking))
    let wantJPEG = !jpegWaiters.isEmpty
    lock.unlock()

    // The video keeps every other frame: about 30 a second.
    if lastVideoT < 0 || t - lastVideoT >= 1 / VideoWriter.maxFPS - 0.004 {
      lastVideoT = t
      if let buffer = copyFrames ? copier.copy(image) : image {
        lock.lock()
        let room = videoPending < 4
        if room { videoPending += 1 } else { videoDroppedBusy += 1 }
        lock.unlock()
        if room {
          videoQueue.async { [self] in
            lock.withLock { video }?.append(buffer, at: t)
            lock.lock()
            videoPending -= 1
            lock.unlock()
          }
        }
        if wantJPEG { makeJPEG(buffer, rotationCW: g.rotationCW) }
      }
    }

    let look = t - lastLookT >= Self.lookEvery || lastLookT < 0
    if look { lastLookT = t }
    return FrameStep(t: t, look: look)
  }

  // A look: the points (world space) go into the cloud, coloured from `image`, and to the map.
  func look(t: Double, image: CVPixelBuffer, cameraToWorld T: simd_float4x4, geometry g: ImageGeometry, tracking: Tracking, points: [SIMD3<Float>]) {
    let tracked = tracking == .normal
    let toCamera = T.inverse
    var pixels: [SIMD2<Float>] = []
    var kept: [SIMD3<Float>] = []
    pixels.reserveCapacity(points.count)
    kept.reserveCapacity(points.count)
    for p in points {
      let c = toCamera * SIMD4(p, 1)
      if let px = g.pixel(SIMD3(c.x, c.y, c.z)), simd_distance(p, SIMD3(T.columns.3.x, T.columns.3.y, T.columns.3.z)) < 8 {
        pixels.append(px)
        kept.append(p)
      }
    }
    if tracked {
      let colors = ImageSampler.colors(image, at: pixels)
      var colored: [(SIMD3<Float>, SIMD4<UInt8>)] = []
      colored.reserveCapacity(kept.count)
      for (i, c) in colors.enumerated() { if let c { colored.append((kept[i], c)) } }
      feed.cloud.add(colored, at: feed.now())
    }
    sensors?.look(t: t, points: kept)

    // Held still: under 12 cm and 8° of change over the last two seconds.
    let pos = SIMD3(T.columns.3.x, T.columns.3.y, T.columns.3.z)
    let lookDir = -SIMD3(T.columns.2.x, T.columns.2.y, T.columns.2.z)
    motion.append((t, pos, lookDir))
    motion.removeAll { t - $0.t > 2.05 }
    let still = tracked && (motion.first.map { t - $0.t >= 1.9 } ?? false)
      && motion.allSatisfy { simd_distance($0.pos, pos) < 0.12 && simd_dot($0.look, lookDir) > cos(8 * Float.pi / 180) }

    lock.lock()
    if mapBusy {
      lock.unlock()
      perf.mapSkip()
      return
    }
    mapBusy = true
    lock.unlock()
    let planes = pendingPlanes, removed = removedPlanes
    pendingPlanes = [:]
    removedPlanes = []
    let sample = kept.count > 300 ? stride(from: 0, to: kept.count, by: kept.count / 300 + 1).map { kept[$0] } : kept
    let cam = CameraObs(transform: T, intrinsics: g.intrinsics, resolution: g.resolution, tracked: tracked)
    let lidar = self.lidar
    mapQueue.async { [self] in
      let began = ProcessInfo.processInfo.systemUptime
      if mapDelay > 0 { Thread.sleep(forTimeInterval: mapDelay) }
      for id in removed { map.remove(planeID: id) }
      for p in planes.values { map.upsert(p) }
      map.observe(cam, points: sample)
      let snap = map.snapshot()
      perf.map(ProcessInfo.processInfo.systemUptime - began)
      feed.map.set(snap)
      lock.lock()
      mapBusy = false
      mapRuns += 1
      let isStopped = stopped
      lock.unlock()
      if !isStopped { send(.update(CaptureUpdate(elapsed: t, tracking: tracking, map: snap, still: still, depth: lidar))) }
    }
  }

  func plane(_ p: PlaneObs, at t: Double) {
    pendingPlanes[p.id] = p
    removedPlanes.remove(p.id)
    feed.walls.upsert(p, at: feed.now())
    sensors?.plane(p, t: t)
  }

  func removePlane(_ id: UUID, at t: Double) {
    pendingPlanes[id] = nil
    removedPlanes.insert(id)
    feed.walls.remove(id)
    sensors?.removed(id, t: t)
  }

  var elapsed: Double { lastT }

  // ---------- from anywhere ----------

  func pin(key: String, label: String, id: String) {
    mapQueue.async { [self] in map.addPin(key: key, label: label, id: id) }
  }

  // The newest camera picture, upright and small, for the live finds. Made from the video's own copy,
  // on its own queue.
  func jpeg() async -> Data? {
    await withCheckedContinuation { c in
      lock.lock()
      if stopped {
        lock.unlock()
        c.resume(returning: nil)
      } else {
        jpegWaiters.append(c)
        lock.unlock()
      }
    }
  }

  private func makeJPEG(_ buffer: CVPixelBuffer, rotationCW: Int) {
    lock.lock()
    let waiters = jpegWaiters
    jpegWaiters = []
    lock.unlock()
    jpegQueue.async { [ciContext] in
      let data = ImageSampler.jpeg(buffer, rotationCW: rotationCW, context: ciContext)
      for w in waiters { w.resume(returning: data) }
    }
  }

  // Finishes the files. The caller has already stopped calling frame().
  func stop(depth: DepthIndex?, depthURL: URL?) async throws -> Take {
    let (waiters, video) = lock.withLock { () -> ([CheckedContinuation<Data?, Never>], VideoWriter?) in
      stopped = true
      defer { jpegWaiters = [] }
      return (jpegWaiters, self.video)
    }
    for w in waiters { w.resume(returning: nil) }
    // Let the frames already on their way into the video land, then close it.
    await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in videoQueue.async { video?.closeInput(); c.resume() } }
    let log = lock.withLock { self.log }
    guard let video, var log else { throw CaptureError.video("Nothing was filmed.") }
    try await video.finish()
    log.depth = depth
    let captureURL = folder.appending(path: "capture.json")
    try log.encoded().write(to: captureURL)
    sensors?.finish()
    let snap = await withCheckedContinuation { (c: CheckedContinuation<MapSnapshot, Never>) in mapQueue.async { [self] in c.resume(returning: map.snapshot()) } }
    return Take(
      folder: folder, video: video.url, capture: captureURL, depth: depth == nil ? nil : depthURL,
      duration: log.frames.last?.t ?? 0, frames: log.frames.count, floorAreaM2: snap.stats.floorAreaM2, wallsFound: snap.stats.wallsFound,
      ceilingCovered: snap.stats.ceilingCovered, wideAt: nil, device: log.device)
  }

  func cancel() {
    lock.lock()
    stopped = true
    let waiters = jpegWaiters
    jpegWaiters = []
    let video = self.video
    lock.unlock()
    for w in waiters { w.resume(returning: nil) }
    videoQueue.async { [folder, sensors] in
      video?.cancel()
      sensors?.finish()
      try? FileManager.default.removeItem(at: folder)
    }
  }
}

// What ARKit saw while filming, five times a second, next to the take: its points and planes. Not
// sent anywhere; it lets the replay harness play a real take back exactly as the phone saw it.
final class SensorLog: @unchecked Sendable {
  private let queue = DispatchQueue(label: "sensors", qos: .utility)
  private var handle: FileHandle?

  init(url: URL) {
    FileManager.default.createFile(atPath: url.path, contents: nil)
    handle = try? FileHandle(forWritingTo: url)
  }

  // The text is made on the log's own queue, not the camera's.
  private func write(_ line: @escaping @Sendable () -> String) {
    queue.async { [self] in try? handle?.write(contentsOf: Data((line() + "\n").utf8)) }
  }

  func look(t: Double, points: [SIMD3<Float>]) {
    write {
      "{\"t\":" + String(format: "%.4f", t) + ",\"p\":[" + points.map { String(format: "%.3f,%.3f,%.3f", $0.x, $0.y, $0.z) }.joined(separator: ",") + "]}"
    }
  }

  func plane(_ p: PlaneObs, t: Double) {
    write {
      let m = CaptureLog.columnMajor(p.transform).map { String(format: "%.4f", $0) }.joined(separator: ",")
      let b = p.boundary.map { String(format: "%.3f,%.3f,%.3f", $0.x, $0.y, $0.z) }.joined(separator: ",")
      return "{\"t\":" + String(format: "%.4f", t) + ",\"plane\":\"\(p.id.uuidString)\",\"v\":\(p.vertical),\"m\":[\(m)],\"b\":[\(b)]}"
    }
  }

  func removed(_ id: UUID, t: Double) {
    write { "{\"t\":" + String(format: "%.4f", t) + ",\"gone\":\"\(id.uuidString)\"}" }
  }

  func finish() {
    queue.sync { [self] in
      try? handle?.close()
      handle = nil
    }
  }
}
