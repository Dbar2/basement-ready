// Small jobs on camera pictures: a copy into the app's own memory (so ARKit gets its buffer straight
// back), the colour under a point, and the upright JPEG the live finds send.
import CoreImage
import CoreVideo
import Foundation
import simd

// Copies pictures into buffers from the app's own pool. ARKit has only a handful of camera buffers;
// one held by the video encoder is one the camera can't fill, and after a few it stops sending frames.
final class PixelCopier {
  private var pool: CVPixelBufferPool?
  private var key: (OSType, Int, Int)?

  func copy(_ src: CVPixelBuffer) -> CVPixelBuffer? {
    let format = CVPixelBufferGetPixelFormatType(src), w = CVPixelBufferGetWidth(src), h = CVPixelBufferGetHeight(src)
    if key.map({ $0 != (format, w, h) }) ?? true {
      let attrs: [CFString: Any] = [
        kCVPixelBufferPixelFormatTypeKey: format, kCVPixelBufferWidthKey: w, kCVPixelBufferHeightKey: h,
        kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary,
      ]
      pool = nil
      CVPixelBufferPoolCreate(nil, [kCVPixelBufferPoolMinimumBufferCountKey: 4] as CFDictionary, attrs as CFDictionary, &pool)
      key = (format, w, h)
    }
    guard let pool else { return nil }
    var out: CVPixelBuffer?
    guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &out) == kCVReturnSuccess, let dst = out else { return nil }
    CVPixelBufferLockBaseAddress(src, .readOnly)
    CVPixelBufferLockBaseAddress(dst, [])
    defer {
      CVPixelBufferUnlockBaseAddress(dst, [])
      CVPixelBufferUnlockBaseAddress(src, .readOnly)
    }
    let planes = CVPixelBufferGetPlaneCount(src)
    for p in 0..<max(1, planes) {
      let from = planes == 0 ? CVPixelBufferGetBaseAddress(src) : CVPixelBufferGetBaseAddressOfPlane(src, p)
      let to = planes == 0 ? CVPixelBufferGetBaseAddress(dst) : CVPixelBufferGetBaseAddressOfPlane(dst, p)
      guard let from, let to else { return nil }
      let rows = planes == 0 ? h : CVPixelBufferGetHeightOfPlane(src, p)
      let a = planes == 0 ? CVPixelBufferGetBytesPerRow(src) : CVPixelBufferGetBytesPerRowOfPlane(src, p)
      let b = planes == 0 ? CVPixelBufferGetBytesPerRow(dst) : CVPixelBufferGetBytesPerRowOfPlane(dst, p)
      if a == b {
        memcpy(to, from, a * rows)
      } else {
        for r in 0..<rows { memcpy(to + r * b, from + r * a, min(a, b)) }
      }
    }
    return dst
  }
}

enum ImageSampler {
  // The colour of the picture at each pixel position (nil outside it). Reads the bytes directly: a
  // few hundred lookups, no GPU. Handles ARKit's YCbCr and the replay's BGRA.
  static func colors(_ buffer: CVPixelBuffer, at pixels: [SIMD2<Float>]) -> [SIMD4<UInt8>?] {
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    let w = CVPixelBufferGetWidth(buffer), h = CVPixelBufferGetHeight(buffer)
    let format = CVPixelBufferGetPixelFormatType(buffer)
    func inside(_ p: SIMD2<Float>) -> (Int, Int)? {
      let x = Int(p.x), y = Int(p.y)
      return x >= 0 && y >= 0 && x < w && y < h && p.x.isFinite && p.y.isFinite ? (x, y) : nil
    }
    switch format {
    case kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange:
      guard let yBase = CVPixelBufferGetBaseAddressOfPlane(buffer, 0)?.assumingMemoryBound(to: UInt8.self),
            let cBase = CVPixelBufferGetBaseAddressOfPlane(buffer, 1)?.assumingMemoryBound(to: UInt8.self) else { return pixels.map { _ in nil } }
      let yRow = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0), cRow = CVPixelBufferGetBytesPerRowOfPlane(buffer, 1)
      let video = format == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
      return pixels.map { p in
        guard let (x, y) = inside(p) else { return nil }
        var yy = Float(yBase[y * yRow + x])
        let ci = (y / 2) * cRow + (x / 2) * 2
        var cb = Float(cBase[ci]) - 128, cr = Float(cBase[ci + 1]) - 128
        if video {
          yy = (yy - 16) * 255 / 219
          cb *= 255 / 224
          cr *= 255 / 224
        }
        let r = yy + 1.402 * cr, g = yy - 0.344 * cb - 0.714 * cr, b = yy + 1.772 * cb
        return SIMD4(clampByte(r), clampByte(g), clampByte(b), 255)
      }
    case kCVPixelFormatType_32BGRA:
      guard let base = CVPixelBufferGetBaseAddress(buffer)?.assumingMemoryBound(to: UInt8.self) else { return pixels.map { _ in nil } }
      let row = CVPixelBufferGetBytesPerRow(buffer)
      return pixels.map { p in
        guard let (x, y) = inside(p) else { return nil }
        let i = y * row + x * 4
        return SIMD4(base[i + 2], base[i + 1], base[i], 255)
      }
    default:
      return pixels.map { _ in nil }
    }
  }

  private static func clampByte(_ v: Float) -> UInt8 { UInt8(max(0, min(255, v.rounded()))) }

  // Upright, 768 px on the long side, like the web's live-finds frames.
  static func jpeg(_ buffer: CVPixelBuffer, rotationCW: Int, context: CIContext) -> Data? {
    let orientation: CGImagePropertyOrientation = switch rotationCW {
    case 90: .right
    case 180: .down
    case 270: .left
    default: .up
    }
    let upright = CIImage(cvPixelBuffer: buffer).oriented(orientation)
    let scale = 768 / max(upright.extent.width, upright.extent.height)
    let small = upright.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    return context.jpegRepresentation(of: small, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.8])
  }
}
