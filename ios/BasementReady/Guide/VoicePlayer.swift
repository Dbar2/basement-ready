// Plays the guide's clips one at a time through the loudspeaker, with the queue's quiet gaps. The
// phone's own speech voice is never used: a cue without a clip only shows its line.
import AVFoundation
import QuartzCore

@MainActor
final class VoicePlayer: NSObject, AVAudioPlayerDelegate {
  private let library = ClipLibrary.bundled
  private var queue = VoiceQueue()
  private var player: AVAudioPlayer?
  private var lastClip: URL?
  private(set) var speaking: Cue?
  var muted = false

  var clipCount: Int { library.clips.count }

  // The audio session is switched on and off away from the main thread: it can block for a moment.
  private static let session = DispatchQueue(label: "audio-session", qos: .userInitiated)

  func activate() {
    Self.session.async {
      let audio = AVAudioSession.sharedInstance()
      // Playback ignores the silent switch: the guide has to be heard in the basement.
      try? audio.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
      try? audio.setActive(true)
    }
  }

  func deactivate() {
    player?.stop()
    player = nil
    speaking = nil
    Self.session.async { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
  }

  func request(_ cue: Cue, at t: Double) {
    queue.request(cue, at: t)
  }

  // Called on the guide's tick: starts the next line if it's time. Returns the cue now speaking.
  @discardableResult
  func tick(at t: Double) -> Cue? {
    guard let cue = queue.next(at: t) else { return speaking }
    guard !muted, let url = library.clip(for: cue, avoiding: lastClip), let p = try? AVAudioPlayer(contentsOf: url) else {
      // No clip: the line shows for a moment as if it had been said, and the quiet gap still applies.
      speaking = cue
      Task { @MainActor [weak self] in
        try? await Task.sleep(for: .seconds(2.5))
        self?.finished(cue, at: t + 2.5)
      }
      return cue
    }
    p.delegate = self
    p.play()
    player = p
    lastClip = url
    speaking = cue
    return cue
  }

  private func finished(_ cue: Cue, at t: Double) {
    guard speaking == cue else { return }
    speaking = nil
    player = nil
    queue.ended(at: t)
  }

  nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    Task { @MainActor in
      guard let cue = self.speaking else { return }
      self.finished(cue, at: self.now())
    }
  }

  // Seconds into the take: the clock the filming screen ticks with.
  var origin = CACurrentMediaTime()
  func now() -> Double { CACurrentMediaTime() - origin }
}
