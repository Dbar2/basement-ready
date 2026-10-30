// Fresh Air (brand/tokens.css): forest ink, mint as a fill only, find colours always with a label.
// The web uses Hanken Grotesk and Geist Mono; the app uses the system's own heavy sans and mono.
import SwiftUI

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
  static let mint = Color(hex: 0x4BE38A) // fill only on light; lines are fine on the dark map
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

  static func display(_ size: CGFloat) -> Font { .system(size: size, weight: .heavy) }
  static func body(_ size: CGFloat = 17, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight) }
  static func mono(_ size: CGFloat = 15, _ weight: Font.Weight = .medium) -> Font { .system(size: size, weight: weight, design: .monospaced) }
}

// The primary button: mint fill, forest text.
struct MintButton: ButtonStyle {
  var enabled = true
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(Brand.body(18, .semibold))
      .foregroundStyle(Brand.ink)
      .frame(maxWidth: .infinity, minHeight: 56)
      .background(Brand.mint.opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.45), in: Capsule())
  }
}

// The quiet button: forest outline on light, light outline on dark.
struct OutlineButton: ButtonStyle {
  var onDark = false
  func makeBody(configuration: Configuration) -> some View {
    let tint = onDark ? Brand.bg : Brand.ink
    configuration.label
      .font(Brand.body(17, .semibold))
      .foregroundStyle(tint)
      .frame(maxWidth: .infinity, minHeight: 52)
      .overlay(Capsule().stroke(tint.opacity(configuration.isPressed ? 0.5 : 0.9), lineWidth: 1.5))
      .contentShape(Capsule())
  }
}
