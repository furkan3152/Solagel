# slana.io: landing site, NFT allowlist (WL) and collab applications

Status: requested by the owner in chat (2026-10-17). X account: **@slanaio**. Domain: **slana.io**.

## Goals

1. **The public home is a landing site, not the game.** It is a creative, animated page in the vivid Paper Ticket language
   (`docs/design/palette.md`). It shows no way into the game.
2. **The game is admin-only for now.** It is reachable only from `/admin` with the admin wallet signed in, for the
   owner's own testing. The server enforces this: no join, ticket or room access without an admin session, unless
   `GAME_PUBLIC=1`.
3. **WL application** for future Slana NFT minters, with tasks the admin can add, edit, reorder and disable later.
4. **Collab application** for communities (DAOs, guilds, alpha groups, NFT projects), modelled on fhecat.com/collab:
   apply → review → (if approved) spots + deadline → add winners' wallets → submit with the raffle post.
5. Every submission lands in **`/admin`**, where the owner reviews, approves or rejects, and exports.

## Public site (`/`)

- **Hero:** the riso wordmark alive. Coins drift, bounce and eat each other on paper; the ink misregisters. There is a
  short tagline ("Eat. Grow. Last the round.") and two CTAs: **Join the WL** and **Collab**. Collab shows "Soon" when
  applications are closed.
- **Sections, scroll-animated:**
  - what Slana is: on-chain coin arenas on Solana, 5-minute rounds;
  - how a round works, as an animated ticket strip: buy ticket → eat → bell → paid;
  - the coins, a gallery of skins drawn with `packages/art`;
  - the NFT teaser: "Slana NFT · coming soon", with sealed card animations;
  - FAQ;
  - footer: X @slanaio, slana.io.
- **Motion:** `motion/react` presets. A reduced-motion path for everything. Fast: lazy-load heavy art and keep the
  first paint light. Responsive down to 360 px. Touch targets ≥ 44 px. Contrast ≥ 4.5:1.
- **Social:** OG and Twitter card meta (`twitter:site` @slanaio), plus favicon and touch icons from the brand art.
- **English only.**

## WL application (`/wl`)

A stepper of tasks. The admin owns the task list. Each task has:

| Field | Meaning |
|---|---|
| `id` | stable id |
| `kind` | `follow_x` (account), `post_x` (user posts, pastes a link), `engage_x` (like/repost/reply a given post, user pastes the reply link), `join_link` (Discord or Telegram invite, self-attested), `text` (free answer), `wallet` (Solana address) |
| `title`, `body` | copy shown to the user |
| `target` | URL or handle the task points at, when the kind needs one |
| `required` | must be done to submit |
| `enabled`, `order` | visibility and position |

- **Default tasks:**
  1. Follow @slanaio.
  2. Post about Slana on X (tag @slanaio) and paste the link.
  3. Like, repost and reply to the pinned launch post. Its link is configurable; until it is set, the step shows "opens
     when the post is live".
  4. Your X handle.
  5. Your Solana wallet.
- **Wallet ownership:** the applicant signs in with their Solana wallet (SIWS, already in the app). The wallet field is
  that wallet. Signing is free and sends no transaction. One application per wallet and one per X handle, both unique.
- **Validation:**
  - X post links must match `x.com|twitter.com/<handle>/status/<id>`.
  - Handles are normalised.
  - A honeypot field.
  - Per-IP and per-wallet rate limits.
- **After submitting:** the user sees their status (pending / approved / rejected) when they sign in again with the same
  wallet. Tasks are verified by hand; there is no X API.
- **A shareable card:** a riso "ticket" with the handle and a coin generated from it, saved as PNG and suggested for the
  post.
- **Switch:** `wlOpen` (admin). When closed, `/wl` shows "Applications are closed, follow @slanaio".

## Collab application (`/collab`)

The same flow and fields as fhecat.com/collab, adapted:

- **Apply form:**
  - community name;
  - type: DAO / Guild / Alpha group / NFT project / Other;
  - members;
  - community X;
  - your X;
  - your Discord (optional);
  - your role: Founder / Community manager / Moderator / Other;
  - link to a post about Slana on the community's X (tag @slanaio, required);
  - about your community (≤ 600 characters).
  
  Signed with the applicant's Solana wallet. One X account can apply at most 2 times.
- **States:**
  - in review;
  - not this time;
  - approved, with N spots and a deadline set by the admin, a countdown and a raffle-post link field;
  - wallet table, one name + Solana wallet per row, with paste-a-list support;
  - submitted, which locks the list;
  - closed.
- **Collab guide modal:** the rules plus a copyable raffle post that mentions @slanaio.
- **Duplicates:** a wallet already submitted by another collab or WL is flagged in admin, not silently dropped.
- **Switch:** `collabOpen` (admin). The landing's Collab button reads it.

## Admin (`/admin`, admin wallet only)

Existing chain admin stays. New tabs:

- **Play:** opens the game for the signed-in admin.
- **WL:**
  - A table of applications with filters (status, search) and a detail view with clickable task links.
  - Approve, reject, or reset to pending, singly or in bulk.
  - Notes.
  - CSV export (approved wallets only, or all).
  - Counts.
- **Tasks:**
  - Add, edit, reorder, enable and disable WL tasks with the fields above.
  - Set the launch-post link.
  - Changes apply to new applicants. Existing answers keep the task snapshot they answered.
- **Collabs:**
  - List and detail.
  - Approve with spots + deadline, or reject.
  - Extend the deadline, unlock a submitted list, view and export its wallets (CSV), with duplicate flags.
- **Settings:** `wlOpen`, `collabOpen`, `gamePublic` (default off), and the X handle (@slanaio).

## Server

- **Store:** JSON files in `DATA_DIR` (the persistent disk), written atomically like the journal: `site/wl.json`,
  `site/collab.json`, `site/settings.json`, `site/tasks.json`. Load all of them at start. Keep them small.
- **Admin auth:** a SIWS session whose wallet is in `ADMIN_WALLETS`, which defaults to `SLANA_ADMIN`
  D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm. Admin endpoints are under `/api/admin/*` and all require it.
- **Public endpoints** under `/api/site/*`: settings and tasks (public view); my WL entry; submit WL; my collabs; apply
  collab; save wallets; submit wallets. Body size limits and rate limits apply.
- **Game gate:**
  - While `gamePublic` is false, the WebSocket refuses `join` for non-admin sessions with `game_closed`.
  - The web app's `/play` route exists only behind admin.
  - Practice, arenas and spectating are all gated; only the landing's decorative animation runs client-side.
- Tests cover every endpoint, auth, validation, rate limits, uniqueness and atomic persistence.

## Out of scope

Minting the NFT, an X API integration and email.
