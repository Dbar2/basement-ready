// What the guide can say: one line of text on screen, and the voice clips that say it. Clips are the
// web app's (public/voice/<id>.mp3), bundled at build time; each cue lists the clip ids it can use,
// best first, and plays whichever exist. A cue with no clip yet just shows its line.
import Foundation

enum CueKind: Int, Sendable {
  case nag = 1, praise, task
}

enum Cue: String, CaseIterable, Sendable {
  // tasks
  case start, walls, ceiling, wide, enough, keepGoing
  // directions (nags that share one allowance)
  case turnLeft, turnRight, turnAround, tiltUp, tiltDown
  // tracking
  case slowDown, tooDark, lost
  // praise and finds
  case firstWall, wallsDone, ceilingDone, newSpace, lookingGood, wideDone
  case stairsFound, windowFound, furnaceFound, panelFound, doorFound, ductFound, beamFound
  // time
  case oneMinute, thirtySeconds

  var kind: CueKind {
    switch self {
    case .start, .walls, .ceiling, .wide, .enough, .keepGoing, .oneMinute, .thirtySeconds: .task
    case .turnLeft, .turnRight, .turnAround, .tiltUp, .tiltDown, .slowDown, .tooDark, .lost: .nag
    default: .praise
    }
  }

  var isDirection: Bool { [.turnLeft, .turnRight, .turnAround, .tiltUp, .tiltDown].contains(self) }
  var isNag: Bool { [.slowDown, .tooDark].contains(self) }

  // The one line on screen. Short, plain, never a question.
  var line: String {
    switch self {
    case .start: "Film the stairs on your way down."
    case .walls: "Walk slowly along the walls, about 2 m back."
    case .ceiling: "Tilt up and film the ceiling."
    case .wide: "Step back into a corner and hold still."
    case .enough: "That's everything. Tap Done when you're ready."
    case .keepGoing: "Keep going, just a little longer."
    case .turnLeft: "Turn left. That wall isn't filmed yet."
    case .turnRight: "Turn right. That wall isn't filmed yet."
    case .turnAround: "Turn around. The wall behind you isn't filmed yet."
    case .tiltUp: "Tilt up. The ceiling here isn't filmed yet."
    case .tiltDown: "Tilt back down to the walls."
    case .slowDown: "Slow down a little."
    case .tooDark: "Too dark or too plain here. Turn on a light."
    case .lost: "Point back at where you just were."
    case .firstWall: "Got a wall."
    case .wallsDone: "The walls look good."
    case .ceilingDone: "Got the ceiling."
    case .newSpace: "New space. Take it slow."
    case .lookingGood: "That's looking good."
    case .wideDone: "Got the wide shot."
    case .stairsFound: "Got the stairs."
    case .windowFound: "Found a window."
    case .furnaceFound: "Found the furnace."
    case .panelFound: "Found the electrical panel."
    case .doorFound: "A door. Film what's through it too."
    case .ductFound: "A duct. Mind your head."
    case .beamFound: "A beam. Mind your head."
    case .oneMinute: "One minute left."
    case .thirtySeconds: "30 seconds left."
    }
  }

  // Clip ids, best first. Today's clips are first where they fit; the rest are the names the new
  // conversational clips are expected to use (ios/CAPTURE.md lists them).
  var clips: [String] {
    switch self {
    case .start: ["intro"]
    case .walls: ["walls"]
    case .ceiling: ["ceiling"]
    case .wide: ["wide"]
    case .enough: ["enough"]
    case .keepGoing: ["keep_going"]
    case .turnLeft: ["turn_left"]
    case .turnRight: ["turn_right"]
    case .turnAround: ["wall_behind", "turn_around"]
    case .tiltUp: ["tilt_up"]
    case .tiltDown: ["tilt_down"]
    case .slowDown: ["slow_down"]
    case .tooDark: ["too_dark"]
    case .lost: ["lost_place"]
    case .firstWall: ["wall_found"]
    case .wallsDone: ["walls_done"]
    case .ceilingDone: ["ceiling_done"]
    case .newSpace: ["new_space"]
    case .lookingGood: ["looking_good"]
    case .wideDone: ["wide_done"]
    case .stairsFound: ["stairs_found", "stairs_done"]
    case .windowFound: ["window_found"]
    case .furnaceFound: ["furnace_found"]
    case .panelFound: ["panel_found"]
    case .doorFound: ["door_found"]
    case .ductFound, .beamFound: ["mind_head"]
    case .oneMinute: ["one_minute"]
    case .thirtySeconds: ["thirty_seconds"]
    }
  }

  // A live find (server/live.ts keys) to what the guide says about it.
  static func found(_ key: String) -> Cue? {
    switch key {
    case "stairs": .stairsFound
    case "window": .windowFound
    case "furnace": .furnaceFound
    case "panel": .panelFound
    case "door": .doorFound
    case "duct": .ductFound
    case "beam": .beamFound
    default: nil
    }
  }
}

// When to speak (the web's VoiceQueue rules, src/capture/voice.ts): one line at a time, 6.5 s of
// quiet between lines, the same line at most every 30 s, and all the turn and tilt lines sharing one
// allowance. A task beats praise, which beats a nag. Pure, so it's tested.
struct VoiceQueue {
  static let gap: Double = 6.5
  static let repeatAfter: Double = 30
  static let nagRepeatAfter: Double = 45
  static let directionEvery: Double = 14

  private struct Waiting {
    var cue: Cue
    var at: Double
  }

  private var waiting: [Waiting] = []
  private var said: [Cue: Double] = [:]
  private var directionAt = -Double.infinity
  private var endedAt = -Double.infinity
  private(set) var playing: Cue?

  private static func stale(_ kind: CueKind) -> Double {
    switch kind {
    case .task: 15
    case .praise: 6
    case .nag: 3
    }
  }

  private func blocked(_ cue: Cue, _ at: Double) -> Bool {
    if let last = said[cue], at - last < (cue.isNag ? Self.nagRepeatAfter : Self.repeatAfter) { return true }
    return cue.isDirection && at - directionAt < Self.directionEvery
  }

  @discardableResult
  mutating func request(_ cue: Cue, at: Double) -> Bool {
    if blocked(cue, at) { return false }
    // One of each waits: a newer direction replaces an older one, a newer task an older task.
    waiting.removeAll { $0.cue == cue || ($0.cue.isDirection && cue.isDirection) || (cue.kind == .task && $0.cue.kind == .task) }
    waiting.append(Waiting(cue: cue, at: at))
    return true
  }

  // The cue to play now, if any.
  mutating func next(at: Double) -> Cue? {
    guard playing == nil, at - endedAt >= Self.gap else { return nil }
    let current = self
    waiting.removeAll { at - $0.at > Self.stale($0.cue.kind) || current.blocked($0.cue, at) }
    guard let best = waiting.max(by: { a, b in a.cue.kind.rawValue < b.cue.kind.rawValue || (a.cue.kind == b.cue.kind && a.at < b.at) }) else { return nil }
    waiting.removeAll { $0.cue == best.cue }
    // Praise and nags queued behind a task are old news once it's said.
    if best.cue.kind == .task { waiting.removeAll { $0.cue.kind != .task } }
    playing = best.cue
    said[best.cue] = at
    if best.cue.isDirection { directionAt = at }
    return best.cue
  }

  mutating func ended(at: Double) {
    playing = nil
    endedAt = at
  }
}

// Every clip in the bundle's voice folder, by id. "turn_left_2.mp3" is another take of "turn_left".
struct ClipLibrary {
  private(set) var clips: [String: [URL]] = [:]

  init(folder: URL?) {
    let files = folder.flatMap { try? FileManager.default.contentsOfDirectory(at: $0, includingPropertiesForKeys: nil) } ?? []
    self.init(files: files)
  }

  init(files: [URL]) {
    for url in files where ["mp3", "m4a", "wav"].contains(url.pathExtension.lowercased()) {
      let id = url.deletingPathExtension().lastPathComponent
      clips[id, default: []].append(url)
      if let r = id.range(of: #"_\d+$"#, options: .regularExpression) { clips[String(id[..<r.lowerBound]), default: []].append(url) }
    }
    for k in clips.keys { clips[k]!.sort { $0.lastPathComponent < $1.lastPathComponent } }
  }

  static var bundled: ClipLibrary { ClipLibrary(folder: Bundle.main.url(forResource: "voice", withExtension: nil)) }

  // A take of the first id that has one, avoiding the take played last time when there's a choice.
  func clip(for cue: Cue, avoiding last: URL? = nil) -> URL? {
    for id in cue.clips {
      guard let takes = clips[id], !takes.isEmpty else { continue }
      let fresh = takes.filter { $0 != last }
      return (fresh.isEmpty ? takes : fresh).randomElement()
    }
    return nil
  }
}
