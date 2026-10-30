// Which Basement Ready server the app talks to: this Mac while testing, or the live site.
import Foundation

struct ServerOption: Identifiable, Hashable {
  let name: String
  let url: URL
  var id: String { url.absoluteString }
}

enum ServerSettings {
  static let live = ServerOption(name: "Live site", url: URL(string: "https://web-production-0c550.up.railway.app")!)
  private static let key = "serverURL"

  // Debug builds carry the Mac's address from build time (scripts/dev-server.sh).
  static let mac: ServerOption? = {
    guard let file = Bundle.main.url(forResource: "dev-server", withExtension: "json"),
          let data = try? Data(contentsOf: file),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: String],
          let url = json["url"].flatMap(URL.init(string:)) else { return nil }
    return ServerOption(name: "Mac (dev)", url: url)
  }()

  static var options: [ServerOption] { [mac, live].compactMap { $0 } }

  static var current: URL {
    // The live site by default (the GPU and the phone's tracking path); the Mac is one tap away in settings.
    get { UserDefaults.standard.string(forKey: key).flatMap(URL.init(string:)) ?? live.url }
    set { UserDefaults.standard.set(newValue.absoluteString, forKey: key) }
  }

  // A typed address, cleaned up: https unless it says otherwise, no trailing slash or path.
  static func parse(_ text: String) -> URL? {
    var s = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !s.isEmpty else { return nil }
    if !s.contains("://") { s = "https://" + s }
    guard var parts = URLComponents(string: s), let host = parts.host, !host.isEmpty, ["http", "https"].contains(parts.scheme ?? "") else { return nil }
    parts.path = ""
    parts.query = nil
    parts.fragment = nil
    return parts.url
  }
}
