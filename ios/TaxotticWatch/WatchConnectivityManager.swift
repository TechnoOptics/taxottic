//  WatchConnectivityManager.swift
//  Receives glanceable state from the phone and sends the one-tap
//  trip classification back. Mirrors the push spec's data contract so
//  the watch and the actionable notification do the SAME server work
//  (POST /api/push/action) — the watch just gives a richer surface.

import Foundation
import WatchConnectivity

/// The snapshot the phone pushes to the watch. Keep field names in
/// sync with the phone-side bridge (see README) and lib/push/payloads.
struct WatchSnapshot: Codable, Equatable {
    var ytdDeductionCents: Int
    var nextQuarterlyDueISO: String?     // e.g. "2026-06-15"
    var pendingTrip: PendingTrip?

    struct PendingTrip: Codable, Equatable {
        var id: String
        var summary: String              // "12.4 mi · 28 min · today 9:14 AM"
    }

    static let empty = WatchSnapshot(
        ytdDeductionCents: 0,
        nextQuarterlyDueISO: nil,
        pendingTrip: nil
    )
}

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

    // MARK: - Outgoing: one-tap trip classification

    /// Sends the user's Business/Personal choice to the phone, which
    /// re-auths and calls the same /api/push/action the notification
    /// action uses. Optimistically clears the pending card.
    func classifyPendingTrip(business: Bool) {
        guard let trip = snapshot.pendingTrip else { return }
        let message: [String: Any] = [
            "type": "trip-classify",
            "tripId": trip.id,
            "classification": business ? "business" : "personal",
        ]
        let session = WCSession.default
        if session.isReachable {
            session.sendMessage(message, replyHandler: nil) { [weak self] err in
                DispatchQueue.main.async {
                    self?.lastActionError = err.localizedDescription
                }
            }
        } else {
            // Phone asleep/out of range — queue it; the phone drains
            // transferUserInfo on next launch and POSTs then.
            session.transferUserInfo(message)
        }
        var s = snapshot
        s.pendingTrip = nil
        snapshot = s
    }

    // MARK: - WCSessionDelegate (incoming snapshots)

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {}

    func session(
        _ session: WCSession,
        didReceiveApplicationContext applicationContext: [String: Any]
    ) {
        apply(applicationContext)
    }

    func session(
        _ session: WCSession,
        didReceiveUserInfo userInfo: [String: Any]
    ) {
        apply(userInfo)
    }

    private func apply(_ dict: [String: Any]) {
        guard
            let data = dict["snapshot"] as? Data,
            let decoded = try? JSONDecoder().decode(WatchSnapshot.self, from: data)
        else { return }
        DispatchQueue.main.async { self.snapshot = decoded }
    }
}
