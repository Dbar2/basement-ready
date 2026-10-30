// Before filming: the address and who it's for. Nothing else.
import SwiftUI

struct StartView: View {
  let onStart: (StartAnswers) -> Void
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
        VStack(alignment: .leading, spacing: 28) {
          HStack(alignment: .top) {
            Text("Could your basement be a home?")
              .font(Brand.display(40))
              .kerning(-1.2)
              .lineSpacing(-4)
              .foregroundStyle(Brand.ink)
              .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 12)
            Button { showSettings = true } label: {
              Image(systemName: "gearshape").font(.system(size: 20, weight: .semibold)).foregroundStyle(Brand.inkMuted).frame(width: 44, height: 44)
            }
            .accessibilityLabel("Settings")
          }

          VStack(alignment: .leading, spacing: 10) {
            Text("Your address").font(Brand.body(17, .semibold)).foregroundStyle(Brand.ink)
            addressField
            if typing && picked == nil {
              suggestions
            }
          }

          VStack(alignment: .leading, spacing: 10) {
            Text("Who's it for?").font(Brand.body(17, .semibold)).foregroundStyle(Brand.ink)
            ForEach(WhoFor.allCases) { option in
              Button {
                who = option
                missingWho = false
              } label: {
                HStack {
                  Text(option.label).font(Brand.body(17, who == option ? .semibold : .regular))
                  Spacer()
                  if who == option { Image(systemName: "checkmark").font(.system(size: 15, weight: .bold)) }
                }
                .foregroundStyle(Brand.ink)
                .padding(.horizontal, 18)
                .frame(minHeight: 54)
                .background(who == option ? Brand.mint : Brand.card, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(who == option ? Color.clear : Brand.border))
              }
              .accessibilityAddTraits(who == option ? .isSelected : [])
            }
            if missingWho {
              Text("Pick one. Not sure is fine.").font(Brand.body(15, .medium)).foregroundStyle(Brand.stop)
            }
          }
          .id("who")

          VStack(spacing: 12) {
            Button {
              guard let who else {
                missingWho = true
                withAnimation { scroll.scrollTo("who", anchor: .center) }
                return
              }
              onStart(StartAnswers(address: picked, who: who))
            } label: { Text("Start filming") }
              .buttonStyle(MintButton(enabled: who != nil))
            Text("Start at the top of the stairs. Walk slowly along every wall. Up to 5 minutes.")
              .font(Brand.body(15))
              .foregroundStyle(Brand.inkMuted)
              .multilineTextAlignment(.center)
              .frame(maxWidth: .infinity)
          }
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 32)
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
    .padding(.horizontal, 16)
    .frame(minHeight: 54)
    .background(Brand.card, in: RoundedRectangle(cornerRadius: 14))
    .overlay(RoundedRectangle(cornerRadius: 14).stroke(picked != nil ? Brand.mintLine : Brand.border, lineWidth: picked != nil ? 2 : 1))
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
          if hit != search.results.last { Divider().overlay(Brand.border) }
        }
      }
      .background(Brand.card, in: RoundedRectangle(cornerRadius: 14))
      .overlay(RoundedRectangle(cornerRadius: 14).stroke(Brand.border))
    } else if text.count >= 2 {
      Text("No match in Waterloo Region yet. Keep typing, or skip it.").font(Brand.body(15)).foregroundStyle(Brand.inkMuted)
    }
  }
}
