// One take: the camera, the coverage, the guide's line, the voice and the live finds, wired together.
import Foundation
import QuartzCore
import UIKit
import simd

// Carries capture events from the capture queues to the model on the main actor.
private final class EventRelay: @unchecked Sendable {
  weak var model: FilmingModel?
  func send(_ e: CaptureEvent) {
    Task { @MainActor [weak self] in self?.model?.handle(e) }
  }
}

@MainActor
final class FilmingModel: ObservableObject {
  enum Phase: Equatable {
    case recording
    case saving
    case stopped(String) // too short to keep, or the camera failed
  }

  enum Source: Equatable {
    case camera, replay, demo
  }

  @Published private(set) var phase: Phase = .recording
  @Published private(set) var map: MapSnapshot?
  @Published private(set) var elapsed: Double = 0
  @Published private(set) var cue: Cue = .start
  @Published private(set) var line: String = Cue.start.line
  @Published private(set) var tracking: Tracking = .initializing
  @Published private(set) var lidar = false

  let capture: CaptureSource
  let source: Source
  private let voice = VoicePlayer()
  private let live = LiveFinds()
  private var guide = Guide()
  private var shortNote: (Cue, Double)? // a line shown for a moment (a tap too early)
  private let server: URL
  private let onDone: (Take, String?) -> Void

  init(server: URL, onDone: @escaping (Take, String?) -> Void) {
    self.server = server
    self.onDone = onDone
    let relay = EventRelay()
    #if DEBUG
    if let take = ReplayCapture.requested {
      capture = ReplayCapture(take: take) { e in relay.send(e) }
      source = .replay
    } else if DemoCapture.requested || !ARCapture.isSupported {
      capture = DemoCapture { e in relay.send(e) }
      source = .demo
    } else {
      capture = ARCapture { e in relay.send(e) }
      source = .camera
    }
    #else
    capture = ARCapture { e in relay.send(e) }
    source = .camera
    #endif
    relay.model = self
  }

  var canFinish: Bool { elapsed >= Guide.minTake }
  var timeText: String { Self.clock(elapsed) + " / " + Self.clock(Guide.maxTake) }

  static func clock(_ s: Double) -> String {
    let n = max(0, Int(s))
    return "\(n / 60):" + String(format: "%02d", n % 60)
  }

  // Which way the nearest spot nobody has filmed is, from where the camera faces (degrees, − is left).
  var gapBearing: Float? {
    guard let s = map?.stats, s.unseenGapM > 0.5, let b = s.unseenBearingDeg else { return nil }
    return b
  }

  func start() {
    UIApplication.shared.isIdleTimerDisabled = true
    voice.activate()
    voice.origin = CACurrentMediaTime()
    do {
      try capture.start()
    } catch {
      phase = .stopped(error.localizedDescription)
      return
    }
    let capture = self.capture
    live.start(server: server, frame: { await capture.jpeg() }, onFind: { [weak self] finds in self?.found(finds) })
  }

  fileprivate func handle(_ event: CaptureEvent) {
    guard phase == .recording else { return }
    switch event {
    case .update(let u):
      elapsed = u.elapsed
      tracking = u.tracking
      lidar = u.depth
      map = u.map
      let (cue, say) = guide.step(GuideInput(elapsed: u.elapsed, tracking: u.tracking, stats: u.map.stats, still: u.still))
      self.cue = cue
      let now = voice.now()
      for c in say { voice.request(c, at: now) }
      let speaking = voice.tick(at: now)
      if let (note, until) = shortNote, now < until {
        line = note.line
      } else {
        shortNote = nil
        line = (speaking ?? cue).line
      }
      if u.elapsed >= Guide.maxTake { finish() }
    case .interrupted:
      if canFinish { finish(note: "Filming stopped early, but there's enough to use.") } else { abandon("Filming stopped. The camera was interrupted before 30 seconds.") }
    case .failed(let why):
      abandon(why)
    }
  }

  private func found(_ finds: [LiveFind]) {
    for f in finds {
      let n = (map?.pins.filter { $0.key == f.key }.count ?? 0)
      // Windows can be several (a new one once the camera has turned well away); anything else once.
      if n > 0, f.key != "window" { continue }
      if f.key == "window", let cam = map?.camera, map?.pins.contains(where: { $0.key == "window" && simd_distance($0.at, cam) < 2.5 }) == true { continue }
      if n >= 4 { continue }
      capture.pin(key: f.key, label: f.label, id: "\(f.key)-\(n + 1)")
      if let cue = guide.found(f.key, at: elapsed, area: map?.stats.floorAreaM2 ?? 0) { voice.request(cue, at: voice.now()) }
    }
  }

  func done() {
    guard phase == .recording else { return }
    if canFinish {
      finish()
    } else {
      voice.request(.keepGoing, at: voice.now())
      shortNote = (.keepGoing, voice.now() + 3)
      line = Cue.keepGoing.line
    }
  }

  private func finish(note: String? = nil) {
    guard phase == .recording else { return }
    phase = .saving
    live.stop()
    voice.deactivate()
    UIApplication.shared.isIdleTimerDisabled = false
    let wideAt = guide.wideAt
    // If the app is on its way to the background, ask for the moment it takes to close the video file.
    let background = UIApplication.shared.beginBackgroundTask(withName: "Save the take")
    Task {
      defer { UIApplication.shared.endBackgroundTask(background) }
      do {
        var take = try await capture.stop()
        take.wideAt = wideAt
        onDone(take, note)
      } catch {
        phase = .stopped("The video didn't save: \(error.localizedDescription)")
      }
    }
  }

  private func abandon(_ why: String) {
    guard phase == .recording else { return }
    live.stop()
    voice.deactivate()
    capture.cancel()
    UIApplication.shared.isIdleTimerDisabled = false
    phase = .stopped(why)
  }

  func discard() {
    abandon("")
  }
}
