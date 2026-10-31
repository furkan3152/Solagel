import { describeError, encodeCall, getMintState, getMintedBy, mintAllowlistCall, mintPublicCall, mintValue, type MintState as ChainMintState } from '@elymum/sdk';
import type { ChainStatus, MintContractState, MintProofResponse, MintState, WlEntryPublic } from '@elymum/shared';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Address, Hash, Hex } from 'viem';
import { AddressChip, ArcGauge, Button, CoinCharacter, FoodBit, HypeAmount, Icon, Kb, PlateLabel, QuantityStepper, Seigaiha, StampSpinner, useMoves, useReducedMotion } from '../../design';
import { SERVER } from '../../config';
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
import { EmblemPanel, FoodConfetti, LinkButton, Starburst, MintSky, MintTrack, type TrackStage } from './MintArt';
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
  type PriceStory,
} from './logic';
import './mint.css';

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

const PHASE_LABEL: Record<MintView, string> = {
  unavailable: 'Not deployed',
  closed: 'Closed',
  allowlist: 'Allowlist',
  public: 'Public',
  soldout: 'Sold out',
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

const fmt = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** "4s ago", "3 min ago": how old the price on screen is. Ticks by itself. */
function Age({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.round((now - since) / 1000));
  return <>{s < 60 ? `${s}s ago` : `${Math.floor(s / 60)} min ago`}</>;
}

/** The night plate every state of the page sits on. */
function NightPlate({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <>
      <PlateLabel numeral="II" title="The mint, after dark" aside="/mint" className="mt-platelabel" />
      <Kb theme="night" className={`mt-night${className ? ` ${className}` : ''}`}>
        <MintSky />
        {children}
        <div className="mt-band" aria-hidden="true">
          <Seigaiha rows={3} r={40} tone="night" />
        </div>
      </Kb>
    </>
  );
}

export function Mint({ pollMs = 30_000 }: { pollMs?: number }) {
  const [state, setState] = useState<MintState | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
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
    const load = () =>
      site.mint().then(
        (s) => {
          if (!live) return;
          setState(s);
          setLoadedAt(Date.now());
          setLoadErr(null);
        },
        (e: Error) => live && setLoadErr(e.message),
      );
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
            <h1 className="mt-quiet__h display">The mint is not answering.</h1>
            <p className="mt-err" role="alert">
              {loadErr}
            </p>
            <Button variant="secondary" onClick={() => setTick((n) => n + 1)}>
              Try again
            </Button>
          </div>
        </div>
      </NightPlate>
    );
  if (!state)
    return (
      <NightPlate className="mt-night--quiet">
        <div className="mt-wrap mt-wrap--quiet mt-wrap--loading">
          <StampSpinner label="Loading" />
        </div>
      </NightPlate>
    );

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
    if (!target) return fail('The game server is not answering, so the network to mint on is unknown. Try again in a moment.');
    if (!chain) setChain(target);
    const client = publicClientFor(target, provider);
    if (!client) return fail('Cannot read the chain right now.');
    let price: bigint;
    try {
      // the latest price and limits, right before the wallet opens (a keeper may have re-priced)
      const [fresh, mine] = await Promise.all([getMintState(client, nft), getMintedBy(client, nft, address)]);
      setMinted(mine);
      const why = mintBlocker(toContractState(fresh), mine, { kind, qty: q, proof });
      if (why) return fail(`Not minted: ${why}.`);
      price = fresh.price;
    } catch {
      return fail('Cannot read the mint contract right now. Try again in a moment.');
    }
    const call =
      kind === 'allowlist' ? mintAllowlistCall(nft, { qty: q, proof: (proof?.proof ?? []) as Hex[], price }) : mintPublicCall(nft, { qty: q, price });
    // the wallet's HYPE and a dry run, so a mint that cannot work says why here instead of in a
    // wallet warning. Only a clear answer stops it (too little HYPE, a contract refusal); a read
    // that fails for any other reason leaves the decision to the wallet.
    const bal = await readBalance(client, address);
    if (bal !== null) setBalance(bal);
    const short = fundsBlocker(bal, call.value ?? 0n);
    if (short) return fail(`Not enough HYPE: ${short}.`);
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
            <span className="kicker mt-kicker">Minted{n > 0 ? ` · No. ${ids.map((i) => i.toString()).join(', ')}` : ''}</span>
            <h1 className="mt-h display">
              {n <= 1 ? (
                <>
                  Your Elymum
                  <br />
                  <em>is here.</em>
                </>
              ) : (
                <>
                  Your {n} Elymum
                  <br />
                  <em>are here.</em>
                </>
              )}
            </h1>
            <p className="mt-lede">
              {n <= 1 ? 'Unsealed and in your wallet.' : 'Unsealed, all of them, and in your wallet.'}{' '}
              {playOpen ? 'The ring is open to holders. It is feeding time.' : 'The ring opens to holders soon. The first bell rings on @elymumio.'}
            </p>
            <div className="mt-done__cta">
              {playOpen ? (
                <LinkButton href="/play" variant="primary" size="lg" icon="arrow" className="mt-play">
                  Play
                </LinkButton>
              ) : (
                <LinkButton href={X_URL} variant="primary" size="lg" target="_blank" rel="noreferrer">
                  Follow @elymumio
                </LinkButton>
              )}
              {tx && (
                <LinkButton href={tx} variant="secondary" target="_blank" rel="noreferrer">
                  View transaction
                </LinkButton>
              )}
              <button type="button" className="mt-textlink" onClick={() => setPhase('idle')}>
                Back to the mint
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
                      Yours
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
  const noText = nextNo === null ? 'NO. ????' : kind && q > 1 ? `NO. ${nextNo}–${nextNo + q - 1}` : `NO. ${nextNo}`;
  const pct = c && c.maxSupply > 0 ? Math.floor((c.totalSupply / c.maxSupply) * 100) : 0;
  const gaugeCaption = !c
    ? null
    : view === 'soldout'
      ? 'All of them. Every last snack.'
      : c.totalSupply === 0
        ? 'None yet. Someone has to be first.'
        : `${pct}% minted. The rest are still deciding.`;

  const emblem =
    view === 'unavailable' ? (
      <EmblemPanel no={noText} mood="sleepy" ribbon="Not struck yet." phase={PHASE_LABEL[view]} />
    ) : view === 'closed' ? (
      <EmblemPanel no={noText} mood="smug" ribbon="Sealed. For now." ribbonAs="h2" phase={PHASE_LABEL[view]} seal="sealed" />
    ) : view === 'soldout' ? (
      <EmblemPanel no={noText} mood="happy" ribbon="All gone. Good." phase={PHASE_LABEL[view]} phaseTone="done" />
    ) : (
      <EmblemPanel no={noText} mood={busy ? 'open' : 'smug'} ribbon={busy ? 'Unsealing…' : 'Sealed. For now.'} phase={PHASE_LABEL[view]} phaseTone="live" seal={busy ? 'trembling' : 'sealed'} />
    );

  const priceRow = c && (
    <div className="mt-price">
      <span data-testid="mt-price" className="mt-price__fig">
        <Flap value={c.priceWei}>
          <HypeAmount wei={priceWei} decimals={4} usd={state.priceUsd} size="lg" />
        </Flap>
      </span>
      <p className="mt-price__tick num">
        {story === 'testnet' && 'Fixed testnet price · '}
        {state.hypeUsd !== null ? <>HYPE/USD {state.hypeUsd.toFixed(2)} · updated {loadedAt ? <Age since={loadedAt} /> : 'just now'}</> : 'HYPE/USD feed is napping; the contract price stands'}
        {' · gas on Elysium, also in HYPE'}
      </p>
    </div>
  );

  const gauge = c && <ArcGauge value={c.totalSupply} max={c.maxSupply} caption={gaugeCaption} label="Emblems minted" />;

  let right: ReactNode;
  if (view === 'unavailable') {
    right = (
      <>
        <div className="mt-card__head">
          <span className="kicker mt-card__kick">Status</span>
          <h2 className="mt-card__h display">The mint is not live yet.</h2>
          <p>The contract is not on Elysium yet. When it lands: one dollar in HYPE, the WL goes first, then everyone else.</p>
        </div>
        <dl className="mt-facts">
          <div>
            <dt className="kicker">Price</dt>
            <dd className="num">$1.00 in HYPE</dd>
          </div>
          <div>
            <dt className="kicker">Order</dt>
            <dd className="num">WL, then public</dd>
          </div>
        </dl>
        <LinkButton href="/wl" route variant="primary" size="lg" block icon="arrow">
          Join the WL
        </LinkButton>
        <WlNote tone="idle" glyph="info">
          Three small chores get you on the list. <b>About a minute, all told.</b>
        </WlNote>
      </>
    );
  } else if (view === 'closed') {
    right = (
      <>
        {gauge}
        {priceRow}
        <p className="mt-card__teaser">WL first, then public. The date lands on @elymumio before it lands anywhere else.</p>
        {session ? (
          <ClosedWlStatus wl={wl} address={session.address} />
        ) : (
          <div className="mt-signin">
            <span className="kicker mt-card__kick">Your WL status</span>
            <WalletSignIn label="Sign in to see my WL status" />
          </div>
        )}
        {session && wl && wl.status === 'approved' ? (
          <LinkButton href={X_URL} variant="secondary" size="lg" block target="_blank" rel="noreferrer">
            Follow @elymumio for the date
          </LinkButton>
        ) : (
          <LinkButton href="/wl" route variant="primary" size="lg" block icon="arrow">
            Join the WL
          </LinkButton>
        )}
      </>
    );
  } else if (view === 'soldout') {
    right = (
      <>
        {gauge}
        <div className="mt-card__head">
          <span className="kicker mt-card__kick">{fmt(state.holders)} {plural(state.holders, 'holder')}</span>
          <h2 className="mt-card__h display">Sold out.</h2>
          <p>Every emblem found a pocket. Holders, the ring is {playOpen ? 'open: go eat.' : 'warming up; the first bell rings on @elymumio.'}</p>
        </div>
        {playOpen ? (
          <LinkButton href="/play" variant="primary" size="lg" block icon="arrow">
            Play
          </LinkButton>
        ) : (
          <LinkButton href={X_URL} variant="primary" size="lg" block target="_blank" rel="noreferrer">
            Follow @elymumio
          </LinkButton>
        )}
        <WlNote tone="idle" glyph="info">
          Missed it? Emblems change hands on NFT marketplaces. The ring checks your wallet, not your receipt.
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
            <span className="kicker mt-card__kick">{kind === 'allowlist' ? 'Allowlist mint' : 'Public mint'}</span>
            {/* minting needs the wallet, not a sign-in: a session left from another page (the
                arena signs in with the same key) must not hide the way to connect */}
            <p className="mt-card__teaser">
              {session ? (
                <>
                  Signed in as <AddressChip address={session.address} size="sm" copy={false} />. Connect that wallet to mint; no new signature.
                </>
              ) : (
                'Connect the wallet you mint with. No sign-in needed.'
              )}
            </p>
            <WalletConnect note="Connecting sends nothing. Minting is one transaction from your wallet." />
          </div>
        ) : (
          <>
            <div className="mt-qty">
              <div>
                <div className="kicker mt-card__kick mt-qty__lbl">How many</div>
                <QuantityStepper value={q} onChange={setQty} max={Math.max(1, left)} label="How many emblems" lessLabel="One less" disabled={busy || left <= 1} data-testid="mt-qty" />
              </div>
              <EmblemHand count={q} />
              <div className="mt-total">
                <span className="kicker mt-card__kick">Total</span>
                <HypeAmount wei={priceWei * BigInt(q)} decimals={4} size="md" className="mt-total__fig" />
                <span className="mt-total__sub num">
                  {state.priceUsd !== null && `≈ ${usdText(state.priceUsd * q)} · `}max {left}
                </span>
              </div>
            </div>
            <Button variant="primary" size="lg" block loading={busy} disabled={!busy && !!blocker} onClick={() => void mint()} className="mt-mintbtn">
              {busy ? BUSY_LABEL[phase as keyof typeof BUSY_LABEL] : `Mint ${q} ${plural(q, 'emblem')}`}
            </Button>
            {steps}
            {blocker && !busy && (
              <p className="mt-why" role="alert" data-testid="mt-blocker">
                <span className="kicker">{poor ? 'Not enough HYPE' : left === 0 ? 'Limit reached' : 'Not yet'}</span> {cap(blocker)}.
                {poor && story === 'testnet' && (
                  <>
                    {' '}
                    <a href={HYPE_FAUCET_URL} target="_blank" rel="noreferrer">
                      Get test HYPE
                    </a>
                  </>
                )}
              </p>
            )}
            {error && (
              <p className="mt-why mt-why--error" role="alert" data-testid="mt-error">
                <span className="kicker">Hm</span> {error}
              </p>
            )}
            {kind === 'allowlist' ? (
              <AllowlistStatus proof={proof} address={address} />
            ) : (
              <WlNote tone="ok" glyph="check">
                <AddressChip address={address} size="sm" copy={false} /> <span>Public mint: any wallet, {c.publicLimit} max. Nobody&rsquo;s rushing you. Well, a little.</span>
              </WlNote>
            )}
            <p className="mt-fine">Your wallet adds a tiny buffer to the price; the contract refunds anything above it in the same transaction.</p>
          </>
        )}
      </>
    );
  }

  const kicker = c ? `Sealed emblems · supply ${fmt(c.maxSupply)}` : 'Sealed emblems · on Elysium';

  return (
    <NightPlate>
      <div className="mt-wrap mt-page" data-view={view}>
        <div className="mt-copy">
          <span className="kicker mt-kicker">{kicker}</span>
          <MintHeadline story={story} price={c ? hypeText(priceWei) : null} />
          <MintTrack at={stage} />
          {c && (
            <p className="mt-limits num">
              Allowlist {c.wlLimit} per wallet · Public {c.publicLimit} per wallet
            </p>
          )}
        </div>
        <motion.div className="mt-card kb-island" variants={mv.stickerDrop} custom={0.6} initial="hidden" animate="shown">
          {emblem}
          <div className="mt-card__right">{right}</div>
        </motion.div>
        {/* under the lede on wide screens, under the mint card on phones (the card comes first there) */}
        <EmblemPerks perks={emblemPerks(isTestnetChain(chain), { feeBps: chain?.feeBps ?? null })} />
      </div>
    </NightPlate>
  );
}

/**
 * The headline and lede, honest about the price: on a testnet the fixed test price (and that
 * mainnet is much cheaper); the "one dollar" story only while the price really tracks a dollar;
 * otherwise the HYPE price as it stands.
 */
export function MintHeadline({ story, price }: { story: PriceStory; price: string | null }) {
  if (story === 'testnet')
    return (
      <>
        <h1 className="mt-h display" data-story="testnet">
          One emblem.
          <br />
          {price ? (
            <>
              <em>{price} HYPE</em> on testnet.
            </>
          ) : (
            <>
              A <em>testnet</em> mint.
            </>
          )}
          <br />
          Many snacks.
        </h1>
        <p className="mt-lede">
          Your emblem is your ticket to the ring. {price ? <>Testnet mint: {price} HYPE, a fixed test price paid in test HYPE.</> : 'The testnet mint is paid in test HYPE.'} We do the arithmetic;
          you do the eating.
        </p>
        <p className="mt-note" data-testid="mt-mainnet-note">
          The mainnet mint will be much cheaper.
        </p>
      </>
    );
  if (story === 'dollar')
    return (
      <>
        <h1 className="mt-h display" data-story="dollar">
          One emblem.
          <br />
          One <em>dollar.</em>
          <br />
          Many snacks.
        </h1>
        <p className="mt-lede">
          Your emblem is your ticket to the ring. The price is pinned to a dollar and paid in HYPE, so the number on the button wiggles with the market. We do the arithmetic; you do the
          eating.
        </p>
      </>
    );
  return (
    <>
      <h1 className="mt-h display" data-story="plain">
        One emblem.
        <br />
        {price ? (
          <>
            <em>{price} HYPE.</em>
          </>
        ) : (
          <>
            Paid in <em>HYPE.</em>
          </>
        )}
        <br />
        Many snacks.
      </h1>
      <p className="mt-lede">Your emblem is your ticket to the ring. The price is set on the contract and paid in HYPE. We do the arithmetic; you do the eating.</p>
    </>
  );
}

const BUSY_LABEL = {
  preparing: 'Checking the price…',
  switching: 'Switching network…',
  signing: 'Confirm in your wallet…',
  confirming: 'Minting…',
} as const;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The two wallet steps while a mint is in flight: sign, then the chain. */
function MintSteps({ phase, hash, explorer }: { phase: Phase; hash: Hash | null; explorer: string | null }) {
  const first = phase === 'preparing' ? 'Reading the fresh price' : phase === 'switching' ? 'Switch to Elysium' : 'Approve in your wallet';
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
        Minting on Elysium
        {hash && (
          <AddressChip address={hash} chars={4} size="sm" href={link ?? undefined} copy={false} label="Transaction" className="mt-steps__hash" />
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
  const chip = <AddressChip address={address} size="sm" copy={false} />;
  if (proof === null)
    return (
      <WlNote tone="wait" glyph="info" testId="mt-eligibility">
        Checking the allowlist for {chip}…
      </WlNote>
    );
  if (!proof.eligible)
    return (
      <WlNote tone="no" glyph="close" testId="mt-eligibility">
        {chip} <span>is not on the allowlist. The public mint follows; or try the wallet you applied with.</span>
      </WlNote>
    );
  const published = !!proof.root && !!proof.onchainRoot && proof.root.toLowerCase() === proof.onchainRoot.toLowerCase();
  if (!published)
    return (
      <WlNote tone="wait" glyph="lock" testId="mt-eligibility">
        {chip} <span>is on the allowlist. The list is not on the contract yet; give it a minute.</span>
      </WlNote>
    );
  return (
    <WlNote tone="ok" glyph="check" testId="mt-eligibility">
      {chip} <span>is on the allowlist. Nobody&rsquo;s rushing you. Well, a little.</span>
    </WlNote>
  );
}

/** Closed phase: the signed-in visitor's WL entry. */
function ClosedWlStatus({ wl, address }: { wl: WlEntryPublic | null | undefined; address: string }) {
  const chip = <AddressChip address={address} size="sm" copy={false} />;
  if (wl === undefined)
    return (
      <WlNote tone="wait" glyph="info" testId="mt-wl">
        Checking the WL for {chip}…
      </WlNote>
    );
  if (wl === null)
    return (
      <WlNote tone="idle" glyph="info" testId="mt-wl">
        {chip} <span>has no WL entry yet. Three chores fix that.</span>
      </WlNote>
    );
  if (wl.status === 'approved')
    return (
      <WlNote tone="ok" glyph="check" testId="mt-wl">
        {chip} <span>is on the list. You mint first when the seal breaks.</span>
      </WlNote>
    );
  if (wl.status === 'pending')
    return (
      <WlNote tone="wait" glyph="info" testId="mt-wl">
        {chip} <span>is in the queue. Someone is reading your chores, slowly.</span>
      </WlNote>
    );
  return (
    <WlNote tone="no" glyph="close" testId="mt-wl">
      {chip} <span>did not make the WL this time. The public mint is for you.</span>
    </WlNote>
  );
}
