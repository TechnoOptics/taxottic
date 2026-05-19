//  Theme.swift
//  Taxottic Watch design system — "midnight & gold".
//
//  The brand is navy (#192539) + a warm metallic gold. On a black
//  watch bezel that reads like fine jewelry: deep midnight surfaces,
//  hairline gold rims, and a brushed-gold sheen on the accents. Every
//  surface in the app composes from the primitives here so the look
//  stays cohesive and "premium" rather than ad-hoc.

import SwiftUI

enum Brand {
    // Core navy (matches the web @theme forest-* scale post-rebrand).
    static let ink900 = Color(hex: 0x192539)   // brand anchor
    static let ink950 = Color(hex: 0x121A2A)   // deepest
    static let ink800 = Color(hex: 0x1D2843)
    static let ink700 = Color(hex: 0x243150)
    static let ink600 = Color(hex: 0x2F3E63)

    // Metallic gold ramp — the jewelry.
    static let goldBright = Color(hex: 0xF2D896)
    static let gold       = Color(hex: 0xD5BB7E)
    static let goldDeep   = Color(hex: 0xC4A25D)
    static let goldShadow = Color(hex: 0xA78540)

    static let cream = Color(hex: 0xFBF7E9)
    static let creamMuted = Color(hex: 0xFBF7E9).opacity(0.62)

    /// The page backdrop: the SAME blue gradient as the app — a
    /// top-lit slate sweeping down into the deepest midnight, with a
    /// soft centre catch-light. Reads as one polished dial surface.
    static var backdrop: some View {
        ZStack {
            LinearGradient(
                colors: [ink600, ink900, ink950],
                startPoint: .top, endPoint: .bottom
            )
            RadialGradient(
                colors: [ink700.opacity(0.45), .clear],
                center: .center, startRadius: 2, endRadius: 150
            )
        }
        .ignoresSafeArea()
    }

    /// Brushed-gold gradient used for rims, gauges and key numerals.
    static let goldSheen = LinearGradient(
        colors: [goldShadow, goldBright, gold, goldShadow],
        startPoint: .topLeading, endPoint: .bottomTrailing
    )

    /// Angular brushed-gold sweep for the scroll bezel.
    static let goldArc = AngularGradient(
        colors: [goldShadow, goldDeep, goldBright, gold, goldBright, goldDeep, goldShadow],
        center: .center
    )

    /// Faint inner-glass fill for cards.
    static let glass = LinearGradient(
        colors: [ink800.opacity(0.92), ink900.opacity(0.92)],
        startPoint: .top, endPoint: .bottom
    )
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red:   Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue:  Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

extension Font {
    /// Tabular, slightly condensed numerals for the "engraved" money
    /// figures — feels minted rather than typed.
    static func figure(_ size: CGFloat) -> Font {
        .system(size: size, weight: .semibold, design: .rounded)
            .monospacedDigit()
    }
    static func eyebrow() -> Font {
        .system(size: 11, weight: .semibold, design: .rounded)
    }
}

enum Haptic {
    static func tap()     { WKInterfaceDevice.current().play(.click) }
    static func success() { WKInterfaceDevice.current().play(.success) }
    static func select()  { WKInterfaceDevice.current().play(.directionUp) }
    static func warn()    { WKInterfaceDevice.current().play(.retry) }
}

/// A gold light that travels across the content — the catch-light of
/// a polished surface. Used on headline numerals and the medal.
struct Shimmer: ViewModifier {
    @State private var x: CGFloat = -1
    func body(content: Content) -> some View {
        content.overlay(
            GeometryReader { geo in
                LinearGradient(
                    colors: [.clear, Brand.goldBright.opacity(0.85), .clear],
                    startPoint: .leading, endPoint: .trailing
                )
                .frame(width: geo.size.width * 0.55)
                .offset(x: x * geo.size.width)
                .blendMode(.screen)
            }
            .mask(content)
        )
        .onAppear {
            withAnimation(.easeInOut(duration: 2.4).repeatForever(autoreverses: false)) {
                x = 1.4
            }
        }
    }
}

/// Slow breathing scale+glow for "live" states (mileage tracking).
struct Pulse: ViewModifier {
    var active: Bool
    @State private var on = false
    func body(content: Content) -> some View {
        content
            .scaleEffect(active && on ? 1.08 : 1.0)
            .opacity(active && on ? 1.0 : 0.78)
            .onAppear {
                guard active else { return }
                withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) {
                    on = true
                }
            }
    }
}

extension View {
    func shimmer() -> some View { modifier(Shimmer()) }
    func pulse(_ active: Bool) -> some View { modifier(Pulse(active: active)) }
}

/// A money figure that rolls up to its value on appear/change — the
/// "real-time" feel. Renders in the engraved gold sheen.
struct CountingMoney: View {
    var cents: Int
    var size: CGFloat = 24
    @State private var shown: Double = 0

    var body: some View {
        Text((shown / 100).formatted(.currency(code: "USD").precision(.fractionLength(0))))
            .font(.figure(size))
            .foregroundStyle(Brand.goldSheen)
            .shimmer()
            .onAppear { roll(to: Double(cents)) }
            .onChange(of: cents) { _, v in roll(to: Double(v)) }
    }
    private func roll(to v: Double) {
        withAnimation(.easeOut(duration: 0.9)) { shown = v }
    }
}

struct Eyebrow: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.eyebrow())
            .tracking(1.4)
            .foregroundStyle(Brand.gold)
    }
}

/// Hairline-gold rounded rim — the single most "jewelry" detail,
/// reused on every card and button.
struct GoldRim: ViewModifier {
    var radius: CGFloat = 16
    var lineWidth: CGFloat = 0.75
    func body(content: Content) -> some View {
        content.overlay(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .strokeBorder(Brand.goldSheen, lineWidth: lineWidth)
                .opacity(0.55)
        )
    }
}

extension View {
    func goldRim(radius: CGFloat = 16) -> some View {
        modifier(GoldRim(radius: radius))
    }

    /// Standard "jewel card" container: midnight glass + gold rim +
    /// soft shadow so it sits above the gemstone backdrop.
    func jewelCard(radius: CGFloat = 16) -> some View {
        self
            .padding(12)
            .background(Brand.glass, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .goldRim(radius: radius)
            .shadow(color: .black.opacity(0.45), radius: 8, y: 4)
    }
}

/// The scroll bezel. A faint full gold rail traces the rim; a bright
/// brushed-gold arc grows from 12 o'clock and turns slightly as the
/// Digital Crown moves through the pages — a Rolex-style rotating
/// bezel that doubles as the scroll-position indicator. Overlaid on
/// the whole watch face, above content, ignoring safe area so it
/// hugs the physical edge.
struct BezelProgress: View {
    /// 0‥1 — current page over (pageCount - 1).
    var progress: Double

    var body: some View {
        let p = max(0, min(1, progress))
        ZStack {
            Circle()
                .stroke(Brand.gold.opacity(0.16), lineWidth: 6)
            Circle()
                .trim(from: 0, to: max(0.015, p))
                .stroke(
                    Brand.goldArc,
                    style: StrokeStyle(lineWidth: 6, lineCap: .round)
                )
                .rotationEffect(.degrees(-90 + p * 22))
                .shadow(color: Brand.goldBright.opacity(0.5), radius: 3)
        }
        .padding(3)
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .animation(.spring(response: 0.45, dampingFraction: 0.85), value: progress)
    }
}
