# Brumachlys

> *brume* (fr. mist) + *achlys* (gr. Ἀχλύς, the death-mist of the *Iliad*)
> A simultaneous-turn tactical hex wargame in the Weewar / Zetawar lineage.

Hot-seat, deterministic, offline-native PWA. Built solo as a PoC.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # vitest run
npm run test:watch
npm run typecheck
npm run build        # → dist/, with service worker + manifest
npm run preview      # serve the production build locally
```

## Status — playable v1

All nine phases shipped. `npm test` shows 118/118 passing across hex / RNG / fog / combat / pathing / resolver / XML parser. The UI is a single-page hot-seat game on the `three-ways` map.

| Phase                                       | Status | Coverage |
| ------------------------------------------- | ------ | -------- |
| 1 — Hex math + RNG + types                  | done   | 40 tests |
| 2 — Data loading + Weewar XML parser        | done   | 14 tests |
| 3 — Combat math + Pathing                   | done   | 36 tests |
| 4 — Resolver (Phase A movement → Phase B combat) | done | 17 tests |
| 5 — Fog of war                              | done   | 11 tests |
| 6 — Canvas board (auto-fit pointy-top hex)  | done   | —        |
| 7 — Order entry (tap-to-select / queue)     | done   | —        |
| 8 — Commit + 2-tap handoff + replay timeline | done  | —        |
| 9 — Win banner, new game, SW update toast, install prompt | done | — |

## Documents

- [`BRUMACHLYS.md`](./BRUMACHLYS.md) — the full build specification.
- [`DECISIONS.md`](./DECISIONS.md) — every design choice the PM locked for v1, with rationale. Read this before changing anything in `core/`.

## Layout

```
brumachlys/
├─ data/
│  ├─ units.json        # infantry + tank stats (Phase 2 roster)
│  ├─ terrain.json      # 6 terrain types
│  └─ maps/three-ways.xml
├─ public/
│  ├─ manifest.webmanifest
│  └─ icons/            # placeholder SVG icons (192, 512, maskable, apple-touch)
├─ src/
│  ├─ core/             # PURE — no DOM, no state, no Math.random
│  ├─ io/               # XML parsing, JSON loading
│  ├─ state/            # Zustand store (sliced: game / ui / replay)
│  ├─ ui/               # React components + styles
│  ├─ App.tsx
│  └─ main.tsx
└─ test/                # vitest, mirrors src/
```

## Conventions

- `core/*` is pure: no `Math.random`, no `Date.now`, no module-level state, no imports from `ui/` or `state/`. All randomness flows through `core/rng.ts`.
- All damage values route through `roundDamage` (Math.round half-up). See [`DECISIONS.md` §B.1](./DECISIONS.md).
- Initiative ties resolved by FNV-1a hash of `${unitId}|${round}`. See [`DECISIONS.md` §B.2](./DECISIONS.md).
- Coordinates are **odd-r offset** (q, r). Convert to cube only inside `core/hex.ts` for math.
- This is a PWA: precaches everything (~410 KiB), works fully offline after first load. Update flow uses a non-blocking toast.

## How to play (hot-seat)

1. **Round 1, Player 1 plans**: tap one of your amber units → its movement range (amber tint) and visible enemies in attack range (red tint) appear. Tap a tinted hex to queue a move; tap a red enemy to queue an attack. Use the bottom panel to set stance (`AGG | DEF | HOLD`).
2. Tap **Commit Orders →**. A black overlay appears: pass the device. Tap once, then `I am Player 2 — Reveal`.
3. Player 2 plans the same way (in teal). Tap **Commit**.
4. The resolver runs and the replay animates events in initiative order. Adjust speed (`0.5× / 1× / 2× / ⏭`) or skip.
5. Repeat until one faction has no units → win banner appears with **New game**.

Controls cheat-sheet:

- Tap own unit: select / deselect.
- Tap reachable amber hex: queue move there.
- Tap red enemy: queue attack on it.
- Tap stance pill: cycle `AGG → DEF → HOLD`.
- Tap ✕ next to a queued order: remove it.

## Lineage and licensing

Built fresh in TypeScript. Combat math ported from the 2007 Weewar spreadsheet (see `weewar.xls`); design choices cross-referenced against [Zetawar](https://github.com/Zetawar/zetawar) (MIT). **No code is vendored from Zetawar** — only conceptual reference, per spec §1.1.

The `weewar-maps/` directory in the project root contains the upstream Weewar map corpus (12k+ XML files, public). Only `1.xml` ("Three ways") is copied into `data/maps/three-ways.xml` for v1 — see [`DECISIONS.md` §B.9](./DECISIONS.md) for the future-add criterion.
