//  ConfirmDeck.swift
//  The signature interaction: a stack of cards for trips / expenses /
//  income the system isn't sure about. Swipe LEFT → the card's
//  leftLabel (Business / Deduct). Swipe RIGHT → rightLabel
//  (Personal / Skip). Live colour + glow + rotation track the drag;
//  a haptic fires at the commit threshold; the card flies off and the
//  next one rises with a spring. Clears to a calm "all caught up".

import SwiftUI

struct ConfirmDeck: View {
    @EnvironmentObject private var model: WatchModel

    private var items: [WatchSnapshot.Confirm] { model.snapshot.confirmations }

    var body: some View {
        VStack(spacing: 6) {
            Eyebrow(text: "Confirm")
            ZStack {
                if items.isEmpty {
                    AllClear()
                } else {
                    ForEach(Array(items.prefix(3).enumerated()).reversed(),
                            id: \.element.id) { idx, item in
                        SwipeCard(
                            item: item,
                            depth: idx,
                            onCommit: { left in model.confirm(item, left: left) }
                        )
                    }
                }
            }
            .frame(maxWidth: .infinity, minHeight: 132)
            if !items.isEmpty {
                Text("\(items.count) to review · swipe ◀ \(items[0].leftLabel)  /  \(items[0].rightLabel) ▶")
                    .font(.system(size: 10, design: .rounded))
                    .foregroundStyle(Brand.creamMuted)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, 6)
    }
}

private struct SwipeCard: View {
    let item: WatchSnapshot.Confirm
    let depth: Int
    let onCommit: (Bool) -> Void

    @State private var drag: CGSize = .zero
    @State private var gone = false

    private let threshold: CGFloat = 60

    // Left pull → gold (business/deduct). Right pull → cool slate.
    private var tint: Color {
        if drag.width < -8 { return Brand.gold }
        if drag.width > 8 { return Color(hex: 0x8898BD) }
        return .clear
    }
    private var verdict: String? {
        if drag.width < -threshold { return item.leftLabel }
        if drag.width > threshold { return item.rightLabel }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Eyebrow(text: item.kind)
                Spacer()
                if item.amountCents > 0 {
                    Text(item.amountCents.usd2)
                        .font(.figure(13))
                        .foregroundStyle(Brand.cream)
                }
            }
            Text(item.title)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .foregroundStyle(Brand.cream)
                .lineLimit(2)
            Text(item.subtitle)
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(Brand.creamMuted)
            // Swipe OR tap — an explicit target is the reliable path
            // on a tiny screen; the swipe is the delight. Both commit
            // the same classification.
            HStack(spacing: 8) {
                Button { onCommit(true) } label: {
                    Text(item.leftLabel)
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(Brand.ink800))
                        .foregroundStyle(Brand.cream)
                }
                .buttonStyle(.plain)
                Button { onCommit(false) } label: {
                    Text(item.rightLabel)
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(Brand.ink800))
                        .foregroundStyle(Brand.cream)
                }
                .buttonStyle(.plain)
            }
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .jewelCard()
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(tint, lineWidth: 2)
                .opacity(min(1, abs(drag.width) / threshold))
        )
        .overlay(verdictBadge)
        .shadow(color: tint.opacity(0.5),
                radius: min(14, abs(drag.width) / 4))
        .scaleEffect(1 - CGFloat(depth) * 0.05)
        .offset(y: CGFloat(depth) * 8)
        .offset(drag)
        .rotationEffect(.degrees(Double(drag.width) / 18))
        .opacity(gone ? 0 : 1)
        .allowsHitTesting(depth == 0)
        .gesture(
            DragGesture()
                .onChanged { v in
                    drag = v.translation
                    if abs(v.translation.width) > threshold,
                       abs(drag.width) - 1 <= threshold { Haptic.tap() }
                }
                .onEnded { v in
                    let w = v.translation.width
                    if w < -threshold { fly(left: true) }
                    else if w > threshold { fly(left: false) }
                    else {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.7)) {
                            drag = .zero
                        }
                    }
                }
        )
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: depth)
    }

    @ViewBuilder private var verdictBadge: some View {
        if let v = verdict {
            Text(v.uppercased())
                .font(.system(size: 13, weight: .heavy, design: .rounded))
                .tracking(1.5)
                .foregroundStyle(Brand.ink950)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(Capsule().fill(tint))
                .rotationEffect(.degrees(drag.width < 0 ? -12 : 12))
        }
    }

    private func fly(left: Bool) {
        Haptic.success()
        withAnimation(.easeIn(duration: 0.28)) {
            drag.width = left ? -260 : 260
            gone = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.26) {
            onCommit(left)
        }
    }
}

private struct AllClear: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 34))
                .foregroundStyle(Brand.goldSheen)
                .shimmer()
            Text("All caught up")
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(Brand.cream)
            Text("Nothing needs your call right now.")
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(Brand.creamMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .jewelCard()
    }
}
