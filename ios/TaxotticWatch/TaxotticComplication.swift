//  TaxotticComplication.swift
//  WidgetKit accessory complication (watchOS 9+) — the glanceable
//  "YTD deduction" the spec calls for on the watch face.
//
//  WidgetKit (not legacy ClockKit) is the modern complication API.
//  The timeline is refreshed from the App Group the watch app writes
//  whenever it receives a new WatchSnapshot (see README → App Group).

import WidgetKit
import SwiftUI

private let appGroup = "group.com.taxottic.app"

struct TaxotticEntry: TimelineEntry {
    let date: Date
    let ytdDeductionCents: Int
}

struct TaxotticProvider: TimelineProvider {
    func placeholder(in context: Context) -> TaxotticEntry {
        TaxotticEntry(date: .now, ytdDeductionCents: 124_300)
    }

    func getSnapshot(in context: Context, completion: @escaping (TaxotticEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TaxotticEntry>) -> Void) {
        // Static until the watch app writes a new value + reloads
        // timelines (WidgetCenter.shared.reloadAllTimelines()).
        completion(Timeline(entries: [currentEntry()], policy: .never))
    }

    private func currentEntry() -> TaxotticEntry {
        let cents = UserDefaults(suiteName: appGroup)?
            .integer(forKey: "ytdDeductionCents") ?? 0
        return TaxotticEntry(date: .now, ytdDeductionCents: cents)
    }
}

struct TaxotticComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TaxotticEntry

    private var dollars: String {
        (Double(entry.ytdDeductionCents) / 100.0)
            .formatted(.currency(code: "USD").precision(.fractionLength(0)))
    }

    var body: some View {
        switch family {
        case .accessoryCircular:
            Gauge(value: 0) { Image(systemName: "car.fill") }
                .gaugeStyle(.accessoryCircularCapacity)
                .overlay(Text(dollars).font(.system(size: 11, weight: .semibold)))
        case .accessoryInline:
            Label("Taxottic \(dollars) YTD", systemImage: "car.fill")
        default: // .accessoryRectangular
            VStack(alignment: .leading) {
                Text("YTD mileage deduction").font(.caption2).foregroundStyle(.secondary)
                Text(dollars).font(.headline)
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
        .description("Your year-to-date mileage tax deduction.")
        .supportedFamilies([.accessoryCircular, .accessoryInline, .accessoryRectangular])
    }
}
