# Elymum game server on a VPS

The game server moves from Render to a VPS you rent (OVH, Ubuntu 24.04). The website stays on Vercel at
**https://elymum.io**; the game server lives at **https://game.elymum.io** and the website talks to it
directly. Every player then reaches the server with their own IP address (through the Vercel `/api` rewrite,
every player shared Vercel's addresses, so per-IP limits hit everyone at once).

Everything is one command, and it looks after itself afterwards:

| What | How |
|---|---|
| HTTPS certificate | Caddy gets and renews it by itself |
| New code | a new commit on the branch is built and deployed within 2 minutes (`elymum-update.timer`) |
| A broken commit | the old version keeps running; the broken commit is not retried until a newer one arrives |
| Crashes, reboots | containers restart by themselves (`restart: unless-stopped`) |
| Backups | every day at 04:00, the newest 14 kept in `/opt/elymum/backups` |
| Security updates | installed automatically; a reboot (if needed) happens at 04:30 |
| Firewall, SSH brute force | ufw (only 22, 80, 443 open) and fail2ban |

Files here: `install.sh` (the installer), `docker-compose.yml` (the app and Caddy), `caddy/Caddyfile`,
`env.example` (every setting, with comments), `update.sh`, `backup.sh`, `restore.sh`, `status.sh`,
`compose.sh`, `systemd/` (the two timers).

---

## 1. Buy the VPS

1. OVHcloud → **VPS**. 4 to 6 vCores, 8 GB RAM or more, location **Gravelines** or **Frankfurt** (close to
   most players), image **Ubuntu 24.04**.
2. During the order, add your **SSH public key** (the content of `~/.ssh/id_ed25519.pub` on your laptop; create
   one with `ssh-keygen -t ed25519` if you have none). OVH emails you the server's **IPv4 address**; the user
   is `ubuntu`.
3. Test the login from your laptop: `ssh ubuntu@<IP>`.

## 2. DNS

Where the DNS of `elymum.io` is managed (Vercel → Domains → elymum.io → DNS Records, or your registrar), add:

| Type | Name | Value | Proxy |
|---|---|---|---|
| `A` | `game` | the VPS IPv4 address | **DNS only** (no CDN proxy) |

Keep it "DNS only": behind a CDN proxy (for example Cloudflare's orange cloud) every player would again share
the CDN's addresses. Check from your laptop (it can take a few minutes): `nslookup game.elymum.io` must answer the
VPS address. Do this **before** step 3: Caddy needs it to get the certificate.

## 3. Run the installer

The repository is private, so copy the installer to the server first. From a clone on your laptop:

```bash
scp deploy/vps/install.sh ubuntu@<IP>:
```

(Or open `deploy/vps/install.sh` on GitHub, press "Raw", copy everything, then on the server
`nano install.sh`, paste, Ctrl+O Enter, Ctrl+X.)

On the server:

```bash
ssh ubuntu@<IP>
sudo -i
bash /home/ubuntu/install.sh
```

It asks three questions (press Enter for the defaults): the domain (`game.elymum.io`), the repository
(`https://github.com/furkan3152/Solagel.git`; the repository is public, so no deploy key is asked for; pass an SSH URL with `--repo` for a private one, and the script then asks for a read-only deploy key) and the branch. Then it:

1. updates Ubuntu, installs Docker from Docker's own repository, automatic security updates, the firewall and
   fail2ban, a swapfile on small machines, and network settings for many connections;
2. makes a **deploy key** and shows it with the exact steps to add it on GitHub (repository → Settings →
   Deploy keys → Add deploy key, "Allow write access" **unchecked**), and waits for you to press Enter;
3. downloads the code to `/opt/elymum` and opens the settings file `/opt/elymum/.env` in the nano editor.
   **Copy the values marked `[FROM RENDER]` from Render** → the game service → Environment
   (`ADMIN_WALLETS`, `AUTH_SECRET`, `SERVER_PRIVATE_KEY`, `EVM_RPC_URL`, `TESTNET_RPC_URL`, and any other you
   set there). Keep `PUBLIC_URL=https://elymum.io` and `CORS_ORIGIN=https://elymum.io`. Save with Ctrl+O, Enter,
   quit with Ctrl+X;
4. builds and starts the server, installs the timers, and waits until `https://game.elymum.io/api/health`
   answers.

Running the installer again is safe; it only does what is missing.

> **Never run two servers with the same server key.** Both would send settlements as the arena's server
> authority. Until the cutover, the VPS runs with its own fresh key (`SERVER_PRIVATE_KEY=auto`, no restore),
> which can do nothing on chain: that is the rehearsal. If Render's `SERVER_PRIVATE_KEY` is a `0x…` key rather
> than `auto`, leave `auto` in the VPS `.env` until step 5 and paste the real key only then.

## 4. Bring the data over (backup and restore)

The backup is a `.tar.gz` of the server's whole data folder: the money journal, the contracts registry, the
**server key**, `auth-secret`, profiles, pictures, standings and site data. **Treat the file like a private key.**

Get an admin session token: open `https://elymum.io/admin`, sign in with the owner wallet, then
**Network → Backup & move → Copy migration command**. The command contains your session token (valid 24 h).

The real restore happens during the cutover (step 5), while Render is closed. To try the restore before
that without starting a second server with Render's key, add `--no-start` and start nothing afterwards (or
restore a backup you made on the VPS itself).

Either let the VPS download it straight from Render (nothing passes through your laptop):

```bash
# on the VPS, as root. The token is the long text after "Bearer " in the copied command.
elymum-restore --no-start --url https://slana-wo00.onrender.com --token '<token>'
```

or download it on your laptop (**Download backup**) and copy it over:

```bash
scp elymum-data-*.tar.gz ubuntu@<IP>:
# on the VPS, as root
elymum-restore /home/ubuntu/elymum-data-*.tar.gz
```

On a fresh install the installer can also do it in one go before the very first start (only when Render is
already closed, as in step 5: the server starts with Render's key):

```bash
bash install.sh --restore-url https://slana-wo00.onrender.com --token '<token>'
# or
bash install.sh --restore /home/ubuntu/elymum-data-....tar.gz
```

The restore checks the archive first (a complete gzip, a readable tar, no absolute or `..` paths). If the
server already holds data, it saves a safety backup of it, stops the server, replaces the data and starts
again. After a restore, check that `https://game.elymum.io/api/config` shows the **same `serverKey`** as
`https://elymum.io/api/config` (Render).

Use the Render URL (`https://slana-wo00.onrender.com`) rather than `https://elymum.io` for the download: the
backup should not go through the Vercel proxy.

## 5. Cutover (switching players to the VPS)

Do it at a quiet hour; the whole switch takes about 15 minutes.

1. **Rehearse.** Steps 1 to 3 done (no restore yet), `elymum-status` green, `https://game.elymum.io/api/health`
   answers. Get a fresh admin token (Copy migration command) right before you start.
2. **Close the game on Render.** `https://elymum.io/admin` → Game → who may play: **Admins**. Wait for the
   current arena round to end (at most 5 minutes) so nobody is mid-game with a stake.
3. **Pause auto-deploy** on the VPS (it would restart a stopped app): `systemctl stop elymum-update.timer`.
4. **Final backup into the VPS, without starting it**, then **suspend Render** right away (Render → the game
   service → Settings → Suspend Service), then start the VPS:
   ```bash
   elymum-restore --yes --no-start --url https://slana-wo00.onrender.com --token '<token>'
   # now suspend Render, then:
   nano /opt/elymum/.env        # only if Render's SERVER_PRIVATE_KEY is a 0x key: paste it now
   elymum-compose up -d
   systemctl start elymum-update.timer
   ```
   `https://game.elymum.io/api/config` must now show the **same `serverKey`** as Render had. (Money stays safe
   even if a settlement slipped in between: the arena contract skips a session that is already settled.)
5. **Point the website at the VPS** (Vercel). These are the exact changes; they are not in the repository yet:
   - Vercel → the project → Settings → Environment Variables → Production:
     `VITE_SERVER_URL=https://game.elymum.io`. Remove `VITE_WS_URL` if it is set (unused once
     `VITE_SERVER_URL` is set).
   - `vercel.json`: keep the `/api` rewrite (NFT metadata lives at `https://elymum.io/api/nft/...`, the base
     URI on chain), but point it at the VPS instead of Render:
     ```diff
     -    { "source": "/api/:path*", "destination": "https://slana-wo00.onrender.com/api/:path*" },
     +    { "source": "/api/:path*", "destination": "https://game.elymum.io/api/:path*" },
     ```
   - Commit, push, and let Vercel redeploy (or Deployments → Redeploy). `VITE_*` values are baked in at build
     time, so a redeploy is required.
6. **Check.** Open `https://elymum.io` in a private window: the browser's network tab shows requests to
   `game.elymum.io` and a `wss://game.elymum.io/ws` socket; sign in; play a practice round; open `/admin` →
   Network (same server key, RPC ok).
7. **Reopen the game** on the VPS: `/admin` → Game → who may play: back to what it was.
8. Keep the Render service **suspended, not deleted**, for a week (rollback).

Settings that stay as they are: `PUBLIC_URL=https://elymum.io` (wallet sign-ins are bound to the site's
domain, and players sign in on elymum.io), the NFT base URI, the contracts.

## 6. Rollback to Render

1. Vercel → Deployments → the last deployment before the cutover → **Promote to Production** (instant; it has
   the old `VITE_SERVER_URL` and `vercel.json`). Later, revert the env var and the `vercel.json` change in git.
2. On the VPS, stop the game first so two servers never settle at once: `systemctl stop elymum-update.timer`
   (it would start the app again), then `elymum-compose stop app`.
3. Render → the game service → **Resume Service**.

Data written on the VPS after the cutover (new profiles, standings, journal entries) is not on Render. Money is
on chain, so nothing is lost there, but wait until the VPS shows no pending settlements (`/admin`) before step 2.

## 7. Day to day

All commands as root on the VPS (`sudo -i`).

| Task | Command |
|---|---|
| Everything at a glance (health, CPU / memory, deployed commit, last backup, disk) | `elymum-status` |
| Live server log | `elymum-compose logs -f --tail 200 app` |
| Caddy (HTTPS) log | `elymum-compose logs --tail 100 caddy` |
| Auto-deploy log | `journalctl -u elymum-update -n 100` |
| Deploy now instead of waiting 2 minutes | `elymum-update` |
| Restart the game server | `elymum-compose restart app` |
| Change a setting | `nano /opt/elymum/.env`, then `elymum-compose up -d app` |
| Backup now | `elymum-backup` (into `/opt/elymum/backups`) |
| Backup log | `journalctl -u elymum-backup -n 50` |
| Restore a backup | `elymum-restore /opt/elymum/backups/elymum-data-YYYYmmdd-HHMM.tar.gz` |
| Pause auto-deploy | `systemctl stop elymum-update.timer` (`start` to resume) |
| Turn off automatic reboots | set `Automatic-Reboot "false"` in `/etc/apt/apt.conf.d/52elymum-unattended` |

**Copy a backup to your laptop:** `scp ubuntu@<IP>:/opt/elymum/backups/elymum-data-*.tar.gz .` (as `ubuntu` you
need `sudo cp` it to your home first, or use `/admin` → Network → Download backup).

**Offsite backups (optional):** the daily backups live on the VPS's own disk. For a copy elsewhere, install
[rclone](https://rclone.org) (`apt install rclone`), run `rclone config` to add a remote (Backblaze B2, S3, ...)
with **encryption** (the "crypt" remote type: the files hold secrets), then add
`rclone copy /opt/elymum/backups <remote>:elymum-backups --max-age 25h` at the end of `backup.sh`.

## Notes

- **Client IPs.** Caddy sets `X-Forwarded-For` itself and ignores the header when a client sends it (no
  `trusted_proxies` configured), so the app sees exactly one hop, the player's address. `docker-compose.yml`
  sets `TRUST_PROXY=1` and `TRUST_PROXY_HOPS=1` for it. Do not put a CDN proxy in front without changing both.
- **Ports.** Only Caddy publishes ports (80, 443, 443/udp for HTTP/3). The app listens on 8787 inside the
  Docker network only. Docker opens its published ports itself; ufw covers everything else.
- **Shutdown.** On a restart or deploy the server gets SIGTERM and pays out every live stake player before it
  exits; compose waits up to 45 s for that (`stop_grace_period`).
- **The `$` in settings.** docker compose expands `$NAME` in `.env` values: write a value containing `$` in
  single quotes.
- **Branch.** The installer records the branch in `/var/lib/elymum/branch`; to follow another branch, run the
  installer again with `--branch <name>`.
