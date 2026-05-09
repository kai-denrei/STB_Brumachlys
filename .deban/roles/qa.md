---
role: qa
owner: gerald
status: active
---

# QA — Brumachlys

Test fixtures, coverage, and the spec-vs-fixture conflicts that came out of writing tests.

## Decisions

- **2026-05-09** — Strict TDD discipline on every `core/*` module: write test first, watch RED (verify failure mode is correct), implement, watch GREEN. Followed for: hex.ts (26 tests), rng.ts (14), combat.ts (22), pathing.ts (14), fog.ts (11), resolver.ts (17), weewar-xml.ts (14). Cross-link [[arch]] — the pure-core boundary is what made TDD cheap.
- **2026-05-09** — Final coverage: 118 tests across 7 files, all passing. UI tested manually only — no React Testing Library tests yet. Acceptable for PoC; would block if shipping multiplayer.
- **2026-05-09** — Test fixtures use the real `loadUnits()` / `loadTerrain()` registries when possible — catches integration drift between data and core. Synthetic types only used for "what if armor=0" / "what if can't attack" edge cases.
- **2026-05-09** — When the spec text and a worked example contradict, the worked example wins. Documented all 3 conflicts in DECISIONS.md (§B.10 startingUnits length, §B.11 tile count, §B.13 combat formula).
- **2026-05-09** — Determinism asserted by JSON-stringify equality of event logs (`expect(JSON.stringify(r1.log)).toBe(JSON.stringify(r2.log))`) for both same-input and reversed-input. Catches order-dependence regressions immediately.

## Dead Ends

- **2026-05-09** — Wrote test "killed unit fizzles second attack" assuming first hit kills count-1 tank. With `Math.round(min(10,1) * 0.4) = 0`, first hit does no damage. Test premise was unworkable. Lesson: at low defender counts the formula floors hard; design fixtures from the math, not from intuition.
- **2026-05-09** — Initial resolver test fixtures used default `aggressive` stance for both attacker and defender. Defender then auto-attacked back, adding extra damage that broke §11.2 expectations. Set defender to `defensive` (counters but doesn't initiate) for any fixture matching a §11.2 case. Lesson: spec test fixtures are stance-implicit; reproduce them with stances explicit.

## Open Questions

- No UI-level tests (component behavior, tap → state change, replay sequencing). If/when adding multiplayer, this becomes critical. For PoC: acceptable; manual smoke testing done.
- No property-based / fuzz testing on the resolver. The "order independence" test is one fixed pair; randomized order shuffles would surface latent dependencies.
- No test for the gang-up bonus calculation in a 3-attacker round (current tests cover 0, 1, 2 priors but not the additive case beyond opposite + flanking simultaneously).

## Assumptions

- `Math.round` half-up is stable across runtimes and won't be replaced by banker's rounding by accident. Locked behind `roundDamage` for swap-safety.
- `JSON.stringify` produces stable ordering for our event objects (objects with consistent key creation order — true in modern V8/JSC for plain literals). If an event ever uses a `Map`, this breaks; document if introduced.

## Lessons

*(none yet — no dead ends old enough to extract)*

## Session Log

- **2026-05-09** — 118/118 green. Three spec contradictions caught and documented during TDD; all surfaced at RED→GREEN transition (the test refused to pass against the prose-formula). Confirms the value of writing fixture tests directly from spec examples even when they look redundant with the prose definition.
