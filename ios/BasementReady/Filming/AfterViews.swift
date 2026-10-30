// After filming: a look at the take before it's sent, then the sending itself.
import SwiftUI

struct ReviewView: View {
  let take: Take
  let note: String?
  let onSend: () -> Void
  let onRetake: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      Text("Got it.").font(Brand.display(44)).kerning(-1.4).foregroundStyle(Brand.ink)
      if let note { Text(note).font(Brand.body(17)).foregroundStyle(Brand.inkMuted) }
      VStack(alignment: .leading, spacing: 12) {
        row("Filmed", FilmingModel.clock(take.duration))
        row("Floor mapped", "\(Int(take.floorAreaM2.rounded())) m²")
        row("Walls found", "\(take.wallsFound)")
        row("Ceiling filmed", "\(Int((take.ceilingCovered * 100).rounded()))%")
        if take.depth != nil { row("Depth", "LiDAR") }
      }
      .padding(18)
      .background(Brand.card, in: RoundedRectangle(cornerRadius: 16))
      .overlay(RoundedRectangle(cornerRadius: 16).stroke(Brand.border))
      Text("Next we measure it and check the rules. It takes a few minutes; you can watch it come together.")
        .font(Brand.body(17)).foregroundStyle(Brand.ink)
      Spacer()
      Button("Send it", action: onSend).buttonStyle(MintButton())
      Button("Film again", action: onRetake).buttonStyle(OutlineButton())
    }
    .padding(20)
    .background(Brand.bg.ignoresSafeArea())
  }

  private func row(_ label: String, _ value: String) -> some View {
    HStack {
      Text(label).font(Brand.body(17)).foregroundStyle(Brand.inkMuted)
      Spacer()
      Text(value).font(Brand.mono(17)).foregroundStyle(Brand.ink)
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
        Text("It didn't send.").font(Brand.display(40)).kerning(-1.2).foregroundStyle(Brand.ink)
        Text(why).font(Brand.body(17)).foregroundStyle(Brand.ink)
        Spacer()
        Button("Try again", action: onRetry).buttonStyle(MintButton())
        Button("Back to start", action: onCancel).buttonStyle(OutlineButton())
      default:
        Text("Sending your video").font(Brand.display(40)).kerning(-1.2).foregroundStyle(Brand.ink)
        ProgressView(value: fraction).tint(Brand.mintLine).scaleEffect(x: 1, y: 2.4, anchor: .center).padding(.vertical, 8)
        Text(fraction > 0 ? "\(Int((fraction * 100).rounded()))%" : "Getting it ready…").font(Brand.mono(17)).foregroundStyle(Brand.inkMuted)
        Text("You can lock your phone. It keeps sending.").font(Brand.body(17)).foregroundStyle(Brand.inkMuted)
        Spacer()
      }
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Brand.bg.ignoresSafeArea())
  }

  private var fraction: Double {
    if case .sending(let f) = uploader.state { return f }
    return 0
  }
}
