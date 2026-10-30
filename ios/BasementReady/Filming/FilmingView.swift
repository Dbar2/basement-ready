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

        GapArrow(bearing: model.gapBearing, cue: model.cue, size: geo.size)
          .allowsHitTesting(false)

        VStack(spacing: 0) {
          topBar
            .padding(.horizontal, Space.s3)
            .padding(.top, Space.s2)
          Spacer()
          bottomPanel
        }
      }
    }
    .background(Brand.ink.ignoresSafeArea())
    .preferredColorScheme(.dark)
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
        stoppedSheet(why)
      }
    }
  }

  #if DEBUG
  static let startInScanOnly = ProcessInfo.processInfo.arguments.contains("-BRScanOnly")
  #else
  static let startInScanOnly = false
  #endif

  // Over the camera: the time as a tag, and the view switch. Tags are card paper with an ink hairline.
  private var topBar: some View {
    HStack(alignment: .top, spacing: Space.s2) {
      VStack(alignment: .leading, spacing: Space.s2) {
        HStack(spacing: Space.s2) {
          Circle().fill(model.phase == .recording ? Brand.stop : Brand.inkMuted).frame(width: 8, height: 8)
          Text(model.timeText).font(Brand.mono(15)).foregroundStyle(Brand.ink).monospacedDigit()
            .accessibilityIdentifier("filming.time")
        }
        .padding(.horizontal, Space.s2 + 2)
        .frame(minHeight: 32)
        .tag()
        if model.lidar { tagText("LiDAR depth on") }
        if model.source == .replay { tagText("Replay") }
        if model.source == .demo { tagText("Pretend walk") }
      }
      Spacer()
      viewSwitch
    }
  }

  // Camera, or only what's been captured: two rectangles, the picked one in ink.
  private var viewSwitch: some View {
    HStack(spacing: 0) {
      switchButton(icon: "camera", label: "Camera", on: !voidView, id: "filming.view.camera") { voidView = false }
      Rectangle().fill(Brand.ink).frame(width: 1)
      switchButton(icon: "cube.transparent", label: "Scan only", on: voidView, id: "filming.view.scan") { voidView = true }
    }
    .fixedSize()
    .background(Brand.card)
    .clipShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).stroke(Brand.ink, lineWidth: 1))
  }

  private func switchButton(icon: String, label: String, on: Bool, id: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: icon)
        .font(.system(size: 16, weight: .semibold))
        .foregroundStyle(on ? Brand.card : Brand.ink)
        .frame(width: 48, height: 44)
        .background(on ? Brand.ink : .clear)
    }
    .accessibilityLabel(label)
    .accessibilityAddTraits(on ? .isSelected : [])
    .accessibilityIdentifier(id)
  }

  // The sheet at the bottom: an ink rule, one instruction, the figures, and the record button.
  private var bottomPanel: some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      if model.elapsed < 15 && model.phase == .recording {
        HStack(spacing: Space.s2) {
          Rectangle().fill(Brand.mint).frame(width: 12, height: 12).overlay(Rectangle().stroke(Brand.ink, lineWidth: 1))
          Text("Glow means not filmed yet. Point at it to fill it in.")
            .font(Brand.body(15)).foregroundStyle(Brand.inkMuted)
        }
        .transition(.opacity)
      }
      Text(model.line)
        .heading(22)
        .foregroundStyle(Brand.ink)
        .lineLimit(2)
        .minimumScaleFactor(0.85)
        .frame(maxWidth: .infinity, minHeight: 56, alignment: .topLeading)
        .animation(.easeOut(duration: 0.2), value: model.line)
        .accessibilityAddTraits(.updatesFrequently)
        .accessibilityIdentifier("filming.line")
      if let s = model.map?.stats {
        Text("\(Int(s.floorAreaM2.rounded())) m²  ·  \(s.wallsFound) \(s.wallsFound == 1 ? "wall" : "walls")  ·  \(Int((s.ceilingCovered * 100).rounded()))% ceiling")
          .font(Brand.mono(15))
          .foregroundStyle(Brand.ink)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
          .accessibilityIdentifier("filming.stats")
      }
      ZStack {
        HStack {
          Button("Throw away") { confirmDiscard = true }
            .buttonStyle(TextLink())
            .accessibilityLabel("Stop and throw away this take")
          Spacer()
        }
        RecordButton(saving: model.phase == .saving) { model.done() }
          .disabled(model.phase != .recording)
          .accessibilityIdentifier("filming.done")
      }
      .padding(.top, Space.s2)
    }
    .padding(.horizontal, Space.s3)
    .padding(.top, Space.s3)
    .padding(.bottom, Space.s2)
    .background(Brand.bg.ignoresSafeArea(edges: .bottom))
    .overlay(alignment: .top) { Rectangle().fill(Brand.ink).frame(height: 1) }
    .environment(\.colorScheme, .light)
  }

  private var sceneDescription: String {
    guard let s = model.map?.stats else { return "Camera view. The scan is starting." }
    return "Camera view with the scan: about \(Int(s.floorAreaM2.rounded())) square metres of floor, \(s.wallsFound) walls found, ceiling \(Int((s.ceilingCovered * 100).rounded())) percent filmed."
  }

  private func tagText(_ text: String) -> some View {
    Text(text).font(Brand.body(13, .semibold)).foregroundStyle(Brand.ink)
      .padding(.horizontal, Space.s2).frame(minHeight: 24)
      .tag()
  }

  private func stoppedSheet(_ why: String) -> some View {
    VStack(alignment: .leading, spacing: Space.s3) {
      Rectangle().fill(Brand.ink).frame(height: 1)
      Text(why).heading(22).foregroundStyle(Brand.ink)
      Button("Back to start", action: onCancel).buttonStyle(PrimaryButton())
      if why.contains("Settings") {
        Button("Open Settings") { UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!) }
          .buttonStyle(TextLink()).frame(maxWidth: .infinity)
      }
    }
    .padding(Space.s3)
    .background(Brand.bg)
    .environment(\.colorScheme, .light)
    .frame(maxHeight: .infinity, alignment: .bottom)
  }
}

// The one action while filming: a 72 pt ink ring. While recording, an ink square in it means stop;
// tapping it is Done (before 30 s the guide asks for a little longer).
struct RecordButton: View {
  var saving = false
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      ZStack {
        Circle().fill(Brand.card)
        Circle().stroke(Brand.ink, lineWidth: 3)
        if saving {
          ProgressView().tint(Brand.ink)
        } else {
          RoundedRectangle(cornerRadius: Radius.small, style: .continuous).fill(Brand.ink).frame(width: 24, height: 24)
        }
      }
      .frame(width: 72, height: 72)
      .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(saving ? "Saving" : "Done")
  }
}

private extension View {
  // A tag on the camera: card paper, an ink hairline, 4 pt corners.
  func tag() -> some View {
    background(Brand.card, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: Radius.small, style: .continuous).stroke(Brand.ink, lineWidth: 1))
  }
}

// A tag at the edge of the screen pointing toward the nearest spot nobody has filmed: left, right,
// behind (a turn, at the bottom), or up at the ceiling. Hidden when it's already in front of you.
struct GapArrow: View {
  let bearing: Float?
  let cue: Cue
  let size: CGSize

  private var target: (icon: String, angle: Double, point: CGPoint)? {
    let w = size.width, h = size.height
    switch cue {
    case .ceiling, .tiltUp: return ("chevron.up", 0, CGPoint(x: w / 2, y: h * 0.18))
    case .tiltDown: return ("chevron.up", 180, CGPoint(x: w / 2, y: h * 0.56))
    default: break
    }
    guard let b = bearing.map(Double.init), abs(b) >= 35 else { return nil }
    if abs(b) > 120 { return ("arrow.uturn.down", 0, CGPoint(x: w / 2, y: h * 0.56)) }
    return ("chevron.up", b < 0 ? -90 : 90, CGPoint(x: b < 0 ? 36 : w - 36, y: h * 0.42))
  }

  var body: some View {
    ZStack {
      if let target {
        Image(systemName: target.icon)
          .font(.system(size: 20, weight: .bold))
          .foregroundStyle(Brand.ink)
          .rotationEffect(.degrees(target.angle))
          .frame(width: 44, height: 44)
          .background(Brand.mint, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
          .overlay(RoundedRectangle(cornerRadius: Radius.small, style: .continuous).stroke(Brand.ink, lineWidth: 1))
          .position(target.point)
          .transition(.opacity)
          .accessibilityHidden(true)
      }
    }
    .animation(.easeInOut(duration: 0.25), value: target?.icon)
    .animation(.easeInOut(duration: 0.25), value: target?.angle)
  }
}
