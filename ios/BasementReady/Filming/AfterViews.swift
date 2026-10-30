// After filming: a look at the take before it's sent, then the sending itself.
import SwiftUI

struct ReviewView: View {
  let take: Take
  let note: String?
  let onSend: () -> Void
  let onRetake: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s4) {
      Text("Got it.").display(40).foregroundStyle(Brand.ink)
      if let note { Text(note).font(Brand.body(17)).foregroundStyle(Brand.inkMuted) }
      // A schedule on the sheet: an ink rule on top, hairlines between rows, no card.
      VStack(alignment: .leading, spacing: 0) {
        Rectangle().fill(Brand.ink).frame(height: 1)
        row("Filmed", FilmingModel.clock(take.duration))
        row("Floor mapped", "\(Int(take.floorAreaM2.rounded())) m²")
        row("Walls found", "\(take.wallsFound)")
        row("Ceiling filmed", "\(Int((take.ceilingCovered * 100).rounded()))%")
        if take.depth != nil { row("Depth", "LiDAR") }
      }
      Text("Next we measure it and check the rules. It takes a few minutes; you can watch it come together.")
        .font(Brand.body(17)).foregroundStyle(Brand.ink)
      Spacer()
      Button("Send it", action: onSend).buttonStyle(PrimaryButton())
      Button("Film again", action: onRetake).buttonStyle(TextLink()).frame(maxWidth: .infinity)
    }
    .padding(Space.s3)
    .background(Brand.bg.ignoresSafeArea())
  }

  private func row(_ label: String, _ value: String) -> some View {
    VStack(spacing: 0) {
      HStack {
        Text(label).font(Brand.body(17)).foregroundStyle(Brand.inkMuted)
        Spacer()
        Text(value).font(Brand.mono(15)).foregroundStyle(Brand.ink)
      }
      .frame(minHeight: 44)
      Rectangle().fill(Brand.border).frame(height: 1)
    }
  }
}

struct SendingView: View {
  @ObservedObject var uploader: Uploader
  let onRetry: () -> Void
  let onCancel: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      Spacer()
      switch uploader.state {
      case .failed(let why):
        Text("It didn't send.").display(34).foregroundStyle(Brand.ink)
        Text(why).font(Brand.body(17)).foregroundStyle(Brand.ink)
        Spacer()
        Button("Try again", action: onRetry).buttonStyle(PrimaryButton())
        Button("Back to start", action: onCancel).buttonStyle(TextLink()).frame(maxWidth: .infinity)
      default:
        Text("Sending your video").display(34).foregroundStyle(Brand.ink)
        ProgressView(value: fraction).tint(Brand.mintLine).scaleEffect(x: 1, y: 2.4, anchor: .center).padding(.vertical, 8)
        Text(fraction > 0 ? "\(Int((fraction * 100).rounded()))%" : "Getting it ready…").font(Brand.mono(17)).foregroundStyle(Brand.inkMuted)
        Text("You can lock your phone. It keeps sending.").font(Brand.body(17)).foregroundStyle(Brand.inkMuted)
        Spacer()
      }
    }
    .padding(Space.s3)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Brand.bg.ignoresSafeArea())
  }

  private var fraction: Double {
    if case .sending(let f) = uploader.state { return f }
    return 0
  }
}
