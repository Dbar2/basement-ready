// The wait screen and the result stay web: the app opens /scans/<id> on the same server. The
// basement's claim token goes into the page's storage first, the way the web's own upload keeps it,
// so signing in later can claim this basement. Links to other sites open in Safari.
import SwiftUI
import WebKit

struct ResultView: View {
  let scan: ScanCreated
  let onNewScan: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text("Basement Ready").font(Brand.body(17, .heavy)).foregroundStyle(Brand.ink)
        Spacer()
        // The web page carries its own primary; this is a way back.
        Button("New scan", action: onNewScan).buttonStyle(TextLink())
      }
      .padding(.horizontal, 16)
      .padding(.bottom, 6)
      Rectangle().fill(Brand.ink).frame(height: 1)
      if let url = scan.resultURL {
        WebPage(url: url, claim: scan).ignoresSafeArea(edges: .bottom)
      }
    }
    .background(Brand.bg.ignoresSafeArea())
  }
}

private struct WebPage: UIViewRepresentable {
  let url: URL
  let claim: ScanCreated

  func makeCoordinator() -> Coordinator { Coordinator(home: url) }

  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.allowsInlineMediaPlayback = true
    config.userContentController.addUserScript(WKUserScript(source: Self.claimScript(claim), injectionTime: .atDocumentStart, forMainFrameOnly: true))
    let web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = context.coordinator
    web.uiDelegate = context.coordinator
    web.allowsBackForwardNavigationGestures = true
    web.isOpaque = false
    web.backgroundColor = UIColor(Brand.bg)
    web.load(URLRequest(url: url))
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

  final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
    let home: URL
    init(home: URL) { self.home = home }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
      guard let url = action.request.url, action.targetFrame?.isMainFrame ?? true else { return .allow }
      if url.host == home.host || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return .allow }
      await UIApplication.shared.open(url)
      return .cancel
    }

    // target="_blank": the city's portal, a grant's page.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
      if let url = action.request.url {
        if url.host == home.host { webView.load(URLRequest(url: url)) } else { UIApplication.shared.open(url) }
      }
      return nil
    }

    func webView(_ webView: WKWebView, respondTo challenge: URLAuthenticationChallenge) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
      if let credential = DevTrust.credential(for: challenge) { return (.useCredential, credential) }
      return (.performDefaultHandling, nil)
    }
  }
}
