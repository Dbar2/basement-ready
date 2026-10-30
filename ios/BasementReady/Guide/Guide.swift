// The guide's thinking, twice a second: the one line on screen and what the voice may say, from the
// map's coverage, ARKit's tracking state and the time left. Pure, so it's tested without a camera.
import Foundation

enum Tracking: Equatable, Sendable {
  case normal, initializing, tooFast, featureless, relocalizing, unavailable
}

struct GuideInput: Sendable {
  var elapsed: Double
  var tracking: Tracking
  var stats: CoverageStats
  var still: Bool // the camera has barely moved or turned for the last 2 s
}

struct Guide {
  static let maxTake: Double = 300
  static let minTake: Double = 30
  static let wideBy: Double = 210 // the staged photos need the wide shot, so ask by 3:30 at the latest

  private(set) var wideAt: Double? // seconds into the take of the still wide shot, for the server
  private var asked = Set<Cue>()
  private var lastLine: Cue?
  private var prev = CoverageStats()
  private var featurelessSince: Double?
  private var lookingUpSince: Double?
  private var areaPraised: Float = 0
  private var doorAt: Double?
  private var areaAtDoor: Float = 0

  static func coverageGood(_ s: CoverageStats, _ elapsed: Double) -> Bool {
    elapsed >= 60 && s.floorAreaM2 >= 8 && s.ceilingCovered >= 0.75 && s.unseenGapM <= 1
  }

  // What to show, and what the voice should ask to say.
  mutating func step(_ input: GuideInput) -> (line: Cue, say: [Cue]) {
    let s = input.stats, t = input.elapsed
    var say: [Cue] = []
    defer { prev = s }

    // Moments worth a word.
    if prev.wallsFound == 0, s.wallsFound > 0, asked.insert(.firstWall).inserted { say.append(.firstWall) }
    if s.floorAreaM2 >= 8, s.ceilingCovered >= 0.8, asked.insert(.ceilingDone).inserted { say.append(.ceilingDone) }
    if t >= 60, s.wallsFound >= 3, s.floorAreaM2 >= 8, s.unseenGapM <= 1, asked.insert(.wallsDone).inserted { say.append(.wallsDone) }
    if s.floorAreaM2 - areaPraised >= 15 {
      areaPraised = s.floorAreaM2
      say.append(.lookingGood)
    }
    if let d = doorAt, t - d < 25, s.floorAreaM2 - areaAtDoor >= 4 {
      doorAt = nil
      say.append(.newSpace)
    }
    if t >= Self.maxTake - 60, asked.insert(.oneMinute).inserted { say.append(.oneMinute) }
    if t >= Self.maxTake - 30, asked.insert(.thirtySeconds).inserted { say.append(.thirtySeconds) }

    // The one thing to do now.
    let line: Cue
    switch input.tracking {
    case .tooFast:
      line = .slowDown
    case .featureless where t - (featurelessSince ?? t) >= 1.5:
      line = .tooDark
    case .relocalizing:
      line = .lost
    default:
      line = task(input)
    }
    if input.tracking == .featureless { featurelessSince = featurelessSince ?? t } else { featurelessSince = nil }
    // Tasks are said when they come up; nags keep asking, and the voice queue spaces them out.
    if line.kind == .nag || line != lastLine { say.append(line) }
    lastLine = line
    return (line, say)
  }

  private mutating func task(_ input: GuideInput) -> Cue {
    let s = input.stats, t = input.elapsed
    if s.pitchDeg > 45 { lookingUpSince = lookingUpSince ?? t } else { lookingUpSince = nil }

    if t < 12, s.floorAreaM2 < 6 { return .start }
    // The wide shot: when the rest is done, or by 3:30 regardless.
    if wideAt == nil, t >= 45, Self.coverageGood(s, t) || t >= Self.wideBy {
      if input.still {
        wideAt = max(0, t - 1)
        return .wideDone
      }
      return .wide
    }
    if wideAt != nil, Self.coverageGood(s, t) { return .enough }
    if s.ceilingOpenNearby, s.pitchDeg < 20 {
      return asked.insert(.ceiling).inserted ? .ceiling : .tiltUp
    }
    if let since = lookingUpSince, t - since > 6, !s.ceilingOpenNearby { return .tiltDown }
    if s.unseenGapM > 0.75, let b = s.unseenBearingDeg {
      if abs(b) > 120 { return .turnAround }
      if b < -35 { return .turnLeft }
      if b > 35 { return .turnRight }
    }
    if wideAt != nil, t >= Self.wideBy { return .enough }
    return .walls
  }

  // A live find: what to say, once per kind (windows can be several; the caller decides).
  mutating func found(_ key: String, at t: Double, area: Float) -> Cue? {
    if key == "door" {
      doorAt = t
      areaAtDoor = area
    }
    return Cue.found(key)
  }
}
