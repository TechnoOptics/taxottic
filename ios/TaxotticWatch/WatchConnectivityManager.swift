//  WatchConnectivityManager.swift
//  Receives the snapshot from the phone and sends one-gesture actions
//  back. The watch and the actionable push do the SAME server work
//  (POST /api/push/action) — the watch is just the richer surface.

import Foundation
import WatchConnectivity
import WidgetKit

private let appGroup = "group.com.taxottic.app"

final class WatchModel: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchModel()

    @Published private(set) var snapshot: WatchSnapshot = .empty
    /// One-shot: set to a badge title when a NEW medal lands, so the
    /// celebration overlay fires once. The view clears it.
    @Published var celebrate: String?

    private var lastCelebratedCode: String?

    private override init() {
        super.init()
        if WCSession.isSupported() {
            let s = WCSession.default
            s.delegate = self
            s.activate()
        }
    }

    // MARK: - Outgoing one-gesture actions

    /// Swipe a card. `left` = the card's leftLabel (Business/Deduct);
    /// `!left` = rightLabel (Personal/Skip).
    func confirm(_ item: WatchSnapshot.Confirm, left: Bool) {
        send([
            "type": "confirm",
            "kind": item.kind,
            "id": item.id,
            "decision": left ? "left" : "right",
        ])
        Haptic.success()
        var s = snapshot
        s.confirmations.removeAll { $0.id == item.id }
        snapshot = s
    }

    func setMileageTracking(on: Bool) {
        send(["type": "mileage", "action": on ? "start" : "stop"])
        Haptic.select()
        var s = snapshot
        s.mileage.trackingActive = on
        snapshot = s
    }

    func setAutoApply(on: Bool) {
        send(["type": "autoApply", "value": on ? "on" : "off"])
        Haptic.tap()
        var s = snapshot
        s.mileage.autoApplyBusiness = on
        snapshot = s
    }

    func requestExpenseCapture() {
        send(["type": "open", "route": "expense-capture"])
        Haptic.tap()
    }

    private func send(_ message: [String: Any]) {
        let session = WCSession.default
        if session.isReachable {
            session.sendMessage(message, replyHandler: nil, errorHandler: { _ in
                session.transferUserInfo(message)
            })
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

            // One-shot medal celebration.
            if let code = decoded.newBadgeCode,
               code != self.lastCelebratedCode {
                self.lastCelebratedCode = code
                self.celebrate = decoded.latestBadge?.title ?? "New medal"
                Haptic.success()
            }

            // Mirror headline figures for the complication.
            if let d = UserDefaults(suiteName: appGroup) {
                d.set(decoded.ytdDeductionCents, forKey: "ytdDeductionCents")
                d.set(decoded.taxReadinessPct, forKey: "taxReadinessPct")
            }
            WidgetCenter.shared.reloadAllTimelines()
        }
    }
}
