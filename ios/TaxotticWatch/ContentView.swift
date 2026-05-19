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
    @State private var setAside = 2_000
    private let pageCount = 8
    private let setAsideIndex = 7

    private var rate: Int {
        let r = s.forecast?.effectiveRatePct ?? 0
        return r > 0 ? r : 25
    }
    private var bezel: Double {
        page == setAsideIndex
            ? min(1, Double(setAside) / 20_000)
            : Double(page) / Double(pageCount - 1)
    }

    var body: some View {
        ZStack {
            Brand.backdrop
            // Guilloché sunburst + chapter ring, under the content.
            RolexDial()
            // .verticalPage is driven by the Digital Crown on watchOS;
            // the selection binding lets the fluted bezel track it.
            TabView(selection: $page) {
                HeroPage(s: s) { model.requestExpenseCapture() }.tag(0)
                ForecastPage(f: s.forecast).tag(1)
                ConfirmDeck().tag(2)
                MileagePage().tag(3)
                DeductionsPage(s: s).tag(4)
                GoalsPage(goals: s.goals).tag(5)
                AchievementPage(s: s) { model.requestExpenseCapture() }.tag(6)
                SetAsidePage(amount: $setAside, ratePct: rate).tag(7)
            }
            .tabViewStyle(.verticalPage)

            // The fluted gold bezel rides the rim, turning with the
            // crown — and on Set-Aside it IS the value dial.
            FlutedBezel(progress: bezel)

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
    var onCapture: () -> Void
    var body: some View {
        VStack(spacing: 6) {
            GoldGauge(progress: Double(s.taxReadinessPct) / 100) {
                VStack(spacing: 1) {
                    Text("\(s.taxReadinessPct)%")
                        .font(.figure(24)).foregroundStyle(Brand.goldSheen)
                    Text("tax-ready").font(.eyebrow())
                        .foregroundStyle(Brand.creamMuted)
                }
            }
            .frame(width: 108, height: 108)

            CountingMoney(cents: s.ytdDeductionCents, size: 20)
            Text("deductions · ≈\(s.estimatedTaxSavedCents.usd0) saved")
                .font(.system(size: 10, design: .rounded))
                .foregroundStyle(Brand.creamMuted)

            // Quick capture — log a deductible the instant you pay.
            Button(action: onCapture) {
                Text("＋ Capture expense")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .foregroundStyle(Brand.ink950)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(Capsule().fill(Brand.goldSheen))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 6)
    }
}

// MARK: Set-Aside crown tool

/// Turn the Digital Crown → set a payment amount; it instantly shows
/// the tax reserve at your real effective rate. The fluted bezel
/// doubles as the value dial.
private struct SetAsidePage: View {
    @Binding var amount: Int
    var ratePct: Int
    @State private var crown = 2_000.0

    var body: some View {
        VStack(spacing: 2) {
            Eyebrow(text: "Set aside · turn crown")
            Text("On a payment of")
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(Brand.creamMuted)
            Text("$\(amount.formatted(.number.grouping(.automatic)))")
                .font(.figure(18)).foregroundStyle(Brand.cream)
            Spacer().frame(height: 4)
            Text("Set aside")
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(Brand.creamMuted)
            Text("$\((amount * ratePct / 100).formatted(.number.grouping(.automatic)))")
                .font(.figure(34)).foregroundStyle(Brand.goldSheen).shimmer()
            Text("for taxes · ~\(ratePct)% rate")
                .font(.system(size: 10, design: .rounded))
                .foregroundStyle(Brand.creamMuted)
        }
        .frame(maxWidth: .infinity)
        .jewelCard()
        .padding(.horizontal, 6)
        .focusable(true)
        .digitalCrownRotation(
            $crown, from: 0, through: 20_000, by: 100,
            sensitivity: .medium, isContinuous: false
        )
        .onChange(of: crown) { _, v in amount = Int(v) }
        .onAppear { crown = Double(amount) }
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
                // The showpiece: a big brushed-gold figure inside a
                // thin gold rate-ring (fills with the effective rate).
                ZStack {
                    Circle()
                        .stroke(Brand.gold.opacity(0.14), lineWidth: 6)
                    Circle()
                        .trim(from: 0, to: max(0.04, min(1, Double(f.effectiveRatePct) / 100)))
                        .stroke(Brand.goldSheen,
                                style: StrokeStyle(lineWidth: 6, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    VStack(spacing: 1) {
                        Text(owe ? "you'll owe" : "refund")
                            .font(.system(size: 10, design: .rounded))
                            .foregroundStyle(Brand.creamMuted)
                        CountingMoney(cents: abs(f.netCents), size: 26)
                        Text("\(f.effectiveRatePct)% eff. rate")
                            .font(.system(size: 10, design: .rounded))
                            .foregroundStyle(Brand.gold)
                    }
                }
                .frame(width: 132, height: 132)
                Text("on \(f.ytdIncomeCents.usd0) income · \(f.label)")
                    .font(.system(size: 10, design: .rounded))
                    .foregroundStyle(Brand.creamMuted)
                    .multilineTextAlignment(.center)
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
