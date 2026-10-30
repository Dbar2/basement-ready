import CoreVideo
import XCTest
import simd
@testable import BasementReady

// The filming freeze at 0:06 (Oct 30): the frame handler did the map's work and handed ARKit's own
// camera buffers to the video encoder, so ARKit ran out of buffers and stopped sending frames. These
// tests feed the pipeline the way ARKit does: 60 frames a second from a small pool of camera buffers.
final class CapturePipelineTests: XCTestCase {
  // ARKit's camera has a handful of buffers; this pool refuses a seventh while six are out.
  private final class CameraPool {
    private var pool: CVPixelBufferPool?
    init(width: Int = 1920, height: Int = 1440) {
      let attrs: [CFString: Any] = [
        kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
        kCVPixelBufferWidthKey: width, kCVPixelBufferHeightKey: height,
        kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary,
      ]
      CVPixelBufferPoolCreate(nil, nil, attrs as CFDictionary, &pool)
    }
    func next() -> CVPixelBuffer? {
      var out: CVPixelBuffer?
      let r = CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(nil, pool!, [kCVPixelBufferPoolAllocationThresholdKey: 6] as CFDictionary, &out)
      return r == kCVReturnSuccess ? out : nil
    }
  }

  private final class Events: @unchecked Sendable {
    private let lock = NSLock()
    private var updates = 0
    func send(_ e: CaptureEvent) {
      if case .update = e { lock.withLock { updates += 1 } }
    }
    var count: Int { lock.withLock { updates } }
  }

  private func pose(_ t: Double) -> simd_float4x4 {
    let yaw = Float(t) * 0.5
    let fwd = SIMD3<Float>(sin(yaw), 0, -cos(yaw)), right = SIMD3<Float>(cos(yaw), 0, sin(yaw)), up = SIMD3<Float>(0, 1, 0)
    return simd_float4x4(SIMD4(-up, 0), SIMD4(right, 0), SIMD4(-fwd, 0), SIMD4(Float(sin(t * 0.2)) * 2, 1.4, -3, 1))
  }

  private let geometry = ImageGeometry(resolution: SIMD2(1920, 1440), intrinsics: SIMD4(1450, 1450, 960, 720), rotationCW: 90)

  // Runs `seconds` of 60 Hz frames through a pipeline; returns each frame's handler time.
  private func film(_ pipeline: CapturePipeline, seconds: Double, speed: Double = 1, size: (Int, Int) = (1920, 1440), from start: Double = 0) throws -> [Double] {
    let camera = CameraPool(width: size.0, height: size.1)
    var times: [Double] = []
    let frames = Int(seconds * 60)
    let wallID = UUID()
    for i in 0..<frames {
      let t = start + Double(i) / 60
      let image = try XCTUnwrap(camera.next(), "the camera ran out of buffers at frame \(i) (\(String(format: "%.1f", t)) s): the pipeline is holding on to them")
      let T = pose(t)
      let began = ProcessInfo.processInfo.systemUptime
      if let step = pipeline.frame(image, timestamp: 1000 + t, cameraToWorld: T, geometry: geometry, tracking: "normal"), step.look {
        let boundary = (0..<120).map { j -> SIMD3<Float> in SIMD3(Float(j) / 40 - 1.5, 0, j % 2 == 0 ? -1 : 1) }
        pipeline.plane(PlaneObs(id: wallID, vertical: true, transform: simd_float4x4(SIMD4(1, 0, 0, 0), SIMD4(0, 0, 1, 0), SIMD4(0, 1, 0, 0), SIMD4(0, 1.2, -5, 1)), boundary: boundary), at: step.t)
        let points = (0..<400).map { k in SIMD3<Float>(Float(k % 20) * 0.2 - 2, Float(k / 20) * 0.12, -5) }
        pipeline.look(t: step.t, image: image, cameraToWorld: T, geometry: geometry, tracking: .normal, points: points)
      }
      times.append(ProcessInfo.processInfo.systemUptime - began)
      Thread.sleep(forTimeInterval: max(0, 1.0 / 60 / speed - times.last!))
    }
    return times
  }

  // A map as slow as the unoptimised build was on the phone never slows the frame handler, and the
  // camera's buffers always go straight back.
  func testASlowMapNeverHoldsUpTheCamera() async throws {
    let folder = FileManager.default.temporaryDirectory.appending(path: "pipeline-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    let events = Events()
    let feed = OverlayFeed()
    let pipeline = CapturePipeline(folder: folder, feed: feed, perf: CapturePerf(), copyFrames: true, send: { events.send($0) })
    pipeline.mapDelay = 0.3

    let times = try film(pipeline, seconds: 6)
    let sorted = times.sorted()
    let p99 = sorted[Int(Double(sorted.count) * 0.99)]
    print(String(format: "BRPERF pipeline handler: median %.2f ms, p99 %.2f ms, max %.2f ms; map ran %d times", sorted[sorted.count / 2] * 1000, p99 * 1000, sorted.last! * 1000, pipeline.mapRuns))
    XCTAssertLessThan(p99, 0.008, "the frame handler must not wait for the map")
    XCTAssertGreaterThan(pipeline.mapRuns, 5, "the map still runs, skipping looks while it's busy")
    XCTAssertGreaterThan(feed.cloud.count, 100, "the point cloud fills in")

    let take = try await pipeline.stop(depth: nil, depthURL: nil)
    XCTAssertEqual(take.frames, 360, "every frame is in capture.json")
    XCTAssertEqual(take.duration, 359.0 / 60, accuracy: 0.001)
    let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: take.capture)) as? [String: Any])
    XCTAssertEqual(json["orientation"] as? String, "portrait")
    XCTAssertEqual((json["frames"] as? [Any])?.count, 360)
    let size = try XCTUnwrap(FileManager.default.attributesOfItem(atPath: take.video.path)[.size] as? Int)
    XCTAssertGreaterThan(size, 10_000)
  }

  // Memory stays flat over a long take: only capture.json's records grow (about 100 bytes a frame).
  // At four times real speed, with small pictures the simulator's software encoder keeps up with.
  func testMemoryStaysBoundedOverALongTake() async throws {
    let folder = FileManager.default.temporaryDirectory.appending(path: "pipeline-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    let pipeline = CapturePipeline(folder: folder, feed: OverlayFeed(), perf: CapturePerf(), copyFrames: true, send: { _ in })
    // Memory every 10 s of take: the encoder and buffer pools fill once, then it should stay flat.
    var mb: [Double] = []
    for k in 0..<8 {
      _ = try film(pipeline, seconds: 10, speed: 4, size: (640, 480), from: Double(k) * 10)
      mb.append(CapturePerf.memoryMB())
    }
    print("BRPERF memory every 10 s of take: " + mb.map { String(format: "%.0f", $0) }.joined(separator: " ") + " MB")
    XCTAssertLessThan(mb[7] - mb[3], 15, "no steady growth over the last 40 s")
    pipeline.cancel()
  }
}
