import XCTest
import simd
@testable import BasementReady

// How long one map look takes on a basement-sized walk: the work the camera's frame handler used to do
// five times a second. It runs on the map's own queue now, but it still has to keep up.
final class CoverageMapPerfTests: XCTestCase {
  func testALookStaysFastOnABigBasement() {
    let map = CoverageMap()
    let floorIDs = (0..<3).map { _ in UUID() }
    let wallIDs = (0..<8).map { _ in UUID() }
    var times: [Double] = []
    let k = SIMD4<Float>(1450, 1450, 960, 720)
    for i in 0..<300 {
      let t = Float(i) * 0.2
      let pos = SIMD3<Float>(sin(t * 0.1) * 4, 1.4, -3 + cos(t * 0.1) * 3)
      let yaw = t * 0.4
      let forward = SIMD3<Float>(sin(yaw), 0, -cos(yaw))
      let right = SIMD3<Float>(cos(yaw), 0, sin(yaw))
      let up = SIMD3<Float>(0, 1, 0)
      let T = simd_float4x4(SIMD4(-up, 0), SIMD4(right, 0), SIMD4(-forward, 0), SIMD4(pos, 1))
      let began = ProcessInfo.processInfo.systemUptime
      // ARKit updates every plane often, each with a boundary of a hundred-odd vertices.
      for (n, id) in floorIDs.enumerated() {
        let r = min(4, 0.5 + t * 0.05) + Float(n)
        let boundary = (0..<120).map { j -> SIMD3<Float> in
          let a = Float(j) / 120 * 2 * .pi
          return SIMD3(cos(a) * r * 1.3, 0, sin(a) * r)
        }
        map.upsert(PlaneObs(id: id, vertical: false, transform: simd_float4x4(SIMD4(1, 0, 0, 0), SIMD4(0, 1, 0, 0), SIMD4(0, 0, 1, 0), SIMD4(Float(n) * 2, 0, -3, 1)), boundary: boundary))
      }
      for (n, id) in wallIDs.enumerated() {
        let a = Float(n) / 8 * 2 * .pi
        let c = SIMD3<Float>(cos(a) * 5, 1.2, -3 + sin(a) * 4)
        let x = SIMD3<Float>(-sin(a), 0, cos(a)), y = SIMD3<Float>(-cos(a), 0, -sin(a))
        let anchor = simd_float4x4(SIMD4(x, 0), SIMD4(y, 0), SIMD4(simd_cross(x, y), 0), SIMD4(c, 1))
        let boundary = (0..<60).map { j -> SIMD3<Float> in SIMD3(Float(j) / 60 * 3 - 1.5, 0, (j % 2 == 0 ? -1 : 1)) }
        map.upsert(PlaneObs(id: id, vertical: true, transform: anchor, boundary: boundary))
      }
      let points = (0..<300).map { _ in SIMD3<Float>(Float.random(in: -5...5), Float.random(in: 0...2.4), Float.random(in: -8...2)) }
      map.observe(CameraObs(transform: T, intrinsics: k, resolution: SIMD2(1920, 1440), tracked: true), points: points)
      _ = map.snapshot()
      times.append(ProcessInfo.processInfo.systemUptime - began)
    }
    let avg = times.reduce(0, +) / Double(times.count)
    let worst = times.max() ?? 0
    print(String(format: "BRPERF map look: avg %.1f ms, worst %.1f ms over %d looks", avg * 1000, worst * 1000, times.count))
    XCTAssertLessThan(avg, 0.05, "a look has to fit easily in the 200 ms between looks")
  }
}
