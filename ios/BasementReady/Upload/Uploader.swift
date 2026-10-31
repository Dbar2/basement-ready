// Sends the take to POST /api/scans with a background URLSession, so it keeps going if they lock the
// phone or switch apps. The fields are the web's (src/api.ts startScan) plus `capture` and, on LiDAR
// phones, `depth` (docs/capture-contract.md).
import Foundation
import UIKit

struct ScanCreated: Codable, Equatable, Sendable {
  let id: String
  let basementId: String
  let claimToken: String
  var server: URL?

  // The scan's home base on the web; the app's logo always comes back here, never the marketing site.
  var homeURL: URL? { server?.appending(path: "scans/\(id)") }
  // The guide, where the wait and the next steps happen (servers since the guide, Oct 31).
  var guideURL: URL? { server?.appending(path: "scans/\(id)/guide") }
  var guideAPI: URL? { server?.appending(path: "api/scans/\(id)/guide") }

  // The last take this phone sent, so the start screen can open its answer again.
  static let lastKey = "lastScan"
  static var last: ScanCreated? {
    UserDefaults.standard.data(forKey: lastKey).flatMap { try? JSONDecoder().decode(ScanCreated.self, from: $0) }
  }
}

// What's being sent, kept on disk so a relaunch can pick the answer up.
private struct Pending: Codable {
  var server: URL
  var folder: URL
  var answers: StartAnswers
}

enum ScanUpload {
  // The multipart body for one take, in the order the server reads it.
  static func body(for take: Take, answers: StartAnswers, boundary: String = "BasementReady-" + UUID().uuidString) -> Multipart {
    var form = Multipart(boundary: boundary)
    for (name, value) in answers.formFields { form.add(name, value) }
    form.add("lens", "wide")
    if let wideAt = take.wideAt { form.add("wideAt", String(format: "%.1f", wideAt)) }
    form.add("capture", filename: "capture.json", type: "application/json", file: take.capture)
    if let depth = take.depth { form.add("depth", filename: "depth.bin", type: "application/octet-stream", file: depth) }
    form.add("video", filename: take.uploadName, type: "video/mp4", file: take.video)
    return form
  }
}

@MainActor
final class Uploader: ObservableObject {
  enum State: Equatable {
    case idle
    case preparing
    case sending(Double)
    case done(ScanCreated)
    case failed(String)
  }

  static let shared = Uploader()
  static let sessionID = "com.davidbarry.basementready.upload"
  private static let pendingKey = "pendingUpload"

  @Published private(set) var state: State = .idle
  var backgroundDone: (() -> Void)?
  private let delegate = UploadDelegate()
  private lazy var session: URLSession = {
    let config = URLSessionConfiguration.background(withIdentifier: Self.sessionID)
    config.sessionSendsLaunchEvents = true
    config.isDiscretionary = false
    config.timeoutIntervalForResource = 60 * 60
    return URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
  }()

  private init() {
    delegate.owner = self
  }

  // On launch: reattach to an upload that was still going when the app was closed.
  func resume() {
    guard UserDefaults.standard.data(forKey: Self.pendingKey) != nil else { return }
    _ = session
    if state == .idle { state = .sending(0) }
  }

  func send(_ take: Take, answers: StartAnswers, server: URL) {
    state = .preparing
    Task.detached(priority: .userInitiated) {
      let bodyURL = take.folder.appending(path: "upload.body")
      let form = ScanUpload.body(for: take, answers: answers)
      do {
        try form.write(to: bodyURL)
      } catch {
        await MainActor.run { self.state = .failed("Couldn't get the video ready to send: \(error.localizedDescription)") }
        return
      }
      await MainActor.run {
        let pending = Pending(server: server, folder: take.folder, answers: answers)
        UserDefaults.standard.set(try? JSONEncoder().encode(pending), forKey: Self.pendingKey)
        var req = URLRequest(url: server.appending(path: "api/scans"))
        req.httpMethod = "POST"
        req.setValue(form.contentType, forHTTPHeaderField: "Content-Type")
        self.session.uploadTask(with: req, fromFile: bodyURL).resume()
        self.state = .sending(0)
      }
    }
  }

  func reset() {
    state = .idle
  }

  // ---------- from the delegate ----------

  fileprivate func progressed(_ fraction: Double) {
    if case .sending = state { state = .sending(fraction) } else if state == .idle { state = .sending(fraction) }
  }

  fileprivate func finished(status: Int, body: Data, error: Error?) {
    let pending = UserDefaults.standard.data(forKey: Self.pendingKey).flatMap { try? JSONDecoder().decode(Pending.self, from: $0) }
    struct Refusal: Decodable { let error: String? }
    if let error {
      state = .failed("Sending stopped: \(error.localizedDescription). Check your connection and try again.")
      return
    }
    guard (200..<300).contains(status), var created = try? JSONDecoder().decode(ScanCreated.self, from: body) else {
      let why = (try? JSONDecoder().decode(Refusal.self, from: body))?.error
      state = .failed(why ?? "The server didn't take the video (error \(status)). Try again.")
      return
    }
    created.server = pending?.server
    UserDefaults.standard.removeObject(forKey: Self.pendingKey)
    UserDefaults.standard.set(try? JSONEncoder().encode(created), forKey: ScanCreated.lastKey)
    // Sent: the take doesn't need to stay on the phone. Who it's for (and so the rent) went with it.
    // Debug builds keep the last few, so a real take can be copied off and replayed (ios/README.md).
    if let pending { Take.sent(pending.folder) }
    state = .done(created)
  }
}

// URLSession calls this on its own queue; everything goes back to the main actor.
final class UploadDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  weak var owner: Uploader?
  private var bodies: [Int: Data] = [:]
  private let lock = NSLock()

  func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
    guard totalBytesExpectedToSend > 0 else { return }
    let fraction = Double(totalBytesSent) / Double(totalBytesExpectedToSend)
    Task { @MainActor in self.owner?.progressed(fraction) }
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    lock.withLock { bodies[dataTask.taskIdentifier, default: Data()].append(data) }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    let body = lock.withLock { bodies.removeValue(forKey: task.taskIdentifier) ?? Data() }
    let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
    Task { @MainActor in self.owner?.finished(status: status, body: body, error: error) }
  }

  func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
    if let credential = DevTrust.credential(for: challenge) { return (.useCredential, credential) }
    return (.performDefaultHandling, nil)
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    Task { @MainActor in
      self.owner?.backgroundDone?()
      self.owner?.backgroundDone = nil
    }
  }
}
