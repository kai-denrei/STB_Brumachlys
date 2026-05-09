# Brumachlys v1 — Decisions

> Authoritative PM ruling for the engineer. Solo PoC; "we will do X" everywhere.
> Captured at scaffold time. Update inline when overridden — do not silently drift.

---

## §12 Open Questions (resolved)

1. **Damage timing within round** — *Confirm: immediate application within Phase B (per §3.4).* Matches the spec's already-locked test fixture in §11.2 (gang-up case where Tank's count drops 10→6 before Inf-B fires); changing this would invalidate the spec's own combat math.
2. **Fizzled attack fallback** — *Confirm: no fallback; out-of-range attack is logged and wasted.* Simpler, deterministic, no AI to disambiguate "nearest" tie-breaks; consistent with hold-fire/defensive philosophy that targeting is explicit.
3. **Counter-attack initiative** — *Confirm: counter happens inside attacker's slot, defender's init irrelevant.* Matches Zetawar; halves the resolver state machine; preserves "concentrate fire" tactical identity.
4. **Initiative tie-breaking** — *Confirm: deterministic FNV-1a 32-bit hash of `${unitId}|${round}`.* FNV-1a is ~10 lines, well-distributed for short ASCII keys, no deps; "sum of charcodes" clusters badly when unit IDs share prefixes.
5. **Replay fog-of-war** — *Confirm: full reveal during replay.* PoC has no async/network so per-side replay would force a third hand-off screen per round; defer until multiplayer exists.
6. **Movement granularity** — *Confirm: integer tenths.* Matches Zetawar so JSON shape is transcribable; fractions risk floating-point drift in determinism tests.
7. **Pathing under fog** — *Confirm: planner assumes plains-cost (3) for fogged hexes; resolver re-paths at execution.* See §B.5 below for exact UX.

---

## Spec Gap Decisions

### B.1 Rounding mode — `Math.round` (round-half-up)
Spec §11.2 fixture `round(10 * 0.45) = 5` only holds under round-half-up; banker's gives 4 and breaks the fixture. All damage routes through `roundDamage` in `src/core/combat.ts` so a future swap is one line.

### B.2 Initiative tie-break hash — FNV-1a 32-bit
Implemented in `src/core/rng.ts` as `fnv1a32(s)` and `initTieKey(unitId, round)`. Sort ascending by hash, descending by initiative — lowest hash wins ties. Reference vectors verified:
- `fnv1a32('') === 0x811c9dc5` (offset basis)
- `fnv1a32('a') === 0xe40c292c`
- `fnv1a32('foobar') === 0xbf9cf968`

Unit IDs are ASCII by convention (`unit-0`, `unit-1`, …) — `charCodeAt & 0xff` truncation is therefore safe.

### B.3 Canvas vs SVG — **Canvas 2D**
Single `<canvas>`, manual draw in a `requestAnimationFrame` loop. Reasons: animation frame budget for 600ms transitions, memory cost of 340 SVG `<polygon>`s on low-end iPhones, future fog-shading and damage-number floats. Cost: hand-rolled point-in-hex hit-test (~15 lines via cube round). Accepted.

### B.4 State management — three sliced Zustand stores in one root
`gameSlice` (pure game state) + `uiSlice` (selection/hover/panels) + `replaySlice` (event-log cursor/speed/paused). Single `useStore()`, three selectors. Pure resolver in `core/` never imports the store. Slicing now costs 30 lines and pays back immediately in Phase 8 (replay-speed changes shouldn't re-render the order panel). Skeleton in `src/state/store.ts`.

### B.5 Pathing under fog — UX
Planner shows the path as: solid amber polyline through visible hexes; dashed amber polyline through fogged hexes; cost displayed is *optimistic* (plains-cost assumption). On commit, if the resolver discovers the actual path is shorter due to higher-cost terrain, the unit stops where its budget runs out and the replay log emits a `path-truncated` event with the original planned destination and actual stop hex. No mid-resolution re-prompt.

### B.6 Damage rounding cascade — integer-only counts throughout
`count: number` is always an integer in `[0, 10]`. `attackDamage()` returns an integer (per B.1). Subtraction stays integer. The spec example (count=2, dmg=1.4 → round to 1, leaving 1) is fine. Engineer must add an assertion `Number.isInteger(unit.count)` at every state transition in the resolver.

### B.7 Hot-seat handoff — two-tap confirmation
Full-screen amber-on-black overlay reading `Pass device to Player 2 — tap when ready`, then a second `[ I am Player 2 — Reveal ]` button after first tap. No timer, no auto-advance. Mobile pockets and accidental taps are real; one-tap dismiss leaks fog if the device is handed mid-animation. Two taps cost 0.5s and prevent the bug class entirely. Copy is monospace, all-caps for the button.

### B.8 Mobile equivalent of right-click — segmented control in the side panel
Three-button segment `AGG | DEF | HOLD`, visible whenever a friendly unit is selected. No long-press (collides with iOS context menu, undiscoverable), no swipe (collides with pan). Right-click on desktop still cycles as a power-user shortcut, but parity is via the panel.

### B.9 Map storage — bundle only `three-ways.xml` for v1
`data/maps/three-ways.xml` (copied verbatim from `weewar-maps/1.xml`). Future-add criterion: `maxPlayers ≤ 2` AND `width ≤ 20` AND `height ≤ 20` AND no unit types beyond `Trooper` (Phase 2 roster).

### B.10 Spec contradiction — `startingUnits.length`
Spec §11.5 asserts `map.startingUnits.length === 3`. Verified actual: `weewar-maps/1.xml` has **6 Trooper start positions** across 3 factions (2 each for factions 0, 1, 2). After dropping factions ≥ 2 per spec §5.1 → **4 Troopers remain, not 3**. Engineer writes the test as `expect(map.startingUnits.length).toBe(4)` plus `expect(map.startingUnits.every(u => u.faction === 0 || u.faction === 1)).toBe(true)`.

### B.11 Spec contradiction — tile count vs grid size
Spec §9 / §11.5 both assert `tiles.size === 190`, but a 17×20 grid has 340 cells. Resolution: Weewar maps are *sparse* — only explicitly-defined `<terrain>` elements exist; off-map cells are absent. `1.xml` has exactly 190 `<terrain>` elements (verified). `width`/`height` are the bounding box. Engineer treats `tiles` as a `Map<string, TerrainKey>`; absent cells are non-traversable void.

### B.12 Neutral bases (`startFaction="5"`)
`1.xml` contains `startFaction="5"` for unowned/neutral bases. Spec doesn't address. **Decision:** treat any `startFaction` not in `{0, 1}` as `null` (neutral) in `startingBases`. Captures are out of PoC scope, so neutrals are visual-only.

### B.13 Combat formula correction — `min(attackerCount, defenderCount)`
**Spec contradiction discovered during implementation.** §3.1 states `damage = round(attackerCount * p)`, but §11.2's third worked example computes `round(6 * 0.55) = 3` with attacker count 10 and defender count 6. The example is the authoritative test fixture, so the canonical formula is:
```
damage = roundDamage(min(attackerCount, defenderCount) * p)
```
Thematic reading: the smaller count is the number of "engagements" in the duel; you can't kill more sub-units than the defender fields. All three §11.2 fixtures hold under this reading; the §3.1 formula text alone does not.

### B.14 Stance semantics in combat
The spec says aggressive units "auto-attack" and counter-attacks are automatic but does not enumerate the case combinations. **Decisions:**

| Stance      | Queued attack fires? | Auto-attack? | Counter-attack? |
|-------------|----------------------|--------------|-----------------|
| aggressive  | yes                  | yes (if no queued) | yes        |
| defensive   | yes                  | no           | yes             |
| hold-fire   | no (silent)          | no           | no (silent)     |

Rationale: aggressive = "shoot anything that comes near"; defensive = "I won't initiate but I'll defend"; hold-fire = "I'm hidden — no muzzle flash". A unit fires at most ONCE per Phase B (queued takes precedence over auto). Counter is independent of own fire.

### B.15 Auto-attack target selection (aggressive without queued)
Order of preference, all deterministic:
1. Closest enemy in range (lowest hex distance)
2. Highest enemy initiative (kill priority targets first)
3. `initTieKey(enemyId, round)` ascending (FNV-1a stable tiebreak)

If no enemy in range: silent skip (no `lost-target` log entry — that's reserved for queued attacks).

### B.16 Damage application during exchange (one-tick)
`battleExchange` computes both attacker→defender damage AND counter against STARTING counts of the exchange, then applies both simultaneously. This matches §3.3 verbatim. The accumulator (`attackedFromHexes`) is appended AFTER the strike, and the counter does not contribute its own hex to that accumulator.

### B.17 Move-conflict execution detail
The resolver walks the planned path step-by-step in init order (so high-init units resolve first). At each step:
- enemy unit at next hex → stop here (don't enter)
- friendly unit at next hex AND budget exhausted/end-of-path → pass-through is consumed but final position is the last empty hex (not the friendly's hex)
- friendly unit at next hex AND more steps remaining → pass-through allowed
- terrain impassable for this unit type → stop
- budget < step cost → stop

This implements §2.4 and DECISIONS §B.5 cleanly without a separate "two units want the same hex" branch — natural init-ordering takes care of it.

---

## PWA & Mobile Decisions

### C.1 Orientation — `portrait-primary`, locked via manifest
17×20 is taller than wide; one-handed phone use is overwhelmingly portrait. Hex math is orientation-agnostic — render the q/r grid with the r-axis vertical-major.

### C.2 Viewport sizing — auto-fit on load + pan + pinch-zoom (clamped 0.7×–2.5×)
No double-tap-to-zoom (collides with double-tap-to-deselect). Default zoom = "fit map height to viewport height minus chrome". Pan via single-finger drag on empty hexes; selection via tap on a unit hex (panning suppressed if `touchstart` lands on a friendly unit).

### C.3 Install prompt — after first completed round
Suppressed on iOS (no `beforeinstallprompt`); instead show a one-time bottom-sheet on first session: `Add to Home Screen — tap [share icon] then "Add to Home Screen" to install Brumachlys.` Dismissible, never re-shown unless localStorage cleared.

### C.4 Service worker — precache everything
Single Workbox `precacheAndRoute(self.__WB_MANIFEST)` covers HTML, JS, CSS, JSON registries, and `three-ways.xml`. Total bundle target < 500 KB gzipped. Lazy-loading splits buy nothing for a < 1 MB game.

### C.5 Offline behavior — offline-native
*"Brumachlys is offline-native: after the first load, the entire game runs from cache with no network dependency. There is no backend, no telemetry, no online multiplayer."* No offline banner — there's nothing to be offline *from*.

### C.6 Update UX — non-blocking toast deferred until planning phase
Use `workbox-window`'s `controlling`/`waiting` events; on `waiting`, show a bottom toast: `New version ready — tap to update`. Tap calls `skipWaiting`, then reloads on `controllerchange`. Auto-dismiss after 30s (user keeps old version until next manual reload). Defer if `phase !== 'planning'` so resolution animations are never interrupted.

### C.7 iOS head tags — present in `index.html`
```html
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="theme-color" content="#0E0F10">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Brumachlys">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.svg">
```
**iOS limitations affecting THIS game:** purgeable storage after 7d (we re-precache); no `beforeinstallprompt` (handled by C.3); apply `env(safe-area-inset-*)` padding to chrome (in `styles.css`); `overscroll-behavior: none` on root (set).

### C.8 Palette (final hex codes)

| Role               | Name           | Hex                     | Use                                       |
|--------------------|----------------|-------------------------|-------------------------------------------|
| `bg-base`          | Brume Black    | `#0E0F10`               | Page background, canvas clear color       |
| `bg-elev`          | Achlys Slate   | `#1A1B1E`               | Side panel, overlays, modals              |
| `hairline`         | (derived)      | `#2A2B2E`               | Borders, dividers                         |
| `fg-text`          | Bone           | `#E8E4D8`               | Primary text, monospace                   |
| `fg-muted`         | Ash            | `#8A8B85`               | Secondary text, disabled                  |
| `accent-faction-0` | Ember Amber    | `#E89A3C`               | Faction 0, selection rings, primary CTA   |
| `accent-faction-1` | Iron Teal      | `#3FB7B0`               | Faction 1, secondary CTA                  |
| `fog-overlay`      | Mist           | `rgba(14,15,16,0.78)`   | Fogged-hex multiply layer                 |

`theme_color` in manifest = `#0E0F10`. Font: `JetBrains Mono` self-hosted via `@fontsource/jetbrains-mono` (offline parity).

---

## Scaffold Scope

### Done in v1 scaffold (engineer completed these)
- Full directory tree per spec §8.
- Vite 6 + React 18 + TS 5.7 strict; `noUncheckedIndexedAccess` on.
- Deps installed: `zustand`, `vite-plugin-pwa`, `workbox-window`, `@fontsource/jetbrains-mono`, vitest stack.
- `vite.config.ts` with `vite-plugin-pwa` configured (registerType `prompt`, generateSW, manual register in main.tsx, separate `manifest.webmanifest`).
- `index.html` with all `<head>` tags from C.7, viewport meta, manifest link, apple-touch-icon.
- `public/manifest.webmanifest` per C.1/C.8 values.
- `src/main.tsx` mounts React root + registers SW with prompt-on-update plumbing (toast UI deferred — registration logic works).
- `src/App.tsx` placeholder page with phase status table in palette colors.
- `src/ui/styles.css` with the full palette as CSS custom properties, safe-area insets, monospace base.
- **Fully implemented & tested (Phase 1):**
  - `src/core/types.ts` — every type from spec §4 verbatim, plus `ResolutionEvent`.
  - `src/core/orders.ts` — `Order` union + `validateOrder` signature stub.
  - `src/core/hex.ts` — odd-r offset hex math: `distance`, `neighbors`, `adjacent`, `opposite`, cube conversions, `key`, `equals`. **26/26 tests passing.**
  - `src/core/rng.ts` — xorshift32 (`createRng`, `next`, `nextFloat`, `clone`) + FNV-1a (`fnv1a32`, `initTieKey`). **14/14 tests passing**, including FNV-1a reference vectors.
- **Stubbed with signatures + `TODO(phase-N)`:**
  - `src/core/combat.ts` (phase 3)
  - `src/core/resolver.ts` (phase 4)
  - `src/core/pathing.ts` (phase 3)
  - `src/core/fog.ts` (phase 5)
  - `src/io/weewar-xml.ts` (phase 2; `coerceFaction` helper is real)
  - `src/io/data-loader.ts` (real — JSON imports with type assertion)
  - `src/state/store.ts` — Zustand store with three slices wired; actions throw `TODO(phase-7+)`.
- `data/units.json` — full content (infantry + tank).
- `data/terrain.json` — full content (6 terrain types).
- `data/maps/three-ways.xml` — copied from `weewar-maps/1.xml`.
- `test/combat.test.ts` etc. — `describe.todo` blocks per phase, all green.
- `public/icons/*.svg` — placeholder amber `B` glyph at 192/512/maskable/180. SVG icons (iOS 13+ accepts).
- `.gitignore`.

### Deferred to phase 2+ (stubs + TODO markers in place)
- Combat resolver implementation (combat math + battle exchange).
- Pathing implementation (Dijkstra with movement-cost weights).
- Fog visibility computation.
- Weewar XML parser body.
- All UI components beyond placeholder (`Board`, `Hex`, `Unit`, `OrderPanel`, `HudHeader`, `Handoff`, `Replay`).
- Real PNG icons (engineer can convert SVGs via `sips` or any rasterizer if required).
- Update toast UI (registration + `waiting`/`controlling` plumbing already wired in `main.tsx`).
- Replay animation timeline.
- Win condition banner.
- New Game reset.
- Save game / IndexedDB.
- Additional unit types beyond infantry + tank.
- Map curation beyond `three-ways.xml`.

---

## Concrete values reference

### Hash function for initiative tie-breaking (TS, in `src/core/rng.ts`)
```ts
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
export const initTieKey = (unitId: string, round: number): number =>
  fnv1a32(`${unitId}|${round}`);
```

### Rounding mode (TS, in `src/core/combat.ts`)
```ts
export const roundDamage = (raw: number): number => Math.round(raw);
```

### `vite-plugin-pwa` config skeleton (in `vite.config.ts`)
```ts
VitePWA({
  registerType: 'prompt',
  strategies: 'generateSW',
  injectRegister: false,
  manifest: false,                         // we ship our own /public/manifest.webmanifest
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,json,xml,woff,woff2}'],
    navigateFallback: '/index.html',
    cleanupOutdatedCaches: true,
    clientsClaim: false,                   // controlled by toast
    skipWaiting: false                     // controlled by toast
  },
  devOptions: { enabled: false }           // SW only in production builds
});
```

---

*End of decisions. Engineer: any question this document does not answer is by definition out-of-scope for v1 scaffold — punt to a `// TODO(phase-N)` and keep moving.*
