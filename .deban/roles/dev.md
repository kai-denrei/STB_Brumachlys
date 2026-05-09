---
role: dev
owner: gerald
status: active
---

# Dev — Brumachlys

Implementation log. Spec corrections. Concrete edge-case handling that future maintenance needs to know about.

## Decisions

- **2026-05-09** — Combat formula corrected: `damage = roundDamage(min(attackerCount, defenderCount) * p)`. The §3.1 prose says `attackerCount` only, but §11.2's third worked example (`round(6 * 0.55) = 3` against count-6 tank) only holds with `min`. The example is the test fixture; the prose is unauthoritative on this. Cross-link [[qa]] DECISIONS B.13 for full reasoning.
- **2026-05-09** — `startingUnits.length === 4` not 3 for `three-ways.xml`. The spec test in §11.5 was written without applying the §5.1 "drop factions ≥ 2" rule. 6 troopers in XML, 2 dropped → 4. Cross-link [[qa]] DECISIONS B.10.
- **2026-05-09** — `tiles.size === 190` is correct because Weewar maps are sparse. The 17×20 = 340 cells is the bounding box; only explicitly-defined `<terrain>` elements exist. Documented in [[qa]] DECISIONS B.11.
- **2026-05-09** — Stance semantics matrix locked (DECISIONS B.14):
  - aggressive → fires queued OR auto-target; counters
  - defensive → fires queued only; counters
  - hold-fire → silent (no fire, no counter)
  - This was a gap in the spec — §2.3 mentioned auto-attack but didn't enumerate the cases.
- **2026-05-09** — Auto-attack target order (B.15): closest enemy → highest enemy initiative → FNV-1a tiebreak.
- **2026-05-09** — Move-conflict execution: walk path step-by-step in init order; enemy blocks, friendly passes through; if final position lands on friendly, back up to last empty hex on path. The "two units want the same hex" case in §2.4 falls out naturally from init-ordered processing.
- **2026-05-09** — Init tie-break: FNV-1a 32-bit of `${unitId}|${round}`, ascending. Reference vectors (`'' → 0x811c9dc5`, `'a' → 0xe40c292c`, `'foobar' → 0xbf9cf968`) verified in tests.

## Dead Ends

- **2026-05-09** — Tried `:scope > name` CSS selector inside `parseWeewarMap` to read direct child elements. jsdom's XML mode doesn't support `:scope`. Replaced with manual `for (child of parent.children)` iteration in `directChildText` helper. Lesson: jsdom XML parser supports a subset of selectors; assume nothing modern.
- **2026-05-09** — Tried `import { defineConfig } from 'vitest/config'` in `vite.config.ts` to get the `test` field type. Caused TS2769 type collision because vitest 2.x bundles its own nested vite that conflicts with the project's vite 6. Resolved by splitting into separate `vite.config.ts` + `vitest.config.ts`. Lesson: vitest 2.x and vite 6 are incompatible at the type level; do not put `test` config inside `vite.config.ts`.
- **2026-05-09** — Initial test for "killed unit fizzles second attack" was based on flawed mental arithmetic. With `min(10, 1) * 0.4 = 0.4`, `Math.round(0.4) = 0`, no damage on first hit, so no fizzle scenario emerges. Spent ~30min before noticing. Replaced with a more realistic test using count-2 defensive tank + opposite gang-up. Lesson: low sub-unit counts behave non-intuitively; always hand-calculate expected damage before writing the test, especially at edge counts.
- **2026-05-09** — Initially had `aggressive` defenders auto-attack DURING resolver tests, which broke spec §11.2 fixture expectations (defender's auto-attack adds extra damage rounds). Fixed by setting test defenders to `defensive` so they counter without initiating. Lesson: spec test fixtures assume specific stance configurations; pinpoint them before importing as test cases.

## Open Questions

- Should `attackedFromHexes` accumulator clear at end-of-round (current behavior) or also reset per-defender after a configurable interval? Current behavior matches spec §3.2 explicitly.
- Pathing under fog (DECISIONS §B.5): planner shows dashed line through fogged hexes, resolver re-paths. Currently the UI doesn't visually distinguish — the `findPath` result is used for the move event but no dashed-vs-solid rendering yet.

## Assumptions

- Unit IDs are ASCII-only (`u0-0`, `u1-3`, etc.). FNV-1a uses `charCodeAt & 0xff` which truncates non-ASCII; this is documented but not enforced at construction.
- Counts always integer. `Number.isInteger` assertion was specified in DECISIONS §B.6 but not currently asserted in resolver — relies on `Math.max(0, count - dmg)` keeping it clean.

## Lessons

*(none yet)*

## Session Log

- **2026-05-09** — All 9 phases shipped via TDD on `core/*`. Discovered 3 spec contradictions (B.10, B.11, B.13) during implementation; all resolved by trusting worked examples over prose. ~2,500 LOC TS/TSX excluding tests.
