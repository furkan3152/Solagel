# Solagel admin control room

Open `/admin` on the game website. The panel uses the same English copy, pastel colors, purple borders and character artwork as the game. It runs without opening a gameplay connection.

## Access and persistence

Set `ADMIN_WALLETS` to comma-separated **public** Solana wallet addresses for off-chain operators. The current `config.admin` read from the deployed program can also enter. Environment-listed operators can change runtime settings and inspect/retry existing settlement records, but do not gain on-chain authority. Contract operations always require the current on-chain admin's wallet signature. No private key is entered in the panel.

A one-use message challenge opens a dedicated 15-minute admin session. The proof and bearer are bound to the configured cluster, program and frontend origin. Game login tokens cannot access admin endpoints. The browser keeps admin credentials in memory and clears them on wallet/network change, expiry, sign-out or refresh. Authority is checked again for each request; an on-chain admin cannot authenticate through a stale cached role during an RPC outage.

Use a persistent random `AUTH_SECRET`, exact production `CORS_ORIGIN`, HTTPS, and persistent `DATA_DIR`. Settings and the latest 200 audit events are atomically saved to `admin.json` with restrictive file permissions. Corruption fails startup instead of silently resetting controls. Bot environment values seed a new store; saved settings take precedence afterward. The persisted snapshot is also bound to its Solana cluster and program ID. Reusing it for a different deployment, or loading an older unbound snapshot, fails startup and preserves the file. Migrate only after explicitly checking assets on the destination network. Operate one game server per arena/journal set.

## Controls

| Panel | What it controls |
| --- | --- |
| Overview | Online humans, room/bot counts, financial journal health, active claims and pending settlement count |
| Game settings | New-entry pause, public/private population targets, public bot cap and private minimum |
| Token | Mint inspection, symbol, decimals, launch status and official pump.fun URL |
| NFT skins | Staged chain/standard, collection identifier, OpenSea URL and asset-to-character mappings |
| On-chain | Contract pause, fees, season share, treasury, server authority, arena creation/enabled/capacity, season funding/end/rollover and empty-vault sweep |
| Activity | Recent configuration audit, existing queued claims and payout receipts |

Every settings save includes its base revision. If another admin changed settings, reload the saved version before retrying; background refreshes preserve unsaved drafts. Contract changes have an inline review and are reread before signing. The client verifies the RPC genesis hash and executable program against the game server, including when a browser RPC override is configured. Signing and broadcasting are separate, so a wallet/network change or admin logout during the signature prompt prevents submission. Unknown transaction confirmation remains pending for recheck. Public receipt metadata is stored in session storage, scoped to wallet/program/RPC/network, and restored after same-tab reload or admin sign-out. Credentials are never stored with it. Only confirmed, definitively failed or expired transactions clear this lock; check your wallet history before switching tabs/browsers or clearing storage.

The runtime pause blocks new practice, private and SOL lives. It preserves active gameplay, surviving paid reconnects and cash-outs. The browser checks admission again immediately before a new ticket signature request. A wallet prompt already opened or transaction already approved cannot be revoked by an off-chain setting. Use the contract's paid-entry pause as well for a chain-enforced maintenance boundary; settlement and unused-ticket refunds remain available. Unused tickets retain their refund rules.

Bots in paid arenas provide mass only, hold no SOL and cannot eat humans. Public bot minimum is always zero so humans can fill the room. The private minimum applies only to friends' practice rooms. Population changes take effect in the existing bot maintenance cycle.

Settlement retry uses the existing exact journal liability. It does not create a payout, change an amount or delete a claim. A corrupt/unhealthy journal requires storage recovery; the panel cannot bypass that boundary. On-chain signatures remain the authoritative record for contract operations; the configuration audit records server-admin requests.

Arena entry prices are immutable in the current program: create a new arena tier for a new price and disable old admission after reviewing existing tickets. Server-authority rotation also requires deploying the matching server signer and funding it for network fees. Initial deployment, upgrades, secrets and persistent-volume recovery remain operator infrastructure work, not browser controls.

## Token first

1. Create the intended token through pump.fun on the intended network.
2. Paste its mint into Token and inspect it. The server reads the mint account through its configured RPC, preserving exact raw supply and reporting decimals, mint/freeze authorities, program and Token-2022 extensions.
3. Save **Configured** for private preparation. The URL, when supplied, must be the official `https://pump.fun/coin/<mint>` path for that exact mint. Inspection confirms on-chain existence, not launchpad provenance.
4. Save **Launched** when ready to announce it in the lobby. This publishes token metadata, not token entry or payouts.

SOL beta accounting remains SOL. Enabling token gameplay requires a separately implemented SPL-token vault/session flow, transfer/extension rules, server accounting, client tickets and verified deployment. No existing funded SOL session is converted or relabeled by these controls.

## NFT collection after token

Select the actual NFT network and standard when known, then stage its collection/contract identifier and OpenSea collection URL. Solana mappings use NFT mint addresses; ERC-721/ERC-1155 mappings use canonical unsigned token IDs up to uint256. Multiple unique assets may map to the same cosmetic skin. Only premium skin IDs 16–23 are mapping targets; starter and XP progression are unaffected.

Supported registry formats are Solana/Metaplex and Ethereum/Base/Polygon ERC-721/ERC-1155. Registry support does not assert OpenSea supports minting every format. Confirm the intended mint route first. Free mint means zero mint price; network fees may apply.

When the real contract is supplied, the remaining integration is an ownership adapter for that exact chain and standard: verify collection membership and wallet ownership/balance, handle transfers and RPC outages, and require signed linked-wallet proof for an EVM owner using a Solana gameplay wallet. Current staged settings never unlock skins or pretend to verify ownership. They preserve the identifiers and cosmetic mappings needed for that integration.
