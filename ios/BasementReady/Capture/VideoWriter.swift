// The camera picture to an HEVC .mp4, frame by frame, exactly as ARKit hands it over: pixels in the
// sensor's landscape orientation, with a display turn of 90° clockwise so players and ffmpeg show it
// upright in portrait. Times are seconds from the first frame, the same `t` as capture.json.
import AVFoundation
import CoreVideo

// Used from one queue at a time (the pipeline's video queue).
final class VideoWriter: @unchecked Sendable {
  // About 190 MB for a full 5 minutes: well under the server's 400 MB limit, and plenty for 1280 px analysis.
  static let bitsPerSecond = 5_000_000
  // ARKit runs at 60 Hz; the video keeps every other frame (the poses keep all of them).
  static let maxFPS: Double = 30

  let url: URL
  private let writer: AVAssetWriter
  private let input: AVAssetWriterInput
  private let adaptor: AVAssetWriterInputPixelBufferAdaptor
  private var lastTime: Double = -1
  private(set) var framesWritten = 0
  private(set) var framesDropped = 0
  var status: Int { writer.status.rawValue }
  private var closed = false

  // HEVC on the phone (its hardware encoder). The simulator encodes in software, where HEVC can't keep
  // up and drops most frames, so replayed takes there are written as H.264.
  #if targetEnvironment(simulator)
  static let codec = AVVideoCodecType.h264
  #else
  static let codec = AVVideoCodecType.hevc
  #endif

  init(url: URL, width: Int, height: Int, rotationCW: Int = 90) throws {
    self.url = url
    try? FileManager.default.removeItem(at: url)
    writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    input = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: Self.codec,
      AVVideoWidthKey: width,
      AVVideoHeightKey: height,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: Self.bitsPerSecond,
        AVVideoExpectedSourceFrameRateKey: Int(Self.maxFPS),
        AVVideoMaxKeyFrameIntervalKey: Int(Self.maxFPS),
      ],
    ])
    input.expectsMediaDataInRealTime = true
    input.transform = CGAffineTransform(rotationAngle: CGFloat(rotationCW) * .pi / 180)
    adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
    guard writer.canAdd(input) else { throw CaptureError.video("The video writer refused its input.") }
    writer.add(input)
    guard writer.startWriting() else { throw CaptureError.video(writer.error?.localizedDescription ?? "The video writer didn't start.") }
    writer.startSession(atSourceTime: .zero)
  }

  // Appends the frame if it's due; returns whether it went into the video.
  @discardableResult
  func append(_ buffer: CVPixelBuffer, at t: Double) -> Bool {
    guard !closed, writer.status == .writing else { return false }
    if lastTime >= 0, t - lastTime < 1 / Self.maxFPS - 0.004 { return false }
    guard input.isReadyForMoreMediaData else {
      framesDropped += 1
      return false
    }
    guard adaptor.append(buffer, withPresentationTime: CMTime(seconds: t, preferredTimescale: 60_000)) else {
      framesDropped += 1
      return false
    }
    lastTime = t
    framesWritten += 1
    return true
  }

  // No more frames; called on the queue that appends them, before finish().
  func closeInput() {
    guard !closed else { return }
    closed = true
    if writer.status == .writing { input.markAsFinished() }
  }

  func finish() async throws {
    guard writer.status == .writing else {
      throw CaptureError.video(writer.error?.localizedDescription ?? "The video stopped early.")
    }
    closeInput()
    await writer.finishWriting()
    if writer.status != .completed { throw CaptureError.video(writer.error?.localizedDescription ?? "The video didn't save.") }
  }

  func cancel() {
    if writer.status == .writing { writer.cancelWriting() }
    try? FileManager.default.removeItem(at: url)
  }
}

enum CaptureError: LocalizedError {
  case video(String)
  case unsupported
  var errorDescription: String? {
    switch self {
    case .video(let why): why
    case .unsupported: "Filming needs an iPhone with a camera that tracks where it is (ARKit)."
    }
  }
}
