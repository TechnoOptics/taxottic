//  TaxotticComplication.swift
//  Watch-face jewelry: a gold-gauge circular complication, a rich
//  rectangular one, and an inline line. WidgetKit (watchOS 9+).
//  Reads the App Group the watch app mirrors on every sync.

import WidgetKit
import SwiftUI

private let appGroup = "group.com.taxottic.app"

struct TaxotticEntry: TimelineEntry {
    let date: Date
    let ytdDeductionCents: Int
    let taxReadinessPct: Int
}

struct TaxotticProvider: TimelineProvider {
    func placeholder(in _: Context) -> TaxotticEntry {
        TaxotticEntry(date: .now, ytdDeductionCents: 124_300, taxReadinessPct: 78)
    }
    func getSnapshot(in _: Context, completion: @escaping (TaxotticEntry) -> Void) {
        completion(current())
    }
    func getTimeline(in _: Context, completion: @escaping (Timeline<TaxotticEntry>) -> Void) {
        completion(Timeline(entries: [current()], policy: .never))
    }
    private func current() -> TaxotticEntry {
        let d = UserDefaults(suiteName: appGroup)
        return TaxotticEntry(
            date: .now,
            ytdDeductionCents: d?.integer(forKey: "ytdDeductionCents") ?? 0,
            taxReadinessPct: d?.integer(forKey: "taxReadinessPct") ?? 0
        )
    }
}

struct TaxotticComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TaxotticEntry

    private var dollars: String {
        (Double(entry.ytdDeductionCents) / 100)
            .formatted(.currency(code: "USD").precision(.fractionLength(0)))
    }
    private var goldSheen: LinearGradient {
        LinearGradient(colors: [Color(hex: 0xC4A25D), Color(hex: 0xF2D896), Color(hex: 0xD5BB7E)],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    var body: some View {
        switch family {
        case .accessoryCircular:
            Gauge(value: Double(entry.taxReadinessPct), in: 0...100) {
                Image(systemName: "car.fill")
            } currentValueLabel: {
                Text("\(entry.taxReadinessPct)")
                    .font(.system(.caption, design: .rounded)).bold()
            }
            .gaugeStyle(.accessoryCircular)
            .tint(goldSheen)

        case .accessoryInline:
            Label("\(dollars) deductions · \(entry.taxReadinessPct)% ready",
                  systemImage: "sparkles")

        case .accessoryCorner:
            Text(dollars)
                .font(.system(.caption, design: .rounded)).bold()
                .widgetLabel {
                    Gauge(value: Double(entry.taxReadinessPct), in: 0...100) {
                        Text("ready")
                    }
                    .tint(goldSheen)
                }

        default: // .accessoryRectangular
            HStack(spacing: 8) {
                Gauge(value: Double(entry.taxReadinessPct), in: 0...100) {
                    Image(systemName: "car.fill")
                }
                .gaugeStyle(.accessoryCircularCapacity)
                .tint(goldSheen)
                .scaleEffect(0.9)
                VStack(alignment: .leading, spacing: 1) {
                    Text("YTD deduction")
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(.secondary)
                    Text(dollars)
                        .font(.system(.headline, design: .rounded))
                        .minimumScaleFactor(0.7)
                }
            }
        }
    }
}

@main
struct TaxotticComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TaxotticComplication", provider: TaxotticProvider()) { entry in
            TaxotticComplicationView(entry: entry)
        }
        .configurationDisplayName("Taxottic")
        .description("Tax-readiness and your year-to-date deduction.")
        .supportedFamilies([
            .accessoryCircular, .accessoryInline,
            .accessoryCorner, .accessoryRectangular,
        ])
    }
}
