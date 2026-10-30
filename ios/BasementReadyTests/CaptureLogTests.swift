import ARKit
import XCTest
import simd
@testable import BasementReady

final class CaptureLogTests: XCTestCase {
  // Columns (1,2,3,4), (5,6,7,8)… so column-major order reads 1…16.
  private let counting = simd_float4x4(SIMD4(1, 2, 3, 4), SIMD4(5, 6, 7, 8), SIMD4(9, 10, 11, 12), SIMD4(13, 14, 15, 16))

  private func parse(_ log: CaptureLog) throws -> [String: Any] {
    try XCTUnwrap(JSONSerialization.jsonObject(with: log.encoded()) as? [String: Any])
  }

  func testHeaderMatchesTheContract() throws {
    var log = CaptureLog(device: "iPhone15,4", imageResolution: (1920, 1440), arkitStartTime: 1234.5)
    log.frames = [FrameRecord(t: 0, transform: matrix_identity_float4x4, intrinsics: SIMD4(1450, 1450, 960, 720), tracking: "normal")]
    let json = try parse(log)
    XCTAssertEqual(json["version"] as? Int, 1)
    XCTAssertEqual(json["device"] as? String, "iPhone15,4")
    XCTAssertEqual(json["lens"] as? String, "wide")
    XCTAssertEqual(json["videoStartTime"] as? Double, 0)
    XCTAssertEqual(json["arkitStartTime"] as? Double, 1234.5)
    XCTAssertEqual(json["imageResolution"] as? [Int], [1920, 1440])
    XCTAssertEqual(json["orientation"] as? String, "portrait")
    XCTAssertNil(json["depth"], "no depth block without LiDAR maps")
  }

  func testFrameRecordIsColumnMajorWithIntrinsicsAndTracking() throws {
    var log = CaptureLog(device: "x", imageResolution: (1920, 1440))
    log.frames = [
      FrameRecord(t: 0.0166667, transform: counting, intrinsics: SIMD4(1451.25, 1451.5, 959.75, 718.5), tracking: "normal"),
      FrameRecord(t: 0.0333333, transform: counting, intrinsics: SIMD4(1, 2, 3, 4), tracking: "limited:excessiveMotion"),
    ]
    let frames = try XCTUnwrap(try parse(log)["frames"] as? [[String: Any]])
    XCTAssertEqual(frames.count, 2)
    XCTAssertEqual(frames[0]["transform"] as? [Double], (1...16).map(Double.init))
    XCTAssertEqual(frames[0]["intrinsics"] as? [Double], [1451.25, 1451.5, 959.75, 718.5])
    XCTAssertEqual(frames[0]["t"] as? Double, 0.01667)
    XCTAssertEqual(frames[1]["tracking"] as? String, "limited:excessiveMotion")
  }

  func testNumbersReadBackAsTheSameFloats() throws {
    let r = simd_float4x4(simd_quatf(angle: 0.731, axis: simd_normalize(SIMD3(0.2, 1, -0.4))))
    var m = r
    m.columns.3 = SIMD4(-1.234567e-5, 1.4123, -3.000001, 1)
    var log = CaptureLog(device: "x", imageResolution: (1920, 1440))
    log.frames = [FrameRecord(t: 1, transform: m, intrinsics: SIMD4(1450.123, 1450.456, 961.5, 719.25), tracking: "normal")]
    let frame = try XCTUnwrap((try parse(log)["frames"] as? [[String: Any]])?.first)
    let back = try XCTUnwrap(frame["transform"] as? [Double]).map(Float.init)
    XCTAssertEqual(back, CaptureLog.columnMajor(m))
  }

  func testSkipsFramesThatArentNumbers() throws {
    var bad = counting
    bad.columns.3.x = .nan
    var log = CaptureLog(device: "x", imageResolution: (1920, 1440))
    log.frames = [
      FrameRecord(t: 0, transform: counting, intrinsics: SIMD4(1, 1, 1, 1), tracking: "normal"),
      FrameRecord(t: 0.1, transform: bad, intrinsics: SIMD4(1, 1, 1, 1), tracking: "normal"),
      FrameRecord(t: 0.2, transform: counting, intrinsics: SIMD4(1, 1, 1, 1), tracking: "normal"),
    ]
    let frames = try XCTUnwrap(try parse(log)["frames"] as? [[String: Any]])
    XCTAssertEqual(frames.compactMap { $0["t"] as? Double }, [0, 0.2])
  }

  func testDepthIndex() throws {
    var log = CaptureLog(device: "iPhone16,1", imageResolution: (1920, 1440))
    log.frames = [FrameRecord(t: 0, transform: counting, intrinsics: SIMD4(1, 1, 1, 1), tracking: "normal")]
    log.depth = DepthIndex(width: 256, height: 192, frames: [(0, 0), (0.2, 98_304)])
    let depth = try XCTUnwrap(try parse(log)["depth"] as? [String: Any])
    XCTAssertEqual(depth["width"] as? Int, 256)
    XCTAssertEqual(depth["height"] as? Int, 192)
    XCTAssertEqual(depth["format"] as? String, "float16")
    XCTAssertEqual(depth["file"] as? String, "depth.bin")
    let frames = try XCTUnwrap(depth["frames"] as? [[String: Any]])
    XCTAssertEqual(frames.map { $0["offset"] as? Int }, [0, 98_304])
    XCTAssertEqual(frames.map { $0["t"] as? Double }, [0, 0.2])
  }

  func testTrackingNames() {
    XCTAssertEqual(ARCapture.tracking(.normal), "normal")
    XCTAssertEqual(ARCapture.tracking(.notAvailable), "notAvailable")
    XCTAssertEqual(ARCapture.tracking(.limited(.initializing)), "limited:initializing")
    XCTAssertEqual(ARCapture.tracking(.limited(.excessiveMotion)), "limited:excessiveMotion")
    XCTAssertEqual(ARCapture.tracking(.limited(.insufficientFeatures)), "limited:insufficientFeatures")
    XCTAssertEqual(ARCapture.tracking(.limited(.relocalizing)), "limited:relocalizing")
    XCTAssertEqual(ARCapture.trackingKind(.limited(.excessiveMotion)), .tooFast)
  }

  // A full five minutes at 60 Hz stays far under the server's 40 MB limit for capture.json.
  func testFiveMinutesFitsTheServerLimit() throws {
    var log = CaptureLog(device: "iPhone15,4", imageResolution: (1920, 1440))
    let r = simd_float4x4(simd_quatf(angle: 0.7, axis: simd_normalize(SIMD3(0.3, 1, 0.1))))
    log.frames = (0..<18_000).map { i in
      var m = r
      m.columns.3 = SIMD4(Float(i) * 0.000123, 1.41, -Float(i) * 0.000321, 1)
      return FrameRecord(t: Double(i) / 60, transform: m, intrinsics: SIMD4(1450.5, 1450.5, 960.25, 719.75), tracking: "normal")
    }
    let data = log.encoded()
    XCTAssertLessThan(data.count, 10_000_000)
    let frames = try XCTUnwrap((try JSONSerialization.jsonObject(with: data) as? [String: Any])?["frames"] as? [Any])
    XCTAssertEqual(frames.count, 18_000)
    // For checking against server/capture.ts: TEST_RUNNER_BR_EXPORT_DIR=/some/dir xcodebuild test …
    if let dir = ProcessInfo.processInfo.environment["BR_EXPORT_DIR"] {
      try data.write(to: URL(fileURLWithPath: dir).appending(path: "capture-sample.json"))
    }
  }
}

final class DepthWriterTests: XCTestCase {
  func testFloat16WithLowConfidenceAsZero() throws {
    let w = 4, h = 2
    var depth: CVPixelBuffer?
    CVPixelBufferCreate(nil, w, h, kCVPixelFormatType_DepthFloat32, nil, &depth)
    var conf: CVPixelBuffer?
    CVPixelBufferCreate(nil, w, h, kCVPixelFormatType_OneComponent8, nil, &conf)
    let d = try XCTUnwrap(depth), c = try XCTUnwrap(conf)
    let values: [Float] = [1, 2.5, 0.75, 3, 4, .nan, 0, 5]
    let sure: [UInt8] = [2, 1, 2, 0, 2, 2, 2, 1]
    CVPixelBufferLockBaseAddress(d, [])
    CVPixelBufferLockBaseAddress(c, [])
    for y in 0..<h {
      let row = CVPixelBufferGetBaseAddress(d)!.advanced(by: y * CVPixelBufferGetBytesPerRow(d)).assumingMemoryBound(to: Float32.self)
      let crow = CVPixelBufferGetBaseAddress(c)!.advanced(by: y * CVPixelBufferGetBytesPerRow(c)).assumingMemoryBound(to: UInt8.self)
      for x in 0..<w {
        row[x] = values[y * w + x]
        crow[x] = sure[y * w + x]
      }
    }
    CVPixelBufferUnlockBaseAddress(d, [])
    CVPixelBufferUnlockBaseAddress(c, [])

    let data = DepthWriter.float16(depth: d, confidence: c)
    XCTAssertEqual(data.count, w * h * 2)
    let back: [Float] = data.withUnsafeBytes { raw in (0..<(w * h)).map { Float(Float16(bitPattern: UInt16(littleEndian: raw.load(fromByteOffset: $0 * 2, as: UInt16.self)))) } }
    XCTAssertEqual(back, [1, 2.5, 0.75, 0, 4, 0, 0, 5])
  }
}
