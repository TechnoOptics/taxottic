//  GoldGauge.swift
//  The centerpiece: a brushed-gold ring that fills like the bezel of
//  a fine watch. Used for the tax-readiness hero and reusable for any
//  0–1 progress. Animates on appear with a spring so it "settles"
//  into place like a mechanism.

import SwiftUI

struct GoldGauge<Center: View>: View {
    /// 0...1
    var progress: Double
    var lineWidth: CGFloat = 9
    @ViewBuilder var center: () -> Center

    @State private var animated: Double = 0

    var body: some View {
        ZStack {
            // Engraved track.
            Circle()
                .stroke(Brand.ink700, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .opacity(0.7)

            // Gold fill with an angular sheen so it looks metallic,
            // not flat — the light "travels" around the ring.
            Circle()
                .trim(from: 0, to: animated)
                .stroke(
                    AngularGradient(
                        colors: [Brand.goldShadow, Brand.gold, Brand.goldBright, Brand.gold, Brand.goldShadow],
                        center: .center
                    ),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .shadow(color: Brand.goldBright.opacity(0.45), radius: 4)

            // Tip highlight — the little catch-light of a gemstone.
            Circle()
                .frame(width: lineWidth + 2, height: lineWidth + 2)
                .foregroundStyle(Brand.goldBright)
                .offset(y: -110)
                .rotationEffect(.degrees(360 * animated))
                .opacity(animated > 0.02 ? 1 : 0)
                .blur(radius: 0.5)

            center()
        }
        .onAppear {
            withAnimation(.spring(response: 1.1, dampingFraction: 0.85)) {
                animated = max(0, min(1, progress))
            }
        }
        .onChange(of: progress) { _, new in
            withAnimation(.spring(response: 0.9, dampingFraction: 0.85)) {
                animated = max(0, min(1, new))
            }
        }
    }
}

/// Elegant capsule action — gold for the primary choice, glass-with-
/// gold-rim for the secondary. Haptic on press.
struct PillButton: View {
    var title: String
    var systemImage: String?
    var filled: Bool
    var action: () -> Void

    var body: some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            HStack(spacing: 5) {
                if let s = systemImage { Image(systemName: s) }
                Text(title).font(.system(size: 14, weight: .semibold, design: .rounded))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .foregroundStyle(filled ? Brand.ink950 : Brand.cream)
            .background {
                if filled {
                    Capsule().fill(Brand.goldSheen)
                } else {
                    Capsule().fill(Brand.ink800)
                }
            }
            .overlay(Capsule().strokeBorder(Brand.goldSheen, lineWidth: 0.75).opacity(filled ? 0 : 0.6))
        }
        .buttonStyle(.plain)
    }
}
