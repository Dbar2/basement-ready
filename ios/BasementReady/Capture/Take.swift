// One recorded take on disk, and what the filming screen hears while it's recorded.
import Foundation

struct Take: Codable, Sendable {
  var folder: URL
  var video: URL
  var capture: URL
  var depth: URL?
  var duration: Double
  var frames: Int
  var floorAreaM2: Float
  var wallsFound: Int
  var ceilingCovered: Float
  var wideAt: Double?
  var device: String

  // Application Support/Takes/<when>, kept until the take has been sent.
  static func newFolder() throws -> URL {
    let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appending(path: "Takes")
    let stamp = ISO8601DateFormatter.string(from: .now, timeZone: .current, formatOptions: [.withFullDate, .withTime]).replacingOccurrences(of: ":", with: "")
    let folder = base.appending(path: stamp)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    return folder
  }

  // basement-YYYY-MM-DD-HHMM.mp4, like the web's recordings.
  var uploadName: String {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd-HHmm"
    return "basement-\(f.string(from: (try? folder.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .now)).mp4"
  }
}

struct CaptureUpdate: Sendable {
  var elapsed: Double
  var tracking: Tracking
  var map: MapSnapshot
  var still: Bool
  var depth: Bool
}

enum CaptureEvent: Sendable {
  case update(CaptureUpdate)
  case interrupted // the camera stopped: a call, Control Center, the app left
  case failed(String)
}

// The real camera (ARCapture) or, in Debug builds, a replayed take or a pretend walk for the
// simulator (ReplayCapture, DemoCapture). Each takes a `send` for its events when made, and fills
// `feed` with what the overlay draws.
protocol CaptureSource: AnyObject, Sendable {
  var feed: OverlayFeed { get }
  var perf: CapturePerf { get }
  func start() throws
  func stop() async throws -> Take
  func cancel()
  func jpeg() async -> Data?
  func pin(key: String, label: String, id: String)
}

enum DeviceModel {
  // "iPhone15,4"; in the simulator, the phone it pretends to be.
  static let identifier: String = {
    if let sim = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return sim }
    var info = utsname()
    uname(&info)
    return withUnsafeBytes(of: &info.machine) { raw in
      String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
    }
  }()
}
