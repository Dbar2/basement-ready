import XCTest
@testable import BasementReady

final class MultipartTests: XCTestCase {
  private var dir: URL!

  override func setUpWithError() throws {
    dir = FileManager.default.temporaryDirectory.appending(path: "mp-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: dir)
  }

  func testExactBytes() throws {
    var form = Multipart(boundary: "B")
    form.add("household", "relative")
    form.add("capture", filename: "capture.json", type: "application/json", data: Data("{\"version\":1}".utf8))
    let expected = "--B\r\nContent-Disposition: form-data; name=\"household\"\r\n\r\nrelative\r\n"
      + "--B\r\nContent-Disposition: form-data; name=\"capture\"; filename=\"capture.json\"\r\nContent-Type: application/json\r\n\r\n{\"version\":1}\r\n"
      + "--B--\r\n"
    XCTAssertEqual(String(decoding: try form.data(), as: UTF8.self), expected)
    XCTAssertEqual(form.contentType, "multipart/form-data; boundary=B")
  }

  func testQuotesAreEscapedInNames() {
    XCTAssertEqual(Multipart.quoted("a\"b\nc"), "a%22b c")
  }

  // The streamed file is byte for byte the in-memory body, across many 1 MB chunks.
  func testStreamedBodyMatchesInMemory() throws {
    let big = dir.appending(path: "video.mp4")
    var bytes = [UInt8](repeating: 0, count: 3 * 1024 * 1024 + 17)
    for i in bytes.indices { bytes[i] = UInt8(truncatingIfNeeded: i &* 31) }
    try Data(bytes).write(to: big)
    var form = Multipart(boundary: "X")
    form.add("a", "1")
    form.add("video", filename: "v.mp4", type: "video/mp4", file: big)
    let out = dir.appending(path: "body")
    let size = try form.write(to: out)
    let streamed = try Data(contentsOf: out)
    XCTAssertEqual(streamed, try form.data())
    XCTAssertEqual(Int64(streamed.count), size)
  }

  private func take(depth: Bool, wideAt: Double?) throws -> Take {
    let video = dir.appending(path: "video.mp4"), capture = dir.appending(path: "capture.json"), depthURL = dir.appending(path: "depth.bin")
    try Data("VIDEO".utf8).write(to: video)
    try Data("{\"version\":1}".utf8).write(to: capture)
    try Data([1, 2, 3, 4]).write(to: depthURL)
    return Take(folder: dir, video: video, capture: capture, depth: depth ? depthURL : nil, duration: 95, frames: 5700, floorAreaM2: 40,
                wallsFound: 6, ceilingCovered: 0.8, wideAt: wideAt, device: "iPhone15,4")
  }

  private let address = AddressHit(address: "295 LESTER ST", municipality: "Waterloo", city: "waterloo-on", lon: -80.5, lat: 43.47, units: 1)

  // The same fields as the web's startScan, then capture, depth and the video.
  func testScanBodyFieldsAndOrder() throws {
    let form = ScanUpload.body(for: try take(depth: true, wideAt: 81.24), answers: StartAnswers(address: address, who: .affordable), boundary: "Z")
    let parts = try MultipartParser.parse(try form.data(), boundary: "Z")
    XCTAssertEqual(parts.map(\.name), ["household", "who", "address", "addressMunicipality", "municipality", "lens", "wideAt", "capture", "depth", "video"])
    let byName = Dictionary(uniqueKeysWithValues: parts.map { ($0.name, $0) })
    XCTAssertEqual(byName["household"]?.text, "renter")
    XCTAssertEqual(byName["who"]?.text, "rental_capped")
    XCTAssertEqual(byName["address"]?.text, "295 LESTER ST")
    XCTAssertEqual(byName["addressMunicipality"]?.text, "Waterloo")
    XCTAssertEqual(byName["municipality"]?.text, "waterloo-on")
    XCTAssertEqual(byName["lens"]?.text, "wide")
    XCTAssertEqual(byName["wideAt"]?.text, "81.2")
    XCTAssertEqual(byName["capture"]?.filename, "capture.json")
    XCTAssertEqual(byName["capture"]?.type, "application/json")
    XCTAssertEqual(byName["capture"]?.text, "{\"version\":1}")
    XCTAssertEqual(byName["depth"]?.filename, "depth.bin")
    XCTAssertEqual(byName["depth"]?.body, Data([1, 2, 3, 4]))
    XCTAssertEqual(byName["video"]?.type, "video/mp4")
    XCTAssertTrue(byName["video"]?.filename?.hasPrefix("basement-") ?? false)
    XCTAssertTrue(byName["video"]?.filename?.hasSuffix(".mp4") ?? false)
    XCTAssertEqual(byName["video"]?.text, "VIDEO")
    if let out = ProcessInfo.processInfo.environment["BR_EXPORT_DIR"] {
      try form.write(to: URL(fileURLWithPath: out).appending(path: "scan-body.multipart"))
    }
  }

  func testNoAddressNoDepthFamily() throws {
    let form = ScanUpload.body(for: try take(depth: false, wideAt: nil), answers: StartAnswers(address: nil, who: .family), boundary: "Z")
    let parts = try MultipartParser.parse(try form.data(), boundary: "Z")
    XCTAssertEqual(parts.map(\.name), ["household", "who", "address", "municipality", "lens", "capture", "video"])
    XCTAssertEqual(parts.first { $0.name == "household" }?.text, "relative")
    XCTAssertEqual(parts.first { $0.name == "who" }?.text, "family")
    XCTAssertEqual(parts.first { $0.name == "address" }?.text, "")
    XCTAssertEqual(parts.first { $0.name == "municipality" }?.text, "other-on")
  }

  func testWhoForMapsToTheServersAnswers() {
    XCTAssertEqual(WhoFor.family.household, "relative")
    XCTAssertEqual(WhoFor.affordable.household, "renter")
    XCTAssertEqual(WhoFor.market.household, "renter")
    XCTAssertEqual(WhoFor.unsure.household, "unsure")
    // server/eligibility.ts WHO_IDS: the server saves the city's own rent answer from these.
    XCTAssertEqual(WhoFor.allCases.map(\.server), ["family", "rental_capped", "rental_market", "unsure"])
    let fields = StartAnswers(address: nil, who: .affordable).formFields.map(\.0)
    XCTAssertTrue(fields.contains("who"))
    XCTAssertFalse(fields.contains("rent"))
  }

  func testServerAddressParsing() {
    XCTAssertEqual(ServerSettings.parse("10.0.0.85:5173")?.absoluteString, "https://10.0.0.85:5173")
    XCTAssertEqual(ServerSettings.parse(" https://example.com/scans/1 ")?.absoluteString, "https://example.com")
    XCTAssertEqual(ServerSettings.parse("http://192.168.1.4:8787")?.absoluteString, "http://192.168.1.4:8787")
    XCTAssertNil(ServerSettings.parse(""))
    XCTAssertNil(ServerSettings.parse("ftp://x"))
    XCTAssertTrue(DevTrust.isLocal("10.0.0.85"))
    XCTAssertTrue(DevTrust.isLocal("192.168.1.4"))
    XCTAssertTrue(DevTrust.isLocal("172.20.1.1"))
    XCTAssertFalse(DevTrust.isLocal("172.40.1.1"))
    XCTAssertFalse(DevTrust.isLocal("basementready.com"))
    XCTAssertFalse(DevTrust.allows(host: "basementready.com"))
  }
}

// A small, strict reader for the bodies above (independent of the writer).
enum MultipartParser {
  struct Part {
    var name: String
    var filename: String?
    var type: String?
    var body: Data
    var text: String { String(decoding: body, as: UTF8.self) }
  }

  struct Malformed: Error {}

  static func parse(_ data: Data, boundary: String) throws -> [Part] {
    let delimiter = Data("--\(boundary)".utf8)
    let crlf = Data("\r\n".utf8)
    var parts: [Part] = []
    guard data.starts(with: delimiter + crlf) else { throw Malformed() }
    var cursor = data.startIndex + delimiter.count + 2
    while true {
      guard let headerEnd = data.range(of: crlf + crlf, in: cursor..<data.endIndex) else { throw Malformed() }
      let headers = String(decoding: data[cursor..<headerEnd.lowerBound], as: UTF8.self).components(separatedBy: "\r\n")
      guard let next = data.range(of: crlf + delimiter, in: headerEnd.upperBound..<data.endIndex) else { throw Malformed() }
      var part = Part(name: "", body: data[headerEnd.upperBound..<next.lowerBound])
      for h in headers {
        if h.hasPrefix("Content-Disposition: form-data; ") {
          for item in h.dropFirst("Content-Disposition: form-data; ".count).components(separatedBy: "; ") {
            let kv = item.split(separator: "=", maxSplits: 1).map(String.init)
            guard kv.count == 2 else { continue }
            let value = String(kv[1].dropFirst().dropLast())
            if kv[0] == "name" { part.name = value } else if kv[0] == "filename" { part.filename = value }
          }
        } else if h.hasPrefix("Content-Type: ") {
          part.type = String(h.dropFirst("Content-Type: ".count))
        } else {
          throw Malformed()
        }
      }
      parts.append(part)
      let after = next.upperBound
      if data[after...].starts(with: Data("--\r\n".utf8)) {
        guard after + 4 == data.endIndex else { throw Malformed() }
        return parts
      }
      guard data[after...].starts(with: crlf) else { throw Malformed() }
      cursor = after + 2
    }
  }
}
