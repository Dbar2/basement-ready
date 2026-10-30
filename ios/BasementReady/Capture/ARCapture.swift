// Filming with ARKit world tracking. Each ARFrame's numbers go to the take's pipeline (its pose for
// capture.json, a copy of every other picture for the video, feature points five times a second);
// on LiDAR phones, five depth maps a second go into depth.bin. The frame handler copies what it
// needs and returns: no ARFrame and no camera buffer is kept past the callback. The overlay draws
// from the session's current frame, holding it only while it's on screen.
import ARKit
import CoreImage

final class ARCapture: NSObject, ARSessionDelegate, CaptureSource, @unchecked Sendable {
  let session = ARSession()
  let feed = OverlayFeed()
  let perf = CapturePerf()
  private let queue = DispatchQueue(label: "capture", qos: .userInteractive)
  private let send: @Sendable (CaptureEvent) -> Void

  // Queue-confined.
  private var pipeline: CapturePipeline?
  private var depth: DepthWriter?
  private var stopped = false

  static var isSupported: Bool { ARWorldTrackingConfiguration.isSupported }

  init(send: @escaping @Sendable (CaptureEvent) -> Void) {
    self.send = send
    super.init()
    session.delegate = self
    session.delegateQueue = queue
    feed.current = { [weak self] in
      guard let frame = self?.session.currentFrame else { return nil }
      return LiveFrame(image: frame.capturedImage, cameraToWorld: frame.camera.transform, geometry: Self.geometry(frame.camera))
    }
  }

  // The largest 4:3 picture from the main (1×) camera: 1920 × 1440 at 60 Hz on an iPhone 15. The 4K
  // formats are 16:9, which crops the view, and the server works at 1280 px anyway.
  static func bestFormat() -> ARConfiguration.VideoFormat? {
    let wide = ARWorldTrackingConfiguration.supportedVideoFormats.filter { $0.captureDeviceType == .builtInWideAngleCamera && $0.captureDevicePosition == .back }
    let pixels = { (f: ARConfiguration.VideoFormat) in f.imageResolution.width * f.imageResolution.height }
    let fourThree = wide.filter { abs($0.imageResolution.width / $0.imageResolution.height - 4.0 / 3.0) < 0.02 }
    return (fourThree.isEmpty ? wide : fourThree).max { (pixels($0), $0.framesPerSecond) < (pixels($1), $1.framesPerSecond) }
  }

  static func geometry(_ cam: ARCamera) -> ImageGeometry {
    let k = cam.intrinsics
    return ImageGeometry(resolution: SIMD2(Float(cam.imageResolution.width), Float(cam.imageResolution.height)), intrinsics: SIMD4(k[0][0], k[1][1], k[2][0], k[2][1]), rotationCW: 90)
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
    let pipeline = CapturePipeline(folder: folder, feed: feed, perf: perf, copyFrames: true, lidar: lidar, send: send)
    queue.sync {
      self.pipeline = pipeline
      self.depth = lidar ? try? DepthWriter(url: folder.appending(path: "depth.bin")) : nil
    }
    session.run(config, options: [.resetTracking, .removeExistingAnchors])
  }

  // Finishes the files. The video and capture.json share one clock: seconds from the first frame.
  func stop() async throws -> Take {
    session.pause()
    // After this, no frame handler is running and none will do anything.
    let (pipeline, depth) = queue.sync { () -> (CapturePipeline?, DepthWriter?) in
      stopped = true
      return (self.pipeline, self.depth)
    }
    guard let pipeline else { throw CaptureError.video("Nothing was filmed.") }
    return try await pipeline.stop(depth: depth?.finish(), depthURL: depth?.url)
  }

  func cancel() {
    session.pause()
    let pipeline = queue.sync { () -> CapturePipeline? in
      stopped = true
      _ = depth?.finish()
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

  // ---------- ARSessionDelegate (on `queue`) ----------

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    let began = ProcessInfo.processInfo.systemUptime
    defer { perf.frame(lag: began - frame.timestamp, handler: ProcessInfo.processInfo.systemUptime - began) }
    guard !stopped, let pipeline else { return }
    let cam = frame.camera
    let g = Self.geometry(cam)
    guard let step = pipeline.frame(frame.capturedImage, timestamp: frame.timestamp, cameraToWorld: cam.transform, geometry: g, tracking: Self.tracking(cam.trackingState)) else { return }
    if let depth, depth.due(step.t), let d = frame.sceneDepth {
      depth.append(depth: d.depthMap, confidence: d.confidenceMap, at: step.t)
    }
    if step.look {
      pipeline.look(t: step.t, image: frame.capturedImage, cameraToWorld: cam.transform, geometry: g, tracking: Self.trackingKind(cam.trackingState), points: frame.rawFeaturePoints?.points ?? [])
    }
  }

  func session(_ session: ARSession, didAdd anchors: [ARAnchor]) { planes(anchors) }
  func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) { planes(anchors) }
  func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
    guard !stopped, let pipeline else { return }
    for a in anchors where a is ARPlaneAnchor { pipeline.removePlane(a.identifier, at: pipeline.elapsed) }
  }

  private func planes(_ anchors: [ARAnchor]) {
    guard !stopped, let pipeline else { return }
    for case let p as ARPlaneAnchor in anchors {
      pipeline.plane(PlaneObs(id: p.identifier, vertical: p.alignment == .vertical, transform: p.transform, boundary: p.geometry.boundaryVertices), at: pipeline.elapsed)
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
}
