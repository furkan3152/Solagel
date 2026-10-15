# Slana Motion + Sound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Replace hard cuts with Paper Ticket transitions, add a three-bus synthesized sound system (effects, lo-fi music, announcer), fix the dev sign-in bug, and re-record the walkthrough with audio.

**Spec:** `docs/superpowers/specs/2026-10-15-slana-motion-and-sound-design.md`

## Global Constraints
- Web only (`apps/web`), plus the dev fake server state in `apps/server/src/chain/dev-fake.ts` where noted. No program, SDK or protocol changes.
- `motion/react` + presets in `apps/web/src/design/motion.ts`; every transition has a reduced-motion path (opacity ≤ 150 ms or none).
- Audio is synthesized WebAudio (no audio files); announcer uses `speechSynthesis` when available, silently no-ops otherwise.
- Defaults: master 0.6, music 0.25, sfx 0.7, voice 0.5; all persisted in settings; master mute in the header mutes everything.
- English only (CI guard). No emoji in UI. Touch targets ≥ 44 px. Contrast ≥ 4.5:1.
- Done means: `pnpm -r typecheck && pnpm -r test`, `pnpm -F @slana/web build` green; bundle size reported before/after.

## Task 1: Dev fixes + motion transitions
- Fix SIWS in the documented dev setup: `apps/web/vite.config.ts` proxies `/api` with `changeOrigin: true`, so the server builds the sign-in message for `127.0.0.1:8787` while the web expects `localhost:5173`. Make the dev proxy preserve the original host (or forward `X-Forwarded-Host` and have the server honour it only when `TRUST_PROXY`/dev), so sign-in works with `NODE_ENV=development DEV_FAKE_CHAIN=1 pnpm dev` and no extra env. Test.
- Dev fake: make Pass mint demonstrable — a fresh wallet does not own a Pass, the mint is open and unrevealed (seed published later by a dev-only action), so the UI can show mint → envelope → sealed passport; keep the existing revealed-pass path available behind a dev flag. Keep production paths untouched.
- Implement the spec's Motion table: `ScreenTransition` (lobby ↔ game: ticket punch + paper wipe + camera zoom-in; reverse on exit), tab page-turn, sheet rise, death slow-mo (renderer time-scale only), cash-out receipt slip, coin drop on join/respawn, staggered lists, pinned-note toasts, stamp spinner/skeletons.
- Tests: RTL for transition mount/unmount and reduced-motion; Playwright smoke lobby → practice → lobby with no console errors; screenshots of mid-transition frames to the scratchpad.

## Task 2: Sound system
- `apps/web/src/audio/` — `mixer.ts` (master/music/sfx/voice buses, limiter, ducking, persistence), `sfx.ts` (extend the existing kit with paper rustle, hover tick, punch, stamp variants, tear, printer, envelope/seal, coin cascade, whoosh; re-balance game sounds), `music.ts` (procedural lo-fi: lobby + game moods, 1.5 s cross-fade, ducking), `announcer.ts` (speechSynthesis lines + cooldowns from the spec).
- Wire sounds to every interaction and transition; settings page gains per-bus sliders + toggles (announcer on/off).
- Expose a dev-only hook to tap the master bus into a `MediaStreamDestination` for recording.
- Tests: mixer routing/persistence, ducking, announcer cooldown (mocked speechSynthesis), hover rate-limit.

## Task 3: Walkthrough video with audio
- Re-record the 4-minute walkthrough (reuse the scratchpad `walkthrough.mjs`) on the new build, capturing game audio through the dev master-bus tap + MediaRecorder, mux with ffmpeg; include Pass mint now that the fake allows it. Announcer audio is captured only if speech is routed through WebAudio — if not, note it.
