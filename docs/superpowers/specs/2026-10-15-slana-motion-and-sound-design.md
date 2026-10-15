# Slana: motion transitions and sound design

Status: approved by the owner in chat (2026-10-15). Scope: web client only (`apps/web`).

## Goals

1. **No hard cuts.** Every change of screen or state animates in the Paper Ticket language. Transitions are short (180–600 ms), never block input for long, and collapse to a fade (or nothing) under `prefers-reduced-motion`.
2. **Sound that fits and never annoys.** Synthesized WebAudio only (no downloaded audio files), with separate controls for music, effects and announcer. Defaults are quiet.

## Motion

| Moment | Transition |
|---|---|
| App boot → lobby | Paper sheet slides up with a slight settle; the wordmark prints in two riso layers (misregistration snaps into place). |
| Lobby tab change (Tickets / Ranks / Pass / Profile / Guide) | Newspaper page turn: outgoing column slides and fades left, incoming slides in from the right with a 2–3° paper skew that settles; tab underline glides. |
| Lobby → game (practice or after ticket purchase) | "Ticket punch": the chosen ticket stub is punched (hole + paper confetti), then an iris/curtain wipe in paper colour opens onto the world while the camera zooms from far to normal. |
| Game → lobby (exit, after death, after cash-out) | Reverse wipe: the world shrinks into a paper card that slides back into the lobby. |
| Sheets (ticket, mint, cash-out, death, settings, claim) | Bottom sheet rises with spring + paper shadow; the backdrop dims with grain. Existing stamp/print/tear/envelope animations kept and chained so each step flows into the next. |
| Death | Short slow-motion (world time-scale ease to 0.3 for ~400 ms in the renderer only), ink splash, then the EATEN sheet. |
| Cash-out | Channel ring fills; on completion a receipt slips out of the HUD till and grows into the cash-out sheet. |
| Join a room / respawn | Your coin "drops" onto the paper (scale overshoot + ink ring). |
| Lists and numbers | Staggered entrance for ticket list, standings rows and passport fields; counters roll (existing `Counter`). |
| Toasts | Slide + small rotation like a pinned note; leave with a flick. |
| Loading states | Paper-stamp spinner instead of blank waits; skeleton rows printed with halftone. |

All motion uses `motion/react` and the shared presets in `design/motion.ts` (extend with `page`, `wipe`, `punch`, `drop`). A single `<ScreenTransition>` owns lobby↔game; `AnimatePresence` handles tabs and sheets. Reduced motion: opacity-only fades ≤ 150 ms, no camera zoom, no slow-motion.

## Sound

Three buses into a master gain with a soft limiter: **music**, **sfx**, **voice**. Settings gain per-bus volume sliders and mutes (persisted); master mute in the header stays. Audio unlocks on the first user gesture.

**Effects (sfx)** — extend the existing synthesized kit so every interaction has a small sound: paper rustle (tab/page turn, sheet open/close), pencil tick (hover on tickets, quiet and rate-limited), ticket punch, stamp thud (PAID / VALID / EATEN variants), tear, printer chatter (receipt), envelope + wax seal, coin cascade (payout), soft whoosh (transitions), in-game chomp/split/eject/virus/loot already exist and are re-balanced. Nothing louder than −12 dBFS peak; hover sounds at most 8 per second.

**Music** — procedural lo-fi loop (pentatonic, ~80–90 BPM, warm pad + soft keys + brushed percussion from filtered noise). Two moods from the same generator: *lobby* (lighter, more melodic) and *game* (calmer bed, less melody). Cross-fade 1.5 s on screen change. Ducks by ~6 dB under announcer lines and big stingers. Default music volume low (0.25).

**Announcer (voice)** — short English lines via the browser Speech Synthesis API (no recorded files), picking a calm English voice when available, rate ~1.0, low volume (0.5), with a global cooldown (≥ 4 s) and per-line cooldowns so it never chatters. Lines: room joined ("Welcome to Penny Pond."), ticket punched ("Ticket punched. Good luck."), first player eaten ("First bite!"), streaks ("Double!" / "Triple!"), big growth ("Whale alert."), cash-out started/complete ("Cashing out." / "Paid."), eaten ("Eaten. Shake it off."), Pass minted ("Your Pass is in the mail."), reveal complete ("Passes revealed."). If no speech voices exist, the announcer silently does nothing. Announcer can be turned off in settings and is muted with the master mute.

## Testing

Unit tests for the audio bus routing/volume persistence and the announcer cooldown logic (mock `speechSynthesis`); RTL tests that transitions render and that reduced-motion paths skip them; Playwright smoke of lobby → practice → lobby with no console errors. Build size of the web bundle reported (music generator must stay small).
