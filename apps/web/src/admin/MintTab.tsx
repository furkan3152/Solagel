import {
  formatHypeAmount,
  freezeMetadataCall,
  ownerMintCall,
  priceDeviationBps,
  setBaseURICall,
  setLimitsCall,
  setMaxSupplyCall,
  setMerkleRootCall,
  setPhaseCall,
  setPriceBoundsCall,
  setPriceCall,
  setPriceKeeperCall,
  setRoyaltyCall,
  setTreasuryCall,
  withdrawCall,
  MINT_PHASE_NAMES,
  type MintPhaseName,
} from '@elymum/sdk';
import { parseAddressInput, parseHypeInput, parseIntInput } from '@elymum/sdk/ops';
import type { AllowlistStatus, MintPriceQuote } from '@elymum/shared';
import { useCallback, useEffect, useState } from 'react';
import type { Address, Hex } from 'viem';
import { ArcGauge, CoinCharacter, HypeAmount, Icon, type CoinMood } from '../design';
import { Addr, Btn, Card, FormError, Input, NeedsSession, Row, useFormError, type ChainCtx } from './ui';
import { readOwner, type Plan } from './plan';

/** Is the allowlist snapshot the root published on the contract, and is it up to date with the approvals? */
export function allowlistWarnings(a: AllowlistStatus | null, onchainRoot: string | null | undefined): string[] {
  const out: string[] = [];
  if (!a) return out;
  if (!a.snapshot) out.push('No allowlist snapshot yet: build one, then publish its root.');
  else {
    const published = !!onchainRoot && onchainRoot.toLowerCase() === a.snapshot.root.toLowerCase();
    if (!published) out.push('The snapshot root is not the root on the contract: publish it (setMerkleRoot) or allowlist proofs fail.');
  }
  if (a.diff.added.length || a.diff.removed.length) {
    out.push(`Approvals changed since the snapshot: ${a.diff.added.length} to add, ${a.diff.removed.length} to drop. Build a new snapshot and publish it.`);
  }
  return out;
}

/** `/admin → Mint`: the ElymumNFT owner's controls, each through the transaction preview. */
export function MintTab({ ctx }: { ctx: ChainCtx }) {
  const nft = ctx.net.nftAddress;
  const s = ctx.status?.nft?.state ?? null;
  const [nftOwner, setNftOwner] = useState<Address | null>(null);
  const [hypeUsd, setHypeUsd] = useState<number | null>(null);
  useEffect(() => {
    if (!nft || !ctx.client) return;
    let live = true;
    readOwner(ctx.client, nft).then(
      (o) => live && setNftOwner(o),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [nft, ctx.client, ctx.status]);

  if (!nft) return <Card title="No NFT yet" id="mint" tone="quiet" lede="Deploy and register ElymumNFT first (Deploy drawer). The mint has nothing to run until then." />;
  if (!s)
    return (
      <Card
        title={ctx.status?.nft?.code === 'mismatch' ? 'That is not our NFT' : 'Reading the NFT…'}
        id="mint"
        tone={ctx.status?.nft?.code === 'mismatch' ? 'danger' : 'quiet'}
        lede={ctx.status?.nft?.code === 'mismatch' ? 'The code at the registered NFT address is not the bundled ElymumNFT.' : 'One moment: asking the chain.'}
      />
    );

  /** A plan on the NFT: owner-checked, re-reads the status after. */
  const open = (title: string, call: Plan['call'], extra: Partial<Plan> = {}) =>
    ctx.open({ title, contract: 'ElymumNFT', call, ownerOf: nft, owner: nftOwner, onDone: () => ctx.refresh(), ...extra });
  const balance = ctx.status?.nft?.balance ?? 0n;
  const usdOf = (wei: bigint) => (hypeUsd !== null ? (Number(wei) / 1e18) * hypeUsd : null);

  return (
    <div className="ad-mint">
      <section className="ad-card ad-glance" aria-labelledby="ad-mint-status-h" data-card="mint-status">
        <h2 className="kb-sr" id="ad-mint-status-h">
          Mint status
        </h2>
        <div className="ad-glance__gauge">
          <ArcGauge value={s.totalSupply} max={s.maxSupply} size={150} tone="sun" caption={s.soldOut ? 'Sold out. Well done.' : `${s.maxSupply - s.totalSupply} emblems still sealed.`} />
        </div>
        <dl className="ad-glance__figs">
          <div>
            <dt className="mono">Phase</dt>
            <dd>
              <span className={`ad-phase-tag is-${s.phaseName}`}>{s.phaseName}</span>
            </dd>
          </div>
          <div>
            <dt className="mono">Price</dt>
            <dd>
              <HypeAmount wei={s.price} decimals={6} usd={usdOf(s.price)} />
            </dd>
          </div>
          <div>
            <dt className="mono">In the contract</dt>
            <dd>
              <HypeAmount wei={balance} decimals={4} />
            </dd>
          </div>
        </dl>
        <dl className="ad-kv ad-glance__kv">
          <Row label="Owner">
            <Addr value={nftOwner} net={ctx.net} />
          </Row>
          <Row label="Treasury">
            <Addr value={s.treasury} net={ctx.net} />
          </Row>
          <Row label="Limits">
            <span className="num">
              {s.wlLimit} allowlist · {s.publicLimit} public
            </span>{' '}
            <span className="ad-role">per wallet</span>
          </Row>
          <Row label="Metadata">{s.frozen ? <strong className="ad-bad">frozen forever</strong> : 'editable'}</Row>
        </dl>
      </section>
      <PhaseCard ctx={ctx} current={s.phaseName} open={open} />
      <div className="ad-mint__pair">
        <AllowlistCard ctx={ctx} root={s.root} open={open} />
        <PriceCard ctx={ctx} price={s.price} open={open} keeper={s.keeper} minPrice={s.minPrice} maxPrice={s.maxPrice} onHypeUsd={setHypeUsd} />
      </div>
      <div className="ad-mint__forms">
        <LimitsCard wl={s.wlLimit} pub={s.publicLimit} max={s.maxSupply} total={s.totalSupply} open={open} nft={nft} />
        <RoyaltyCard me={ctx.me} open={open} nft={nft} treasury={s.treasury} />
        <OwnerMintCard me={ctx.me} open={open} nft={nft} />
        <Card title="Withdraw" id="mint-withdraw" lede="Sends the whole HYPE balance of the NFT contract to the treasury.">
          <p className="ad-bigfig">
            <HypeAmount wei={balance} decimals={6} usd={usdOf(balance)} size="lg" />
          </p>
          <Btn primary onClick={() => open('Withdraw the mint proceeds to the treasury', withdrawCall(nft))} disabled={balance === 0n} testId="mint-withdraw">
            Withdraw {formatHypeAmount(balance, 6)}
          </Btn>
        </Card>
      </div>
      <MetadataCard frozen={s.frozen} open={open} nft={nft} />
    </div>
  );
}

type OpenFn = (title: string, call: Plan['call'], extra?: Partial<Plan>) => void;

const PHASE_COPY: Record<MintPhaseName, { title: string; line: string; mood: CoinMood }> = {
  closed: { title: 'Closed', line: 'Sealed. For now.', mood: 'sleepy' },
  allowlist: { title: 'Allowlist', line: 'Only wallets in the root may mint.', mood: 'smug' },
  public: { title: 'Public', line: 'Anyone with a dollar of HYPE.', mood: 'happy' },
};

function PhaseCard({ ctx, current, open }: { ctx: ChainCtx; current: MintPhaseName; open: OpenFn }) {
  const [phase, setPhase] = useState<MintPhaseName>(current === 'closed' ? 'allowlist' : current);
  const [activate, setActivate] = useState(true);
  const nft = ctx.net.nftAddress!;
  const opening = phase !== 'closed' && current === 'closed';
  return (
    <Card title="Phase" id="mint-phase" kicker={`Now: ${current}`} lede="Closed → Allowlist → Public. Pick one, then preview the switch. Opening the mint can open the game to holders in the same go.">
      <div className="ad-phases" role="radiogroup" aria-label="Mint phase">
        {MINT_PHASE_NAMES.map((p) => (
          <label key={p} className={`ad-phase${phase === p ? ' is-picked' : ''}${current === p ? ' is-live' : ''}`}>
            <input type="radio" name="ad-mint-phase" className="kb-sr" checked={phase === p} onChange={() => setPhase(p)} />
            <CoinCharacter paint={p === 'closed' ? 'cream' : p === 'allowlist' ? 'spray' : 'sun'} mood={PHASE_COPY[p].mood} size={52} />
            <span className="ad-phase__text">
              <span className="ad-phase__title">{PHASE_COPY[p].title}</span>
              <span className="ad-phase__line">{PHASE_COPY[p].line}</span>
            </span>
            {current === p && <span className="ad-phase__live mono">Live</span>}
          </label>
        ))}
      </div>
      {phase !== 'closed' && (
        <label className="ad-check" data-testid="mint-activate">
          <input type="checkbox" checked={activate} onChange={() => setActivate(!activate)} />
          <span>
            Activate the game for holders
            <span className="ad-check__sub">Saves “Who may play: NFT holders” after the receipt.</span>
          </span>
        </label>
      )}
      <div className="ad-actions">
        <Btn
          sun
          disabled={phase === current && !(phase !== 'closed' && activate)}
          testId="mint-set-phase"
          onClick={() =>
            open(opening ? `Open the mint (${phase})` : `Set the mint phase to ${phase}`, setPhaseCall(nft, phase), {
              note: phase !== 'closed' && activate ? 'After the receipt, the game access setting is saved as “NFT holders”.' : undefined,
              onDone: async () => {
                if (phase !== 'closed' && activate) {
                  if (!ctx.api) throw new Error('The phase is set, but the game access was not saved: sign in as the admin and save it in Settings.');
                  await ctx.api.saveSettings({ gameAccess: 'holders' });
                }
                await ctx.refresh();
              },
            })
          }
        >
          {opening ? 'Open mint' : 'Set phase'}
        </Btn>
      </div>
      <NeedsSession api={ctx.api} />
    </Card>
  );
}

const shortRoot = (r: string) => (r.length > 18 ? `${r.slice(0, 10)}…${r.slice(-6)}` : r);

function AllowlistCard({ ctx, root, open }: { ctx: ChainCtx; root: Hex; open: OpenFn }) {
  const [status, setStatus] = useState<AllowlistStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    if (!ctx.api) return;
    ctx.api.allowlist().then(setStatus, (e: Error) => setErr(e.message));
  }, [ctx.api]);
  useEffect(load, [load]);
  const warnings = allowlistWarnings(status, root);
  const snap = status?.snapshot ?? null;
  const published = !!snap && snap.root.toLowerCase() === root.toLowerCase();
  const added = status?.diff.added.length ?? 0;
  const removed = status?.diff.removed.length ?? 0;
  const emptyRoot = /^0x0+$/.test(root);
  return (
    <Card
      title="Allowlist"
      id="mint-allowlist"
      kicker="Snapshot → root"
      aside={status && (warnings.length === 0 ? <span className="ad-code mono is-ok">Up to date</span> : <span className="ad-code mono is-bad">Out of date</span>)}
      lede="Every approved WL wallet plus every submitted collab wallet (EVM only). Build a snapshot on the server, then publish its root."
    >
      <NeedsSession api={ctx.api} />
      <div className="ad-stats">
        <div>
          <span className="mono">Wallets</span>
          <strong className="num">{snap ? snap.count.toLocaleString('en-US') : '—'}</strong>
          {snap && (
            <small>
              WL {snap.sources.wl} · collab {snap.sources.collab}
            </small>
          )}
        </div>
        <div>
          <span className="mono">Since snapshot</span>
          <strong className="num">
            <span className="ad-plus">+{added}</span> <span className="ad-minus">−{removed}</span>
          </strong>
          <small>approvals added · dropped</small>
        </div>
      </div>
      <dl className="ad-kv">
        <Row label="Snapshot root">{snap ? <code className="ad-hash" title={snap.root}>{shortRoot(snap.root)}</code> : <span className="ad-none">none yet</span>}</Row>
        <Row label="On chain">
          {emptyRoot ? <span className="ad-none">empty (0x00…)</span> : <code className="ad-hash" title={root}>{shortRoot(root)}</code>}
          {published && <span className="ad-code mono is-ok">match</span>}
        </Row>
        {snap && <Row label="Built">{new Date(snap.builtAt).toLocaleString('en-US')}</Row>}
      </dl>
      {warnings.length > 0 && (
        <ul className="ad-warn ad-warn--list" data-testid="allowlist-warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <div className="ad-actions">
        <Btn
          disabled={!ctx.api || busy}
          testId="allowlist-build"
          onClick={async () => {
            if (!ctx.api) return;
            setBusy(true);
            setErr(null);
            try {
              await ctx.api.buildAllowlist();
              load();
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Building…' : 'Build snapshot'}
        </Btn>
        <Btn
          primary
          disabled={!snap || published}
          testId="allowlist-publish"
          onClick={() =>
            snap &&
            open(`Publish the allowlist root (${snap.count} wallets)`, setMerkleRootCall(ctx.net.nftAddress!, snap.root as Hex), {
              onDone: async () => {
                await ctx.refresh();
                load();
              },
            })
          }
        >
          Publish root
        </Btn>
      </div>
      <FormError error={err} />
    </Card>
  );
}

function PriceCard({
  ctx,
  price,
  keeper,
  minPrice,
  maxPrice,
  open,
  onHypeUsd,
}: {
  ctx: ChainCtx;
  price: bigint;
  keeper: Address | null;
  minPrice: bigint;
  maxPrice: bigint;
  open: OpenFn;
  onHypeUsd?: (v: number | null) => void;
}) {
  const [quote, setQuote] = useState<MintPriceQuote | null>(null);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [manual, setManual] = useState('');
  const [err, guard, setErr] = useFormError();
  useEffect(() => {
    if (!ctx.api) return;
    ctx.api.mintPrice().then(
      (q) => {
        setQuote(q);
        onHypeUsd?.(q.hypeUsd);
      },
      (e: Error) => setErr(e.message),
    );
  }, [ctx.api, setErr, onHypeUsd]);
  const nft = ctx.net.nftAddress!;
  const target = quote?.priceWei ? BigInt(quote.priceWei) : null;
  const dev = target && target > 0n ? priceDeviationBps(price, target) : null;
  const serverKey = ctx.net.serverKey;
  const targetUsd = ((quote?.targetUsdCents ?? 100) / 100).toFixed(2);
  const off = dev !== null && Math.abs(dev) > 200;
  const usd = quote?.hypeUsd ? (Number(price) / 1e18) * quote.hypeUsd : null;
  return (
    <Card title="Price" id="mint-price" kicker={`Pinned to $${targetUsd}`} lede={`Held in wei, kept at $${targetUsd} in HYPE. The number wiggles with the market; the dollar does not.`}>
      <div className="ad-pricebox">
        <div className="ad-pricebox__now">
          <span className="mono">On the contract</span>
          <HypeAmount wei={price} decimals={6} usd={usd} size="md" stack />
        </div>
        <div className="ad-pricebox__target">
          <span className="mono">Target</span>
          {target ? (
            <>
              <span className="num ad-pricebox__fig">{formatHypeAmount(target, 6)}</span>
              <span className="ad-tick num">HYPE/USD {quote?.hypeUsd}</span>
            </>
          ) : (
            <span className="ad-none">price feed unavailable</span>
          )}
          {dev !== null && <span className={`ad-code mono${off ? ' is-bad' : ' is-ok'}`}>off by {(dev / 100).toFixed(2)} %</span>}
        </div>
      </div>
      <div className="ad-actions">
        <Btn primary disabled={!target} testId="mint-sync-price" icon="check" onClick={() => target && open('Sync the mint price to $1', setPriceCall(nft, target))}>
          Sync to ${targetUsd}
        </Btn>
      </div>
      <details className="ad-more">
        <summary>Set a price by hand</summary>
        <div className="ad-inlineform">
          <Input label="Price" suffix="HYPE" value={manual} onChange={setManual} />
          <Btn onClick={() => guard(() => open('Set the mint price', setPriceCall(nft, parseHypeInput('Price', manual))))}>Preview setPrice</Btn>
        </div>
      </details>
      <div className="ad-sub">
        <h3 className="ad-h3">Keeper</h3>
        <p className="ad-note">With the server key as keeper, the server re-prices every 5 minutes when off by more than 2 %, always inside the bounds.</p>
        <dl className="ad-kv">
          <Row label="Keeper">{keeper ? <Addr value={keeper} net={ctx.net} /> : <span className="ad-none">none</span>}</Row>
          <Row label="Bounds">
            <span className="num">
              {formatHypeAmount(minPrice, 6)} – {formatHypeAmount(maxPrice, 6)}
            </span>
          </Row>
        </dl>
        <div className="ad-form ad-form--grid">
          <Input label="Min price" suffix="HYPE" value={min} onChange={setMin} />
          <Input label="Max price" suffix="HYPE" value={max} onChange={setMax} />
        </div>
        <div className="ad-actions">
          <Btn onClick={() => guard(() => open('Set the keeper price bounds', setPriceBoundsCall(nft, parseHypeInput('Min price', min), parseHypeInput('Max price', max))))}>Preview bounds</Btn>
          <Btn disabled={!serverKey} testId="mint-keeper" onClick={() => serverKey && open('Make the server key the price keeper', setPriceKeeperCall(nft, serverKey))}>
            Keeper = server key
          </Btn>
          <Btn disabled={!keeper} onClick={() => open('Remove the price keeper', setPriceKeeperCall(nft, null))}>
            Remove keeper
          </Btn>
        </div>
      </div>
      <FormError error={err} />
    </Card>
  );
}

function LimitsCard({ wl, pub, max, total, open, nft }: { wl: number; pub: number; max: number; total: number; open: OpenFn; nft: Address }) {
  const [w, setW] = useState(String(wl));
  const [p, setP] = useState(String(pub));
  const [m, setM] = useState(String(max));
  const [err, guard] = useFormError();
  return (
    <Card title="Limits and supply" id="mint-limits" lede="The max supply can only go down, never below what is minted.">
      <div className="ad-form ad-form--grid">
        <Input label="Allowlist per wallet" value={w} onChange={setW} />
        <Input label="Public per wallet" value={p} onChange={setP} />
      </div>
      <Btn onClick={() => guard(() => open('Set the per-wallet limits', setLimitsCall(nft, parseIntInput('Allowlist limit', w, 0, 65_535), parseIntInput('Public limit', p, 0, 65_535))))}>Preview limits</Btn>
      <div className="ad-inlineform">
        <Input label={`Max supply (minted: ${total})`} value={m} onChange={setM} />
        <Btn onClick={() => guard(() => open('Lower the max supply', setMaxSupplyCall(nft, parseIntInput('Max supply', m, total, max))))}>Preview max supply</Btn>
      </div>
      <FormError error={err} />
    </Card>
  );
}

function MetadataCard({ frozen, open, nft }: { frozen: boolean; open: OpenFn; nft: Address }) {
  const [uri, setUri] = useState(`${location.origin}/api/nft/`);
  const [err, guard] = useFormError();
  if (frozen)
    return (
      <Card title="Metadata" id="mint-metadata" kicker="Frozen forever" tone="quiet">
        <p className="ad-note">
          <Icon name="lock" size={16} /> The base URI is frozen. Nobody can change it, including you.
        </p>
      </Card>
    );
  return (
    <Card title="Metadata" id="mint-metadata" tone="danger" kicker="Base URI · freeze" lede="tokenURI = base URI + id. Changing the base URI is routine; freezing it is forever.">
      <div className="ad-inlineform">
        <Input label="Base URI" value={uri} onChange={setUri} />
        <Btn
          onClick={() =>
            guard(() => {
              if (!/^https?:\/\/\S+\/$/.test(uri.trim())) throw new Error('Base URI: an http(s) URL ending with "/".');
              open('Set the base URI', setBaseURICall(nft, uri.trim()));
            })
          }
        >
          Preview base URI
        </Btn>
      </div>
      <div className="ad-dangerrow">
        <p>
          <strong>Freeze the metadata.</strong> Every emblem keeps its URI forever. You will type FREEZE to confirm.
        </p>
        <Btn danger icon="lock" testId="mint-freeze" onClick={() => open('Freeze the metadata forever', freezeMetadataCall(nft), { confirmText: 'FREEZE', note: 'This can never be undone.' })}>
          Freeze metadata
        </Btn>
      </div>
      <FormError error={err} />
    </Card>
  );
}

function RoyaltyCard({ me, open, nft, treasury }: { me: Address | null; open: OpenFn; nft: Address; treasury: Address }) {
  const [to, setTo] = useState<string>(treasury);
  const [bps, setBps] = useState('500');
  const [t, setT] = useState<string>(me ?? '');
  const [err, guard] = useFormError();
  return (
    <Card title="Royalty and treasury" id="mint-royalty" lede="ERC-2981 royalty (at most 10 %), and where withdraw() sends the proceeds.">
      <div className="ad-form ad-form--grid">
        <Input label="Royalty receiver" value={to} onChange={setTo} />
        <Input label="Royalty" suffix="bps" value={bps} onChange={setBps} hint={`${(Number(bps) / 100 || 0).toFixed(2)} %`} />
      </div>
      <Btn onClick={() => guard(() => open('Set the royalty', setRoyaltyCall(nft, parseAddressInput('Receiver', to), parseIntInput('Royalty', bps, 0, 1000))))}>Preview royalty</Btn>
      <div className="ad-inlineform">
        <Input label="Treasury" value={t} onChange={setT} />
        <Btn onClick={() => guard(() => open('Set the treasury', setTreasuryCall(nft, parseAddressInput('Treasury', t))))}>Preview treasury</Btn>
      </div>
      <FormError error={err} />
    </Card>
  );
}

function OwnerMintCard({ me, open, nft }: { me: Address | null; open: OpenFn; nft: Address }) {
  const [to, setTo] = useState<string>(me ?? '');
  const [qty, setQty] = useState('1');
  const [err, guard] = useFormError();
  return (
    <Card title="Owner mint" id="mint-owner" lede="Mints for free to any wallet (team, giveaways). It counts toward the supply.">
      <div className="ad-form ad-form--grid ad-form--wide1">
        <Input label="To" value={to} onChange={setTo} />
        <Input label="Quantity" value={qty} onChange={setQty} />
      </div>
      <Btn onClick={() => guard(() => open('Owner mint', ownerMintCall(nft, parseAddressInput('To', to), parseIntInput('Quantity', qty, 1, 65_535))))}>Preview owner mint</Btn>
      <FormError error={err} />
    </Card>
  );
}
