import XCTest
import simd
@testable import BasementReady

final class VoiceQueueTests: XCTestCase {
  func testOneAtATimeWithAGap() {
    var q = VoiceQueue()
    q.request(.walls, at: 0)
    XCTAssertEqual(q.next(at: 0), .walls)
    q.request(.firstWall, at: 1)
    XCTAssertNil(q.next(at: 1), "nothing while a line plays")
    q.ended(at: 3)
    q.request(.firstWall, at: 5)
    XCTAssertNil(q.next(at: 8), "6.5 s of quiet after a line")
    XCTAssertEqual(q.next(at: 9.6), .firstWall)
    q.ended(at: 11)
    q.request(.ceilingDone, at: 11)
    XCTAssertNil(q.next(at: 17.6), "praise is old news after 6 s")
  }

  func testTaskBeatsPraiseBeatsNag() {
    var q = VoiceQueue()
    q.request(.slowDown, at: 0)
    q.request(.lookingGood, at: 0)
    q.request(.ceiling, at: 0)
    XCTAssertEqual(q.next(at: 0), .ceiling)
    q.ended(at: 1)
    XCTAssertNil(q.next(at: 8), "praise and nags behind a task are dropped once it's said")
  }

  func testSameLineWaitsThirtySecondsAndDirectionsShareAnAllowance() {
    var q = VoiceQueue()
    q.request(.turnLeft, at: 0)
    XCTAssertEqual(q.next(at: 0), .turnLeft)
    q.ended(at: 2)
    XCTAssertFalse(q.request(.turnRight, at: 9), "another direction within 14 s")
    XCTAssertTrue(q.request(.turnRight, at: 15))
    XCTAssertEqual(q.next(at: 15), .turnRight)
    q.ended(at: 17)
    XCTAssertFalse(q.request(.turnRight, at: 40), "the same line within 30 s")
  }

  func testStaleNagsAreDropped() {
    var q = VoiceQueue()
    q.request(.walls, at: 0)
    _ = q.next(at: 0)
    q.ended(at: 2)
    q.request(.slowDown, at: 3)
    XCTAssertNil(q.next(at: 8.6), "a nag is old news after 3 s")
  }
}

final class ClipLibraryTests: XCTestCase {
  func testTakesAndPreferenceOrder() {
    let files = ["turn_around.mp3", "wall_behind.mp3", "wall_behind_2.mp3", "intro.mp3", "notes.txt"].map { URL(fileURLWithPath: "/v/\($0)") }
    let lib = ClipLibrary(files: files)
    XCTAssertEqual(lib.clips["wall_behind"]?.count, 2)
    XCTAssertNil(lib.clips["notes"])
    // turnAround prefers the newer wall_behind clips, and never repeats the last take when there's a choice.
    let last = URL(fileURLWithPath: "/v/wall_behind.mp3")
    for _ in 0..<10 { XCTAssertEqual(lib.clip(for: .turnAround, avoiding: last)?.lastPathComponent, "wall_behind_2.mp3") }
    XCTAssertEqual(lib.clip(for: .start)?.lastPathComponent, "intro.mp3")
    XCTAssertNil(lib.clip(for: .oneMinute))
  }

  func testTheBundledClipsLoad() {
    XCTAssertGreaterThan(ClipLibrary.bundled.clips.count, 10, "public/voice is copied into the app")
    XCTAssertNotNil(ClipLibrary.bundled.clip(for: .walls))
  }
}

final class GuideTests: XCTestCase {
  private func input(_ t: Double, _ stats: CoverageStats, tracking: Tracking = .normal, still: Bool = false) -> GuideInput {
    GuideInput(elapsed: t, tracking: tracking, stats: stats, still: still)
  }

  func testStartsWithTheStairsThenTheWalls() {
    var g = Guide()
    let first = g.step(input(0.2, CoverageStats()))
    XCTAssertEqual(first.line, .start)
    XCTAssertEqual(first.say, [.start])
    XCTAssertEqual(g.step(input(0.4, CoverageStats())).say, [], "a task is said once, when it comes up")
    XCTAssertEqual(g.step(input(13, CoverageStats(floorAreaM2: 7))).line, .walls)
  }

  func testTurnsTowardTheUnseenWall() {
    var g = Guide()
    var s = CoverageStats(floorAreaM2: 10, unseenGapM: 3)
    s.unseenBearingDeg = -75
    XCTAssertEqual(g.step(input(20, s)).line, .turnLeft)
    s.unseenBearingDeg = 165
    XCTAssertEqual(g.step(input(21, s)).line, .turnAround)
    s.unseenBearingDeg = 10
    XCTAssertEqual(g.step(input(22, s)).line, .walls, "ahead: keep walking")
  }

  func testCeilingThenTrackingProblems() {
    var g = Guide()
    var s = CoverageStats(floorAreaM2: 10)
    s.ceilingOpenNearby = true
    XCTAssertEqual(g.step(input(20, s)).line, .ceiling)
    XCTAssertEqual(g.step(input(21, CoverageStats(floorAreaM2: 10, wallsFound: 1))).line, .walls)
    XCTAssertEqual(g.step(input(22, s)).line, .tiltUp, "after the first time, the shorter nudge")
    XCTAssertEqual(g.step(input(23, s, tracking: .tooFast)).line, .slowDown)
    XCTAssertEqual(g.step(input(24, s, tracking: .featureless)).line, .tiltUp, "a moment of no features isn't worth a word")
    XCTAssertEqual(g.step(input(25.6, s, tracking: .featureless)).line, .tooDark)
  }

  func testWideShotWhenTheRestIsDone() {
    var g = Guide()
    let good = CoverageStats(floorAreaM2: 30, wallsFound: 5, ceilingCovered: 0.85, unseenGapM: 0.5)
    XCTAssertEqual(g.step(input(70, good)).line, .wide)
    XCTAssertNil(g.wideAt)
    XCTAssertEqual(g.step(input(74, good, still: true)).line, .wideDone)
    XCTAssertEqual(g.wideAt, 73)
    XCTAssertEqual(g.step(input(75, good)).line, .enough)
  }

  func testWideShotByThreeThirtyRegardless() {
    var g = Guide()
    let patchy = CoverageStats(floorAreaM2: 30, wallsFound: 2, ceilingCovered: 0.3, unseenGapM: 4)
    XCTAssertNotEqual(g.step(input(200, patchy)).line, .wide)
    XCTAssertEqual(g.step(input(211, patchy)).line, .wide)
  }

  func testTimeAndPraise() {
    var g = Guide()
    _ = g.step(input(10, CoverageStats()))
    XCTAssertTrue(g.step(input(11, CoverageStats(wallsFound: 1))).say.contains(.firstWall))
    XCTAssertTrue(g.step(input(240, CoverageStats(floorAreaM2: 16, wallsFound: 1))).say.contains(.oneMinute))
    XCTAssertTrue(g.step(input(241, CoverageStats(floorAreaM2: 16, wallsFound: 1))).say.contains(.lookingGood) == false)
    XCTAssertTrue(g.step(input(270, CoverageStats(floorAreaM2: 16, wallsFound: 1))).say.contains(.thirtySeconds))
  }

  func testNoLineIsAQuestion() {
    for cue in Cue.allCases { XCTAssertFalse(cue.line.contains("?"), "\(cue) asks something") }
  }
}

final class CoverageMapTests: XCTestCase {
  // An upright phone at (x, 1.4, z), facing `heading` degrees clockwise from map-up, tilted `pitch` up.
  private func camera(_ x: Float, _ z: Float, heading: Float, pitch: Float = 0) -> CameraObs {
    let yaw = heading * .pi / 180, p = pitch * .pi / 180
    let forward = SIMD3<Float>(sin(yaw) * cos(p), sin(p), -cos(yaw) * cos(p))
    let right = simd_normalize(SIMD3<Float>(cos(yaw), 0, sin(yaw)))
    let up = simd_cross(right, forward)
    let t = simd_float4x4(SIMD4(-up, 0), SIMD4(right, 0), SIMD4(-forward, 0), SIMD4(x, 1.4, z, 1))
    return CameraObs(transform: t, intrinsics: SIMD4(1450, 1450, 960, 720), resolution: SIMD2(1920, 1440), tracked: true)
  }

  private func floor(_ minX: Float, _ minZ: Float, _ maxX: Float, _ maxZ: Float) -> PlaneObs {
    PlaneObs(id: UUID(), vertical: false, transform: matrix_identity_float4x4,
             boundary: [SIMD3(minX, 0, minZ), SIMD3(maxX, 0, minZ), SIMD3(maxX, 0, maxZ), SIMD3(minX, 0, maxZ)])
  }

  func testFloorPlaneArea() {
    let map = CoverageMap()
    map.upsert(floor(-2, -3, 2, 0))
    map.observe(camera(0, -1, heading: 0), points: [])
    let s = map.snapshot().stats
    XCTAssertEqual(s.floorAreaM2, 12, accuracy: 1.5)
    XCTAssertEqual(map.floorY ?? 99, 0, accuracy: 0.01)
  }

  func testVerticalPlaneBecomesAWall() {
    let map = CoverageMap()
    // A 3 m wall along x at z = −3, facing the camera (normal +z).
    let x = SIMD3<Float>(1, 0, 0), y = SIMD3<Float>(0, 0, 1)
    let anchor = simd_float4x4(SIMD4(x, 0), SIMD4(y, 0), SIMD4(simd_cross(x, y), 0), SIMD4(0.5, 1.2, -3, 1))
    map.upsert(PlaneObs(id: UUID(), vertical: true, transform: anchor, boundary: [SIMD3(-1.5, 0, -1), SIMD3(1.5, 0, -1), SIMD3(1.5, 0, 1), SIMD3(-1.5, 0, 1)]))
    map.upsert(floor(-2, -3, 2, 0))
    map.observe(camera(0, -1, heading: 0), points: [])
    let s = map.snapshot()
    XCTAssertEqual(s.stats.wallsFound, 1)
    XCTAssertEqual(s.walls.first?.length ?? 0, 3, accuracy: 0.01)
    XCTAssertEqual(s.walls.first.map { min($0.a.x, $0.b.x) } ?? 0, -1, accuracy: 0.01)
  }

  func testAWallJustPastTheFloorClosesTheEdge() {
    let map = CoverageMap()
    map.upsert(floor(-2, -2.5, 2, 0))
    map.observe(camera(0, -1, heading: 180), points: [])
    let open = map.snapshot().gapsUnseen.filter { $0.a.y < -2.4 && $0.b.y < -2.4 }.count
    XCTAssertGreaterThan(open, 0)
    // The far wall, found half a metre past where the floor plane stops.
    let x = SIMD3<Float>(1, 0, 0), y = SIMD3<Float>(0, 0, 1)
    let anchor = simd_float4x4(SIMD4(x, 0), SIMD4(y, 0), SIMD4(simd_cross(x, y), 0), SIMD4(0, 1.2, -3, 1))
    map.upsert(PlaneObs(id: UUID(), vertical: true, transform: anchor, boundary: [SIMD3(-2.2, 0, -1), SIMD3(2.2, 0, -1), SIMD3(2.2, 0, 1), SIMD3(-2.2, 0, 1)]))
    map.observe(camera(0, -1, heading: 180), points: [])
    let after = map.snapshot()
    XCTAssertEqual((after.gapsUnseen + after.gapsSeen).filter { $0.a.y < -2.4 && $0.b.y < -2.4 }.count, 0)
  }

  func testGapsStayBrightUntilLookedAt() {
    let map = CoverageMap()
    map.upsert(floor(-2, -3, 2, 0))
    map.observe(camera(0, -1.5, heading: 180), points: []) // facing +z: the far (−z) edge is behind
    let before = map.snapshot()
    XCTAssertGreaterThan(before.gapsUnseen.count, 0)
    XCTAssertNotNil(before.stats.unseenBearingDeg)
    map.observe(camera(0, -1.5, heading: 0), points: []) // turn around to face −z
    let after = map.snapshot()
    XCTAssertLessThan(after.gapsUnseen.count, before.gapsUnseen.count)
    XCTAssertGreaterThan(after.gapsSeen.count, before.gapsSeen.count)
  }

  func testCeilingCountsOnceLookedAt() {
    let map = CoverageMap()
    map.upsert(floor(-1, -2, 1, 0))
    map.observe(camera(0, -1, heading: 0), points: [])
    XCTAssertEqual(map.snapshot().stats.ceilingCovered, 0, accuracy: 0.05)
    map.observe(camera(0, -1, heading: 0, pitch: 80), points: [])
    XCTAssertGreaterThan(map.snapshot().stats.ceilingCovered, 0.15)
    XCTAssertGreaterThan(map.snapshot().stats.pitchDeg, 70)
  }

  func testHeadingIsClockwiseFromMapUp() {
    let map = CoverageMap()
    map.upsert(floor(-1, -2, 1, 0))
    map.observe(camera(0, -1, heading: 90), points: [])
    XCTAssertEqual(map.snapshot().heading * 180 / .pi, 90, accuracy: 0.5)
    // Straight down at the floor, the top of the phone still says which way they face.
    map.observe(camera(0, -1, heading: -90, pitch: -89), points: [])
    XCTAssertEqual(map.snapshot().heading * 180 / .pi, -90, accuracy: 2)
  }
}
