import WidgetKit
import SwiftUI

// Shared container the app writes the forecast snapshot into.
private let appGroup = "group.com.taxottic.app"
private let snapshotKey = "snapshot"
private let tsKey = "ts"

// Brand palette (matches the app header + Android widget).
private let navyTop = Color(red: 0x1D / 255, green: 0x28 / 255, blue: 0x43 / 255)
private let navyBottom = Color(red: 0x12 / 255, green: 0x1A / 255, blue: 0x2A / 255)
private let gold = Color(red: 0xC4 / 255, green: 0xA2 / 255, blue: 0x5D / 255)
private let goldBright = Color(red: 0xF2 / 255, green: 0xD8 / 255, blue: 0x96 / 255)
private let cream = Color(red: 0xF2 / 255, green: 0xF7 / 255, blue: 0xE9 / 255)
private let muted = Color(red: 0x8A / 255, green: 0x93 / 255, blue: 0xA6 / 255)
private let soft = Color(red: 0xC7 / 255, green: 0xCE / 255, blue: 0xDA / 255)

struct ForecastEntry: TimelineEntry {
    let date: Date
    let hasForecast: Bool
    let hero: String
    let caption: String
    let label: String
    let stat1: String
    let stat2: String
    let updated: String
}

private func formatMoney(_ cents: Int) -> String {
    let dollars = Int((Double(abs(cents)) / 100.0).rounded())
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.groupingSeparator = ","
    let n = f.string(from: NSNumber(value: dollars)) ?? "\(dollars)"
    return "$\(n)"
}

private func relTime(_ ts: Double) -> String {
    if ts <= 0 { return "" }
    let mins = Int((Date().timeIntervalSince1970 - ts) / 60.0)
    if mins < 1 { return "Updated just now" }
    if mins < 60 { return "Updated \(mins)m ago" }
    let hrs = mins / 60
    if hrs < 24 { return "Updated \(hrs)h ago" }
    return "Updated \(hrs / 24)d ago"
}

private func readEntry() -> ForecastEntry {
    let defaults = UserDefaults(suiteName: appGroup)
    let ts = defaults?.double(forKey: tsKey) ?? 0
    guard
        let json = defaults?.string(forKey: snapshotKey),
        let data = json.data(using: .utf8),
        let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else {
        return emptyEntry()
    }

    if let f = root["forecast"] as? [String: Any] {
        let net = (f["netCents"] as? NSNumber)?.intValue ?? 0
        let rate = (f["effectiveRatePct"] as? NSNumber)?.intValue ?? 0
        let label = (f["label"] as? String) ?? "Projected estimate"
        let owe = net >= 0
        let ytdDed = (root["ytdDeductionCents"] as? NSNumber)?.intValue ?? 0
        let outstanding = (root["outstandingCount"] as? NSNumber)?.intValue ?? 0
        return ForecastEntry(
            date: Date(),
            hasForecast: true,
            hero: formatMoney(net),
            caption: (owe ? "Projected tax owed" : "Projected refund") + " · \(rate)% rate",
            label: label,
            stat1: "\(formatMoney(ytdDed)) deductions",
            stat2: outstanding > 0 ? "\(outstanding) to review" : "All caught up",
            updated: relTime(ts)
        )
    }
    return emptyEntry()
}

private func emptyEntry() -> ForecastEntry {
    ForecastEntry(
        date: Date(), hasForecast: false,
        hero: "Taxottic", caption: "Your tax forecast", label: "",
        stat1: "", stat2: "", updated: ""
    )
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> ForecastEntry {
        ForecastEntry(
            date: Date(), hasForecast: true,
            hero: "$12,480", caption: "Projected tax owed · 21% rate",
            label: "2026 projected estimate",
            stat1: "$3,200 deductions", stat2: "2 to review",
            updated: "Updated just now"
        )
    }
    func getSnapshot(in context: Context, completion: @escaping (ForecastEntry) -> Void) {
        completion(readEntry())
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<ForecastEntry>) -> Void) {
        // The data only changes when the app pushes a new snapshot; we
        // refresh a few times a day so the "Updated …" stamp keeps aging.
        let next = Calendar.current.date(byAdding: .hour, value: 6, to: Date())
            ?? Date().addingTimeInterval(21_600)
        completion(Timeline(entries: [readEntry()], policy: .after(next)))
    }
}

struct TaxotticWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    var entry: ForecastEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("TAXOTTIC")
                    .font(.system(size: 11, weight: .bold))
                    .tracking(2)
                    .foregroundColor(gold)
                Spacer()
                if !entry.updated.isEmpty {
                    Text(entry.updated)
                        .font(.system(size: 9))
                        .foregroundColor(muted)
                }
            }

            Spacer(minLength: 6)

            Text(entry.hero)
                .font(.system(size: family == .systemSmall ? 26 : 32, weight: .bold))
                .foregroundColor(goldBright)
                .minimumScaleFactor(0.6)
                .lineLimit(1)

            Text(entry.caption)
                .font(.system(size: 12))
                .foregroundColor(soft)
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            if entry.hasForecast && !entry.label.isEmpty {
                Text(entry.label)
                    .font(.system(size: 11))
                    .foregroundColor(muted)
                    .lineLimit(1)
            }
            if !entry.hasForecast {
                Text("Open Taxottic to see your forecast")
                    .font(.system(size: 12))
                    .foregroundColor(soft)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 6)

            if entry.hasForecast && family != .systemSmall {
                HStack {
                    Text(entry.stat1)
                        .font(.system(size: 11))
                        .foregroundColor(cream)
                    Spacer()
                    Text(entry.stat2)
                        .font(.system(size: 11))
                        .foregroundColor(cream)
                }
            } else if entry.hasForecast {
                // Small: one stat only, to avoid crowding.
                Text(entry.stat2)
                    .font(.system(size: 11))
                    .foregroundColor(cream)
                    .lineLimit(1)
            }
        }
        .padding(16)
        .containerBackground(for: .widget) {
            LinearGradient(
                colors: [navyTop, navyBottom],
                startPoint: .top, endPoint: .bottom
            )
        }
    }
}

struct TaxotticWidget: Widget {
    let kind = "TaxotticForecastWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            TaxotticWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Taxottic Forecast")
        .description("Your projected tax, effective rate, and deductions at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct TaxotticWidgetBundle: WidgetBundle {
    var body: some Widget {
        TaxotticWidget()
    }
}
