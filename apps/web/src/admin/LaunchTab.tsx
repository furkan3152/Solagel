import { formatHypeAmount, needsReprice, sameAddress } from '@elymum/sdk';
import { planDefaultArenas, type StatusSnapshot } from '@elymum/sdk/ops';
import type { AllowlistStatus, MintPriceQuote, SiteSettings } from '@elymum/shared';
import { useEffect, useState } from 'react';
import type { AdminNetwork } from './net';
import { Card, type ChainCtx } from './ui';

export type ChecklistTab = 'deploy' | 'mint' | 'arena' | 'settings';

export interface ChecklistItem {
  id: string;
  label: string;
  /** null: unknown (not readable yet). */
  ok: boolean | null;
  detail: string;
  tab: ChecklistTab;
}

/** The launch checklist, from the status read and the server's site data (pure, tested). */
export function launchChecklist(i: {
  net: AdminNetwork;
  status: StatusSnapshot | null;
  allowlist: AllowlistStatus | null;
  settings: SiteSettings | null;
  quote: MintPriceQuote | null;
}): ChecklistItem[] {
  const a = i.status?.arena ?? null;
  const n = i.status?.nft ?? null;
  const cfg = a?.config ?? null;
  const existing = (a?.arenas ?? []).filter((x) => x.exists).map((x) => x.id);
  const missingArenas = cfg?.token ? planDefaultArenas(cfg.decimals, existing).create.length : null;
  const target = i.quote?.priceWei ? BigInt(i.quote.priceWei) : null;
  const root = n?.state?.root ?? null;
  const snapRoot = i.allowlist?.snapshot?.root ?? null;
  return [
    { id: 'chain', label: 'The server is on a chain', ok: !!i.net.info, detail: i.net.info ? `${i.net.info.name} (${i.net.info.id})${i.net.mainnet ? ' · MAINNET' : ''}` : 'EVM_RPC_URL is unset on the server.', tab: 'deploy' },
    {
      id: 'server-key',
      label: 'The server key has HYPE for gas',
      ok: !i.net.serverKey ? false : a?.serverBalance === null || a?.serverBalance === undefined ? null : a.serverBalance > 0n,
      detail: i.net.serverKey ? `${i.net.serverKey}${a?.serverBalance != null ? ` · ${formatHypeAmount(a.serverBalance, 4)}` : ''}` : 'The server publishes no key.',
      tab: 'arena',
    },
    { id: 'arena', label: 'ElymumArena deployed and registered', ok: !i.net.arenaAddress ? false : a ? a.code === 'ok' : null, detail: i.net.arenaAddress ? `${i.net.arenaAddress} · code ${a?.code ?? '…'}` : 'Not registered.', tab: 'deploy' },
    {
      id: 'authority',
      label: "The arena settles with this server's key",
      ok: cfg && i.net.serverKey ? sameAddress(cfg.serverAuthority, i.net.serverKey) : cfg ? false : null,
      detail: cfg ? cfg.serverAuthority : '—',
      tab: 'arena',
    },
    { id: 'nft', label: 'ElymumNFT deployed and registered', ok: !i.net.nftAddress ? false : n ? n.code === 'ok' : null, detail: i.net.nftAddress ? `${i.net.nftAddress} · code ${n?.code ?? '…'}` : 'Not registered.', tab: 'deploy' },
    { id: 'token', label: 'The game token is set', ok: cfg ? !!cfg.token : i.net.arenaAddress ? null : false, detail: cfg?.token ?? 'Set it once from Deploy or Arena.', tab: 'arena' },
    { id: 'arenas', label: 'The four default arenas exist', ok: missingArenas === null ? (cfg ? false : null) : missingArenas === 0, detail: missingArenas === null ? 'Needs the token.' : `${4 - missingArenas} / 4`, tab: 'arena' },
    {
      id: 'allowlist',
      label: 'The allowlist root is published',
      ok: !root || !i.allowlist ? null : !!snapRoot && snapRoot.toLowerCase() === root.toLowerCase() && i.allowlist.diff.added.length === 0 && i.allowlist.diff.removed.length === 0,
      detail: i.allowlist ? (snapRoot ? `snapshot of ${i.allowlist.snapshot!.count} · ${i.allowlist.diff.added.length} to add, ${i.allowlist.diff.removed.length} to drop` : 'No snapshot yet.') : 'Sign in to check.',
      tab: 'mint',
    },
    {
      id: 'price',
      label: 'The mint price is $1 in HYPE',
      ok: n?.state && target ? !needsReprice(n.state.price, target) : null,
      detail: n?.state ? `${formatHypeAmount(n.state.price, 6)}${target ? ` · target ${formatHypeAmount(target, 6)}` : ''}` : '—',
      tab: 'mint',
    },
    { id: 'phase', label: 'The mint is open', ok: n?.state ? n.state.phaseName !== 'closed' : null, detail: n?.state ? `phase ${n.state.phaseName}` : '—', tab: 'mint' },
    {
      id: 'access',
      label: 'The game is open to holders',
      ok: i.settings ? i.settings.gameAccess !== 'admins' : null,
      detail: i.settings ? `Who may play: ${i.settings.gameAccess}` : 'Sign in to check.',
      tab: 'settings',
    },
  ];
}

/** `/admin → Launch`: what is done and what is left, each with the tab that does it. */
export function LaunchTab({ ctx, go }: { ctx: ChainCtx; go: (tab: ChecklistTab) => void }) {
  const [allowlist, setAllowlist] = useState<AllowlistStatus | null>(null);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [quote, setQuote] = useState<MintPriceQuote | null>(null);
  useEffect(() => {
    if (!ctx.api) return;
    let live = true;
    ctx.api.allowlist().then((a) => live && setAllowlist(a), () => {});
    ctx.api.settings().then((r) => live && setSettings(r.settings), () => {});
    ctx.api.mintPrice().then((q) => live && setQuote(q), () => {});
    return () => {
      live = false;
    };
  }, [ctx.api]);
  const items = launchChecklist({ net: ctx.net, status: ctx.status, allowlist, settings, quote });
  return (
    <Card title="Launch checklist" id="launch" lede="WL → Mint → the game opens for holders. Each line links to the tab that does it.">
      <ul className="ad-checklist" data-testid="launch-checklist">
        {items.map((it) => (
          <li key={it.id} className={`ad-checklist__item is-${it.ok === null ? 'unknown' : it.ok ? 'ok' : 'todo'}`} data-item={it.id} data-ok={String(it.ok)}>
            <span className="ad-checklist__mark mono" aria-hidden="true">
              {it.ok === null ? '?' : it.ok ? 'OK' : 'TODO'}
            </span>{' '}
            <strong>{it.label}</strong> <span className="ad-note">{it.detail}</span>{' '}
            {it.ok !== true && (
              <button type="button" className="ad-textlink" onClick={() => go(it.tab)}>
                {it.tab}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
