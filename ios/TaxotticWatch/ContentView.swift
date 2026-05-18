//  ContentView.swift
//  A paged, jewelry-grade glance: each page is one calm idea on the
//  midnight backdrop. Vertical paging (Digital Crown) so it feels
//  like turning the facets of a stone.

import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: WatchModel
    private var s: WatchSnapshot { model.snapshot }

    var body: some View {
        ZStack {
            Brand.backdrop
            TabView {
                HeroPage(s: s)
                if s.pendingTrip != nil {
                    TripPage(trip: s.pendingTrip!) { model.classifyPendingTrip(business: $0) }
                }
                QuarterlyPage(q: s.nextQuarterly)
                AchievementPage(s: s) { model.requestExpenseCapture() }
            }
            .tabViewStyle(.verticalPage)

            if s == .empty {
                Text("Open Taxottic on iPhone to sync")
                    .font(.footnote)
                    .foregroundStyle(Brand.creamMuted)
                    .multilineTextAlignment(.center)
                    .padding()
            }
        }
        .tint(Brand.gold)
    }
}

// MARK: - Hero

private struct HeroPage: View {
    let s: WatchSnapshot
    private var dollars: String {
        (Double(s.ytdDeductionCents) / 100).formatted(
            .currency(code: "USD").precision(.fractionLength(0)))
    }
    private var saved: String {
        (Double(s.estimatedTaxSavedCents) / 100).formatted(
            .currency(code: "USD").precision(.fractionLength(0)))
    }

    var body: some View {
        VStack(spacing: 6) {
            GoldGauge(progress: Double(s.taxReadinessPct) / 100) {
                VStack(spacing: 1) {
                    Text("\(s.taxReadinessPct)%")
                        .font(.figure(26))
                        .foregroundStyle(Brand.goldSheen)
                    Text("tax-ready")
                        .font(.eyebrow())
                        .foregroundStyle(Brand.creamMuted)
                }
            }
            .frame(width: 116, height: 116)
            .padding(.top, 2)

            VStack(spacing: 0) {
                Text(dollars)
                    .font(.figure(22))
                    .foregroundStyle(Brand.cream)
                Text("deductions · ≈\(saved) saved")
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(Brand.creamMuted)
            }

            if s.streakDays > 0 {
                Label("\(s.streakDays)-day streak", systemImage: "flame.fill")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(Brand.goldBright)
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(Capsule().fill(Brand.ink800))
                    .goldRim(radius: 20)
            }
        }
        .padding(.horizontal, 6)
    }
}

// MARK: - Pending trip (the one-gesture classify)

private struct TripPage: View {
    let trip: WatchSnapshot.PendingTrip
    let choose: (Bool) -> Void
    private var est: String {
        (Double(trip.estDeductionCents) / 100).formatted(
            .currency(code: "USD").precision(.fractionLength(2)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("CLASSIFY YOUR DRIVE")
                .font(.eyebrow()).foregroundStyle(Brand.gold)
            Text(trip.summary)
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(Brand.cream)
            Text("Worth \(est) if business")
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(Brand.creamMuted)
            HStack(spacing: 7) {
                PillButton(title: "Business", systemImage: "briefcase.fill", filled: true) { choose(true) }
                PillButton(title: "Personal", systemImage: "house.fill", filled: false) { choose(false) }
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .jewelCard()
        .padding(.horizontal, 6)
    }
}

// MARK: - Quarterly countdown

private struct QuarterlyPage: View {
    let q: WatchSnapshot.Quarterly?

    private func days(_ iso: String) -> Int? {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: iso) else { return nil }
        return Calendar.current.dateComponents([.day], from: .now, to: d).day
    }

    var body: some View {
        VStack(spacing: 8) {
            if let q {
                let dleft = days(q.dueISO) ?? 0
                let urgent = dleft <= 14
                Text(q.label.uppercased())
                    .font(.eyebrow()).foregroundStyle(Brand.gold)
                Text((Double(q.amountCents) / 100).formatted(
                        .currency(code: "USD").precision(.fractionLength(0))))
                    .font(.figure(26))
                    .foregroundStyle(Brand.cream)
                Label(
                    dleft <= 0 ? "Due now" : "in \(dleft) day\(dleft == 1 ? "" : "s")",
                    systemImage: urgent ? "exclamationmark.circle.fill" : "calendar"
                )
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(urgent ? Brand.goldBright : Brand.creamMuted)
            } else {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(Brand.goldSheen)
                Text("No estimate due")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(Brand.cream)
            }
        }
        .frame(maxWidth: .infinity)
        .jewelCard()
        .padding(.horizontal, 6)
    }
}

// MARK: - Achievement + quick action

private struct AchievementPage: View {
    let s: WatchSnapshot
    let logExpense: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            if let b = s.latestBadge {
                ZStack {
                    Circle().fill(Brand.ink800).frame(width: 58, height: 58).goldRim(radius: 29)
                    Image(systemName: b.symbol)
                        .font(.system(size: 24))
                        .foregroundStyle(Brand.goldSheen)
                }
                Text(b.title)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(Brand.cream)
                Text("Latest achievement")
                    .font(.eyebrow()).foregroundStyle(Brand.creamMuted)
            }
            PillButton(title: "Log an expense", systemImage: "plus.circle.fill", filled: true,
                       action: logExpense)
        }
        .frame(maxWidth: .infinity)
        .jewelCard()
        .padding(.horizontal, 6)
    }
}
