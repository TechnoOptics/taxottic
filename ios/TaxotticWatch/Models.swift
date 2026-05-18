//  Models.swift
//  The watch payload — mirror of lib/watch/types.ts. Decoded from the
//  phone via WatchConnectivity. Every collection defaults to empty so
//  a partial sync never crashes a view.

import Foundation

struct WatchSnapshot: Codable, Equatable {
    var taxReadinessPct: Int = 0
    var ytdDeductionCents: Int = 0
    var estimatedTaxSavedCents: Int = 0
    var streakDays: Int = 0

    var forecast: Forecast?
    var confirmations: [Confirm] = []
    var deductions: [Deduction] = []
    var goals: [Goal] = []
    var mileage: Mileage = .init()

    var latestBadge: Badge?
    var newBadgeCode: String?
    var companyId: String?

    struct Forecast: Codable, Equatable {
        var label: String
        /// Positive = owe, negative = refund.
        var netCents: Int
        var effectiveRatePct: Int
        var ytdIncomeCents: Int
    }
    struct Confirm: Codable, Equatable, Identifiable {
        var id: String
        var kind: String          // trip | expense | income
        var title: String
        var subtitle: String
        var amountCents: Int
        var leftLabel: String     // swipe-left commits this
        var rightLabel: String    // swipe-right commits this
    }
    struct Deduction: Codable, Equatable, Identifiable {
        var name: String
        var amountCents: Int
        var captured: Bool
        var id: String { name }
    }
    struct Goal: Codable, Equatable, Identifiable {
        var id: String
        var title: String
        var savedCents: Int
        var targetCents: Int
        var progress: Double {
            targetCents > 0 ? min(1, Double(savedCents) / Double(targetCents)) : 0
        }
    }
    struct Mileage: Codable, Equatable {
        var trackingActive: Bool = false
        var autoApplyBusiness: Bool = false
        var todayMiles: Double = 0
        var todayDeductionCents: Int = 0
    }
    struct Badge: Codable, Equatable {
        var title: String
        var symbol: String
    }

    static let empty = WatchSnapshot()
}

extension Int {
    /// Cents → "$1,243" (no fraction) for headline figures.
    var usd0: String {
        (Double(self) / 100).formatted(
            .currency(code: "USD").precision(.fractionLength(0)))
    }
    /// Cents → "$18.40" for line items.
    var usd2: String {
        (Double(self) / 100).formatted(
            .currency(code: "USD").precision(.fractionLength(2)))
    }
}
