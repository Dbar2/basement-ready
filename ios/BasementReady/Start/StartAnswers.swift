// The two things asked before filming: the address, and who the suite is for (rent folded in).
import Foundation

struct AddressHit: Codable, Hashable, Sendable {
  let address: String
  let municipality: String
  let city: String? // our rules pack, e.g. "waterloo-on"; null for the townships
  let lon: Double
  let lat: Double
  let units: Int
}

enum WhoFor: String, CaseIterable, Identifiable, Codable, Sendable {
  case family, affordable, market, unsure
  var id: String { rawValue }

  var label: String {
    switch self {
    case .family: "Family, no rent"
    case .affordable: "Rental, about $1,200/mo or less"
    case .market: "Rental at market rent"
    case .unsure: "Not sure"
    }
  }

  // The server's household (relative | renter | unsure).
  var household: String {
    switch self {
    case .family: "relative"
    case .affordable, .market: "renter"
    case .unsure: "unsure"
    }
  }

  // The money question "rent" (server/eligibility.ts): "none", a monthly amount, or "market".
  var rent: RentAnswer? {
    switch self {
    case .family: .noRent
    case .affordable: .amount(1200)
    case .market: .market
    case .unsure: nil
    }
  }
}

enum RentAnswer: Equatable, Sendable {
  case noRent, market, amount(Int)
  var formValue: String {
    switch self {
    case .noRent: "none"
    case .market: "market"
    case .amount(let n): String(n)
    }
  }
  var jsonValue: Any {
    switch self {
    case .noRent: "none"
    case .market: "market"
    case .amount(let n): n
    }
  }
}

struct StartAnswers: Sendable, Codable {
  var address: AddressHit?
  var who: WhoFor

  // The same fields the web start sheet sends (src/screens/Start.tsx).
  var formFields: [(String, String)] {
    var f: [(String, String)] = [("household", who.household)]
    if let a = address {
      f += [("address", a.address), ("addressMunicipality", a.municipality), ("municipality", a.city ?? "other-on")]
    } else {
      f += [("address", ""), ("municipality", "other-on")]
    }
    if let rent = who.rent { f.append(("rent", rent.formValue)) }
    return f
  }
}

@MainActor
final class AddressSearch: ObservableObject {
  @Published var results: [AddressHit] = []
  @Published var failed = false
  private var task: Task<Void, Never>?

  func search(_ text: String) {
    task?.cancel()
    let q = text.trimmingCharacters(in: .whitespaces)
    guard q.count >= 2 else {
      results = []
      return
    }
    task = Task {
      try? await Task.sleep(for: .milliseconds(180))
      guard !Task.isCancelled else { return }
      var url = URLComponents(url: ServerSettings.current.appending(path: "api/address"), resolvingAgainstBaseURL: false)!
      url.queryItems = [URLQueryItem(name: "q", value: String(q.prefix(80)))]
      do {
        let (data, _) = try await Net.session.data(from: url.url!)
        struct Body: Decodable { let results: [AddressHit] }
        let hits = try JSONDecoder().decode(Body.self, from: data).results
        guard !Task.isCancelled else { return }
        results = hits
        failed = false
      } catch {
        if !Task.isCancelled { failed = true }
      }
    }
  }
}
