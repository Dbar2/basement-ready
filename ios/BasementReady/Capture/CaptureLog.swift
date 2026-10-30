// capture.json, version 1 (ios/CAPTURE.md, docs/capture-contract.md): one record per ARFrame, so the
// server knows where the camera was for every frame of the video. Plain values only, so it's testable
// without a camera.
import Foundation
import simd

struct FrameRecord: Equatable, Sendable {
  var t: Double // presentation time in the video, seconds from its first frame
  var transform: simd_float4x4 // ARKit camera-to-world
  var intrinsics: SIMD4<Float> // fx, fy, cx, cy at imageResolution
  var tracking: String // normal | limited:<reason> | notAvailable
}

struct DepthIndex: Equatable, Sendable {
  var width: Int
  var height: Int
  var frames: [(t: Double, offset: Int)] = []

  static func == (a: DepthIndex, b: DepthIndex) -> Bool {
    a.width == b.width && a.height == b.height && a.frames.elementsEqual(b.frames) { $0.t == $1.t && $0.offset == $1.offset }
  }
}

struct CaptureLog: Sendable {
  var device: String
  var lens = "wide"
  var imageResolution: (width: Int, height: Int)
  var arkitStartTime: Double? // ARFrame.timestamp (seconds of device uptime) of the video's first frame
  var rotationCW = 90 // ARKit's sensor image turns 90° clockwise to stand upright ("portrait"); a replayed upright take is 0
  var frames: [FrameRecord] = []
  var depth: DepthIndex?

  // Compact JSON in the contract's field order, with numbers written the way they're stored.
  func encoded() -> Data {
    var s = "{\"version\":1"
    s += ",\"device\":" + jsonString(device)
    s += ",\"lens\":" + jsonString(lens)
    s += ",\"videoStartTime\":0"
    if let arkitStartTime { s += ",\"arkitStartTime\":" + fixed(arkitStartTime, 6) }
    s += ",\"imageResolution\":[\(imageResolution.width),\(imageResolution.height)]"
    s += rotationCW == 90 ? ",\"orientation\":\"portrait\"" : ",\"rotationCW\":\(rotationCW)"
    s += ",\"frames\":["
    s.reserveCapacity(s.utf8.count + frames.count * 260)
    var first = true
    for f in frames {
      let m = Self.columnMajor(f.transform)
      guard m.allSatisfy(\.isFinite), f.intrinsics.x.isFinite, f.intrinsics.y.isFinite, f.t.isFinite else { continue }
      if !first { s += "," }
      first = false
      s += "{\"t\":" + fixed(f.t, 5)
      s += ",\"transform\":[" + m.map(number).joined(separator: ",") + "]"
      s += ",\"intrinsics\":[" + [f.intrinsics.x, f.intrinsics.y, f.intrinsics.z, f.intrinsics.w].map(number).joined(separator: ",") + "]"
      s += ",\"tracking\":" + jsonString(f.tracking) + "}"
    }
    s += "]"
    if let d = depth, !d.frames.isEmpty {
      s += ",\"depth\":{\"width\":\(d.width),\"height\":\(d.height),\"format\":\"float16\",\"file\":\"depth.bin\",\"frames\":["
      s += d.frames.map { "{\"t\":" + fixed($0.t, 5) + ",\"offset\":\($0.offset)}" }.joined(separator: ",")
      s += "]}"
    }
    s += "}"
    return Data(s.utf8)
  }

  // simd_float4x4 keeps its columns; the contract lists them one after another.
  static func columnMajor(_ m: simd_float4x4) -> [Float] {
    [m.columns.0, m.columns.1, m.columns.2, m.columns.3].flatMap { [$0.x, $0.y, $0.z, $0.w] }
  }
}

// The shortest text that reads back as the same Float ("0.5", "-1.2345678e-05"): valid JSON.
private func number(_ v: Float) -> String {
  v == 0 ? "0" : "\(v)"
}

private func fixed(_ v: Double, _ places: Int) -> String {
  String(format: "%.\(places)f", v)
}

private func jsonString(_ s: String) -> String {
  let data = try? JSONSerialization.data(withJSONObject: [s], options: [.withoutEscapingSlashes])
  let array = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
  return String(array.dropFirst().dropLast())
}
