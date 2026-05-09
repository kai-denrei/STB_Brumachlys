---
project: Brumachlys
mode: solo
owner: gerald
stale_threshold_days: 30
last_sync: 2026-05-09
---

# Brumachlys — Project Memory Index

A simultaneous-turn tactical hex wargame in the Weewar / Zetawar lineage. Hot-seat single-screen, deterministic resolver, offline-native PWA. Solo build.

Scope: PoC implementing all 9 spec phases on the `three-ways` map with the 2-unit roster (infantry, tank). No netcode, AI, custom art, sound, persistence, capture, or economy.

## Active Roles

- [[pm]] — scope, decisions, deferred items
- [[arch]] — pure-core boundary, state model, rendering choice
- [[dev]] — TDD discipline, spec corrections, edge-case handling
- [[ux]] — mobile-first PWA, two-tap handoff, stance control
- [[qa]] — test fixtures, coverage strategy, spec-vs-fixture conflicts
- [[devops]] — Vite + vite-plugin-pwa build, service worker

## Key Decisions (cross-role)

- Combat formula uses `min(attackerCount, defenderCount)` — see [[dev]] (spec said attackerCount only, but §11.2 worked example only holds with min)
- Canvas 2D, not SVG — see [[arch]]
- Sliced Zustand store (game / ui / replay) — see [[arch]]
- Two-tap handoff (mobile pockets / accidental taps) — see [[ux]]
- Stance segmented control replaces right-click — see [[ux]]
- TDD enforced for all `core/*` modules; UI work non-TDD — see [[qa]]

## Open Questions (cross-role)

- Has the hex coordinate convention (`q=x, r=y` from Weewar XML) been visually verified against the original Weewar map render? — see [[dev]]
- Will round 1 with aggressive default + units in vision range produce immediate combat the player didn't anticipate? — see [[ux]]
- Combat balance on `three-ways` with 4 troopers / no economy — does it reach a clean win in <15 rounds, or grind? — see [[pm]]
- PWA install + offline tested on real iOS hardware? — see [[devops]]
- 220px fixed OrderPanel height — does it overflow on iPhone SE class screens? — see [[ux]]
