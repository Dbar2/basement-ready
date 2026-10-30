import AVFoundation
import CoreImage
import XCTest
@testable import BasementReady

final class VideoWriterTests: XCTestCase {
  // Landscape sensor pixels, a 90° display turn, and times from 0: what the server's ffmpeg reads.
  func testPortraitVideo() async throws {
    let url = FileManager.default.temporaryDirectory.appending(path: "writer-\(UUID().uuidString).mp4")
    defer { try? FileManager.default.removeItem(at: url) }
    let writer = try VideoWriter(url: url, width: 640, height: 480)
    let ci = CIContext()
    var written = 0
    for i in 0..<120 { // two seconds of 60 Hz frames: every other one is kept
      var buffer: CVPixelBuffer?
      CVPixelBufferCreate(nil, 640, 480, kCVPixelFormatType_32BGRA, [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &buffer)
      // A white square in the sensor picture's top-left corner: upright in portrait it's top-right.
      let base = CIImage(color: CIColor(red: 0.1, green: 0.2, blue: 0.15)).cropped(to: CGRect(x: 0, y: 0, width: 640, height: 480))
      let mark = CIImage(color: .white).cropped(to: CGRect(x: 0, y: 380, width: 100, height: 100))
      ci.render(mark.composited(over: base), to: buffer!)
      if writer.append(buffer!, at: Double(i) / 60) { written += 1 }
      try await Task.sleep(for: .milliseconds(16)) // real time, as ARKit sends them
    }
    try await writer.finish()
    // Real-time mode drops a frame rather than wait when the encoder is busy (the simulator's software
    // encoder on a loaded Mac drops plenty); never more than every other.
    XCTAssertGreaterThanOrEqual(written, 15)
    XCTAssertLessThanOrEqual(written, 61)

    let asset = AVURLAsset(url: url)
    let tracks = try await asset.loadTracks(withMediaType: .video)
    let track = try XCTUnwrap(tracks.first)
    let (size, transform, formats) = try await track.load(.naturalSize, .preferredTransform, .formatDescriptions)
    XCTAssertEqual(size, CGSize(width: 640, height: 480))
    XCTAssertEqual(atan2(transform.b, transform.a) * 180 / .pi, 90, accuracy: 0.01)
    // HEVC on a phone; the simulator writes H.264 (VideoWriter.codec).
    XCTAssertEqual(CMFormatDescriptionGetMediaSubType(formats[0]), VideoWriter.codec == .hevc ? kCMVideoCodecType_HEVC : kCMVideoCodecType_H264)
    let duration = try await asset.load(.duration).seconds
    XCTAssertEqual(duration, 2, accuracy: 0.25)
    if let dir = ProcessInfo.processInfo.environment["BR_EXPORT_DIR"] {
      try FileManager.default.copyItem(at: url, to: URL(fileURLWithPath: dir).appending(path: "writer-sample.mp4"))
    }
  }
}
