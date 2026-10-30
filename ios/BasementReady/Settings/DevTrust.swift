// `pnpm dev:phone` serves the Mac over HTTPS with a self-signed certificate. Debug builds accept that
// certificate for the Mac's own address only; every other host, and every Release build, gets the
// system's normal checks.
import Foundation

enum DevTrust {
  static func allows(host: String) -> Bool {
    #if DEBUG
    guard let mac = ServerSettings.mac?.url.host, host == mac || host == ServerSettings.current.host else { return false }
    return isLocal(host)
    #else
    return false
    #endif
  }

  // Private Wi-Fi addresses and .local names: never a public site.
  static func isLocal(_ host: String) -> Bool {
    if host == "localhost" || host.hasSuffix(".local") { return true }
    let p = host.split(separator: ".").compactMap { Int($0) }
    guard p.count == 4 else { return false }
    return p[0] == 10 || (p[0] == 172 && (16...31).contains(p[1])) || (p[0] == 192 && p[1] == 168) || p[0] == 127
  }

  // For URLSession and WKWebView challenges alike.
  static func credential(for challenge: URLAuthenticationChallenge) -> URLCredential? {
    let space = challenge.protectionSpace
    guard space.authenticationMethod == NSURLAuthenticationMethodServerTrust, let trust = space.serverTrust, allows(host: space.host) else { return nil }
    return URLCredential(trust: trust)
  }
}

// A delegate for plain requests that applies DevTrust.
final class TrustingDelegate: NSObject, URLSessionDelegate, Sendable {
  func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
    if let credential = DevTrust.credential(for: challenge) { return (.useCredential, credential) }
    return (.performDefaultHandling, nil)
  }
}

enum Net {
  static let session = URLSession(configuration: .default, delegate: TrustingDelegate(), delegateQueue: nil)
}
