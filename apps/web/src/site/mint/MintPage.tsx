import { describeError, encodeCall, getMintState, getMintedBy, mintAllowlistCall, mintPublicCall, mintValue, type MintState as ChainMintState } from '@elymum/sdk';
import type { ChainStatus, MintContractState, MintProofResponse, MintState, WlEntryPublic } from '@elymum/shared';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Address, Hash, Hex } from 'viem';
import { AddressChip, ArcGauge, Button, CoinCharacter, FoodBit, HypeAmount, Icon, QuantityStepper, useMoves, useReducedMotion } from '../../design';
import { SERVER } from '../../config';
import { intlLocale, useT, type TKey } from '../../i18n';
import { renderRich } from '../../i18n/rich';
import { explorerTx } from '../../wallet/links';
import { fetchServerChain, publicClientFor } from '../../wallet/network';
import { useWallet } from '../../wallet/store';
import { sendWalletCall, txErrorText, type TxPhase } from '../../wallet/tx';
import { site } from '../api';
import { dropExpired } from '../session';
import { HYPE_FAUCET_URL } from '../faucet/logic';
import { X_URL } from '../settings';
import { isTestnetChain } from '../serverChain';
import { SitePage } from '../Shell';
import { SiteWalletProvider, WalletConnect, WalletSignIn, useSiteSession } from '../wallet/SiteWallet';
import { EmblemPanel, FoodConfetti, LinkButton, Starburst, MintTrack, type TrackStage } from './MintArt';
import { MintHeadline } from './MintHeadline';
import { MintSkeleton, NightPlate } from './MintShell';
import { fetchMintState, readCachedMint, takeEarlyMint } from './mintState';
import { EmblemHand, Flap, FlipCard, SealBreak } from './MintRitual';
import { EmblemPerks } from './Perks';
import {
  emblemPerks,
  fundsBlocker,
  hypeText,
  mintBlocker,
  mintErrorText,
  mintKind,
  mintView,
  mintedTokenIds,
  playOpenForHolders,
  priceStory,
  remaining,
  usdText,
  type MintView,
} from './logic';

/** The NFT emblem image the server draws for a token id. */
export const nftImageUrl = (id: bigint | number | string): string => `${SERVER.http}/api/nft/${id.toString()}.svg`;

/**
 * A freshly minted emblem. The server may not have seen the mint yet when the receipt lands (its
 * supply read can predate it by a moment), so a failed load retries a few times, cache-busted.
 */
function EmblemImage({ id }: { id: bigint }) {
  const [attempt, setAttempt] = useState(0);
  const src = attempt === 0 ? nftImageUrl(id) : `${nftImageUrl(id)}?retry=${attempt}`;
  return (
    <img
      src={src}
      alt={`Elymum #${id.toString()}`}
      width={240}
      height={240}
      onError={() => {
        if (attempt < 5) setTimeout(() => setAttempt((a) => a + 1), 800 * (attempt + 1));
      }}
    />
  );
}

const PHASE_LABEL: Record<MintView, TKey> = {
  unavailable: 'mn.phase.unavailable',
  closed: 'mn.phase.closed',
  allowlist: 'mn.phase.allowlist',
  public: 'mn.phase.public',
  soldout: 'mn.phase.soldout',
};

/** The contract fields of an on-chain read, in the server's shape. */
export function toContractState(s: ChainMintState): MintContractState {
  return {
    phase: s.phaseName,
    priceWei: s.price.toString(),
    minPriceWei: s.minPrice.toString(),
    maxPriceWei: s.maxPrice.toString(),
    keeper: s.keeper ?? '0x0000000000000000000000000000000000000000',
    merkleRoot: s.root,
    maxSupply: s.maxSupply,
    totalSupply: s.totalSupply,
    wlLimit: s.wlLimit,
    publicLimit: s.publicLimit,
    treasury: s.treasury,
    frozen: s.frozen,
  };
}

type ReadClient = NonNullable<ReturnType<typeof publicClientFor>>;

/** The wallet's HYPE, or null when the read fails. */
async function readBalance(client: ReadClient, address: Address): Promise<bigint | null> {
  try {
    const b = await client.getBalance({ address });
    return typeof b === 'bigint' ? b : null;
  } catch {
    return null;
  }
}

/**
 * Estimates the mint from the wallet (`eth_estimateGas`, nothing is sent). Returns the text to
 * show when the chain clearly refuses it (a contract error, too little HYPE), else null.
 */
async function dryRun(client: ReadClient, from: Address, call: ReturnType<typeof mintPublicCall>): Promise<string | null> {
  try {
    await client.estimateGas({ account: from, ...encodeCall(call) });
    return null;
  } catch (err) {
    const e = describeError(err);
    if (e.kind === 'contract' || e.kind === 'insufficient-funds') return mintErrorText(e, e.message);
    return null;
  }
}

/** `/mint`: Plate II, "The mint, after dark" (Closed / Allowlist / Public / Sold out, and the minted moment). */
export function MintPage() {
  return (
    <SitePage className="mt-root" cta={false}>
      <SiteWalletProvider>
        <Mint />
      </SiteWalletProvider>
    </SitePage>
  );
}

type Phase = 'idle' | 'preparing' | TxPhase | 'done' | 'error';

const fmt = (n: number) => n.toLocaleString(intlLocale());

/** "4s ago", "3 min ago": how old the price on screen is. Ticks by itself. */
function Age({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const t = useT();
  const s = Math.max(0, Math.round((now - since) / 1000));
  return <>{s < 60 ? t('mn.ageS', { s }) : t('mn.ageM', { m: Math.floor(s / 60) })}</>;
}

export function Mint({ pollMs = 30_000 }: { pollMs?: number }) {
  // the last state this browser saw paints the card at once; the server's answer replaces it
  const t = useT();
  const [cached] = useState(() => readCachedMint());
  const [state, setState] = useState<MintState | null>(cached?.state ?? null);
  const [loadedAt, setLoadedAt] = useState(cached?.at ?? 0);
  /** True once the server answered on this visit (until then the card shows the kept state). */
  const [fresh, setFresh] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [chain, setChain] = useState<ChainStatus | null>(null);
  const address = useWallet((s) => (s.status === 'connected' ? s.address : null));
  const provider = useWallet((s) => s.current?.provider ?? null);
  const session = useSiteSession();
  const [proof, setProof] = useState<MintProofResponse | null>(null);
  const [minted, setMinted] = useState<{ wl: number; pub: number }>({ wl: 0, pub: 0 });
  /** The wallet's HYPE (wei); null while unknown (the wallet then decides). */
  const [balance, setBalance] = useState<bigint | null>(null);
  const [wl, setWl] = useState<WlEntryPublic | null | undefined>(undefined);
  const [qty, setQty] = useState(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<Hash | null>(null);
  const [ids, setIds] = useState<bigint[]>([]);
  const inFlight = useRef(false);
  const [tick, setTick] = useState(0);
  const mv = useMoves();
  const reduced = useReducedMotion();
  // the minted stickers land one after another, slower than a list (it is a moment, not a menu)
  const dropIn = reduced ? mv.stagger : { hidden: {}, shown: { transition: { staggerChildren: 0.2, delayChildren: 0.08 } } };
  // the minted moment opens with the wax seal breaking; the emblems drop once it snaps
  const [unsealed, setUnsealed] = useState(false);
  useEffect(() => {
    if (phase !== 'done') setUnsealed(false);
  }, [phase]);

  // the server's mint state (and the chain it is on), refreshed while the page is open
  useEffect(() => {
    let live = true;
    // the first load takes the request the site entry started with the page's code (no waterfall)
    let first = true;
    const load = () => {
      const p = (first && takeEarlyMint()) || fetchMintState();
      first = false;
      return p.then(
        (s) => {
          if (!live) return;
          setState(s);
          setLoadedAt(Date.now());
          setFresh(true);
          setLoadErr(null);
        },
        (e: Error) => live && setLoadErr(e.message),
      );
    };
    // the server's chain: asked again on every refresh until it answers (a slow or failed first
    // answer must not leave the mint button disabled for the rest of the visit)
    let retry: number | undefined;
    const loadChain = (n = 0): void =>
      void fetchServerChain().then((c) => {
        if (!live) return;
        if (c) setChain(c);
        else if (n < 6) retry = window.setTimeout(() => loadChain(n + 1), 1500 * (n + 1));
      });
    void load();
    loadChain();
    const id = pollMs > 0 ? window.setInterval(() => void load(), pollMs) : null;
    return () => {
      live = false;
      if (id) clearInterval(id);
      clearTimeout(retry);
    };
  }, [pollMs, tick]);

  const nft = (state?.nftAddress ?? null) as Address | null;

  // eligibility (proof) and what this wallet already minted
  useEffect(() => {
    setProof(null);
    setMinted({ wl: 0, pub: 0 });
    setBalance(null);
    if (!address || !nft) return;
    let live = true;
    site.mintProof(address).then(
      (p) => live && setProof(p),
      () => live && setProof({ eligible: false, proof: [], root: null, onchainRoot: null }),
    );
    const client = publicClientFor(chain, provider);
    if (client) {
      void getMintedBy(client, nft, address).then((m) => live && setMinted(m), () => {});
      void Promise.resolve()
        .then(() => client.getBalance({ address }))
        .then((b) => live && typeof b === 'bigint' && setBalance(b))
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [address, nft, chain, provider, tick]);

  // the WL status of a signed-in visitor (the Closed teaser)
  useEffect(() => {
    if (!session) {
      setWl(undefined);
      return;
    }
    let live = true;
    site.myWl(session.token).then(
      (e) => live && setWl(e),
      (err) => {
        if (!live) return;
        dropExpired(err);
        setWl(null);
      },
    );
    return () => {
      live = false;
    };
  }, [session]);

  // the minted moment replaces a long card: bring the top of the plate into view
  useEffect(() => {
    if (phase !== 'done') return;
    const el = document.querySelector<HTMLElement>('.mt-platelabel');
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }, [phase, reduced]);

  if (loadErr && !state)
    return (
      <NightPlate className="mt-night--quiet">
        <div className="mt-wrap mt-wrap--quiet">
          <CoinCharacter paint="sun" mood="scared" size={120} sweat />
          <div>
            <h1 className="mt-quiet__h display">{t('mn.down')}</h1>
            <p className="mt-err" role="alert">
              {loadErr}
            </p>
            <Button variant="secondary" onClick={() => setTick((n) => n + 1)}>
              {t('tf.retry')}
            </Button>
          </div>
        </div>
      </NightPlate>
    );
  // nothing to show yet: the card's layout with stand-in values, not a spinner on an empty plate
  if (!state) return <MintSkeleton />;

  const view = mintView(state);
  const c = state.contract;
  const kind = mintKind(view);
  const left = c && kind ? remaining(c, minted, kind) : 0;
  const q = Math.max(1, Math.min(qty, Math.max(1, left)));
  const priceWei = c ? BigInt(c.priceWei) : 0n;
  const busy = phase === 'preparing' || phase === 'switching' || phase === 'signing' || phase === 'confirming';
  // what the wallet sends: the price times the quantity, plus the buffer the contract refunds
  const value = priceWei > 0n ? mintValue(priceWei, q) : 0n;
  const refusal = c && kind && address ? mintBlocker(c, minted, { kind, qty: q, proof }) : null;
  const poor = !!(c && kind && address && !refusal && fundsBlocker(balance, value));
  const blocker = refusal ?? (poor ? fundsBlocker(balance, value) : null);
  const playOpen = playOpenForHolders(state.gameAccess);
  const story = priceStory(state, isTestnetChain(chain));

  const mint = async () => {
    if (inFlight.current || !c || !kind || !address || !nft) return;
    inFlight.current = true;
    setError(null);
    setHash(null);
    setPhase('preparing');
    const fail = (msg: string) => {
      inFlight.current = false;
      setError(msg);
      setPhase('error');
    };
    // the server's chain (asked again here in case the first answer never came)
    const target = chain ?? (await fetchServerChain({ fresh: true }));
    if (!target) return fail(t('mn.fail.server'));
    if (!chain) setChain(target);
    const client = publicClientFor(target, provider);
    if (!client) return fail(t('mn.fail.chain'));
    let price: bigint;
    try {
      // the latest price and limits, right before the wallet opens (a keeper may have re-priced)
      const [fresh, mine] = await Promise.all([getMintState(client, nft), getMintedBy(client, nft, address)]);
      setMinted(mine);
      const why = mintBlocker(toContractState(fresh), mine, { kind, qty: q, proof });
      if (why) return fail(t('mn.fail.not', { why }));
      price = fresh.price;
    } catch {
      return fail(t('mn.fail.contract'));
    }
    const call =
      kind === 'allowlist' ? mintAllowlistCall(nft, { qty: q, proof: (proof?.proof ?? []) as Hex[], price }) : mintPublicCall(nft, { qty: q, price });
    // the wallet's HYPE and a dry run, so a mint that cannot work says why here instead of in a
    // wallet warning. Only a clear answer stops it (too little HYPE, a contract refusal); a read
    // that fails for any other reason leaves the decision to the wallet.
    const bal = await readBalance(client, address);
    if (bal !== null) setBalance(bal);
    const short = fundsBlocker(bal, call.value ?? 0n);
    if (short) return fail(t('mn.fail.funds', { why: short }));
    const dry = await dryRun(client, address, call);
    if (dry) return fail(dry);
    const res = await sendWalletCall(call, {
      chain: target,
      onPhase: (p, h) => {
        setPhase(p);
        if (h) setHash(h);
      },
    });
    if (!res.ok) return fail(mintErrorText(res.error, txErrorText(res.error)));
    setIds(mintedTokenIds(res.receipt.logs, nft, address));
    setHash(res.hash);
    setPhase('done');
    inFlight.current = false;
    setTick((n) => n + 1);
  };

  /* ---------------- minted: the stickers drop in ---------------- */
  if (phase === 'done') {
    const tx = hash ? explorerTx(hash, chain?.explorerUrl) : null;
    const n = ids.length;
    return (
      <NightPlate className="mt-night--done">
        <div className="mt-wrap mt-wrap--done mt-done" data-testid="mt-done">
          <div className="mt-copy">
            <MintTrack at="play" />
            <span className="kicker mt-kicker">{n > 0 ? t('mn.done.kickerNo', { ids: ids.map((i) => i.toString()).join(', ') }) : t('mn.done.kicker')}</span>
            <h1 className="mt-h display">
              {renderRich(n <= 1 ? t('mn.done.h1') : t('mn.done.hN', { n }), { br: () => <br />, em: (c) => <em>{c}</em> })}
            </h1>
            <p className="mt-lede">
              {n <= 1 ? t('mn.done.one') : t('mn.done.many')} {playOpen ? t('mn.done.open') : t('mn.done.soon')}
            </p>
            <div className="mt-done__cta">
              {playOpen ? (
                <LinkButton href="/play" variant="primary" size="lg" icon="arrow" className="mt-play">
                  {t('site.nav.play')}
                </LinkButton>
              ) : (
                <LinkButton href={X_URL} variant="primary" size="lg" target="_blank" rel="noreferrer">
                  {t('pg.follow')}
                </LinkButton>
              )}
              {tx && (
                <LinkButton href={tx} variant="secondary" target="_blank" rel="noreferrer">
                  {t('tf.viewTx')}
                </LinkButton>
              )}
              <button type="button" className="mt-textlink" onClick={() => setPhase('idle')}>
                {t('mn.done.back')}
              </button>
            </div>
          </div>
          <div className={`mt-pile mt-pile--${Math.min(n, 4)}`}>
            {unsealed && <Starburst />}
            {unsealed && <FoodConfetti count={n > 1 ? 44 : 36} delay={-0.2} />}
            <SealBreak size={n > 1 ? 180 : 220} onSnap={() => setUnsealed(true)} />
            <motion.ul className="mt-tokens" variants={dropIn} initial="hidden" animate={unsealed ? 'shown' : 'hidden'}>
              {ids.map((id, i) => {
                const tilt = [-3, 2.5, -1.5, 3.5][i % 4];
                return (
                  <motion.li key={id.toString()} className="mt-token" variants={mv.stickerDrop} custom={tilt}>
                    <FlipCard front={<EmblemImage id={id} />} go={unsealed} delay={0.55 + i * 0.2} />
                    <motion.span
                      className="mt-token__tag mono"
                      initial={reduced ? { opacity: 0 } : { scale: 0, rotate: -40 }}
                      animate={!unsealed ? undefined : reduced ? { opacity: 1 } : { scale: 1, rotate: i % 2 ? 8 : -8 }}
                      transition={reduced ? { duration: 0.12, delay: 0.3 } : { type: 'spring', stiffness: 600, damping: 14, delay: 1.05 + i * 0.2 }}
                    >
                      {t('mn.done.yours')}
                    </motion.span>
                  </motion.li>
                );
              })}
            </motion.ul>
            <div className="mt-pile__ground" aria-hidden="true">
              <CoinCharacter paint="cyan" mood="chomp" size={104} feet className="mt-pile__eater" />
              <FoodBit kind="pear" size={26} className="mt-pile__snack" />
              <FoodBit kind="seed" paint="foam" size={16} className="mt-pile__snack mt-pile__snack--2" />
            </div>
          </div>
        </div>
      </NightPlate>
    );
  }

  /* ---------------- the mint card ---------------- */
  const stage: TrackStage = view === 'soldout' ? 'play' : kind ? 'mint' : 'wl';
  const nextNo = c ? (view === 'soldout' ? c.maxSupply : c.totalSupply + 1) : null;
  const noText = nextNo === null ? t('mn.noUnknown') : kind && q > 1 ? t('mn.noRange', { a: nextNo, b: nextNo + q - 1 }) : t('mn.no', { n: nextNo });
  const pct = c && c.maxSupply > 0 ? Math.floor((c.totalSupply / c.maxSupply) * 100) : 0;
  const gaugeCaption = !c
    ? null
    : view === 'soldout'
      ? t('mn.gauge.all')
      : c.totalSupply === 0
        ? t('mn.gauge.none')
        : t('mn.gauge.pct', { pct });

  const emblem =
    view === 'unavailable' ? (
      <EmblemPanel no={noText} mood="sleepy" ribbon={t('mn.rib.unstruck')} phase={t(PHASE_LABEL[view])} />
    ) : view === 'closed' ? (
      <EmblemPanel no={noText} mood="smug" ribbon={t('ld.nft.rib')} ribbonAs="h2" phase={t(PHASE_LABEL[view])} seal="sealed" />
    ) : view === 'soldout' ? (
      <EmblemPanel no={noText} mood="happy" ribbon={t('mn.rib.gone')} phase={t(PHASE_LABEL[view])} phaseTone="done" />
    ) : (
      <EmblemPanel no={noText} mood={busy ? 'open' : 'smug'} ribbon={busy ? t('mn.rib.unsealing') : t('ld.nft.rib')} phase={t(PHASE_LABEL[view])} phaseTone="live" seal={busy ? 'trembling' : 'sealed'} />
    );

  const priceRow = c && (
    <div className="mt-price">
      <span data-testid="mt-price" className="mt-price__fig">
        <Flap value={c.priceWei}>
          <HypeAmount wei={priceWei} decimals={4} usd={state.priceUsd} size="lg" />
        </Flap>
      </span>
      <p className="mt-price__tick num">
        {story === 'testnet' && t('mn.tick.test')}
        {state.hypeUsd !== null ? (
          <>
            {t('mn.tick.rate', { rate: state.hypeUsd.toFixed(2) })} {loadedAt ? <Age since={loadedAt} /> : t('mn.tick.now')}
          </>
        ) : (
          t('mn.tick.napping')
        )}
        {t('mn.tick.gas')}
      </p>
    </div>
  );

  const gauge = c && <ArcGauge value={c.totalSupply} max={c.maxSupply} caption={gaugeCaption} label={t('mn.gauge.label')} />;

  let right: ReactNode;
  if (view === 'unavailable') {
    right = (
      <>
        <div className="mt-card__head">
          <span className="kicker mt-card__kick">{t('mn.na.status')}</span>
          <h2 className="mt-card__h display">{t('mn.na.h')}</h2>
          <p>{t('mn.na.body')}</p>
        </div>
        <dl className="mt-facts">
          <div>
            <dt className="kicker">{t('mn.na.price')}</dt>
            <dd className="num">{t('mn.na.priceV')}</dd>
          </div>
          <div>
            <dt className="kicker">{t('mn.na.order')}</dt>
            <dd className="num">{t('mn.na.orderV')}</dd>
          </div>
        </dl>
        <LinkButton href="/wl" route variant="primary" size="lg" block icon="arrow">
          {t('ld.cta.wl')}
        </LinkButton>
        <WlNote tone="idle" glyph="info">
          {renderRich(t('mn.na.note'), { b: (c) => <b>{c}</b> })}
        </WlNote>
      </>
    );
  } else if (view === 'closed') {
    right = (
      <>
        {gauge}
        {priceRow}
        <p className="mt-card__teaser">{t('mn.closed.teaser')}</p>
        {session ? (
          <ClosedWlStatus wl={wl} address={session.address} />
        ) : (
          <div className="mt-signin">
            <span className="kicker mt-card__kick">{t('mn.closed.status')}</span>
            <WalletSignIn label={t('mn.closed.signIn')} />
          </div>
        )}
        {session && wl && wl.status === 'approved' ? (
          <LinkButton href={X_URL} variant="secondary" size="lg" block target="_blank" rel="noreferrer">
            {t('mn.closed.follow')}
          </LinkButton>
        ) : (
          <LinkButton href="/wl" route variant="primary" size="lg" block icon="arrow">
            {t('ld.cta.wl')}
          </LinkButton>
        )}
      </>
    );
  } else if (view === 'soldout') {
    right = (
      <>
        {gauge}
        <div className="mt-card__head">
          <span className="kicker mt-card__kick">{t('mn.so.holders', { n: state.holders, count: fmt(state.holders) })}</span>
          <h2 className="mt-card__h display">{t('mn.so.h')}</h2>
          <p>{playOpen ? t('mn.so.open') : t('mn.so.soon')}</p>
        </div>
        {playOpen ? (
          <LinkButton href="/play" variant="primary" size="lg" block icon="arrow">
            {t('site.nav.play')}
          </LinkButton>
        ) : (
          <LinkButton href={X_URL} variant="primary" size="lg" block target="_blank" rel="noreferrer">
            {t('pg.follow')}
          </LinkButton>
        )}
        <WlNote tone="idle" glyph="info">
          {t('mn.so.missed')}
        </WlNote>
      </>
    );
  } else if (c && kind) {
    const steps = busy || (phase === 'error' && hash) ? <MintSteps phase={phase} hash={hash} explorer={chain?.explorerUrl ?? null} /> : null;
    right = (
      <>
        {gauge}
        {priceRow}
        {!address ? (
          <div className="mt-signin" data-testid="mt-connect">
            <span className="kicker mt-card__kick">{kind === 'allowlist' ? t('mn.kind.allowlist') : t('mn.kind.public')}</span>
            {/* minting needs the wallet, not a sign-in: a session left from another page (the
                arena signs in with the same key) must not hide the way to connect */}
            <p className="mt-card__teaser">
              {session
                ? renderRich(t('mn.connect.signed'), { chip: () => <AddressChip address={session.address} size="sm" copy={false} /> })
                : t('mn.connect.plain')}
            </p>
            <WalletConnect note={t('mn.connect.note')} />
          </div>
        ) : (
          <>
            <div className="mt-qty">
              <div>
                <div className="kicker mt-card__kick mt-qty__lbl">{t('mn.qty')}</div>
                <QuantityStepper value={q} onChange={setQty} max={Math.max(1, left)} label={t('mn.qtyLabel')} lessLabel={t('mn.qtyLess')} moreLabel={t('mn.qtyMore')} disabled={busy || left <= 1} data-testid="mt-qty" />
              </div>
              <EmblemHand count={q} />
              <div className="mt-total">
                <span className="kicker mt-card__kick">{t('cr.total')}</span>
                <HypeAmount wei={priceWei * BigInt(q)} decimals={4} size="md" className="mt-total__fig" />
                <span className="mt-total__sub num">
                  {state.priceUsd !== null && `≈ ${usdText(state.priceUsd * q)} · `}
                  {t('mn.max', { n: left })}
                </span>
              </div>
            </div>
            <Button variant="primary" size="lg" block loading={busy} disabled={!busy && !!blocker} onClick={() => void mint()} className="mt-mintbtn">
              {busy ? t(BUSY_LABEL[phase as keyof typeof BUSY_LABEL]) : t('mn.mintN', { n: q })}
            </Button>
            {steps}
            {blocker && !busy && (
              <p className="mt-why" role="alert" data-testid="mt-blocker">
                <span className="kicker">{poor ? t('mn.why.poor') : left === 0 ? t('mn.why.limit') : t('mn.why.notYet')}</span> {cap(blocker)}.
                {poor && story === 'testnet' && (
                  <>
                    {' '}
                    <a href={HYPE_FAUCET_URL} target="_blank" rel="noreferrer">
                      {t('mn.testHype')}
                    </a>
                  </>
                )}
              </p>
            )}
            {error && (
              <p className="mt-why mt-why--error" role="alert" data-testid="mt-error">
                <span className="kicker">{t('mn.hm')}</span> {error}
              </p>
            )}
            {kind === 'allowlist' ? (
              <AllowlistStatus proof={proof} address={address} />
            ) : (
              <WlNote tone="ok" glyph="check">
                <AddressChip address={address} size="sm" copy={false} /> <span>{t('mn.pubNote', { n: c.publicLimit })}</span>
              </WlNote>
            )}
            <p className="mt-fine">{t('mn.fine')}</p>
          </>
        )}
      </>
    );
  }

  const kicker = c ? t('mn.kickerSupply', { n: fmt(c.maxSupply) }) : t('mn.kicker');

  return (
    <NightPlate>
      <div className="mt-wrap mt-page" data-view={view} data-stale={fresh ? undefined : ''}>
        <div className="mt-copy">
          <span className="kicker mt-kicker">{kicker}</span>
          <MintHeadline story={story} price={c ? hypeText(priceWei) : null} />
          <MintTrack at={stage} />
          {c && (
            <p className="mt-limits num">{t('mn.limits', { wl: c.wlLimit, pub: c.publicLimit })}</p>
          )}
        </div>
        <motion.div className="mt-card kb-island" variants={mv.stickerDrop} custom={0.6} initial="hidden" animate="shown">
          {emblem}
          <div className="mt-card__right">{right}</div>
        </motion.div>
        {/* under the lede on wide screens, under the mint card on phones (the card comes first there) */}
        <EmblemPerks perks={emblemPerks(isTestnetChain(chain), { feeBps: chain?.feeBps ?? null, feeModel: chain?.feeModel ?? null, gameAccess: state.gameAccess })} />
      </div>
    </NightPlate>
  );
}

const BUSY_LABEL: Record<'preparing' | 'switching' | 'signing' | 'confirming', TKey> = {
  preparing: 'mn.busy.preparing',
  switching: 'mn.busy.switching',
  signing: 'mn.busy.signing',
  confirming: 'mn.busy.confirming',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The two wallet steps while a mint is in flight: sign, then the chain. */
function MintSteps({ phase, hash, explorer }: { phase: Phase; hash: Hash | null; explorer: string | null }) {
  const t = useT();
  const first = phase === 'preparing' ? t('mn.step.price') : phase === 'switching' ? t('mn.step.switch') : t('mn.step.approve');
  const s1 = phase === 'confirming' || phase === 'error' ? 'done' : 'on';
  const s2 = phase === 'confirming' ? 'on' : phase === 'error' ? 'off' : 'wait';
  const link = hash ? explorerTx(hash, explorer) : null;
  return (
    <ol className="mt-steps" aria-live="polite">
      <li className={`mt-steps__s is-${s1}`}>
        <span className="mt-steps__n num">{s1 === 'done' ? <Icon name="check" size={14} /> : '1'}</span>
        {first}
      </li>
      <li className={`mt-steps__s is-${s2}`}>
        <span className="mt-steps__n num">2</span>
        {t('mn.step.mint')}
        {hash && (
          <AddressChip address={hash} chars={4} size="sm" href={link ?? undefined} copy={false} label={t('mn.step.tx')} className="mt-steps__hash" />
        )}
      </li>
    </ol>
  );
}

/** A small status sticker under the mint button (WL status, public notes). */
function WlNote({ tone, glyph, children, testId }: { tone: 'ok' | 'no' | 'wait' | 'idle'; glyph: 'check' | 'close' | 'info' | 'lock'; children: ReactNode; testId?: string }) {
  return (
    <div className={`mt-wl mt-wl--${tone}`} data-testid={testId}>
      <span className="mt-wl__dot" aria-hidden="true">
        <Icon name={glyph} size={15} />
      </span>
      <div className="mt-wl__text">{children}</div>
    </div>
  );
}

/** Allowlist phase: is the connected wallet on the list (and is the list on the contract yet)? */
function AllowlistStatus({ proof, address }: { proof: MintProofResponse | null; address: string }) {
  const t = useT();
  const chip = <AddressChip address={address} size="sm" copy={false} />;
  if (proof === null)
    return (
      <WlNote tone="wait" glyph="info" testId="mt-eligibility">
        {renderRich(t('mn.al.checking'), { chip: () => chip })}
      </WlNote>
    );
  if (!proof.eligible)
    return (
      <WlNote tone="no" glyph="close" testId="mt-eligibility">
        {chip} <span>{t('mn.al.no')}</span>
      </WlNote>
    );
  const published = !!proof.root && !!proof.onchainRoot && proof.root.toLowerCase() === proof.onchainRoot.toLowerCase();
  if (!published)
    return (
      <WlNote tone="wait" glyph="lock" testId="mt-eligibility">
        {chip} <span>{t('mn.al.unpublished')}</span>
      </WlNote>
    );
  return (
    <WlNote tone="ok" glyph="check" testId="mt-eligibility">
      {chip} <span>{t('mn.al.yes')}</span>
    </WlNote>
  );
}

/** Closed phase: the signed-in visitor's WL entry. */
function ClosedWlStatus({ wl, address }: { wl: WlEntryPublic | null | undefined; address: string }) {
  const t = useT();
  const chip = <AddressChip address={address} size="sm" copy={false} />;
  if (wl === undefined)
    return (
      <WlNote tone="wait" glyph="info" testId="mt-wl">
        {renderRich(t('mn.wl.checking'), { chip: () => chip })}
      </WlNote>
    );
  if (wl === null)
    return (
      <WlNote tone="idle" glyph="info" testId="mt-wl">
        {chip} <span>{t('mn.wl.none')}</span>
      </WlNote>
    );
  if (wl.status === 'approved')
    return (
      <WlNote tone="ok" glyph="check" testId="mt-wl">
        {chip} <span>{t('mn.wl.approved')}</span>
      </WlNote>
    );
  if (wl.status === 'pending')
    return (
      <WlNote tone="wait" glyph="info" testId="mt-wl">
        {chip} <span>{t('mn.wl.pending')}</span>
      </WlNote>
    );
  return (
    <WlNote tone="no" glyph="close" testId="mt-wl">
      {chip} <span>{t('mn.wl.rejected')}</span>
    </WlNote>
  );
}
