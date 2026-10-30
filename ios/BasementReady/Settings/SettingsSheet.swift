// Where takes go: this Mac while testing, the live site, or any address typed in.
import SwiftUI

struct SettingsSheet: View {
  @Environment(\.dismiss) private var dismiss
  @State private var current = ServerSettings.current
  @State private var typed = ServerSettings.current.absoluteString
  @State private var invalid = false

  var body: some View {
    NavigationStack {
      Form {
        Section {
          ForEach(ServerSettings.options) { option in
            Button {
              choose(option.url)
            } label: {
              HStack {
                VStack(alignment: .leading, spacing: 2) {
                  Text(option.name).font(Brand.body(17, .semibold)).foregroundStyle(Brand.ink)
                  Text(option.url.absoluteString).font(Brand.mono(13)).foregroundStyle(Brand.inkMuted)
                }
                Spacer()
                if current == option.url { Image(systemName: "checkmark").foregroundStyle(Brand.accentText) }
              }
            }
          }
        } header: { Text("Server") }

        Section {
          TextField("https://10.0.0.5:5173", text: $typed)
            .font(Brand.mono(15))
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .onSubmit(useTyped)
          Button("Use this address", action: useTyped)
          if invalid { Text("That isn't a web address.").foregroundStyle(Brand.stop) }
        } header: { Text("Another address") } footer: {
          Text("On the Mac, run `pnpm dev:phone`. Your phone and Mac need the same Wi-Fi.")
        }
      }
      .navigationTitle("Settings")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
  }

  private func choose(_ url: URL) {
    current = url
    typed = url.absoluteString
    ServerSettings.current = url
    invalid = false
  }

  private func useTyped() {
    guard let url = ServerSettings.parse(typed) else {
      invalid = true
      return
    }
    choose(url)
  }
}
