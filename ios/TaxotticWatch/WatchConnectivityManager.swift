//  WatchConnectivityManager.swift
//  Receives the glanceable snapshot from the phone and sends one-tap
//  actions back. The watch and the actionable push do the SAME server
//  work (POST /api/push/action) — the watch is just the richer,
//  more beautiful surface.

import Foundation
import WatchConnectivity
import WidgetKit

/// Everything the watch can show. Keep field names in sync with the
/// phone-side bridge (see README) and lib/push/payloads.ts.
struct WatchSnapshot: Codable, Equatable {
    /// 0–100 overall tax-readiness (drives the hero dial).
    var taxReadinessPct: Int = 0
    var ytdDeductionCents: Int = 0
    /// Rough tax actually saved by those deductions (marginal-rate
    /// estimate computed phone-side).
    var estimatedTaxSavedCents: Int = 0

    var nextQuarterly: Quarterly?
    var pendingTrip: PendingTrip?
    var latestBadge: Badge?
    /// Consecutive days the user logged something — the "streak".
    var streakDays: Int = 0

    struct Quarterly: Codable, Equatable {
        var label: String          // "Q2 2026 estimate"
        var dueISO: String         // "2026-06-15"
        var amountCents: Int
    }
    struct PendingTrip: Codable, Equatable {
        var id: String
        var summary: String        // "12.4 mi · 28 min · today 9:14 AM"
        var estDeductionCents: Int
    }
    struct Badge: Codable, Equatable {
        var title: String          // "Deduction Hunter"
        var symbol: String         // SF Symbol name
    }

    static let empty = WatchSnapshot()
}

private let appGroup = "group.com.taxottic.app"

final class WatchModel: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchModel()

    @Published private(set) var snapshot: WatchSnapshot = .empty
    @Published private(set) var lastActionError: String?

    private override init() {
        super.init()
        if WCSession.isSupported() {
            let s = WCSession.default
            s.delegate = self
            s.activate()
        }
    }

    // MARK: - Outgoing one-tap actions

    func classifyPendingTrip(business: Bool) {
        guard let trip = snapshot.pendingTrip else { return }
        send([
            "type": "trip-classify",
            "tripId": trip.id,
            "classification": business ? "business" : "personal",
        ])
        Haptic.success()
        var s = snapshot; s.pendingTrip = nil; snapshot = s
    }

    /// "Log an expense" → hands off to the phone, which opens the
    /// dictation/camera capture flow (the heavy UI stays on the phone).
    func requestExpenseCapture() {
        send(["type": "open", "route": "expense-capture"])
        Haptic.tap()
    }

    private func send(_ message: [String: Any]) {
        let session = WCSession.default
        if session.isReachable {
            session.sendMessage(message, replyHandler: nil) { [weak self] err in
                DispatchQueue.main.async { self?.lastActionError = err.localizedDescription }
            }
        } else {
            session.transferUserInfo(message)
        }
    }

    // MARK: - WCSessionDelegate (incoming)

    func session(_ s: WCSession, activationDidCompleteWith _: WCSessionActivationState, error _: Error?) {}
    func session(_ s: WCSession, didReceiveApplicationContext ctx: [String: Any]) { apply(ctx) }
    func session(_ s: WCSession, didReceiveUserInfo info: [String: Any]) { apply(info) }

    private func apply(_ dict: [String: Any]) {
        guard
            let data = dict["snapshot"] as? Data,
            let decoded = try? JSONDecoder().decode(WatchSnapshot.self, from: data)
        else { return }
        DispatchQueue.main.async {
            self.snapshot = decoded
            // Mirror the headline figure to the App Group so the
            // watch-face complication can render it without launching
            // the app, then ask WidgetKit to refresh the timeline.
            UserDefaults(suiteName: appGroup)?
                .set(decoded.ytdDeductionCents, forKey: "ytdDeductionCents")
            UserDefaults(suiteName: appGroup)?
                .set(decoded.taxReadinessPct, forKey: "taxReadinessPct")
            WidgetCenter.shared.reloadAllTimelines()
        }
    }
}
