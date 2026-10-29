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

  if (!nft) return <Card title="Mint" id="mint" lede="Deploy and register the NFT first (Deploy tab)."><></></Card>;
  if (!s) return <Card title="Mint" id="mint" lede={ctx.status?.nft?.code === 'mismatch' ? 'The code at the registered NFT address is not the bundled ElymumNFT.' : 'Reading the NFT…'}><></></Card>;

  /** A plan on the NFT: owner-checked, re-reads the status after. */
  const open = (title: string, call: Plan['call'], extra: Partial<Plan> = {}) =>
    ctx.open({ title, contract: 'ElymumNFT', call, ownerOf: nft, owner: nftOwner, onDone: () => ctx.refresh(), ...extra });

  return (
    <div className="ad-mint">
      <Card title="Mint status" id="mint-status">
        <dl className="ad-kv">
          <Row label="Contract">
            <Addr value={nft} net={ctx.net} /> · code {ctx.status?.nft?.code}
          </Row>
          <Row label="Owner">
            <Addr value={nftOwner} net={ctx.net} />
          </Row>
          <Row label="Phase">{s.phaseName}</Row>
          <Row label="Supply">
            {s.totalSupply} / {s.maxSupply}
            {s.soldOut ? ' · SOLD OUT' : ''}
          </Row>
          <Row label="Price">{formatHypeAmount(s.price, 6)}</Row>
          <Row label="Keeper">
            {s.keeper ? <Addr value={s.keeper} net={ctx.net} /> : 'none'} · bounds {formatHypeAmount(s.minPrice, 6)} – {formatHypeAmount(s.maxPrice, 6)}
          </Row>
          <Row label="Limits">
            allowlist {s.wlLimit} · public {s.publicLimit} per wallet
          </Row>
          <Row label="Root">
            <code>{s.root}</code>
          </Row>
          <Row label="Treasury">
            <Addr value={s.treasury} net={ctx.net} />
          </Row>
          <Row label="Balance">{formatHypeAmount(ctx.status?.nft?.balance ?? 0n, 6)}</Row>
          <Row label="Metadata">{s.frozen ? 'frozen forever' : 'editable'}</Row>
        </dl>
      </Card>
      <PhaseCard ctx={ctx} current={s.phaseName} open={open} />
      <AllowlistCard ctx={ctx} root={s.root} open={open} />
      <PriceCard ctx={ctx} price={s.price} open={open} keeper={s.keeper} />
      <LimitsCard wl={s.wlLimit} pub={s.publicLimit} max={s.maxSupply} total={s.totalSupply} open={open} nft={nft} />
      <MetadataCard frozen={s.frozen} open={open} nft={nft} />
      <RoyaltyCard me={ctx.me} open={open} nft={nft} treasury={s.treasury} />
      <OwnerMintCard me={ctx.me} open={open} nft={nft} />
      <Card title="Withdraw" id="mint-withdraw" lede="Sends the whole HYPE balance of the NFT contract to the treasury.">
        <Btn onClick={() => open('Withdraw the mint proceeds to the treasury', withdrawCall(nft))} disabled={(ctx.status?.nft?.balance ?? 0n) === 0n} testId="mint-withdraw">
          Withdraw {formatHypeAmount(ctx.status?.nft?.balance ?? 0n, 6)}
        </Btn>
      </Card>
    </div>
  );
}

type OpenFn = (title: string, call: Plan['call'], extra?: Partial<Plan>) => void;

function PhaseCard({ ctx, current, open }: { ctx: ChainCtx; current: MintPhaseName; open: OpenFn }) {
  const [phase, setPhase] = useState<MintPhaseName>(current === 'closed' ? 'allowlist' : current);
  const [activate, setActivate] = useState(true);
  const nft = ctx.net.nftAddress!;
  const opening = phase !== 'closed' && current === 'closed';
  return (
    <Card title="Phase" id="mint-phase" lede="Closed → Allowlist → Public. Opening the mint can also open the game to holders.">
      <div className="ad-chips" role="radiogroup" aria-label="Mint phase">
        {MINT_PHASE_NAMES.map((p) => (
          <label key={p} className="ad-check">
            <input type="radio" name="ad-mint-phase" checked={phase === p} onChange={() => setPhase(p)} /> {p}
          </label>
        ))}
      </div>
      {phase !== 'closed' && (
        <label className="ad-check" data-testid="mint-activate">
          <input type="checkbox" checked={activate} onChange={() => setActivate(!activate)} /> Activate the game for holders (saves “Who may play: NFT holders”)
        </label>
      )}
      <Btn
        primary
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
      <NeedsSession api={ctx.api} />
    </Card>
  );
}

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
  return (
    <Card title="Allowlist" id="mint-allowlist" lede="Every approved WL wallet plus every submitted collab wallet (EVM only). Build a snapshot on the server, then publish its root.">
      <NeedsSession api={ctx.api} />
      {snap && (
        <dl className="ad-kv">
          <Row label="Snapshot">
            {snap.count} wallets (WL {snap.sources.wl}, collab {snap.sources.collab}) · {new Date(snap.builtAt).toLocaleString('en-US')}
          </Row>
          <Row label="Root">
            <code>{snap.root}</code>
          </Row>
          <Row label="On chain">
            <code>{root}</code>
          </Row>
        </dl>
      )}
      {warnings.length > 0 && (
        <ul className="ad-warn" data-testid="allowlist-warnings">
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
          Build snapshot
        </Btn>
        <Btn
          primary
          disabled={!snap || snap.root.toLowerCase() === root.toLowerCase()}
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

function PriceCard({ ctx, price, keeper, open }: { ctx: ChainCtx; price: bigint; keeper: Address | null; open: OpenFn }) {
  const [quote, setQuote] = useState<MintPriceQuote | null>(null);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [manual, setManual] = useState('');
  const [err, guard, setErr] = useFormError();
  useEffect(() => {
    if (!ctx.api) return;
    ctx.api.mintPrice().then(setQuote, (e: Error) => setErr(e.message));
  }, [ctx.api, setErr]);
  const nft = ctx.net.nftAddress!;
  const target = quote?.priceWei ? BigInt(quote.priceWei) : null;
  const dev = target && target > 0n ? priceDeviationBps(price, target) : null;
  const serverKey = ctx.net.serverKey;
  return (
    <Card title="Price" id="mint-price" lede={`Held in wei; kept at $${((quote?.targetUsdCents ?? 100) / 100).toFixed(2)} in HYPE.`}>
      <dl className="ad-kv">
        <Row label="Now">{formatHypeAmount(price, 6)}</Row>
        <Row label="Target">
          {target ? `${formatHypeAmount(target, 6)} (HYPE = $${quote?.hypeUsd})` : 'price feed unavailable'}
          {dev !== null && ` · off by ${(dev / 100).toFixed(2)} %`}
        </Row>
      </dl>
      <div className="ad-actions">
        <Btn primary disabled={!target} testId="mint-sync-price" onClick={() => target && open('Sync the mint price to $1', setPriceCall(nft, target))}>
          Sync to $1
        </Btn>
      </div>
      <Input label="Set a price by hand (HYPE)" value={manual} onChange={setManual} />
      <Btn onClick={() => guard(() => open('Set the mint price', setPriceCall(nft, parseHypeInput('Price', manual))))}>Preview setPrice</Btn>
      <h3 className="ad-h3">Keeper</h3>
      <p className="ad-note">
        With the server key as keeper, the server re-prices every 5 minutes when off by more than 2 %, always inside the bounds. Keeper now:{' '}
        {keeper ? <Addr value={keeper} net={ctx.net} /> : 'none'}.
      </p>
      <div className="ad-form">
        <Input label="Min price (HYPE)" value={min} onChange={setMin} />
        <Input label="Max price (HYPE)" value={max} onChange={setMax} />
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
      <div className="ad-form">
        <Input label="Allowlist per wallet" value={w} onChange={setW} />
        <Input label="Public per wallet" value={p} onChange={setP} />
      </div>
      <Btn onClick={() => guard(() => open('Set the per-wallet limits', setLimitsCall(nft, parseIntInput('Allowlist limit', w, 0, 65_535), parseIntInput('Public limit', p, 0, 65_535))))}>Preview limits</Btn>
      <Input label={`Max supply (minted: ${total})`} value={m} onChange={setM} />
      <Btn onClick={() => guard(() => open('Lower the max supply', setMaxSupplyCall(nft, parseIntInput('Max supply', m, total, max))))}>Preview max supply</Btn>
      <FormError error={err} />
    </Card>
  );
}

function MetadataCard({ frozen, open, nft }: { frozen: boolean; open: OpenFn; nft: Address }) {
  const [uri, setUri] = useState(`${location.origin}/api/nft/`);
  const [err, guard] = useFormError();
  if (frozen) return <Card title="Metadata" id="mint-metadata" lede="Frozen forever."><></></Card>;
  return (
    <Card title="Metadata" id="mint-metadata" lede="tokenURI = base URI + id. Freezing is forever.">
      <Input label="Base URI" value={uri} onChange={setUri} />
      <div className="ad-actions">
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
        <Btn danger testId="mint-freeze" onClick={() => open('Freeze the metadata forever', freezeMetadataCall(nft), { confirmText: 'FREEZE', note: 'This can never be undone.' })}>
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
    <Card title="Royalty and treasury" id="mint-royalty" lede="ERC-2981 royalty (at most 10 %).">
      <div className="ad-form">
        <Input label="Royalty receiver" value={to} onChange={setTo} />
        <Input label="Royalty (bps)" value={bps} onChange={setBps} />
      </div>
      <Btn onClick={() => guard(() => open('Set the royalty', setRoyaltyCall(nft, parseAddressInput('Receiver', to), parseIntInput('Royalty', bps, 0, 1000))))}>Preview royalty</Btn>
      <Input label="Treasury" value={t} onChange={setT} />
      <Btn onClick={() => guard(() => open('Set the treasury', setTreasuryCall(nft, parseAddressInput('Treasury', t))))}>Preview treasury</Btn>
      <FormError error={err} />
    </Card>
  );
}

function OwnerMintCard({ me, open, nft }: { me: Address | null; open: OpenFn; nft: Address }) {
  const [to, setTo] = useState<string>(me ?? '');
  const [qty, setQty] = useState('1');
  const [err, guard] = useFormError();
  return (
    <Card title="Owner mint" id="mint-owner" lede="Mints for free to any wallet (team, giveaways); it counts toward the supply.">
      <div className="ad-form">
        <Input label="To" value={to} onChange={setTo} />
        <Input label="Quantity" value={qty} onChange={setQty} />
      </div>
      <Btn onClick={() => guard(() => open('Owner mint', ownerMintCall(nft, parseAddressInput('To', to), parseIntInput('Quantity', qty, 1, 65_535))))}>Preview owner mint</Btn>
      <FormError error={err} />
    </Card>
  );
}
