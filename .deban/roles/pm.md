---
role: pm
owner: gerald
status: active
---

# PM — Brumachlys

Scope keeper. Tracks what's in v1, what's deferred, and which assumptions haven't been validated.

## Decisions

- **2026-05-09** — All 7 §12 open questions resolved (defaults confirmed); see DECISIONS.md §A.
- **2026-05-09** — v1 scope: full 9-phase build on `three-ways` only, 2-unit roster. No additional maps, no full Zetawar roster, no save-state, no AI, no netcode. Cross-link [[arch]] for the determinism contract that justifies the deferrals.
- **2026-05-09** — Stance defaults to `aggressive` per spec §4.1, despite the surprise factor. Cross-link [[ux]] for mitigation (visible stance pill, segmented control).
- **2026-05-09** — Map storage: bundle only `three-ways.xml`. Future-add criterion: maxPlayers ≤ 2, dims ≤ 20×20, only Trooper unit type.

## Dead Ends

*(none yet)*

## Open Questions

- Combat balance on `three-ways` with 4 troopers / no economy — does the PoC reach a clean win in <15 rounds, or grind to stalemate? No playtest data yet.
- Whether to run a tiny playtest before adding more units / maps. Adding the full Zetawar roster (19 units) before validating the 2-unit core feel might bake in a tuning that doesn't match the resolver's actual behavior.
- Cleanup-vs-iterate priority: 7 deferred polish items (movement animation along path, attack flash, pan/zoom, save state, real PNG icons, better damage-number floats, additional unit types). Which delivers most user-felt value per hour? Likely: pan/zoom > movement animation > save state.

## Assumptions

- Hot-seat-only (one device, two players) is the correct PoC shape for verifying the simultaneous-turn design before investing in netcode.
- 2 unit types (inf, tank) is enough roster to validate the gang-up bonus and counter-attack mechanics. Snipers / artillery / air would test ranged + min-range > 1 logic that's currently exercised only by synthetic test fixtures.
- The `three-ways` map's geography produces interesting tactical decisions. We haven't actually played it; it could be a foregone conclusion based on starting positions.

## Lessons

*(none yet — none promoted from dead-ends in this session)*

## Session Log

- **2026-05-09** — All §12 open questions confirmed; deferred items written down explicitly so they don't drift back into scope; v1 shipped end-to-end.
