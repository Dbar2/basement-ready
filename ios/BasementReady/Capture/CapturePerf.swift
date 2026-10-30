// One log line a second while filming: how many camera frames came in, how late the newest one was,
// how long the frame handler and the map took, what the video kept and dropped, and the app's memory.
// It's how a stall shows up on a real phone (`idevicesyslog -m BRPERF`) and in the replay harness.
import Foundation
import os

final class CapturePerf: @unchecked Sendable {
  private static let log = Logger(subsystem: "com.davidbarry.basementready", category: "perf")
  private let lock = NSLock()
  private var windowStart = ProcessInfo.processInfo.systemUptime
  private var frames = 0
  private var maxLag: Double = 0
  private var handlerTotal: Double = 0
  private var handlerMax: Double = 0
  private var mapMax: Double = 0
  private var mapRuns = 0
  private var mapSkipped = 0
  private var renderMax: Double = 0
  private(set) var peakMemoryMB: Double = 0
  private(set) var lines: [String] = []
  var extra: @Sendable () -> String = { "" }

  // A frame arrived `lag` seconds after it was captured, and its handler took `handler` seconds.
  func frame(lag: Double, handler: Double) {
    lock.lock()
    frames += 1
    maxLag = max(maxLag, lag)
    handlerTotal += handler
    handlerMax = max(handlerMax, handler)
    lock.unlock()
    flushIfDue()
  }

  func map(_ seconds: Double) {
    lock.lock()
    mapRuns += 1
    mapMax = max(mapMax, seconds)
    lock.unlock()
  }

  func mapSkip() {
    lock.lock()
    mapSkipped += 1
    lock.unlock()
  }

  func render(_ seconds: Double) {
    lock.lock()
    renderMax = max(renderMax, seconds)
    lock.unlock()
  }

  private func flushIfDue() {
    let now = ProcessInfo.processInfo.systemUptime
    lock.lock()
    guard now - windowStart >= 1 else {
      lock.unlock()
      return
    }
    let span = now - windowStart
    let mem = Self.memoryMB()
    peakMemoryMB = max(peakMemoryMB, mem)
    let line = String(
      format: "BRPERF fps=%.0f lag=%.0fms handler=%.1f/%.1fms map=%d(%d skipped) max %.0fms render=%.1fms mem=%.0fMB",
      Double(frames) / span, maxLag * 1000, frames > 0 ? handlerTotal / Double(frames) * 1000 : 0, handlerMax * 1000,
      mapRuns, mapSkipped, mapMax * 1000, renderMax * 1000, mem)
    windowStart = now
    frames = 0
    maxLag = 0
    handlerTotal = 0
    handlerMax = 0
    mapMax = 0
    mapRuns = 0
    mapSkipped = 0
    renderMax = 0
    lock.unlock()
    let full = line + " " + extra()
    lock.lock()
    lines.append(full)
    if lines.count > 600 { lines.removeFirst(lines.count - 600) }
    lock.unlock()
    Self.log.notice("\(full, privacy: .public)")
  }

  // The app's footprint, the number iOS kills apps by.
  static func memoryMB() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
    }
    return kr == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : 0
  }
}
