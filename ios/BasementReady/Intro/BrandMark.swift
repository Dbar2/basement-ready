// The Basement Ready mark, drawn from the same numbers as brand/logo/mark.svg: the B of Basement with a
// house cut out of its lower half and a door at its base. viewBox 0 0 100 120, even-odd fill.
import SwiftUI

enum MarkGeometry {
  static let viewBox = CGSize(width: 100, height: 120)

  /// The B: M0 0H56C76 0 90 13 90 30C90 42 84 50 76 55C90 60 98 72 98 87C98 106 84 120 62 120H0Z
  static var letter: Path {
    var p = Path()
    p.move(to: CGPoint(x: 0, y: 0))
    p.addLine(to: CGPoint(x: 56, y: 0))
    p.addCurve(to: CGPoint(x: 90, y: 30), control1: CGPoint(x: 76, y: 0), control2: CGPoint(x: 90, y: 13))
    p.addCurve(to: CGPoint(x: 76, y: 55), control1: CGPoint(x: 90, y: 42), control2: CGPoint(x: 84, y: 50))
    p.addCurve(to: CGPoint(x: 98, y: 87), control1: CGPoint(x: 90, y: 60), control2: CGPoint(x: 98, y: 72))
    p.addCurve(to: CGPoint(x: 62, y: 120), control1: CGPoint(x: 98, y: 106), control2: CGPoint(x: 84, y: 120))
    p.addLine(to: CGPoint(x: 0, y: 120))
    p.closeSubpath()
    return p
  }

  /// The house: M12 120V84L39 61L66 84V120Z
  static var house: Path {
    var p = Path()
    p.move(to: CGPoint(x: 12, y: 120))
    p.addLine(to: CGPoint(x: 12, y: 84))
    p.addLine(to: CGPoint(x: 39, y: 61))
    p.addLine(to: CGPoint(x: 66, y: 84))
    p.addLine(to: CGPoint(x: 66, y: 120))
    p.closeSubpath()
    return p
  }

  /// The door: rect x=31 y=92 w=16 h=28
  static var door: Path { Path(CGRect(x: 31, y: 92, width: 16, height: 28)) }

  /// All three as one path. Filled even-odd it's the B, less the house, plus the door, exactly like the SVG.
  static var mark: Path {
    var p = letter
    p.addPath(house)
    p.addPath(door)
    return p
  }

  /// Fits the 100 × 120 viewBox into a rect, centred, keeping its shape.
  static func fit(_ rect: CGRect) -> CGAffineTransform {
    let s = min(rect.width / viewBox.width, rect.height / viewBox.height)
    let x = rect.minX + (rect.width - viewBox.width * s) / 2
    let y = rect.minY + (rect.height - viewBox.height * s) / 2
    return CGAffineTransform(translationX: x, y: y).scaledBy(x: s, y: s)
  }
}

/// The mark as a Shape. Fill it even-odd: `BrandMark().fill(Brand.ink, style: FillStyle(eoFill: true))`.
struct BrandMark: Shape {
  func path(in rect: CGRect) -> Path {
    MarkGeometry.mark.applying(MarkGeometry.fit(rect))
  }
}
