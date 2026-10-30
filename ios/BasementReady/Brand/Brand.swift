// Drawing Set (brand/ui.md): every screen is a sheet of an architect's drawing set. Forest ink on a
// light sheet, hairlines instead of cards, one mint rectangle button per screen, mint as a fill only.
// Type is Hanken Grotesk and Geist Mono (mono only for figures: 2.10 m, Wall 2 of 4, 0:42); until
// their font files are in the app, the system's own sans and mono stand in.
import SwiftUI
import UIKit

extension Color {
  init(hex: UInt32, opacity: Double = 1) {
    self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255, opacity: opacity)
  }
}

enum Brand {
  static let bg = Color(hex: 0xF4F6F2)
  static let card = Color(hex: 0xFBFCFA)
  static let surface = Color(hex: 0xE6EBE4)
  static let border = Color(hex: 0xD5DDD4)
  static let ink = Color(hex: 0x0F2A1E)
  static let inkMuted = Color(hex: 0x4A5D52)
  static let mint = Color(hex: 0x4BE38A) // fill only: the primary button, a picked state, scan points
  static let mintPress = Color(hex: 0x3FCF7B) // the primary button while pressed
  static let mintLine = Color(hex: 0x2E9A5C)
  static let accentText = Color(hex: 0x1F7A4A)
  static let stop = Color(hex: 0xB42318)
  static let fix = Color(hex: 0x8C6A00)

  // What the scan finds, keyed like the server's live concepts.
  static func find(_ key: String) -> Color {
    switch key {
    case "window": Color(hex: 0x2F6FDB)
    case "door": Color(hex: 0x0F8B8D)
    case "stairs": Color(hex: 0xB58A00)
    case "duct": Color(hex: 0x6B7A86)
    case "beam": Color(hex: 0x8A5A3C)
    default: Color(hex: 0xC2417A) // furnace, panel and the rest of the mechanical room
    }
  }

  static func display(_ size: CGFloat) -> Font { font(sans, size, .black) } // titles, 900
  static func heading(_ size: CGFloat) -> Font { font(sans, size, .heavy) } // 800
  static func body(_ size: CGFloat = 17, _ weight: Font.Weight = .regular) -> Font { font(sans, size, weight) }
  // Figures only: measurements, money, counts, times, step numbers. Never a sentence.
  static func mono(_ size: CGFloat = 15, _ weight: Font.Weight = .regular) -> Font { font(monoFamily, size, weight, design: .monospaced) }

  private static let sans = "Hanken Grotesk"
  private static let monoFamily = "Geist Mono"
  private static func font(_ family: String, _ size: CGFloat, _ weight: Font.Weight, design: Font.Design = .default) -> Font {
    available.contains(family) ? .custom(family, size: size).weight(weight) : .system(size: size, weight: weight, design: design)
  }
  private static let available = Set(UIFont.familyNames)
}

// Spacing and corners (brand/ui.md).
enum Space {
  static let s1: CGFloat = 4, s2: CGFloat = 8, s3: CGFloat = 16, s4: CGFloat = 24, s5: CGFloat = 40, s6: CGFloat = 64
}

enum Radius {
  static let small: CGFloat = 4 // photos, inputs, the map
  static let control: CGFloat = 6 // buttons, frames
}

extension Text {
  // A title: display weight, set tight.
  func display(_ size: CGFloat) -> Text { font(Brand.display(size)).kerning(-size * 0.045) }
  func heading(_ size: CGFloat) -> Text { font(Brand.heading(size)).kerning(-size * 0.03) }
}

// The one primary action on a screen: mint rectangle, forest text, 6 pt corners.
struct PrimaryButton: ButtonStyle {
  var enabled = true
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(Brand.body(18, .bold))
      .foregroundStyle(Brand.ink)
      .frame(maxWidth: .infinity, minHeight: 52)
      .background(enabled ? (configuration.isPressed ? Brand.mintPress : Brand.mint) : Brand.mint.opacity(0.45),
                  in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
      .contentShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
  }
}

// A choice (not the primary): a hairline rectangle; picked = ink fill, card text.
struct ChoiceButton: ButtonStyle {
  var picked = false
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(Brand.body(17, .semibold))
      .foregroundStyle(picked ? Brand.card : Brand.ink)
      .frame(maxWidth: .infinity, minHeight: 48)
      .background(picked ? Brand.ink : .clear, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: Radius.control, style: .continuous).stroke(Brand.ink, lineWidth: 1))
      .contentShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
      .opacity(configuration.isPressed ? 0.7 : 1)
  }
}

// A secondary action: underlined ink text, at least 44 pt tall to tap.
struct TextLink: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(Brand.body(17, .semibold))
      .foregroundStyle(Brand.ink)
      .underline(true, color: Brand.mintLine)
      .frame(minHeight: 44)
      .contentShape(Rectangle())
      .opacity(configuration.isPressed ? 0.6 : 1)
  }
}
