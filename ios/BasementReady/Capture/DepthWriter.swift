// LiDAR depth (Pro phones only): ARKit's 256 × 192 sceneDepth maps, five a second, as float16 metres
// in one depth.bin. Pixels ARKit is least sure of are written as 0, meaning "no reading".
import CoreVideo
import Foundation

final class DepthWriter {
  static let every: Double = 0.2 // seconds between kept maps (the server analyses 5 frames a second)

  let url: URL
  private let handle: FileHandle
  private(set) var index: DepthIndex?
  private var offset = 0
  private var lastT = -Double.infinity

  init(url: URL) throws {
    self.url = url
    FileManager.default.createFile(atPath: url.path, contents: nil)
    handle = try FileHandle(forWritingTo: url)
  }

  func due(_ t: Double) -> Bool { t - lastT >= Self.every - 0.005 }

  // depth: kCVPixelFormatType_DepthFloat32; confidence: one byte per pixel, 0 low, 1 medium, 2 high.
  func append(depth: CVPixelBuffer, confidence: CVPixelBuffer?, at t: Double) {
    let w = CVPixelBufferGetWidth(depth), h = CVPixelBufferGetHeight(depth)
    if index == nil { index = DepthIndex(width: w, height: h) }
    guard w == index!.width, h == index!.height else { return }
    let bytes = Self.float16(depth: depth, confidence: confidence)
    do {
      try handle.write(contentsOf: bytes)
    } catch {
      return
    }
    index!.frames.append((t: t, offset: offset))
    offset += bytes.count
    lastT = t
  }

  func finish() -> DepthIndex? {
    try? handle.close()
    return index
  }

  static func float16(depth: CVPixelBuffer, confidence: CVPixelBuffer?) -> Data {
    CVPixelBufferLockBaseAddress(depth, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(depth, .readOnly) }
    if let confidence { CVPixelBufferLockBaseAddress(confidence, .readOnly) }
    defer { if let confidence { CVPixelBufferUnlockBaseAddress(confidence, .readOnly) } }
    let w = CVPixelBufferGetWidth(depth), h = CVPixelBufferGetHeight(depth)
    let rowBytes = CVPixelBufferGetBytesPerRow(depth)
    let base = CVPixelBufferGetBaseAddress(depth)!
    let conf = confidence.flatMap { c -> (UnsafeMutableRawPointer, Int)? in
      guard CVPixelBufferGetWidth(c) == w, CVPixelBufferGetHeight(c) == h, let b = CVPixelBufferGetBaseAddress(c) else { return nil }
      return (b, CVPixelBufferGetBytesPerRow(c))
    }
    var out = [UInt16](repeating: 0, count: w * h)
    for y in 0..<h {
      let row = base.advanced(by: y * rowBytes).assumingMemoryBound(to: Float32.self)
      let crow = conf.map { $0.0.advanced(by: y * $0.1).assumingMemoryBound(to: UInt8.self) }
      for x in 0..<w {
        let v = row[x]
        let sure = crow.map { $0[x] >= 1 } ?? true
        out[y * w + x] = (sure && v.isFinite && v > 0) ? Float16(v).bitPattern.littleEndian : 0
      }
    }
    return out.withUnsafeBufferPointer { Data(buffer: $0) }
  }
}
