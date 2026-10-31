// After a take is sent the app opens the web's guide for the scan (/scans/<id>/guide), where the wait
// and the next steps happen; "Your last scan" opens its home base (/scans/<id>). The basement's
// claim token goes into the page's storage first, the way the web's own upload keeps it, so signing
// in later can claim this basement.
//
// Inside the app the logo always goes to the scan's home base, never the marketing site: the app's
// own logo above the page, and the page's links to the front page too. Other marketing and legal
// pages, and other sites, open in Safari.
import SwiftUI
import WebKit

enum ResultPage: Sendable {
  case guide, home
}

struct ResultView: View {
  let scan: ScanCreated
  let page: ResultPage
  let onNewScan: () -> Void
  @StateObject private var web = WebController()
  @State private var start: URL?

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Button { if let home = scan.homeURL { web.load(home) } } label: {
          HStack(spacing: Space.s2) {
            BrandMark().fill(Brand.ink, style: FillStyle(eoFill: true)).frame(width: 18, height: 22)
            Text("Basement Ready").heading(17).foregroundStyle(Brand.ink)
          }
          .frame(minHeight: 44)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Basement Ready: this basement's home")
        .accessibilityIdentifier("result.logo")
        Spacer()
        Button("New scan", action: onNewScan).buttonStyle(TextLink())
      }
      .padding(.horizontal, Space.s3)
      Rectangle().fill(Brand.ink).frame(height: 1)
      if let start {
        WebPage(url: start, home: scan.homeURL ?? start, claim: scan, controller: web).ignoresSafeArea(edges: .bottom)
      } else {
        Spacer()
      }
    }
    .background(Brand.bg.ignoresSafeArea())
    .task { start = await Self.firstPage(scan, page) }
  }

  // The guide if this server has it, else the home base (a server from before the guide, Oct 31).
  // Only the guide's own JSON counts: a server without it answers unknown paths with the web page.
  static func firstPage(_ scan: ScanCreated, _ page: ResultPage, session: URLSession = Net.session) async -> URL? {
    guard page == .guide, let guide = scan.guideURL, let api = scan.guideAPI else { return scan.homeURL }
    var req = URLRequest(url: api)
    req.timeoutInterval = 6
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    guard let (data, res) = try? await session.data(for: req), let http = res as? HTTPURLResponse, (200..<300).contains(http.statusCode),
          (try? JSONSerialization.jsonObject(with: data)) is [String: Any] else { return scan.homeURL }
    return guide
  }

  // Where a link inside the app goes: on with it, back to the scan's home base, or out to Safari.
  enum Route: Equatable {
    case stay, home, safari
  }

  static func route(_ url: URL, server: URL) -> Route {
    guard url.host == server.host, url.port == server.port else {
      return ["about", "blob", "data"].contains(url.scheme ?? "") ? .stay : .safari
    }
    let path = url.path.isEmpty ? "/" : url.path
    if path == "/" { return .home } // the front page is the marketing site
    // The marketing and legal pages (src/marketing/site.ts PATHS).
    let marketing = ["/how-it-works", "/for-pros", "/cities", "/faq", "/privacy", "/terms", "/about", "/pros/join"]
    return marketing.contains(where: { path == $0 || path.hasPrefix($0 + "/") }) ? .safari : .stay
  }
}

// The page's web view, so the logo can send it home.
@MainActor
final class WebController: ObservableObject {
  weak var view: WKWebView?
  func load(_ url: URL) { view?.load(URLRequest(url: url)) }
}

private struct WebPage: UIViewRepresentable {
  let url: URL
  let home: URL
  let claim: ScanCreated
  let controller: WebController

  func makeCoordinator() -> Coordinator { Coordinator(home: home) }

  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.allowsInlineMediaPlayback = true
    // The web can tell it's inside the app (navigator.userAgent ends "BasementReadyApp/1").
    config.applicationNameForUserAgent = "BasementReadyApp/1"
    config.userContentController.addUserScript(WKUserScript(source: Self.claimScript(claim), injectionTime: .atDocumentStart, forMainFrameOnly: true))
    let web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = context.coordinator
    web.uiDelegate = context.coordinator
    web.allowsBackForwardNavigationGestures = true
    web.isOpaque = false
    web.backgroundColor = UIColor(Brand.bg)
    web.load(URLRequest(url: url))
    controller.view = web
    // The page's own router changes the address without a navigation; the front page still means home.
    context.coordinator.watch(web)
    return web
  }

  func updateUIView(_ web: WKWebView, context: Context) {}

  // Same storage as src/api.ts rememberClaim: br-claims, the newest 20.
  static func claimScript(_ claim: ScanCreated) -> String {
    let entry = (try? JSONSerialization.data(withJSONObject: ["basementId": claim.basementId, "claimToken": claim.claimToken])).flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    return """
    try {
      const entry = \(entry);
      const all = JSON.parse(localStorage.getItem("br-claims") || "[]");
      if (entry && !all.some((c) => c.basementId === entry.basementId)) {
        all.push(entry);
        localStorage.setItem("br-claims", JSON.stringify(all.slice(-20)));
      }
    } catch (e) {}
    """
  }

  @MainActor
  final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
    let home: URL
    private var watching: NSKeyValueObservation?
    private var wentHome = Date.distantPast
    init(home: URL) { self.home = home }

    // Back to the home base, at most once every few seconds: if the home base itself ever sends the
    // page to the front page (a scan that's gone, say), it stays there rather than going round.
    private func goHome(_ web: WKWebView) {
      guard Date().timeIntervalSince(wentHome) > 4 else { return }
      wentHome = Date()
      web.load(URLRequest(url: home))
    }

    func watch(_ web: WKWebView) {
      watching = web.observe(\.url, options: [.new]) { [weak self] web, _ in
        Task { @MainActor in
          guard let self, let url = web.url, ResultView.route(url, server: self.home) == .home else { return }
          self.goHome(web)
        }
      }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
      guard let url = action.request.url, action.targetFrame?.isMainFrame ?? true else { return .allow }
      switch ResultView.route(url, server: home) {
      case .stay:
        return .allow
      case .home:
        goHome(webView)
        return .cancel
      case .safari:
        await UIApplication.shared.open(url)
        return .cancel
      }
    }

    // target="_blank": the city's portal, a grant's page.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
      if let url = action.request.url {
        switch ResultView.route(url, server: home) {
        case .stay: webView.load(URLRequest(url: url))
        case .home: goHome(webView)
        case .safari: UIApplication.shared.open(url)
        }
      }
      return nil
    }

    func webView(_ webView: WKWebView, respondTo challenge: URLAuthenticationChallenge) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
      if let credential = DevTrust.credential(for: challenge) { return (.useCredential, credential) }
      return (.performDefaultHandling, nil)
    }
  }
}
