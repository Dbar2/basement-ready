// Basement Ready for iPhone: answer two things, film the basement with ARKit tracking, send it, and
// the web takes it from there.
import SwiftUI
import UIKit

@main
struct BasementReadyApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

  var body: some Scene {
    WindowGroup {
      RootView()
    }
  }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
  // The system wakes the app when a background upload finishes.
  func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
    Uploader.shared.backgroundDone = completionHandler
    Uploader.shared.resume()
  }
}

@MainActor
final class AppModel: ObservableObject {
  enum Stage {
    case start
    case filming(StartAnswers, server: URL)
    case review(Take, StartAnswers, note: String?)
    case sending(retry: (Take, StartAnswers)?) // nil: picked up after a relaunch
    case result(ScanCreated)
  }

  @Published var stage: Stage = .start
  let uploader = Uploader.shared

  init() {
    // An upload still going from last time.
    uploader.resume()
    if case .sending = uploader.state { stage = .sending(retry: nil) }
    #if DEBUG
    // Straight to filming (with "not sure" and no address), for the replay harness and screenshots.
    if ProcessInfo.processInfo.arguments.contains("-BRFilmNow") { film(StartAnswers(address: nil, who: .unsure)) }
    #endif
  }

  func film(_ answers: StartAnswers) {
    stage = .filming(answers, server: ServerSettings.current)
  }

  func filmed(_ take: Take, answers: StartAnswers, note: String?) {
    stage = .review(take, answers, note: note)
  }

  func send(_ take: Take, _ answers: StartAnswers) {
    stage = .sending(retry: (take, answers))
    uploader.send(take, answers: answers, server: ServerSettings.current)
  }

  func discard(_ take: Take) {
    try? FileManager.default.removeItem(at: take.folder)
    stage = .start
  }

  func restart() {
    uploader.reset()
    stage = .start
  }
}

struct RootView: View {
  @StateObject private var app = AppModel()
  @ObservedObject private var uploader = Uploader.shared

  var body: some View {
    Group {
      switch app.stage {
      case .start:
        StartView(onStart: { answers in app.film(answers) }, onOpenLast: { scan in app.stage = .result(scan) }).preferredColorScheme(.light)
      case .filming(let answers, let server):
        FilmingView(server: server, onDone: { take, note in app.filmed(take, answers: answers, note: note) }, onCancel: { app.stage = .start })
      case .review(let take, let answers, let note):
        ReviewView(take: take, note: note, onSend: { app.send(take, answers) }, onRetake: { app.discard(take) }).preferredColorScheme(.light)
      case .sending(let retry):
        SendingView(uploader: uploader, onRetry: { if let (take, answers) = retry { app.send(take, answers) } else { app.restart() } }, onCancel: { app.restart() }).preferredColorScheme(.light)
      case .result(let scan):
        ResultView(scan: scan) { app.restart() }.preferredColorScheme(.light)
      }
    }
    .onChange(of: uploader.state) { _, state in
      if case .done(let scan) = state { app.stage = .result(scan) }
    }
    .introFlow() // the launch animation, and the filming guide on the first launch
  }
}
