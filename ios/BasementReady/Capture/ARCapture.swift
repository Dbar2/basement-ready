// Filming with ARKit world tracking. Every ARFrame becomes a capture.json record (where the camera
// was, at true scale, gravity up); every other one goes into the HEVC video; on LiDAR phones, five
// depth maps a second go into depth.bin. Five times a second the map takes a look. All the work
// happens on one serial queue, and no ARFrame is kept past its callback.
import ARKit
import CoreImage

final class ARCapture: NSObject, ARSessionDelegate, CaptureSource, @unchecked Sendable {
  let session = ARSession()
  private let queue = DispatchQueue(label: "capture", qos: .userInitiated)
  private let ciContext = CIContext(options: [.cacheIntermediates: false])

  // Queue-confined state.
  private var folder: URL!
  private var video: VideoWriter?
  private var depth: DepthWriter?
  private var log: CaptureLog?
  private var startTimestamp: Double?
  private var lastT: Double = 0
  private var lastLookT: Double = 0
  private var map = CoverageMap()
  private var pendingPlanes: [UUID: PlaneObs] = [:]
  private var removedPlanes = Set<UUID>()
  private var frameCount = 0
  private var stopped = false
  private var jpegWaiters: [CheckedContinuation<Data?, Never>] = []
  private var motion: [(t: Double, pos: SIMD3<Float>, look: SIMD3<Float>)] = []
  private let send: @Sendable (CaptureEvent) -> Void

  static var isSupported: Bool { ARWorldTrackingConfiguration.isSupported }

  init(send: @escaping @Sendable (CaptureEvent) -> Void) {
    self.send = send
    super.init()
    session.delegate = self
    session.delegateQueue = queue
  }

  // The largest 4:3 picture from the main (1×) camera: 1920 × 1440 at 60 Hz on an iPhone 15. The 4K
  // formats are 16:9, which crops the view, and the server works at 1280 px anyway.
  static func bestFormat() -> ARConfiguration.VideoFormat? {
    let wide = ARWorldTrackingConfiguration.supportedVideoFormats.filter { $0.captureDeviceType == .builtInWideAngleCamera && $0.captureDevicePosition == .back }
    let pixels = { (f: ARConfiguration.VideoFormat) in f.imageResolution.width * f.imageResolution.height }
    let fourThree = wide.filter { abs($0.imageResolution.width / $0.imageResolution.height - 4.0 / 3.0) < 0.02 }
    return (fourThree.isEmpty ? wide : fourThree).max { (pixels($0), $0.framesPerSecond) < (pixels($1), $1.framesPerSecond) }
  }

  func start() throws {
    guard Self.isSupported else { throw CaptureError.unsupported }
    let folder = try Take.newFolder()
    let config = ARWorldTrackingConfiguration()
    config.worldAlignment = .gravity
    config.planeDetection = [.horizontal, .vertical]
    config.isAutoFocusEnabled = true
    config.environmentTexturing = .none
    if let f = Self.bestFormat() { config.videoFormat = f }
    let lidar = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
    if lidar { config.frameSemantics.insert(.sceneDepth) }
    queue.sync {
      self.folder = folder
      self.depth = lidar ? try? DepthWriter(url: folder.appending(path: "depth.bin")) : nil
    }
    session.run(config, options: [.resetTracking, .removeExistingAnchors])
  }

  // Finishes the files. The video and capture.json share one clock: seconds from the first frame.
  func stop() async throws -> Take {
    session.pause()
    let (video, depth, log, folder, frames) = queue.sync { () -> (VideoWriter?, DepthWriter?, CaptureLog?, URL?, Int) in
      stopped = true
      for w in jpegWaiters { w.resume(returning: nil) }
      jpegWaiters = []
      return (self.video, self.depth, self.log, self.folder, self.frameCount)
    }
    guard let video, var log, let folder else { throw CaptureError.video("Nothing was filmed.") }
    try await video.finish()
    log.depth = depth?.finish()
    let captureURL = folder.appending(path: "capture.json")
    try log.encoded().write(to: captureURL)
    let snap = queue.sync { map.snapshot() }
    return Take(
      folder: folder, video: video.url, capture: captureURL, depth: log.depth == nil ? nil : depth?.url,
      duration: log.frames.last?.t ?? 0, frames: frames, floorAreaM2: snap.stats.floorAreaM2, wallsFound: snap.stats.wallsFound,
      ceilingCovered: snap.stats.ceilingCovered, wideAt: nil, device: log.device)
  }

  func cancel() {
    session.pause()
    queue.sync {
      stopped = true
      video?.cancel()
      _ = depth?.finish()
      for w in jpegWaiters { w.resume(returning: nil) }
      jpegWaiters = []
      if let folder { try? FileManager.default.removeItem(at: folder) }
    }
  }

  // The newest camera picture, upright and small, for the live finds.
  func jpeg() async -> Data? {
    await withCheckedContinuation { c in
      queue.async {
        if self.stopped { c.resume(returning: nil) } else { self.jpegWaiters.append(c) }
      }
    }
  }

  func pin(key: String, label: String, id: String) {
    queue.async { self.map.addPin(key: key, label: label, id: id) }
  }

  // ---------- ARSessionDelegate (on `queue`) ----------

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    guard !stopped, let folder else { return }
    let cam = frame.camera
    if startTimestamp == nil {
      let res = cam.imageResolution
      do {
        video = try VideoWriter(url: folder.appending(path: "video.mp4"), width: Int(res.width), height: Int(res.height))
      } catch {
        stopped = true
        send(.failed(error.localizedDescription))
        return
      }
      startTimestamp = frame.timestamp
      log = CaptureLog(device: DeviceModel.identifier, imageResolution: (Int(res.width), Int(res.height)), arkitStartTime: frame.timestamp)
    }
    let t = frame.timestamp - startTimestamp!
    guard t >= lastT || frameCount == 0 else { return }
    lastT = t
    frameCount += 1

    video?.append(frame.capturedImage, at: t)
    let k = cam.intrinsics
    log?.frames.append(FrameRecord(t: t, transform: cam.transform, intrinsics: SIMD4(k[0][0], k[1][1], k[2][0], k[2][1]), tracking: Self.tracking(cam.trackingState)))
    if let depth, depth.due(t), let d = frame.sceneDepth {
      depth.append(depth: d.depthMap, confidence: d.confidenceMap, at: t)
    }
    if !jpegWaiters.isEmpty {
      let jpeg = Self.jpeg(frame.capturedImage, context: ciContext)
      for w in jpegWaiters { w.resume(returning: jpeg) }
      jpegWaiters = []
    }

    // The map looks five times a second.
    if t - lastLookT >= 0.2 || frameCount == 1 {
      lastLookT = t
      look(frame, t: t)
    }
  }

  private func look(_ frame: ARFrame, t: Double) {
    for id in removedPlanes { map.remove(planeID: id) }
    removedPlanes = []
    for p in pendingPlanes.values { map.upsert(p) }
    pendingPlanes = [:]
    let cam = frame.camera
    let res = cam.imageResolution
    let k = cam.intrinsics
    let tracked: Bool
    if case .normal = cam.trackingState { tracked = true } else { tracked = false }
    var points = frame.rawFeaturePoints?.points ?? []
    if points.count > 300 { points = stride(from: 0, to: points.count, by: points.count / 300 + 1).map { points[$0] } }
    map.observe(CameraObs(transform: cam.transform, intrinsics: SIMD4(k[0][0], k[1][1], k[2][0], k[2][1]), resolution: SIMD2(Float(res.width), Float(res.height)), tracked: tracked), points: points)

    // Held still: under 12 cm and 8° of change over the last two seconds.
    let pos = SIMD3(cam.transform.columns.3.x, cam.transform.columns.3.y, cam.transform.columns.3.z)
    let look = -SIMD3(cam.transform.columns.2.x, cam.transform.columns.2.y, cam.transform.columns.2.z)
    motion.append((t, pos, look))
    motion.removeAll { t - $0.t > 2.05 }
    let still = tracked && (motion.first.map { t - $0.t >= 1.9 } ?? false)
      && motion.allSatisfy { simd_distance($0.pos, pos) < 0.12 && simd_dot($0.look, look) > cos(8 * Float.pi / 180) }

    send(.update(CaptureUpdate(elapsed: t, tracking: Self.trackingKind(cam.trackingState), map: map.snapshot(), still: still, depth: depth != nil)))
  }

  func session(_ session: ARSession, didAdd anchors: [ARAnchor]) { planes(anchors) }
  func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) { planes(anchors) }
  func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
    for a in anchors where a is ARPlaneAnchor {
      pendingPlanes[a.identifier] = nil
      removedPlanes.insert(a.identifier)
    }
  }

  private func planes(_ anchors: [ARAnchor]) {
    for case let p as ARPlaneAnchor in anchors {
      pendingPlanes[p.identifier] = PlaneObs(id: p.identifier, vertical: p.alignment == .vertical, transform: p.transform, boundary: p.geometry.boundaryVertices)
    }
  }

  func sessionWasInterrupted(_ session: ARSession) {
    if !stopped { send(.interrupted) }
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    let code = (error as? ARError)?.code
    send(.failed(code == .cameraUnauthorized
      ? "Basement Ready can't use the camera. Turn it on in Settings, then try again."
      : "The camera stopped: \(error.localizedDescription)"))
  }

  // ---------- helpers ----------

  static func tracking(_ state: ARCamera.TrackingState) -> String {
    switch state {
    case .normal: return "normal"
    case .notAvailable: return "notAvailable"
    case .limited(let reason):
      switch reason {
      case .initializing: return "limited:initializing"
      case .excessiveMotion: return "limited:excessiveMotion"
      case .insufficientFeatures: return "limited:insufficientFeatures"
      case .relocalizing: return "limited:relocalizing"
      @unknown default: return "limited:unknown"
      }
    }
  }

  static func trackingKind(_ state: ARCamera.TrackingState) -> Tracking {
    switch state {
    case .normal: .normal
    case .notAvailable: .unavailable
    case .limited(.initializing): .initializing
    case .limited(.excessiveMotion): .tooFast
    case .limited(.insufficientFeatures): .featureless
    case .limited(.relocalizing): .relocalizing
    case .limited: .initializing
    }
  }

  // Upright (portrait: the sensor picture turned 90° clockwise), 768 px on the long side, like the web's.
  static func jpeg(_ buffer: CVPixelBuffer, context: CIContext) -> Data? {
    let upright = CIImage(cvPixelBuffer: buffer).oriented(.right)
    let scale = 768 / max(upright.extent.width, upright.extent.height)
    let small = upright.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    return context.jpegRepresentation(of: small, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.8])
  }
}
