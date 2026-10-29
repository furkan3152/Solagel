import { formatHypeAmount, needsReprice, sameAddress } from '@elymum/sdk';
import { planDefaultArenas, type StatusSnapshot } from '@elymum/sdk/ops';
import type { AllowlistStatus, MintPriceQuote, SiteCounts, SiteSettings } from '@elymum/shared';
import { useEffect, useState } from 'react';
import { Button, CoinCharacter, Stamp, type CoinMood, type CoinPaint } from '../design';
import type { AdminNetwork } from './net';
import { Mark, type ChainCtx } from './ui';

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

/** The five terraces of the launch, each holding its checklist lines. */
const STAGES: { id: string; title: string; blurb: string; items: string[]; paint: CoinPaint }[] = [
  { id: 'wl', title: 'Whitelist', blurb: 'People ask in; you approve them.', items: [], paint: 'cream' },
  { id: 'deploy', title: 'Deploy', blurb: 'Both contracts live, owned by you, wired to the server.', items: ['chain', 'server-key', 'arena', 'authority', 'nft', 'token', 'arenas'], paint: 'teal' },
  { id: 'allowlist', title: 'Allowlist', blurb: 'The approved wallets, hashed into one root on chain.', items: ['allowlist'], paint: 'spray' },
  { id: 'mint', title: 'Mint', blurb: 'One dollar in HYPE, and the doors open.', items: ['price', 'phase'], paint: 'sun' },
  { id: 'game', title: 'Game', blurb: 'Holders walk onto the floor. Lunch is served.', items: ['access'], paint: 'up' },
];

type StageState = 'done' | 'now' | 'todo' | 'unknown';

/** `/admin → Launch`: the checklist as a terrace path, WL → Deploy → Allowlist → Mint → Game. */
export function LaunchTab({ ctx, go }: { ctx: ChainCtx; go: (tab: ChecklistTab | 'wl') => void }) {
  const [allowlist, setAllowlist] = useState<AllowlistStatus | null>(null);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [quote, setQuote] = useState<MintPriceQuote | null>(null);
  const [counts, setCounts] = useState<SiteCounts | null>(null);
  useEffect(() => {
    if (!ctx.api) return;
    let live = true;
    ctx.api.allowlist().then((a) => live && setAllowlist(a), () => {});
    ctx.api.settings().then((r) => live && setSettings(r.settings), () => {});
    ctx.api.mintPrice().then((q) => live && setQuote(q), () => {});
    ctx.api.counts?.().then((c) => live && setCounts(c), () => {});
    return () => {
      live = false;
    };
  }, [ctx.api]);
  const items = launchChecklist({ net: ctx.net, status: ctx.status, allowlist, settings, quote });
  const byId = new Map(items.map((it) => [it.id, it]));
  const wlOk = counts ? counts.wl.approved > 0 : null;
  const done = items.filter((it) => it.ok === true).length + (wlOk ? 1 : 0);
  const total = items.length + 1;

  let seenOpen = false;
  const stages = STAGES.map((st) => {
    const its = st.items.map((id) => byId.get(id)!).filter(Boolean);
    const oks = st.id === 'wl' ? [wlOk] : its.map((it) => it.ok);
    const raw: StageState = oks.every((o) => o === true) ? 'done' : oks.some((o) => o === false) ? 'todo' : 'unknown';
    let state: StageState = raw;
    if (raw !== 'done' && !seenOpen) {
      state = 'now';
      seenOpen = true;
    }
    return { ...st, its, state };
  });
  const mood: Record<StageState, CoinMood> = { done: 'happy', now: 'open', todo: 'sleepy', unknown: 'smile' };

  return (
    <section className="ad-launch" aria-labelledby="ad-launch-h">
      <header className="ad-launch__head">
        <div>
          <h2 className="ad-launch__title" id="ad-launch-h">
            The way up
          </h2>
          <p className="ad-card__lede">Each terrace lights up when its lines are done. A line that is not done links to the drawer that does it.</p>
        </div>
        <div className="ad-launch__prog">
          <span className="num ad-launch__count">
            {done}
            <small> / {total}</small>
          </span>
          <span className="ad-launch__bar" aria-hidden="true">
            <i style={{ width: `${Math.round((done / total) * 100)}%` }} />
          </span>
          <span className="mono ad-launch__cap">lines done</span>
        </div>
      </header>
      <ol className="ad-terraces" data-testid="launch-checklist">
        {stages.map((st, i) => (
          <li key={st.id} className={`ad-terrace is-${st.state}`} style={{ ['--terrace' as string]: i }} data-stage={st.id}>
            <div className="ad-terrace__art" aria-hidden="true">
              <CoinCharacter paint={st.paint} mood={mood[st.state]} size={68} bob={st.state === 'now'} blink feet={st.state !== 'todo'} />
            </div>
            <div className="ad-terrace__main">
              <div className="ad-terrace__top">
                <span className="mono ad-terrace__no">Terrace {i + 1}</span>
                <h3 className="ad-terrace__title">{st.title}</h3>
                {st.state === 'now' && <span className="ad-terrace__now mono">You are here</span>}
              </div>
              <p className="ad-terrace__blurb">{st.blurb}</p>
              <ul className={`ad-checks${st.state === 'done' && st.its.length > 1 ? ' is-compact' : ''}`}>
                {st.id === 'wl' ? (
                  <li className={`ad-check-line is-${wlOk === null ? 'unknown' : wlOk ? 'ok' : 'todo'}`} data-item="wl" data-ok={String(wlOk)}>
                    <Mark state={wlOk === null ? 'unknown' : wlOk ? 'ok' : 'todo'} />
                    <span className="ad-check-line__label">Approved WL wallets</span>
                    <span className="ad-check-line__detail num">{counts ? `${counts.wl.approved} approved · ${counts.wl.pending} waiting` : 'Sign in to count.'}</span>
                    {wlOk !== true && (
                      <button type="button" className="ad-golink" onClick={() => go('wl')}>
                        WL →
                      </button>
                    )}
                  </li>
                ) : (
                  st.its.map((it) => (
                    <li key={it.id} className={`ad-check-line is-${it.ok === null ? 'unknown' : it.ok ? 'ok' : 'todo'}`} data-item={it.id} data-ok={String(it.ok)}>
                      <Mark state={it.ok === null ? 'unknown' : it.ok ? 'ok' : 'todo'} />
                      <span className="ad-check-line__label">{it.label}</span>
                      <span className="ad-check-line__detail">{it.detail}</span>
                      {it.ok !== true && (
                        <button type="button" className="ad-golink" onClick={() => go(it.tab)}>
                          {it.tab[0].toUpperCase() + it.tab.slice(1)} →
                        </button>
                      )}
                    </li>
                  ))
                )}
              </ul>
            </div>
            {st.state === 'done' && <Stamp text="Done" tone="up" size="sm" rotate={-8} className="ad-terrace__stamp" />}
          </li>
        ))}
      </ol>
      {stages.every((s) => s.state === 'done') && (
        <p className="ad-launch__fin">
          Everything is lit. <Button variant="secondary" size="sm" onClick={() => go('settings')}>Check who may play</Button>
        </p>
      )}
    </section>
  );
}
