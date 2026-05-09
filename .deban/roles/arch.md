---
role: arch
owner: gerald
status: active
---

# Architecture — Brumachlys

Pure-core boundary, state model, rendering choice, determinism contract.

## Decisions

- **2026-05-09** — `core/*` is pure: no DOM, no `Math.random`, no `Date.now`, no module-level state, no imports from `ui/*` or `state/*`. RNG flows through `core/rng.ts` (xorshift32) only. Cross-link [[qa]] — this is what makes determinism testable.
- **2026-05-09** — Resolver returns `{ newState, log }` and is invoked by the store via `resolveAndReplay`. Replay UI animates events from the OLD state (snapshot in store before resolve) to reach `newState`; store flips to `newState` only after `finishReplay`. This means the store's `game` field IS the replay baseline during `phase: 'replay'` — no separate ref needed.
- **2026-05-09** — Canvas 2D over SVG. Reasons: animation frame budget for 600ms transitions, memory cost of 340 SVG `<polygon>`s on low-end iPhones, future fog shading and damage-number floats. Cost: hand-rolled point-in-hex hit-test (`pixelToHex` via cube round, ~15 lines).
- **2026-05-09** — Sliced Zustand store (game / ui / replay slices in one root). Avoided one-big-store re-render storms in advance. Total: ~290 lines for full game lifecycle including handoff + replay state machine.
- **2026-05-09** — Map XML loaded via Vite `?raw` import (`import threeWaysXml from '../data/maps/three-ways.xml?raw'`) rather than runtime fetch. Bundles into JS chunk — one HTTP request, simpler offline story, no separate precache rule for the data file. Cost: rebuild required to swap maps. Acceptable for v1 with one map.
- **2026-05-09** — Unit-type and terrain-type registries are loaded once via `data-loader.ts` (real implementation, not stub) and threaded as args to pure functions (`resolveRound`, `visibleHexesFor`). Avoided embedding them in `GameState`, which keeps the state shape lean and makes determinism tests easy to construct.

## Dead Ends

- **2026-05-09** — Considered putting `unitTypes` registry inside `GameState` so functions only need state. Rejected: bloats the state shape (~14 KB of static data per snapshot for the future full roster), adds noise to determinism tests, no real upside since the registry is global anyway.
- **2026-05-09** — Considered ban on pass-through-friendly during planning to simplify the planner. Rejected: spec §2.4 mandates pass-through, and disallowing it would force suboptimal paths in `findPath`. Kept the conservative approach inside `reachableHexes` (friendly hexes excluded as destinations but still traversable mid-path).

## Open Questions

- Save-game / persistence: should it write GameState snapshots to IndexedDB so refresh doesn't lose progress? Current cost of losing progress is "redo this round". Adds a serialization layer (`Map<string, TerrainKey>` doesn't JSON-serialize cleanly).
- Pan/zoom on the canvas was specified but deferred. Auto-fit alone makes hexes ~20px on a 5.4″ phone — usable but tight. Implementing pinch-zoom needs a viewport-control hook + tap-vs-drag disambiguation.

## Assumptions

- `structuredClone` is available everywhere we ship (Node 17+, Safari 15.4+, Chrome 98+). Used in `resolveRound` and Replay's working state. iOS Safari < 15.4 would fail at runtime; we don't currently target it.
- `requestAnimationFrame` is sufficient for the 600ms-per-event replay animation budget. Untested on lower-end Android.

## Lessons

*(none yet)*

## Session Log

- **2026-05-09** — Pure-core boundary held cleanly across all 9 phases; no UI imports leaked into `core/`. Sliced store paid off in Phase 8 (replay-speed setter never re-renders OrderPanel). `?raw` import for the XML simplified the offline story significantly.
