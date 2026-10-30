// Filming: the camera fills the screen, and the basement assembles on top of it as it's filmed:
// floor tiles, walls painting in, the point cloud, and a glow wherever nothing's been filmed yet.
// "Scan only" swaps the camera for a dark void, so only what's been captured shows. One line of
// guidance at the bottom; nothing to answer while filming.
import SwiftUI

struct FilmingView: View {
  @StateObject private var model: FilmingModel
  let onCancel: () -> Void
  @State private var confirmDiscard = false
  @State private var voidView = FilmingView.startInScanOnly
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  init(server: URL, onDone: @escaping (Take, String?) -> Void, onCancel: @escaping () -> Void) {
    _model = StateObject(wrappedValue: FilmingModel(server: server, onDone: onDone))
    self.onCancel = onCancel
  }

  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .top) {
        OverlayView(feed: model.capture.feed, perf: model.capture.perf, voidView: voidView)
          .ignoresSafeArea()
          .accessibilityElement()
          .accessibilityLabel(sceneDescription)

        // Shade behind the words at the top and bottom, so they read on a bright wall.
        VStack(spacing: 0) {
          LinearGradient(colors: [.black.opacity(0.5), .clear], startPoint: .top, endPoint: .bottom).frame(height: geo.safeAreaInsets.top + 130)
          Spacer()
          LinearGradient(colors: [.clear, .black.opacity(0.62)], startPoint: .top, endPoint: .bottom).frame(height: geo.safeAreaInsets.bottom + 260)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)

        GapArrow(bearing: model.gapBearing, cue: model.cue, size: geo.size, reduceMotion: reduceMotion)
          .allowsHitTesting(false)

        VStack(spacing: 0) {
          topBar
            .padding(.horizontal, 16)
            .padding(.top, 8)
          Spacer()
          bottom
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
        }
      }
    }
    .background(Brand.ink.ignoresSafeArea())
    .preferredColorScheme(.dark)
    .statusBarHidden(false)
    .onAppear { model.start() }
    .confirmationDialog("Throw away this take?", isPresented: $confirmDiscard, titleVisibility: .visible) {
      Button("Throw it away", role: .destructive) {
        model.discard()
        onCancel()
      }
      Button("Keep filming", role: .cancel) {}
    }
    .overlay {
      if case .stopped(let why) = model.phase, !why.isEmpty {
        stoppedCard(why)
      }
    }
  }

  #if DEBUG
  static let startInScanOnly = ProcessInfo.processInfo.arguments.contains("-BRScanOnly")
  #else
  static let startInScanOnly = false
  #endif

  private var topBar: some View {
    HStack(alignment: .top, spacing: 10) {
      VStack(alignment: .leading, spacing: 8) {
        HStack(spacing: 8) {
          Circle().fill(model.phase == .recording ? Brand.stop : Brand.inkMuted).frame(width: 10, height: 10)
          Text(model.timeText).font(Brand.mono(16, .semibold)).foregroundStyle(Brand.bg).monospacedDigit()
            .accessibilityIdentifier("filming.time")
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 36)
        .background(Brand.ink.opacity(0.75), in: Capsule())
        if let s = model.map?.stats {
          Text("\(Int(s.floorAreaM2.rounded())) m² · \(s.wallsFound) \(s.wallsFound == 1 ? "wall" : "walls") · \(Int((s.ceilingCovered * 100).rounded()))% ceiling")
            .font(Brand.mono(13))
            .foregroundStyle(Brand.bg.opacity(0.85))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .padding(.leading, 4)
            .accessibilityIdentifier("filming.stats")
        }
        HStack(spacing: 6) {
          if model.lidar { badge("LiDAR depth on") }
          if model.source == .replay { badge("Replay") }
          if model.source == .demo { badge("Pretend walk") }
        }
      }
      Spacer()
      viewSwitch
    }
  }

  // Camera, or only what's been captured.
  private var viewSwitch: some View {
    HStack(spacing: 2) {
      switchButton(icon: "camera.fill", label: "Camera", on: !voidView, id: "filming.view.camera") { voidView = false }
      switchButton(icon: "cube.transparent", label: "Scan only", on: voidView, id: "filming.view.scan") { voidView = true }
    }
    .padding(3)
    .background(Brand.ink.opacity(0.75), in: Capsule())
  }

  private func switchButton(icon: String, label: String, on: Bool, id: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: icon)
        .font(.system(size: 16, weight: .semibold))
        .foregroundStyle(on ? Brand.ink : Brand.bg)
        .frame(width: 48, height: 40)
        .background(on ? Brand.mint : .clear, in: Capsule())
    }
    .accessibilityLabel(label)
    .accessibilityAddTraits(on ? .isSelected : [])
    .accessibilityIdentifier(id)
  }

  private var bottom: some View {
    VStack(spacing: 14) {
      if model.elapsed < 15 && model.phase == .recording {
        HStack(spacing: 8) {
          Circle().fill(Brand.mint).frame(width: 8, height: 8).shadow(color: Brand.mint, radius: 4)
          Text("Glow means not filmed yet. Point at it to fill it in.")
        }
        .font(Brand.body(13, .medium))
        .foregroundStyle(Brand.bg.opacity(0.9))
        .transition(.opacity)
      }
      Text(model.line)
        .font(Brand.body(22, .semibold))
        .foregroundStyle(Brand.bg)
        .multilineTextAlignment(.center)
        .lineLimit(2)
        .minimumScaleFactor(0.8)
        .frame(maxWidth: .infinity, minHeight: 60)
        .animation(.easeOut(duration: 0.25), value: model.line)
        .accessibilityAddTraits(.updatesFrequently)
        .accessibilityIdentifier("filming.line")
      HStack(spacing: 12) {
        Button { confirmDiscard = true } label: {
          Image(systemName: "xmark").font(.system(size: 18, weight: .bold)).foregroundStyle(Brand.bg).frame(width: 56, height: 56)
            .overlay(Circle().stroke(Brand.bg.opacity(0.7), lineWidth: 1.5))
        }
        .accessibilityLabel("Stop and throw away this take")
        Button { model.done() } label: {
          Text(model.phase == .saving ? "Saving…" : "Done")
        }
        .buttonStyle(MintButton())
        .disabled(model.phase != .recording)
        .accessibilityIdentifier("filming.done")
      }
    }
  }

  private var sceneDescription: String {
    guard let s = model.map?.stats else { return "Camera view. The scan is starting." }
    return "Camera view with the scan: about \(Int(s.floorAreaM2.rounded())) square metres of floor, \(s.wallsFound) walls found, ceiling \(Int((s.ceilingCovered * 100).rounded())) percent filmed."
  }

  private func badge(_ text: String) -> some View {
    Text(text).font(Brand.body(12, .semibold)).foregroundStyle(Brand.ink)
      .padding(.horizontal, 10).frame(minHeight: 24)
      .background(Brand.mint, in: Capsule())
  }

  private func stoppedCard(_ why: String) -> some View {
    VStack(spacing: 16) {
      Text(why).font(Brand.body(18, .semibold)).foregroundStyle(Brand.ink).multilineTextAlignment(.center)
      if why.contains("Settings") {
        Button("Open Settings") { UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!) }.buttonStyle(OutlineButton())
      }
      Button("Back to start", action: onCancel).buttonStyle(MintButton())
    }
    .padding(24)
    .background(Brand.bg, in: RoundedRectangle(cornerRadius: 20))
    .padding(24)
  }
}

// A soft mint chevron at the edge of the screen, toward the nearest spot nobody has filmed: left,
// right, behind (at the bottom), or up at the ceiling. Hidden when it's already in front of you.
struct GapArrow: View {
  let bearing: Float?
  let cue: Cue
  let size: CGSize
  let reduceMotion: Bool
  @State private var breathe = false

  private var target: (icon: String, angle: Double, point: CGPoint)? {
    let w = size.width, h = size.height
    switch cue {
    case .ceiling, .tiltUp: return ("chevron.up", 0, CGPoint(x: w / 2, y: h * 0.2))
    case .tiltDown: return ("chevron.up", 180, CGPoint(x: w / 2, y: h * 0.66))
    default: break
    }
    guard let b = bearing.map(Double.init), abs(b) >= 35 else { return nil }
    // Behind you: a turn, not a tilt.
    if abs(b) > 120 { return ("arrow.uturn.down", 0, CGPoint(x: w / 2, y: h * 0.64)) }
    return ("chevron.up", b < 0 ? -90 : 90, CGPoint(x: b < 0 ? 34 : w - 34, y: h * 0.45))
  }

  var body: some View {
    ZStack {
      if let target {
        Image(systemName: target.icon)
          .font(.system(size: 30, weight: .heavy))
          .foregroundStyle(Brand.mint)
          .shadow(color: Brand.mint.opacity(0.9), radius: breathe ? 14 : 6)
          .opacity(breathe ? 1 : 0.65)
          .rotationEffect(.degrees(target.angle))
          .position(target.point)
          .transition(.opacity)
          .accessibilityHidden(true)
      }
    }
    .animation(.easeInOut(duration: 0.35), value: target?.angle)
    .onAppear {
      guard !reduceMotion else {
        breathe = true
        return
      }
      withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) { breathe = true }
    }
  }
}
