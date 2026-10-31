import XCTest

// The whole phone journey with no person: start → film (a recorded take, replayed as if it were
// ARKit) → send → the web result. The take is the Blender test basement b2, small enough to live in
// the repo (ios/Fixtures/b2-finished-family). The server is scripts/test-server.sh, which answers
// from saved recordings and never spends anything; `make test-ui` starts it.
//   BR_SERVER (TEST_RUNNER_BR_SERVER for xcodebuild): the server, default http://localhost:5183
//   BR_REPLAY_TAKE: another take folder to film instead
final class FilmAndSendTests: XCTestCase {
  private var fixtures: URL { URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appending(path: "Fixtures") }

  override func setUp() {
    continueAfterFailure = false
  }

  @MainActor
  func testFilmAReplayedTakeAndSeeTheResult() throws {
    let env = ProcessInfo.processInfo.environment
    let server = env["BR_SERVER"] ?? "http://localhost:5183"
    let take = env["BR_REPLAY_TAKE"] ?? fixtures.appending(path: "b2-finished-family").path
    try XCTSkipUnless(Self.reachable(server), "No test server at \(server). Start it with ios/scripts/test-server.sh (make test-ui does).")

    let app = XCUIApplication()
    app.launchArguments = ["-BRSkipIntro", "-BRReplay", take, "-BRReplaySpeed", "2", "-serverURL", server]
    app.launch()

    // Start: who it's for (no address is fine), then film.
    let notSure = app.buttons["Not sure"]
    XCTAssertTrue(notSure.waitForExistence(timeout: 15))
    notSure.tap()
    app.buttons["Start filming"].tap()

    // Filming: the replay plays at twice its speed; Done works once the take passes 30 s.
    let time = app.staticTexts["filming.time"]
    XCTAssertTrue(time.waitForExistence(timeout: 15))
    attach(app, "filming")
    let done = app.buttons["filming.done"]
    let past30 = NSPredicate { _, _ in
      let parts = time.label.split(separator: " ").first?.split(separator: ":").compactMap { Int($0) } ?? []
      return parts.count == 2 && parts[0] * 60 + parts[1] >= 32
    }
    expectation(for: past30, evaluatedWith: nil)
    waitForExpectations(timeout: 60)
    XCTAssertTrue(app.staticTexts["filming.stats"].exists, "the coverage shows while filming")
    app.buttons["filming.view.scan"].tap()
    attach(app, "scan only")
    done.tap()

    // Review, then send.
    let send = app.buttons["Send it"]
    XCTAssertTrue(send.waitForExistence(timeout: 30), "the take saved")
    send.tap()

    // The result opens: the web's page for this scan (with the free test server, its first model call
    // has no saved answer, so the scan stops there; the page still shows).
    let web = app.webViews.firstMatch
    XCTAssertTrue(web.waitForExistence(timeout: 120), "the upload finished and the result opened")
    let words = NSPredicate { _, _ in web.staticTexts.count > 3 }
    expectation(for: words, evaluatedWith: nil)
    waitForExpectations(timeout: 60)
    attach(app, "result")

    // The logo stays in the app: it goes to this basement's home base, never the marketing site.
    app.buttons["result.logo"].tap()
    XCTAssertTrue(web.waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["New scan"].exists, "still on the result screen, not sent out of the app")
  }

  private func attach(_ app: XCUIApplication, _ name: String) {
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = name
    shot.lifetime = .keepAlways
    add(shot)
  }

  private static func reachable(_ server: String) -> Bool {
    guard let url = URL(string: server + "/api/health") else { return false }
    let done = DispatchSemaphore(value: 0)
    nonisolated(unsafe) var ok = false
    var req = URLRequest(url: url)
    req.timeoutInterval = 5
    URLSession.shared.dataTask(with: req) { _, res, _ in
      ok = ((res as? HTTPURLResponse)?.statusCode ?? 0) == 200
      done.signal()
    }.resume()
    _ = done.wait(timeout: .now() + 6)
    return ok
  }
}
