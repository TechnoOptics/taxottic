//  ContentView.swift
//  Paged, jewelry-grade glance. Digital-Crown vertical paging turns
//  the facets of the stone: Hero · Forecast · Confirm · Mileage ·
//  Deductions · Goals · Achievements. A medal celebration overlays
//  everything when a new badge lands.

import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: WatchModel
    private var s: WatchSnapshot { model.snapshot }
    @State private var page = 0
    private let pageCount = 7

    var body: some View {
        ZStack {
            Brand.backdrop
            // .verticalPage is driven by the Digital Crown on
            // watchOS; the selection binding lets the gold bezel
            // track the crown as it turns the pages.
            TabView(selection: $page) {
                HeroPage(s: s).tag(0)
                ForecastPage(f: s.forecast).tag(1)
                ConfirmDeck().tag(2)
                MileagePage().tag(3)
                DeductionsPage(s: s).tag(4)
                GoalsPage(goals: s.goals).tag(5)
                AchievementPage(s: s) { model.requestExpenseCapture() }.tag(6)
            }
            .tabViewStyle(.verticalPage)

            // The gold scroll-bezel rides the rim, turning with the crown.
            BezelProgress(
                progress: Double(page) / Double(pageCount - 1)
            )

            if s == .empty {
                Text("Open Taxottic on iPhone to sync")
                    .font(.footnote)
                    .foregroundStyle(Brand.creamMuted)
                    .multilineTextAlignment(.center)
                    .padding()
            }

            if let title = model.celebrate {
                MedalCelebration(title: title) { model.celebrate = nil }
                    .transition(.opacity)
            }
        }
        .tint(Brand.gold)
        .animation(.easeInOut, value: model.celebrate)
    }
}

// MARK: Hero

private struct HeroPage: View {
    let s: WatchSnapshot
    var body: some View {
        VStack(spacing: 6) {
            GoldGauge(progress: Double(s.taxReadinessPct) / 100) {
                VStack(spacing: 1) {
                    Text("\(s.taxReadinessPct)%")
                        .font(.figure(26)).foregroundStyle(Brand.goldSheen)
                    Text("tax-ready").font(.eyebrow())
                        .foregroundStyle(Brand.creamMuted)
                }
            }
            .frame(width: 116, height: 116)

            CountingMoney(cents: s.ytdDeductionCents, size: 22)
            Text("deductions · ≈\(s.estimatedTaxSavedCents.usd0) saved")
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(Brand.creamMuted)

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

// MARK: Real-time forecast window

private struct ForecastPage: View {
    let f: WatchSnapshot.Forecast?
    var body: some View {
        VStack(spacing: 8) {
            Eyebrow(text: "Live forecast")
            if let f {
                let owe = f.netCents >= 0
                Text(owe ? "Projected owed" : "Projected refund")
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(Brand.creamMuted)
                CountingMoney(cents: abs(f.netCents), size: 30)
                HStack(spacing: 10) {
                    Stat(label: "Eff. rate", value: "\(f.effectiveRatePct)%")
                    Stat(label: "YTD income", value: f.ytdIncomeCents.usd0)
                }
                Text(f.label)
                    .font(.system(size: 10, design: .rounded))
                    .foregroundStyle(Brand.creamMuted)
            } else {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 26)).foregroundStyle(Brand.goldSheen)
                Text("Your forecast updates\non your iPhone")
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(Brand.creamMuted)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .jewelCard()
        .padding(.horizontal, 6)
    }
    private struct Stat: View {
        let label: String; let value: String
        var body: some View {
            VStack(spacing: 1) {
                Text(value).font(.figure(14)).foregroundStyle(Brand.cream)
                Text(label).font(.system(size: 9, design: .rounded))
                    .foregroundStyle(Brand.creamMuted)
            }
        }
    }
}

// MARK: Mileage tracking + auto-apply

private struct MileagePage: View {
    @EnvironmentObject private var model: WatchModel
    private var m: WatchSnapshot.Mileage { model.snapshot.mileage }

    var body: some View {
        VStack(spacing: 9) {
            HStack(spacing: 6) {
                Circle()
                    .fill(m.trackingActive ? Color.green : Brand.creamMuted)
                    .frame(width: 9, height: 9)
                    .pulse(m.trackingActive)
                Eyebrow(text: m.trackingActive ? "Tracking drives" : "Mileage")
                Spacer()
            }
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(String(format: "%.1f mi today", m.todayMiles))
                        .font(.figure(15)).foregroundStyle(Brand.cream)
                    Text("\(m.todayDeductionCents.usd2) deduction")
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(Brand.creamMuted)
                }
                Spacer()
            }
            Toggle(isOn: Binding(
                get: { m.trackingActive },
                set: { model.setMileageTracking(on: $0) }
            )) { Text("Auto-track").font(.system(size: 13, design: .rounded)) }
                .tint(Brand.gold)
            Toggle(isOn: Binding(
                get: { m.autoApplyBusiness },
                set: { model.setAutoApply(on: $0) }
            )) { Text("Auto-apply business").font(.system(size: 13, design: .rounded)) }
                .tint(Brand.gold)
        }
        .foregroundStyle(Brand.cream)
        .frame(maxWidth: .infinity, alignment: .leading)
        .jewelCard()
        .padding(.horizontal, 6)
    }
}

// MARK: Deductions

private struct DeductionsPage: View {
    let s: WatchSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(text: "Available deductions")
            if s.deductions.isEmpty {
                HStack(spacing: 10) {
                    GoldGauge(progress: Double(s.taxReadinessPct) / 100) {
                        Text("\(s.taxReadinessPct)%")
                            .font(.figure(15)).foregroundStyle(Brand.goldSheen)
                    }
                    .frame(width: 64, height: 64)
                    Text("Every captured deduction lowers what you owe. Keep your books current on your phone to fill this in.")
                        .font(.system(size: 11, design: .rounded))
                        .foregroundStyle(Brand.creamMuted)
                }
            } else {
                ForEach(s.deductions.prefix(5)) { d in
                    HStack {
                        Image(systemName: d.captured ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(d.captured ? Brand.gold : Brand.creamMuted)
                        Text(d.name).font(.system(size: 12, design: .rounded))
                            .foregroundStyle(Brand.cream).lineLimit(1)
                        Spacer()
                        Text(d.amountCents.usd0)
                            .font(.figure(12)).foregroundStyle(Brand.creamMuted)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .jewelCard()
        .padding(.horizontal, 6)
    }
}

// MARK: Goals

private struct GoalsPage: View {
    let goals: [WatchSnapshot.Goal]
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Eyebrow(text: "Goals")
            if goals.isEmpty {
                Text("Set a savings goal on your phone and track it from your wrist.")
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(Brand.creamMuted)
            } else {
                ForEach(goals.prefix(4)) { g in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(g.title).font(.system(size: 12, weight: .semibold, design: .rounded))
                                .foregroundStyle(Brand.cream).lineLimit(1)
                            Spacer()
                            Text("\(Int(g.progress * 100))%")
                                .font(.figure(11)).foregroundStyle(Brand.gold)
                        }
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Brand.ink700).frame(height: 5)
                                Capsule().fill(Brand.goldSheen)
                                    .frame(width: geo.size.width * g.progress, height: 5)
                            }
                        }
                        .frame(height: 5)
                        Text("\(g.savedCents.usd0) of \(g.targetCents.usd0)")
                            .font(.system(size: 10, design: .rounded))
                            .foregroundStyle(Brand.creamMuted)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .jewelCard()
        .padding(.horizontal, 6)
    }
}

// MARK: Achievements + quick action

private struct AchievementPage: View {
    let s: WatchSnapshot
    let logExpense: () -> Void
    var body: some View {
        VStack(spacing: 10) {
            if let b = s.latestBadge {
                ZStack {
                    Circle().fill(Brand.ink800).frame(width: 58, height: 58)
                        .goldRim(radius: 29)
                    Image(systemName: b.symbol)
                        .font(.system(size: 24))
                        .foregroundStyle(Brand.goldSheen).shimmer()
                }
                Text(b.title)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(Brand.cream)
                Text("Latest achievement").font(.eyebrow())
                    .foregroundStyle(Brand.creamMuted)
            }
            PillButton(title: "Log an expense", systemImage: "plus.circle.fill",
                       filled: true, action: logExpense)
        }
        .frame(maxWidth: .infinity)
        .jewelCard()
        .padding(.horizontal, 6)
    }
}
