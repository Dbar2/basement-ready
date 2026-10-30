// How to film, in four pages: each a small drawing of the live map that moves, a title and one line.
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
      TabView(selection: $page) {
        ForEach(pages) { p in
          GuidePageView(page: p, count: pages.count, playing: playing && p.id == page, freezeAt: freezeAt)
            .tag(p.id)
        }
      }
      .tabViewStyle(.page(indexDisplayMode: .never))

      VStack(spacing: 18) {
        PageDots(count: pages.count, page: $page)
        Button(isLast ? "Got it" : "Next") { next() }
          .buttonStyle(PrimaryButton())
          .accessibilityHint(isLast ? "Closes the guide" : "")
      }
      .padding(.horizontal, 20)
      .padding(.top, 10)
      .padding(.bottom, 12)
    }
    .background(Brand.bg.ignoresSafeArea())
    .environment(\.colorScheme, .light)
    .accessibilityAddTraits(.isModal)
  }

  private var topBar: some View {
    HStack(spacing: 10) {
      BrandMark()
        .fill(Brand.ink, style: FillStyle(eoFill: true))
        .frame(width: 20, height: 24)
        .accessibilityHidden(true)
      Text("How to film")
        .font(Brand.body(16, .semibold))
        .foregroundStyle(Brand.ink)
        .accessibilityAddTraits(.isHeader)
      Spacer()
      Button("Skip") { onDone() }
        .font(Brand.body(17, .semibold))
        .foregroundStyle(Brand.ink)
        .padding(.horizontal, 12)
        .frame(minWidth: 44, minHeight: 44)
        .contentShape(Rectangle())
        .opacity(isLast ? 0 : 1)
        .disabled(isLast)
        .accessibilityHidden(isLast)
        .accessibilityHint("Closes the guide")
    }
    .padding(.leading, 20)
    .padding(.trailing, 8)
    .frame(height: 52)
    .animation(.easeOut(duration: 0.2), value: isLast)
  }

  private func next() {
    guard !isLast else { return onDone() }
    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.35)) { page += 1 }
  }
}

private struct GuidePageView: View {
  let page: GuidePage
  let count: Int
  let playing: Bool
  let freezeAt: Double?

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      // As big as fits, up to a little taller than wide; any height left over goes under the words.
      GuideVisual(kind: page.visual, playing: playing, freezeAt: freezeAt)
        .background(Brand.ink, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .aspectRatio(0.9, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .layoutPriority(1)
      Text("\(page.id + 1) of \(count)")
        .font(Brand.mono(13))
        .foregroundStyle(Brand.accentText)
        .padding(.top, 26)
        .accessibilityHidden(true)
      Text(page.title)
        .font(Brand.display(32))
        .kerning(-0.9)
        .foregroundStyle(Brand.ink)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 8)
        .accessibilityAddTraits(.isHeader)
      Text(page.line)
        .font(Brand.body(17))
        .foregroundStyle(Brand.inkMuted)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 10)
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 20)
    .padding(.top, 4)
    .padding(.bottom, 8)
  }
}

/// Which page this is: a dot for each, the current one long.
private struct PageDots: View {
  let count: Int
  @Binding var page: Int

  var body: some View {
    HStack(spacing: 6) {
      ForEach(0..<count, id: \.self) { i in
        Capsule()
          .fill(i == page ? Brand.ink : Brand.ink.opacity(0.18))
          .frame(width: i == page ? 22 : 8, height: 8)
      }
    }
    .animation(.easeOut(duration: 0.25), value: page)
    .accessibilityElement()
    .accessibilityLabel("Page \(page + 1) of \(count)")
    .accessibilityAdjustableAction { direction in
      switch direction {
      case .increment: if page < count - 1 { page += 1 }
      case .decrement: if page > 0 { page -= 1 }
      @unknown default: break
      }
    }
  }
}
