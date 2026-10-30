import XCTest
@testable import BasementReady

final class IntroPlanTests: XCTestCase {
  func testFirstLaunchPlaysTheAnimationThenTheGuide() {
    let plan = IntroPlan.make(seenGuide: false, arguments: ["BasementReady"])
    XCTAssertTrue(plan.playLaunch)
    XCTAssertTrue(plan.showGuide)
    XCTAssertEqual(plan.guidePage, 0)
  }

  func testLaterLaunchesPlayTheAnimationOnly() {
    let plan = IntroPlan.make(seenGuide: true, arguments: ["BasementReady"])
    XCTAssertTrue(plan.playLaunch)
    XCTAssertFalse(plan.showGuide)
  }

  #if DEBUG
  func testSkipIntroSkipsTheAnimationAndTheGuide() {
    let plan = IntroPlan.make(seenGuide: false, arguments: ["BasementReady", "-BRSkipIntro", "-BRDemoWalk"])
    XCTAssertFalse(plan.playLaunch)
    XCTAssertFalse(plan.showGuide)
  }

  func testAFlagSetToNoIsOff() {
    let plan = IntroPlan.make(seenGuide: true, arguments: ["BasementReady", "-BRSkipIntro", "NO"])
    XCTAssertTrue(plan.playLaunch)
  }

  func testShowGuideOpensItAtOnceOnTheAskedPage() {
    let plan = IntroPlan.make(seenGuide: true, arguments: ["BasementReady", "-BRShowGuide", "-BRGuidePage", "3"])
    XCTAssertFalse(plan.playLaunch)
    XCTAssertTrue(plan.showGuide)
    XCTAssertEqual(plan.guidePage, 2)
    XCTAssertEqual(IntroPlan.make(seenGuide: true, arguments: ["-BRShowGuide", "-BRGuidePage", "9"]).guidePage, GuideContent.pages.count - 1)
    XCTAssertTrue(IntroPlan.make(seenGuide: true, arguments: ["-BRSkipIntro", "-BRShowGuide"]).showGuide, "asking for the guide wins")
  }

  func testResetAndFreeze() {
    let plan = IntroPlan.make(seenGuide: true, arguments: ["-BRResetGuide", "-BRFreezeAt", "0.8"])
    XCTAssertTrue(plan.resetGuide)
    XCTAssertTrue(plan.showGuide)
    XCTAssertEqual(plan.freezeAt, 0.8)
  }
  #endif
}

final class GuideFlagTests: XCTestCase {
  func testRemembersTheGuideWasSeen() throws {
    let suite = "GuideFlagTests-\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    XCTAssertEqual(GuideFlag.key, "seenFilmingGuide")
    XCTAssertFalse(GuideFlag(defaults).seen)
    GuideFlag(defaults).seen = true
    XCTAssertTrue(GuideFlag(defaults).seen)
  }
}

final class LaunchFrameTests: XCTestCase {
  func testStartsEmptyAndEndsAsTheMark() {
    let first = LaunchFrame.at(0)
    XCTAssertEqual(first.outline, 0)
    XCTAssertEqual(first.fill, 0)
    XCTAssertEqual(first.house, 0)
    XCTAssertEqual(first.door, 0)
    XCTAssertEqual(first.word, 0)
    XCTAssertEqual(LaunchFrame.at(LaunchTimeline.total), .finished)
  }

  func testTheBThenTheHouseThenTheDoorThenTheName() {
    func starts(_ part: KeyPath<LaunchFrame, Double>) -> Double {
      stride(from: 0.0, through: 2, by: 0.01).first { LaunchFrame.at($0)[keyPath: part] > 0 } ?? .infinity
    }
    XCTAssertLessThan(starts(\.outline), starts(\.house))
    XCTAssertLessThan(starts(\.house), starts(\.door))
    XCTAssertLessThan(starts(\.door), starts(\.word))
  }

  func testAboutASecondAndAHalf() {
    XCTAssertTrue((1.2...1.7).contains(LaunchTimeline.total + LaunchTimeline.fadeOut))
  }

  func testReduceMotionOnlyFades() {
    XCTAssertEqual(LaunchFrame.still(0).opacity, 0)
    var still = LaunchFrame.still(0.1)
    still.opacity = 1
    XCTAssertEqual(still, .finished, "the finished mark from the first frame, nothing moving")
  }
}
