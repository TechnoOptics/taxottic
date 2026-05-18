//  ContentView.swift
//  Glanceable tax surface + the one-gesture trip classification the
//  business asked for ("after a trip, ask business or personal —
//  answer in one tap, no app open").

import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: WatchModel

    private var ytd: String {
        let dollars = Double(model.snapshot.ytdDeductionCents) / 100.0
        return dollars.formatted(.currency(code: "USD").precision(.fractionLength(0)))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                if let trip = model.snapshot.pendingTrip {
                    PendingTripCard(summary: trip.summary) { isBusiness in
                        model.classifyPendingTrip(business: isBusiness)
                    }
                }

                StatCard(
                    label: "YTD mileage deduction",
                    value: ytd,
                    systemImage: "car.fill"
                )

                if let due = model.snapshot.nextQuarterlyDueISO {
                    StatCard(
                        label: "Next quarterly estimate due",
                        value: friendlyDate(due),
                        systemImage: "calendar"
                    )
                }

                if model.snapshot == .empty {
                    Text("Open Taxottic on your iPhone to sync.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.top, 4)
                }
            }
            .padding(.horizontal, 4)
        }
        .navigationTitle("Taxottic")
    }

    private func friendlyDate(_ iso: String) -> String {
        let inFmt = DateFormatter()
        inFmt.dateFormat = "yyyy-MM-dd"
        guard let d = inFmt.date(from: iso) else { return iso }
        return d.formatted(.dateTime.month(.abbreviated).day())
    }
}

private struct PendingTripCard: View {
    let summary: String
    let onChoose: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Classify your drive")
                .font(.headline)
            Text(summary)
                .font(.caption2)
                .foregroundStyle(.secondary)
            HStack(spacing: 6) {
                Button("Business") { onChoose(true) }
                    .buttonStyle(.borderedProminent)
                Button("Personal") { onChoose(false) }
                    .buttonStyle(.bordered)
            }
            .font(.caption)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.green.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct StatCard: View {
    let label: String
    let value: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: systemImage)
                .foregroundStyle(.green)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.headline)
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.gray.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))
    }
}
