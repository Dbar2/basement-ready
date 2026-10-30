// How to film, in four sheets: each a line drawing that strokes in once, a title and one sentence.
// It opens by itself on the first launch, and again from the start screen.
import SwiftUI

struct GuidePage: Identifiable {
  let id: Int
  let title: String
  let line: String
  let visual: GuideVisual.Kind
}

enum GuideContent {
  static let pages: [GuidePage] = [
    GuidePage(id: 0, title: "Start at the stairs", line: "Hold your phone upright and film on your way down.", visual: .stairs),
    GuidePage(id: 1, title: "Sweep each wall slowly", line: "Stay about 2 m back. Each wall fills in once it's filmed.", visual: .walls),
    GuidePage(id: 2, title: "No need to walk in", line: "For each room, stand in the doorway and pan slowly across it.", visual: .doorway),
    GuidePage(id: 3, title: "Missed a spot? It glows", line: "Point your phone back at it and it fills in.", visual: .missedSpot),
  ]
}

struct FilmingGuide: View {
  /// False while the launch animation is still on top: the drawings wait for it.
  var playing = true
  var freezeAt: Double?
  let onDone: () -> Void
  @State private var page: Int
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private let pages = GuideContent.pages
  private var isLast: Bool { page == pages.count - 1 }

  init(startPage: Int = 0, playing: Bool = true, freezeAt: Double? = nil, onDone: @escaping () -> Void) {
    self.playing = playing
    self.freezeAt = freezeAt
    self.onDone = onDone
    _page = State(initialValue: startPage)
  }

  var body: some View {
    VStack(spacing: 0) {
      topBar
      // The sheet's top edge.
      Rectangle()
        .fill(Brand.ink)
        .frame(height: 1)
        .padding(.horizontal, Space.s3)
      TabView(selection: $page) {
        ForEach(pages) { p in
          GuideSheet(page: p, playing: playing && p.id == page, freezeAt: freezeAt)
            .tag(p.id)
        }
      }
      .tabViewStyle(.page(indexDisplayMode: .never))
      Button(isLast ? "Got it" : "Next") { next() }
        .buttonStyle(PrimaryButton())
        .accessibilityHint(isLast ? "Closes the guide" : "")
        .padding(.horizontal, Space.s3)
        .padding(.top, Space.s2)
        .padding(.bottom, Space.s3)
    }
    .background(Brand.bg.ignoresSafeArea())
    .environment(\.colorScheme, .light)
    .accessibilityAddTraits(.isModal)
  }

  private var topBar: some View {
    HStack {
      Text("\(page + 1) / \(pages.count)")
        .font(Brand.mono(15))
        .foregroundStyle(Brand.ink)
        .frame(minHeight: 44)
        .accessibilityLabel("Page \(page + 1) of \(pages.count)")
        .accessibilityAdjustableAction { direction in
          switch direction {
          case .increment: if page < pages.count - 1 { page += 1 }
          case .decrement: if page > 0 { page -= 1 }
          @unknown default: break
          }
        }
      Spacer()
      Button { onDone() } label: {
        Text("Skip").padding(.horizontal, Space.s2)
      }
      .buttonStyle(TextLink())
      .padding(.trailing, -Space.s2) // the text lines up with the margin; the padding is only there to tap
      .opacity(isLast ? 0 : 1)
      .disabled(isLast)
      .accessibilityHidden(isLast)
      .accessibilityHint("Closes the guide")
    }
    .padding(.horizontal, Space.s3)
    .frame(height: 52)
    .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: isLast)
  }

  private func next() {
    guard !isLast else { return onDone() }
    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.35)) { page += 1 }
  }
}

/// One sheet: the drawing, a hairline, the title and one sentence.
private struct GuideSheet: View {
  let page: GuidePage
  let playing: Bool
  let freezeAt: Double?

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      GuideVisual(kind: page.visual, playing: playing, freezeAt: freezeAt)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      Rectangle()
        .fill(Brand.border)
        .frame(height: 1)
      VStack(alignment: .leading, spacing: Space.s2) {
        Text(page.title)
          .display(34)
          .foregroundStyle(Brand.ink)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityAddTraits(.isHeader)
        Text(page.line)
          .font(Brand.body(17))
          .foregroundStyle(Brand.ink)
          .fixedSize(horizontal: false, vertical: true)
      }
      // The same height on every sheet, so the drawing and the hairline don't jump between pages.
      .frame(maxWidth: .infinity, minHeight: 132, alignment: .topLeading)
      .padding(.top, Space.s4)
    }
    .padding(.horizontal, Space.s3)
    .padding(.bottom, Space.s3)
  }
}
