import CoreImage
import ImageIO
import XCTest
@testable import BasementReady

final class LiveFindsTests: XCTestCase {
  // The frame sent to SAM: upright like the web's, 768 px on the long side, small enough for the server.
  func testUprightSmallJPEG() throws {
    var buffer: CVPixelBuffer?
    CVPixelBufferCreate(nil, 1920, 1440, kCVPixelFormatType_32BGRA, [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &buffer)
    let base = CIImage(color: CIColor(red: 0.1, green: 0.2, blue: 0.15)).cropped(to: CGRect(x: 0, y: 0, width: 1920, height: 1440))
    let mark = CIImage(color: .white).cropped(to: CGRect(x: 0, y: 1140, width: 300, height: 300)) // sensor top-left
    CIContext().render(mark.composited(over: base), to: try XCTUnwrap(buffer))

    let jpeg = try XCTUnwrap(ImageSampler.jpeg(try XCTUnwrap(buffer), rotationCW: 90, context: CIContext()))
    XCTAssertLessThan(jpeg.count, 400 * 1024)
    let source = try XCTUnwrap(CGImageSourceCreateWithData(jpeg as CFData, nil))
    let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
    XCTAssertEqual(image.width, 576)
    XCTAssertEqual(image.height, 768)
    // Upright, the sensor's top-left corner is top-right.
    let ci = CIImage(cgImage: image)
    func brightness(_ x: CGFloat, _ yFromTop: CGFloat) -> CGFloat {
      var px = [UInt8](repeating: 0, count: 4)
      CIContext().render(ci, toBitmap: &px, rowBytes: 4, bounds: CGRect(x: x, y: CGFloat(image.height) - yFromTop - 1, width: 1, height: 1), format: .RGBA8, colorSpace: nil)
      return CGFloat(px[0]) / 255
    }
    XCTAssertGreaterThan(brightness(560, 20), 0.9)
    XCTAssertLessThan(brightness(20, 20), 0.3)
  }

  @MainActor
  func testConceptsRotateAndStayUnderThree() {
    let live = LiveFinds()
    let first = live.plan(), second = live.plan()
    XCTAssertEqual(first, ["door", "stairs", "window"])
    XCTAssertEqual(second.first, "door")
    XCTAssertLessThanOrEqual(second.count, 3)
    XCTAssertEqual(LiveFinds.checklist.filter { !["stairs", "window", "furnace", "panel", "door", "duct", "beam"].contains($0) }, [], "keys server/live.ts knows")
  }
}
