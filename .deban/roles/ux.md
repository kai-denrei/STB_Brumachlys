---
role: ux
owner: gerald
status: active
---

# UX — Brumachlys

Mobile-first portrait. Editorial dark palette. Two-tap handoff. Touch ≠ desktop right-click.

## Decisions

- **2026-05-09** — Portrait-primary lock via manifest `orientation`. A 17×20 map is taller than wide; one-handed phone use is portrait-first. Hex math is orientation-agnostic so this is a render-choice only.
- **2026-05-09** — Two-tap handoff overlay (DECISIONS §B.7): "Pass device to Player 2 — tap when ready" → "I am Player 2 — Reveal". Mobile pockets and accidental taps are real; one-tap dismiss leaks fog. Two taps cost 0.5 s.
- **2026-05-09** — Right-click → mobile equivalent is a 3-button segmented control `AGG | DEF | HOLD` in the side panel (DECISIONS §B.8). Long-press conflicts with iOS context menu and is undiscoverable; swipe collides with pan. Discoverability beats clever gestures.
- **2026-05-09** — Stance pip rendered above each unit (red/blue/grey for aggressive/defensive/hold-fire). Cheap visual signal of unit posture without opening the panel.
- **2026-05-09** — Tap own unit shows movement range (amber) and attack range against visible enemies (red) simultaneously. Same-tap action: tap reachable hex → queue move; tap red enemy → queue attack. Avoided a "select mode" toggle (Plan Move / Plan Attack buttons) — extra friction.
- **2026-05-09** — Order panel locked at 220px fixed height. Selecting a unit no longer reflows the canvas, eliminating the perceived "zoom" jump on selection. Internal scroll on the variable-content region; footer (Commit) always visible. Cross-link [[arch]] — canvas ResizeObserver was the cause.

## Dead Ends

- **2026-05-09** — Initial OrderPanel layout used `flex: 0 0 auto` + `max-height: 40dvh` + `overflow-y: auto`, growing the panel as content appeared. This caused the canvas's flex-1 ancestor to shrink, ResizeObserver fired, `fitToViewport` recomputed with a smaller height, hexes shrank — visible as a "zoom" jump on every selection. Lesson: when a flex sibling holds a `ResizeObserver`-driven canvas, lock heights of the variable siblings or expect cascade reflows.
- **2026-05-09** — Considered showing install prompt on first paint. Rejected: user has no investment in the app yet. Gated on `game.round > 1` instead — they've completed a round before being asked.

## Open Questions

- Does 220px panel height overflow on iPhone SE (1st-gen, 320×568 logical)? After HUD (~50px) and panel (220px), board has 298px. Hexes at that size on a 17-wide map are ~17px — usable but tight. Untested.
- Does the user understand the stance pip color encoding without legend? `red = aggressive` is non-obvious without context.
- The "tap reachable hex to move" pattern: when user wants to move ONE step then attack from that position, does the planning order matter to them? Currently must queue move first, attack updates from planned destination.
- Pinch-zoom + pan on the canvas was specified (DECISIONS §C.2) but deferred. On phones smaller than iPhone 12, hexes may be too small for reliable tapping. Acceptance threshold not validated.

## Assumptions

- Players know how to read a hex grid. No tutorial.
- Faction colors (amber #E89A3C ember, teal #3FB7B0 iron) are accessible enough — neither relies on red-vs-green so deuteranopia OK; both differ in luminance by ~6% which is borderline for protanopia. Untested on real users.
- Auto-fit-to-screen is sufficient sizing. No initial pan/zoom.

## Lessons

*(none yet)*

## Session Log

- **2026-05-09** — Full mobile-PWA UI shipped. One UX bug found and fixed mid-session: panel-growth zoom cascade. Two-tap handoff implemented per spec; install prompt + iOS A2HS hint plumbed through `usePwaIntegration` hook.
