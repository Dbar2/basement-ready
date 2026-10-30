import XCTest
import simd
@testable import BasementReady

final class ReplayTests: XCTestCase {
  private var fixtures: URL { URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appending(path: "Fixtures") }

  // b2's family room is x 0…6.4, y 0…4.6 in Blender (z up), 2.35 m high: in ARKit, x 0…6.4 and z −4.6…0.
  func testRaysHitTheTestBasementsWalls() throws {
    let world = try XCTUnwrap(ReplayWorld(url: fixtures.appending(path: "b2-finished-family/geometry.json")))
    let eye = SIMD3<Float>(3, 1.45, -2)
    let west = try XCTUnwrap(world.cast(eye, SIMD3(-1, 0, 0)))
    XCTAssertEqual(west.point.x, 0, accuracy: 1e-4)
    XCTAssertEqual(west.normal, SIMD3(1, 0, 0), "facing back into the room")
    let floor = try XCTUnwrap(world.cast(eye, SIMD3(0, -1, 0)))
    XCTAssertEqual(floor.point.y, 0, accuracy: 1e-4)
    let ceiling = try XCTUnwrap(world.cast(eye, SIMD3(0, 1, 0)))
    XCTAssertEqual(ceiling.point.y, 2.35, accuracy: 1e-4)
    // Through the door (Blender y 1.0…1.8 on the east wall) into the utility room, to its far wall at x 9.6.
    let through = try XCTUnwrap(world.cast(SIMD3(3, 1, -1.4), SIMD3(1, 0, 0), maxDistance: 10))
    XCTAssertEqual(through.point.x, 9.6, accuracy: 1e-3)
    XCTAssertNil(world.cast(SIMD3(50, 1, 50), SIMD3(1, 0, 0)), "outside the house")
  }

  func testWallsAreFoundOnceSeenEnough() throws {
    let world = try XCTUnwrap(ReplayWorld(url: fixtures.appending(path: "b2-finished-family/geometry.json")))
    var detector = PlaneDetector()
    var found: [PlaneObs] = []
    for i in 0..<40 {
      let dir = simd_normalize(SIMD3<Float>(-1, Float(i % 8) * 0.05 - 0.2, Float(i / 8) * 0.1 - 0.2))
      if let hit = world.cast(SIMD3(3, 1.45, -2), dir), let p = detector.hit(hit, world: world) { found.append(p) }
    }
    let wall = try XCTUnwrap(found.last)
    XCTAssertTrue(wall.vertical)
    XCTAssertEqual(SIMD3(wall.transform.columns.1.x, wall.transform.columns.1.y, wall.transform.columns.1.z), SIMD3(1, 0, 0), "an ARKit wall's y axis is its normal")
    XCTAssertEqual(Set(found.map(\.id)).count, 1, "one wall, grown, not many")
    // The coverage map reads it as a wall along x = 0.
    let map = CoverageMap()
    map.upsert(wall)
    map.observe(CameraObs(transform: matrix_identity_float4x4, intrinsics: SIMD4(500, 500, 320, 240), resolution: SIMD2(640, 480), tracked: true), points: [])
    let seg = try XCTUnwrap(map.snapshot().walls.first)
    XCTAssertEqual(seg.a.x, 0, accuracy: 1e-3)
    XCTAssertEqual(seg.b.x, 0, accuracy: 1e-3)
  }

  // What a real take writes beside itself plays back in order.
  func testSensorLogPlaysBack() throws {
    let url = FileManager.default.temporaryDirectory.appending(path: "sensors-\(UUID().uuidString).jsonl")
    defer { try? FileManager.default.removeItem(at: url) }
    let log = SensorLog(url: url)
    let id = UUID()
    log.look(t: 0.2, points: [SIMD3(1, 2, 3)])
    log.plane(PlaneObs(id: id, vertical: true, transform: matrix_identity_float4x4, boundary: [SIMD3(-1, 0, -1), SIMD3(1, 0, -1), SIMD3(1, 0, 1)]), t: 0.3)
    log.look(t: 0.4, points: [SIMD3(4, 5, 6), SIMD3(7, 8, 9)])
    log.removed(id, t: 0.5)
    log.finish()
    var play = try XCTUnwrap(SensorPlayback(url: url))
    XCTAssertEqual(play.points(upTo: 0.25), [SIMD3(1, 2, 3)])
    XCTAssertEqual(play.planes(upTo: 0.35).first?.plane?.id, id)
    XCTAssertEqual(play.points(upTo: 0.6).count, 2)
    XCTAssertEqual(play.planes(upTo: 0.6).first?.gone, id)
  }

  func testPosesFromABlenderCapture() throws {
    let url = FileManager.default.temporaryDirectory.appending(path: "capture-\(UUID().uuidString).json")
    defer { try? FileManager.default.removeItem(at: url) }
    let id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]
    let frames = (0..<31).map { i in "{\"t\":\(Double(i) / 30),\"transform\":\(id + [i, 1, 0, 1]),\"intrinsics\":[1423,1423,540,960],\"tracking\":\"normal\"}" }
    try Data("{\"version\":1,\"imageResolution\":[1080,1920],\"rotationCW\":0,\"frames\":[\(frames.joined(separator: ","))]}".utf8).write(to: url)
    let poses = try ReplayPoses(url: url)
    XCTAssertEqual(poses.fps, 30)
    XCTAssertEqual(poses.geometry.rotationCW, 0)
    XCTAssertEqual(poses.geometry.upright, SIMD2(1080, 1920))
    XCTAssertEqual(poses.at(0.51).transform.columns.3.x, 15)
  }

  func testCaptureJSONSaysHowAnUprightTakeTurns() throws {
    var log = CaptureLog(device: "test", imageResolution: (1080, 1920), rotationCW: 0)
    log.frames.append(FrameRecord(t: 0, transform: matrix_identity_float4x4, intrinsics: SIMD4(1, 1, 0, 0), tracking: "normal"))
    let json = try XCTUnwrap(JSONSerialization.jsonObject(with: log.encoded()) as? [String: Any])
    XCTAssertEqual(json["rotationCW"] as? Int, 0)
    XCTAssertNil(json["orientation"])
  }
}
