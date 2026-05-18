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

    // Metallic gold ramp — the jewelry.
    static let goldBright = Color(hex: 0xF2D896)
    static let gold       = Color(hex: 0xD5BB7E)
    static let goldDeep   = Color(hex: 0xC4A25D)
    static let goldShadow = Color(hex: 0xA78540)

    static let cream = Color(hex: 0xFBF7E9)
    static let creamMuted = Color(hex: 0xFBF7E9).opacity(0.62)

    /// The page backdrop: a soft midnight radial so the watch face
    /// "glows" from its center like a gemstone, not a flat fill.
    static var backdrop: some View {
        ZStack {
            ink950
            RadialGradient(
                colors: [ink700.opacity(0.55), ink950],
                center: .center, startRadius: 4, endRadius: 180
            )
        }
        .ignoresSafeArea()
    }

    /// Brushed-gold gradient used for rims, gauges and key numerals.
    static let goldSheen = LinearGradient(
        colors: [goldShadow, goldBright, gold, goldShadow],
        startPoint: .topLeading, endPoint: .bottomTrailing
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
