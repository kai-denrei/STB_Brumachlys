---
role: devops
owner: gerald
status: active
---

# DevOps — Brumachlys

Build, PWA, service worker, deployment.

## Decisions

- **2026-05-09** — Stack: Vite 6 + React 18 + TS 5.7 strict (with `noUncheckedIndexedAccess`). Vitest 2 for tests in a separate `vitest.config.ts`. `@fontsource/jetbrains-mono` self-hosted fonts.
- **2026-05-09** — `vite-plugin-pwa` with `registerType: 'prompt'` + `injectRegister: false` + `manifest: false`. Service worker registration is owned by the React tree (`usePwaIntegration` hook), not main.tsx, so the update-toast UI can hook into the same Workbox instance.
- **2026-05-09** — Strategy: `generateSW` (not `injectManifest`) — the app is small enough that a custom SW would be over-engineered. Workbox precaches everything matching `**/*.{js,css,html,svg,png,webmanifest,json,xml,woff,woff2}`. Current dist: 488 KB total, 405 KiB precached across 26 entries.
- **2026-05-09** — Manifest at `/public/manifest.webmanifest`. Icons are SVG (192/512/maskable/apple-touch-180), not PNG. Modern Chrome/Edge/iOS Safari accept SVG; some legacy Android may not. Documented in DECISIONS as future work.
- **2026-05-09** — Update flow: on `waiting`, `usePwaIntegration` exposes `needsUpdate`; `PwaToasts` renders a non-blocking bottom strip with an "Update" button. Tap → `messageSkipWaiting()` → on `controlling`, full reload. Spec'd to defer to planning phase but actually only mounted when `phase !== 'replay'` already (PwaToasts is in the second App return path).

## Dead Ends

- **2026-05-09** — Tried using `vitest/config`'s `defineConfig` in `vite.config.ts` to get the `test` field. Vite 6 + Vitest 2 cause TS2769 type collisions because vitest 2.x bundles its own nested vite. Split into two config files. Lesson: when stacking vite plugins with vitest 2.x, don't merge configs at the type level.
- **2026-05-09** — Initially registered the SW outside React in `main.tsx`. Worked, but tying the update-toast UI to it required a window-level event bridge. Refactored registration into `usePwaIntegration` hook so the toast can subscribe to the same Workbox events directly.

## Open Questions

- PNG icons not generated. Current SVG icons may not render correctly in older Android launchers. Should generate at least the 512 maskable as PNG via `sips` or similar.
- No CI configured. Tests run locally only. For solo PoC: acceptable. If the project gets shared, GitHub Actions running `npm ci && npm test && npm run build && npm run typecheck` is a 30-line addition.
- No deployment target chosen. Build output works as a static site (Vercel, Netlify, GitHub Pages, plain S3+CloudFront). Decision deferred until there's a reason to share.
- Real iOS device PWA install + offline test — pending. Simulator misses ~half of iOS-specific bugs.

## Assumptions

- The 405 KiB precache fits comfortably in the iOS Safari budget (which purges after 7 days inactivity for unused storage). Acceptable — re-precache on next launch.
- `workbox-window` v7 events (`waiting`, `controlling`) are stable and won't change behavior across Workbox 7.x patch updates.

## Lessons

*(none yet)*

## Session Log

- **2026-05-09** — PWA fully wired: precache, manifest, iOS head tags, update toast, install prompt (Chromium) + iOS A2HS hint. Build is 488 KB, precaches 26 entries / 405 KiB. SW emits `dist/sw.js` + `dist/workbox-*.js`. Dev server tested OK; production preview not yet validated.
