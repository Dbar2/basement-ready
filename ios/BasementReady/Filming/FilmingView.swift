// Filming: the map fills the screen, the camera picture is a large inset, one line of text at the
// bottom. Nothing to answer while filming.
import ARKit
import RealityKit
import SwiftUI

struct FilmingView: View {
  @StateObject private var model: FilmingModel
  let onCancel: () -> Void
  @State private var confirmDiscard = false

  init(server: URL, onDone: @escaping (Take, String?) -> Void, onCancel: @escaping () -> Void) {
    _model = StateObject(wrappedValue: FilmingModel(server: server, onDone: onDone))
    self.onCancel = onCancel
  }

  var body: some View {
    GeometryReader { geo in
      let insetWidth = geo.size.width * 0.4
      // The map fits in the space below the camera picture and above the line and buttons.
      let fit = EdgeInsets(top: geo.safeAreaInsets.top + 8 + insetWidth * 4 / 3 + 14, leading: 20, bottom: geo.safeAreaInsets.bottom + 168, trailing: 20)
      ZStack(alignment: .top) {
        MapView(map: model.map, fit: fit)
          .ignoresSafeArea()

        VStack(spacing: 0) {
          HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 8) {
              HStack(spacing: 8) {
                Circle().fill(model.phase == .recording ? Brand.stop : Brand.inkMuted).frame(width: 10, height: 10)
                Text(model.timeText).font(Brand.mono(16, .semibold)).foregroundStyle(Brand.bg).monospacedDigit()
              }
              .padding(.horizontal, 12)
              .frame(minHeight: 36)
              .background(Brand.ink.opacity(0.75), in: Capsule())
              if model.lidar { badge("LiDAR depth on") }
              if model.isDemo { badge("Pretend walk") }
              if let s = model.map?.stats {
                VStack(alignment: .leading, spacing: 3) {
                  Text("\(Int(s.floorAreaM2.rounded())) m² floor")
                  Text("\(s.wallsFound) \(s.wallsFound == 1 ? "wall" : "walls") found")
                  Text("\(Int((s.ceilingCovered * 100).rounded()))% of ceiling")
                }
                .font(Brand.mono(13))
                .foregroundStyle(Brand.bg.opacity(0.8))
                .padding(.leading, 4)
              }
            }
            Spacer()
            cameraInset
              .frame(width: insetWidth, height: insetWidth * 4 / 3)
              .clipShape(RoundedRectangle(cornerRadius: 16))
              .overlay(RoundedRectangle(cornerRadius: 16).stroke(Brand.bg.opacity(0.85), lineWidth: 2))
          }
          .padding(.horizontal, 16)
          .padding(.top, 8)

          Spacer()

          VStack(spacing: 14) {
            Text(model.line)
              .font(Brand.body(22, .semibold))
              .foregroundStyle(Brand.bg)
              .multilineTextAlignment(.center)
              .lineLimit(2)
              .minimumScaleFactor(0.8)
              .frame(maxWidth: .infinity, minHeight: 60)
              .animation(.easeOut(duration: 0.25), value: model.line)
              .accessibilityAddTraits(.updatesFrequently)
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
            }
          }
          .padding(.horizontal, 20)
          .padding(.bottom, 12)
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
        stoppedCard(why)
      }
    }
  }

  private func badge(_ text: String) -> some View {
    Text(text).font(Brand.body(12, .semibold)).foregroundStyle(Brand.ink)
      .padding(.horizontal, 10).frame(minHeight: 24)
      .background(Brand.mint, in: Capsule())
  }

  @ViewBuilder private var cameraInset: some View {
    if let ar = model.arCapture {
      CameraInset(session: ar.session)
    } else {
      ZStack {
        Brand.inkMuted.opacity(0.5)
        Text("The camera picture shows here on an iPhone.")
          .font(Brand.body(13, .medium)).foregroundStyle(Brand.bg.opacity(0.85))
          .multilineTextAlignment(.center).padding(12)
      }
    }
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

// The live camera picture, drawn by RealityKit from the same ARSession (nothing else is rendered).
struct CameraInset: UIViewRepresentable {
  let session: ARSession

  func makeUIView(context: Context) -> ARView {
    let view = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
    view.session = session
    view.renderOptions = [.disableMotionBlur, .disableDepthOfField, .disableHDR, .disableGroundingShadows, .disableAREnvironmentLighting, .disableCameraGrain, .disablePersonOcclusion, .disableFaceMesh]
    view.environment.sceneUnderstanding.options = []
    return view
  }

  func updateUIView(_ view: ARView, context: Context) {}
}
