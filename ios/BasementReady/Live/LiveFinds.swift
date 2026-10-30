// Live finds while filming: every ~2.5 s a small upright JPEG of the camera goes to the server's SAM
// (POST /api/live/detect, the same call the web makes), and what comes back can be said and pinned.
// Best effort: if the network or the allowance runs out, filming carries on without it.
import Foundation

struct LiveFind: Decodable, Sendable {
  struct Box: Decodable, Sendable {
    let x, y, w, h: Double
    let c: Double?
  }
  let key: String
  let label: String
  let boxes: [Box]
}

@MainActor
final class LiveFinds {
  static let every: Duration = .milliseconds(2500)
  // server/live.ts LIVE_CONCEPTS. Keys the server doesn't know are dropped there, so new ones are safe.
  static let checklist = ["stairs", "window", "furnace", "panel"]
  static let extras = ["window", "duct", "panel", "furnace"]

  let session = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
  private var loop: Task<Void, Never>?
  private var round = 0
  private(set) var found = Set<String>()
  private(set) var offline = false

  // `frame` gives the newest camera picture as a JPEG; `onFind` hears each answer that found something.
  func start(server: URL, frame: @escaping @MainActor () async -> Data?, onFind: @escaping @MainActor ([LiveFind]) -> Void) {
    loop?.cancel()
    loop = Task { [weak self] in
      var failures = 0
      while !Task.isCancelled {
        try? await Task.sleep(for: Self.every)
        guard let self, !Task.isCancelled, let jpeg = await frame() else { continue }
        var body = Multipart()
        body.add("frame", filename: "frame.jpg", type: "image/jpeg", data: jpeg)
        body.add("session", self.session)
        body.add("concepts", Self.json(self.plan()))
        body.add("live3d", "off") // the app maps the room itself; the server may skip its 3D preview
        var req = URLRequest(url: server.appending(path: "api/live/detect"))
        req.httpMethod = "POST"
        req.setValue(body.contentType, forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 15
        do {
          let (data, res) = try await Net.session.upload(for: req, from: try body.data())
          let status = (res as? HTTPURLResponse)?.statusCode ?? 0
          if status == 429 {
            struct Refused: Decodable { let error: String? }
            if (try? JSONDecoder().decode(Refused.self, from: data))?.error != "slow down" {
              self.offline = true
              return // out of live finds for this take; the full scan still runs afterwards
            }
          } else if (200..<300).contains(status) {
            failures = 0
            struct Body: Decodable { let finds: [LiveFind] }
            let finds = (try? JSONDecoder().decode(Body.self, from: data))?.finds ?? []
            for f in finds { self.found.insert(f.key) }
            if !finds.isEmpty { onFind(finds) }
          } else {
            failures += 1
          }
        } catch {
          failures += 1
        }
        if failures >= 3 {
          self.offline = true
          return
        }
      }
    }
  }

  func stop() {
    loop?.cancel()
    loop = nil
  }

  // Doors every round (they mark a way through), then what's still missing, then an extra: three at most.
  func plan() -> [String] {
    let missing = Self.checklist.filter { !found.contains($0) }
    let extra = Self.extras[round % Self.extras.count]
    round += 1
    var out: [String] = []
    for k in ["door"] + missing.prefix(1) + [extra] + missing.dropFirst() where !out.contains(k) { out.append(k) }
    return Array(out.prefix(3))
  }

  private static func json(_ keys: [String]) -> String {
    (try? JSONSerialization.data(withJSONObject: keys)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
  }
}
