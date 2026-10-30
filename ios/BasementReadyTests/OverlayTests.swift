import XCTest
import simd
@testable import BasementReady

final class ProjectionTests: XCTestCase {
  private let viewport = SIMD2<Float>(1179, 2556)

  // The overlay lands exactly on the camera picture: the pixel each screen corner shows, cast back
  // into the room and projected, lands on that same corner. For ARKit's sideways picture and an
  // upright one.
  func testOverlayMatchesTheCameraPicture() {
    for g in [
      ImageGeometry(resolution: SIMD2(1920, 1440), intrinsics: SIMD4(1450, 1452, 955, 721), rotationCW: 90),
      ImageGeometry(resolution: SIMD2(1080, 1920), intrinsics: SIMD4(1423, 1423, 540, 960), rotationCW: 0),
      ImageGeometry(resolution: SIMD2(1920, 1440), intrinsics: SIMD4(1450, 1450, 960, 720), rotationCW: 270),
    ] {
      let P = g.projection(viewport: viewport)
      for corner in g.backgroundQuad(viewport: viewport) {
        let pixel = SIMD2(corner.z, corner.w) * g.resolution
        let c = g.ray(pixel) * 3
        let clip = P * SIMD4(c, 1)
        XCTAssertEqual(clip.x / clip.w, corner.x, accuracy: 1e-3, "rotation \(g.rotationCW)")
        XCTAssertEqual(clip.y / clip.w, corner.y, accuracy: 1e-3, "rotation \(g.rotationCW)")
        XCTAssert(clip.z / clip.w > 0 && clip.z / clip.w < 1)
      }
    }
  }

  // ios/CAPTURE.md: a mark in the sensor picture's top-left corner is top-right once upright.
  func testSensorTopLeftIsUprightTopRight() {
    let g = ImageGeometry(resolution: SIMD2(1920, 1440), intrinsics: SIMD4(1450, 1450, 960, 720), rotationCW: 90)
    XCTAssertEqual(g.upright, SIMD2(1440, 1920))
    let up = g.toUpright(SIMD2(10, 10))
    XCTAssertEqual(up.x, 1430, accuracy: 1e-4)
    XCTAssertEqual(up.y, 10, accuracy: 1e-4)
    for r in [0, 90, 180, 270] {
      let h = ImageGeometry(resolution: SIMD2(1920, 1440), intrinsics: .zero, rotationCW: r)
      let p = SIMD2<Float>(123, 456)
      XCTAssertEqual(h.fromUpright(h.toUpright(p)), p)
    }
  }

  // A point straight ahead is in the middle of the screen; one behind the camera is nowhere.
  func testCentreAndBehind() {
    let g = ImageGeometry(resolution: SIMD2(1920, 1440), intrinsics: SIMD4(1450, 1450, 960, 720), rotationCW: 90)
    let T = matrix_identity_float4x4
    let ahead = g.screenPoint(SIMD3(0, 0, -2), cameraToWorld: T, viewport: viewport)!
    XCTAssertEqual(ahead.x, viewport.x / 2, accuracy: 0.5)
    XCTAssertEqual(ahead.y, viewport.y / 2, accuracy: 0.5)
    XCTAssertNil(g.screenPoint(SIMD3(0, 0, 2), cameraToWorld: T, viewport: viewport))
    // ARKit's +y (the phone's right side, held upright) is to the right on screen.
    XCTAssertGreaterThan(g.screenPoint(SIMD3(0, 0.3, -2), cameraToWorld: T, viewport: viewport)!.x, viewport.x / 2)
  }
}

final class SceneStoreTests: XCTestCase {
  func testThePointCloudKeepsOnePointPerSpot() {
    let cloud = PointCloud()
    let c = SIMD4<UInt8>(200, 100, 50, 255)
    XCTAssertEqual(cloud.add([(SIMD3(0.01, 0.01, 0.01), c), (SIMD3(0.02, 0.02, 0.02), c), (SIMD3(1, 1, 1), c)], at: 0), 2)
    XCTAssertEqual(cloud.add([(SIMD3(0.015, 0.015, 0.015), c), (SIMD3(-1, 2, -3), c), (SIMD3(.nan, 0, 0), c)], at: 1), 1)
    XCTAssertEqual(cloud.count, 3)
    var copied = 0
    cloud.copy(from: 1) { copied = $0.count }
    XCTAssertEqual(copied, 2)
  }

  func testOnlyWallsArePaintedAndKeepWhereTheyStarted() {
    let walls = PlaneStore()
    let id = UUID()
    let T = simd_float4x4(SIMD4(1, 0, 0, 0), SIMD4(0, 0, 1, 0), SIMD4(0, 1, 0, 0), SIMD4(0, 1, -3, 1))
    walls.upsert(PlaneObs(id: id, vertical: true, transform: T, boundary: [SIMD3(-1, 0, -1), SIMD3(1, 0, -1), SIMD3(1, 0, 1), SIMD3(-1, 0, 1)]), at: 2)
    walls.upsert(PlaneObs(id: UUID(), vertical: false, transform: T, boundary: [SIMD3(-1, 0, -1), SIMD3(1, 0, -1), SIMD3(1, 0, 1)]), at: 2)
    walls.upsert(PlaneObs(id: id, vertical: true, transform: T, boundary: [SIMD3(-3, 0, -1), SIMD3(3, 0, -1), SIMD3(3, 0, 1), SIMD3(-3, 0, 1)]), at: 5)
    let s = walls.snapshot()
    XCTAssertEqual(s.walls.count, 1)
    XCTAssertEqual(s.walls[0].born, 2, "grows without starting its paint again")
    XCTAssertEqual(s.walls[0].seed.z, -3, accuracy: 1e-5)
    XCTAssertEqual(s.walls[0].outline.map(\.x).max()!, 3, accuracy: 1e-5)
  }
}
