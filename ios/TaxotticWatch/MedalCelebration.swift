//  MedalCelebration.swift
//  Fires once when a new medal lands (model.celebrate set by the
//  WCSession decode). Gold rays sweep behind a struck-medal that
//  springs in, shimmers, then the overlay fades. Pure reward moment.

import SwiftUI

struct MedalCelebration: View {
    let title: String
    let onDone: () -> Void

    @State private var inScene = false
    @State private var rays = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea()

            // Rotating gold rays.
            ForEach(0..<12, id: \.self) { i in
                Capsule()
                    .fill(Brand.goldSheen)
                    .frame(width: 3, height: 130)
                    .opacity(0.5)
                    .offset(y: -70)
                    .rotationEffect(.degrees(Double(i) / 12 * 360))
            }
            .rotationEffect(.degrees(rays ? 30 : -30))
            .scaleEffect(inScene ? 1 : 0.2)
            .opacity(inScene ? 1 : 0)

            VStack(spacing: 8) {
                ZStack {
                    Circle()
                        .fill(Brand.ink800)
                        .frame(width: 78, height: 78)
                        .goldRim(radius: 39)
                    Image(systemName: "rosette")
                        .font(.system(size: 36))
                        .foregroundStyle(Brand.goldSheen)
                        .shimmer()
                }
                .scaleEffect(inScene ? 1 : 0.1)

                Text("Medal earned")
                    .font(.eyebrow())
                    .foregroundStyle(Brand.gold)
                Text(title)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(Brand.cream)
                    .multilineTextAlignment(.center)
                    .opacity(inScene ? 1 : 0)
            }
            .padding(.horizontal, 12)
        }
        .onAppear {
            withAnimation(.spring(response: 0.6, dampingFraction: 0.55)) {
                inScene = true
            }
            withAnimation(.easeInOut(duration: 1.6).repeatForever(autoreverses: true)) {
                rays = true
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.6) {
                withAnimation(.easeOut(duration: 0.35)) { inScene = false }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35, execute: onDone)
            }
        }
        .onTapGesture { onDone() }
    }
}
