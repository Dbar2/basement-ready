import XCTest
@testable import BasementReady

// Track G (Oct 31): inside the app the logo goes to the scan's home base, never the marketing site,
// and a take that's just been sent opens the guide.
final class ResultRoutesTests: XCTestCase {
  private let server = URL(string: "https://web-production-0c550.up.railway.app")!

  func testTheFrontPageMeansThisScansHome() {
    XCTAssertEqual(ResultView.route(server, server: server), .home)
    XCTAssertEqual(ResultView.route(server.appending(path: "/"), server: server), .home)
    XCTAssertEqual(ResultView.route(URL(string: "https://web-production-0c550.up.railway.app/?from=logo")!, server: server), .home)
  }

  func testTheScanStaysInTheAppAndTheRestGoesToSafari() {
    XCTAssertEqual(ResultView.route(server.appending(path: "scans/abc/guide"), server: server), .stay)
    XCTAssertEqual(ResultView.route(server.appending(path: "scans/abc"), server: server), .stay)
    XCTAssertEqual(ResultView.route(server.appending(path: "dashboard"), server: server), .stay)
    XCTAssertEqual(ResultView.route(server.appending(path: "faq"), server: server), .safari)
    XCTAssertEqual(ResultView.route(server.appending(path: "privacy"), server: server), .safari)
    XCTAssertEqual(ResultView.route(URL(string: "https://www.waterloo.ca/permits")!, server: server), .safari)
    XCTAssertEqual(ResultView.route(URL(string: "blob:https://x/1")!, server: server), .stay)
    // The Mac's dev server: another port on the same host is another site.
    let mac = URL(string: "https://192.168.1.20:5173")!
    XCTAssertEqual(ResultView.route(URL(string: "https://192.168.1.20:5173/scans/a")!, server: mac), .stay)
    XCTAssertEqual(ResultView.route(URL(string: "https://192.168.1.20:8787/")!, server: mac), .safari)
  }

  // The web's in-app "New scan" link (basementready://new) goes back to the app's start screen.
  func testTheAppsOwnNewScanLink() {
    XCTAssertEqual(ResultView.route(URL(string: "basementready://new")!, server: server), .newScan)
    XCTAssertEqual(ResultView.route(URL(string: "BasementReady://new")!, server: server), .newScan)
    XCTAssertEqual(ResultView.route(URL(string: "basementready://other")!, server: server), .stay)
    XCTAssertEqual(AppLink(URL(string: "basementready://new")!), .newScan)
    XCTAssertNil(AppLink(URL(string: "https://example.com/new")!))
  }

  // The guide if the server has it (its API answers), else the home base.
  func testAJustSentTakeOpensTheGuideWhenTheServerHasIt() async {
    let scan = ScanCreated(id: "abc", basementId: "b", claimToken: "t", server: server)
    StubProtocol.status = 200
    let guide = await ResultView.firstPage(scan, .guide, session: StubProtocol.session)
    XCTAssertEqual(guide?.path, "/scans/abc/guide")
    XCTAssertEqual(StubProtocol.asked, "/api/scans/abc/guide")
    // The owner's claim goes with it, the way the web sends it (server/workspace.ts parseClaims reads it).
    let header = try? XCTUnwrap(StubProtocol.claims)
    let decoded = header.flatMap { $0.removingPercentEncoding }.flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [[String: String]]
    XCTAssertEqual(decoded ?? [], [["basementId": "b", "claimToken": "t"]])
    XCTAssertFalse(header?.contains("\"") ?? true, "URI-encoded, like encodeURIComponent")
    StubProtocol.status = 404
    let older = await ResultView.firstPage(scan, .guide, session: StubProtocol.session)
    XCTAssertEqual(older?.path, "/scans/abc")
    // A server without the guide answers an unknown path with its web page, and a 200.
    StubProtocol.status = 200
    StubProtocol.body = "<!doctype html><title>Basement Ready</title>"
    let page = await ResultView.firstPage(scan, .guide, session: StubProtocol.session)
    XCTAssertEqual(page?.path, "/scans/abc")
    StubProtocol.body = "{\"milestone\":\"answer\"}"
    StubProtocol.asked = nil
    let home = await ResultView.firstPage(scan, .home, session: StubProtocol.session)
    XCTAssertEqual(home?.path, "/scans/abc")
    XCTAssertNil(StubProtocol.asked, "the home base needs no check")
  }
}

private final class StubProtocol: URLProtocol {
  nonisolated(unsafe) static var status = 200
  nonisolated(unsafe) static var asked: String?
  nonisolated(unsafe) static var claims: String?
  nonisolated(unsafe) static var body = "{\"milestone\":\"answer\"}"
  static let session: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubProtocol.self]
    return URLSession(configuration: config)
  }()

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Self.asked = request.url?.path
    Self.claims = request.value(forHTTPHeaderField: "x-claims")
    let res = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil, headerFields: nil)!
    client?.urlProtocol(self, didReceive: res, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(Self.body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

final class ClaimsHeaderTests: XCTestCase {
  // Exactly what encodeURIComponent(JSON.stringify([{basementId, claimToken}])) gives in the browser.
  func testTheClaimMatchesTheWebsOwnHeader() {
    let scan = ScanCreated(id: "s", basementId: "3f2b8c1e-0000-4000-8000-000000000001", claimToken: "Ab_9-xyzABCDEFGH", server: nil)
    XCTAssertEqual(scan.claimsHeader,
                   "%5B%7B%22basementId%22%3A%223f2b8c1e-0000-4000-8000-000000000001%22%2C%22claimToken%22%3A%22Ab_9-xyzABCDEFGH%22%7D%5D")
  }
}
