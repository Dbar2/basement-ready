// Before filming: the address and who it's for. Nothing else. The last take this phone sent opens again
// from here.
import SwiftUI

struct StartView: View {
  let onStart: (StartAnswers) -> Void
  var onOpenLast: (ScanCreated) -> Void = { _ in }
  @State private var last = ScanCreated.last
  @StateObject private var search = AddressSearch()
  @State private var text = ""
  @State private var picked: AddressHit?
  @State private var who: WhoFor?
  @State private var showSettings = false
  @State private var missingWho = false
  @FocusState private var typing: Bool

  var body: some View {
    ScrollViewReader { scroll in
      ScrollView {
        VStack(alignment: .leading, spacing: Space.s4) {
          HStack(alignment: .top) {
            Text("Could your basement be a home?")
              .display(34)
              .foregroundStyle(Brand.ink)
              .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: Space.s3)
            Button { showSettings = true } label: {
              Image(systemName: "gearshape").font(.system(size: 20, weight: .regular)).foregroundStyle(Brand.ink).frame(width: 44, height: 44)
            }
            .accessibilityLabel("Settings")
          }
          Rectangle().fill(Brand.ink).frame(height: 1)

          VStack(alignment: .leading, spacing: Space.s2) {
            Text("Your address").font(Brand.body(17, .semibold)).foregroundStyle(Brand.ink)
            addressField
            if typing && picked == nil {
              suggestions
            }
          }

          VStack(alignment: .leading, spacing: Space.s2) {
            Text("Who's it for?").font(Brand.body(17, .semibold)).foregroundStyle(Brand.ink)
            ForEach(WhoFor.allCases) { option in
              Button {
                who = option
                missingWho = false
              } label: {
                HStack {
                  Text(option.label)
                  Spacer()
                  if who == option { Image(systemName: "checkmark").font(.system(size: 15, weight: .bold)) }
                }
                .padding(.horizontal, Space.s3)
              }
              .buttonStyle(ChoiceButton(picked: who == option))
              .accessibilityAddTraits(who == option ? .isSelected : [])
            }
            if missingWho {
              Text("Pick one. Not sure is fine.").font(Brand.body(15, .medium)).foregroundStyle(Brand.stop)
            }
          }
          .id("who")

          VStack(spacing: Space.s2) {
            Button {
              guard let who else {
                missingWho = true
                withAnimation { scroll.scrollTo("who", anchor: .center) }
                return
              }
              onStart(StartAnswers(address: picked, who: who))
            } label: { Text("Start filming") }
              .buttonStyle(PrimaryButton(enabled: who != nil))
            Text("Start at the stairs. Sweep each wall slowly, and pan into rooms from the door. Up to 5 minutes.")
              .font(Brand.body(15))
              .foregroundStyle(Brand.inkMuted)
              .multilineTextAlignment(.center)
              .frame(maxWidth: .infinity)
            HStack(spacing: Space.s4) {
              Button("How to film") { IntroFlow.shared.openGuide() }
                .buttonStyle(TextLink())
                .accessibilityHint("Four short tips before you start")
              if let last, last.resultURL != nil {
                Button("Your last scan") { onOpenLast(last) }
                  .buttonStyle(TextLink())
                  .accessibilityHint("Opens the answer for the last basement you sent")
              }
            }
            .frame(maxWidth: .infinity)
          }
        }
        .padding(.horizontal, Space.s3)
        .padding(.top, Space.s3)
        .padding(.bottom, Space.s5)
      }
      .scrollDismissesKeyboard(.interactively)
    }
    .background(Brand.bg.ignoresSafeArea())
    .sheet(isPresented: $showSettings) { SettingsSheet() }
  }

  private var addressField: some View {
    HStack(spacing: 10) {
      Image(systemName: "magnifyingglass").foregroundStyle(Brand.inkMuted)
      TextField("Start typing, e.g. 100 King St", text: $text)
        .font(Brand.body(17))
        .foregroundStyle(Brand.ink)
        .textContentType(.fullStreetAddress)
        .autocorrectionDisabled()
        .submitLabel(.done)
        .focused($typing)
        .onChange(of: text) { _, value in
          if let p = picked, value != "\(p.address), \(p.municipality)" { picked = nil }
          if picked == nil { search.search(value) }
        }
      if !text.isEmpty {
        Button {
          text = ""
          picked = nil
          search.search("")
        } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Brand.inkMuted) }
          .accessibilityLabel("Clear address")
      }
    }
    .padding(.horizontal, Space.s3)
    .frame(minHeight: 52)
    .background(Brand.card, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: Radius.small, style: .continuous).stroke(picked != nil ? Brand.ink : Brand.border, lineWidth: picked != nil ? 1.5 : 1))
  }

  @ViewBuilder private var suggestions: some View {
    if search.failed {
      Text("Can't reach the server. Check the address in Settings.").font(Brand.body(15)).foregroundStyle(Brand.stop)
    } else if !search.results.isEmpty {
      VStack(spacing: 0) {
        ForEach(search.results, id: \.self) { hit in
          Button {
            picked = hit
            text = "\(hit.address), \(hit.municipality)"
            typing = false
          } label: {
            HStack {
              Text(hit.address).font(Brand.body(17, .semibold))
              Text(hit.municipality).font(Brand.body(15)).foregroundStyle(Brand.inkMuted)
              Spacer()
            }
            .foregroundStyle(Brand.ink)
            .padding(.horizontal, 16)
            .frame(minHeight: 48)
            .contentShape(Rectangle())
          }
          if hit != search.results.last { Rectangle().fill(Brand.border).frame(height: 1) }
        }
      }
      .background(Brand.card, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: Radius.small, style: .continuous).stroke(Brand.ink, lineWidth: 1))
    } else if text.count >= 2 {
      Text("No match in Waterloo Region yet. Keep typing, or skip it.").font(Brand.body(15)).foregroundStyle(Brand.inkMuted)
    }
  }
}
