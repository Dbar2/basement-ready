// multipart/form-data bodies, the shape Hono's parseBody reads. Small ones are built in memory; the
// take is streamed into a file, since a background upload has to come from a file and the video can
// be a couple of hundred megabytes.
import Foundation

struct Multipart {
  enum Part {
    case field(name: String, value: String)
    case data(name: String, filename: String, type: String, data: Data)
    case file(name: String, filename: String, type: String, url: URL)
  }

  let boundary: String
  var parts: [Part] = []

  init(boundary: String = "BasementReady-" + UUID().uuidString) {
    self.boundary = boundary
  }

  var contentType: String { "multipart/form-data; boundary=\(boundary)" }

  mutating func add(_ name: String, _ value: String) { parts.append(.field(name: name, value: value)) }
  mutating func add(_ name: String, filename: String, type: String, data: Data) { parts.append(.data(name: name, filename: filename, type: type, data: data)) }
  mutating func add(_ name: String, filename: String, type: String, file: URL) { parts.append(.file(name: name, filename: filename, type: type, url: file)) }

  private func header(_ part: Part) -> Data {
    var h = "--\(boundary)\r\n"
    switch part {
    case .field(let name, _):
      h += "Content-Disposition: form-data; name=\"\(Self.quoted(name))\"\r\n\r\n"
    case .data(let name, let filename, let type, _), .file(let name, let filename, let type, _):
      h += "Content-Disposition: form-data; name=\"\(Self.quoted(name))\"; filename=\"\(Self.quoted(filename))\"\r\nContent-Type: \(type)\r\n\r\n"
    }
    return Data(h.utf8)
  }

  private var closing: Data { Data("--\(boundary)--\r\n".utf8) }

  static func quoted(_ s: String) -> String {
    s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "%22").replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ")
  }

  // The whole body in memory: for small requests (a live frame).
  func data() throws -> Data {
    var out = Data()
    for part in parts {
      out.append(header(part))
      switch part {
      case .field(_, let value): out.append(Data(value.utf8))
      case .data(_, _, _, let data): out.append(data)
      case .file(_, _, _, let url): out.append(try Data(contentsOf: url, options: .mappedIfSafe))
      }
      out.append(Data("\r\n".utf8))
    }
    out.append(closing)
    return out
  }

  // The body streamed into a file, a megabyte at a time. Returns its size in bytes.
  @discardableResult
  func write(to dest: URL) throws -> Int64 {
    FileManager.default.createFile(atPath: dest.path, contents: nil)
    let out = try FileHandle(forWritingTo: dest)
    defer { try? out.close() }
    var size: Int64 = 0
    func put(_ d: Data) throws {
      try out.write(contentsOf: d)
      size += Int64(d.count)
    }
    for part in parts {
      try put(header(part))
      switch part {
      case .field(_, let value): try put(Data(value.utf8))
      case .data(_, _, _, let data): try put(data)
      case .file(_, _, _, let url):
        let input = try FileHandle(forReadingFrom: url)
        defer { try? input.close() }
        while let chunk = try input.read(upToCount: 1 << 20), !chunk.isEmpty { try put(chunk) }
      }
      try put(Data("\r\n".utf8))
    }
    try put(closing)
    return size
  }
}
