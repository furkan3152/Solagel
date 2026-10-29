import { formatHypeAmount, getMintState, getMintedBy, mintAllowlistCall, mintPublicCall, type MintState as ChainMintState } from '@elymum/sdk';
import type { ChainStatus, MintContractState, MintProofResponse, MintState, WlEntryPublic } from '@elymum/shared';
import { useEffect, useRef, useState } from 'react';
import type { Address, Hash, Hex } from 'viem';
import { InkButton, StampSpinner } from '../../design';
import { SERVER } from '../../config';
import { explorerTx } from '../../wallet/links';
import { fetchServerChain, publicClientFor } from '../../wallet/network';
import { useWallet } from '../../wallet/store';
import { sendWalletCall, txErrorText, type TxPhase } from '../../wallet/tx';
import { site } from '../api';
import { Link } from '../router';
import { dropExpired } from '../session';
import { SitePage } from '../Shell';
import { SiteWalletProvider, WalletSignIn, useSiteSession } from '../wallet/SiteWallet';
import { mintBlocker, mintKind, mintView, mintedTokenIds, playOpenForHolders, remaining, usdText, type MintView } from './logic';

/** The NFT emblem image the server draws for a token id. */
export const nftImageUrl = (id: bigint | number | string): string => `${SERVER.http}/api/nft/${id.toString()}.svg`;

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

/** `/mint`: the Elymum NFT mint (Closed / Allowlist / Public / Sold out). Visuals come later (classNames `mt-`). */
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

export function Mint({ pollMs = 30_000 }: { pollMs?: number }) {
  const [state, setState] = useState<MintState | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [chain, setChain] = useState<ChainStatus | null>(null);
  const address = useWallet((s) => (s.status === 'connected' ? s.address : null));
  const provider = useWallet((s) => s.current?.provider ?? null);
  const session = useSiteSession();
  const [proof, setProof] = useState<MintProofResponse | null>(null);
  const [minted, setMinted] = useState<{ wl: number; pub: number }>({ wl: 0, pub: 0 });
  const [wl, setWl] = useState<WlEntryPublic | null | undefined>(undefined);
  const [qty, setQty] = useState(1);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<Hash | null>(null);
  const [ids, setIds] = useState<bigint[]>([]);
  const inFlight = useRef(false);
  const [tick, setTick] = useState(0);

  // the server's mint state (and the chain it is on), refreshed while the page is open
  useEffect(() => {
    let live = true;
    const load = () =>
      site.mint().then(
        (s) => {
          if (!live) return;
          setState(s);
          setLoadErr(null);
        },
        (e: Error) => live && setLoadErr(e.message),
      );
    void load();
    void fetchServerChain().then((c) => live && setChain(c));
    const id = pollMs > 0 ? window.setInterval(() => void load(), pollMs) : null;
    return () => {
      live = false;
      if (id) clearInterval(id);
    };
  }, [pollMs, tick]);

  const nft = (state?.nftAddress ?? null) as Address | null;

  // eligibility (proof) and what this wallet already minted
  useEffect(() => {
    setProof(null);
    setMinted({ wl: 0, pub: 0 });
    if (!address || !nft) return;
    let live = true;
    site.mintProof(address).then(
      (p) => live && setProof(p),
      () => live && setProof({ eligible: false, proof: [], root: null, onchainRoot: null }),
    );
    const client = publicClientFor(chain, provider);
    if (client) void getMintedBy(client, nft, address).then((m) => live && setMinted(m), () => {});
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

  if (loadErr && !state)
    return (
      <div className="st-page mt-page">
        <p className="st-err" role="alert">
          {loadErr}
        </p>
      </div>
    );
  if (!state)
    return (
      <div className="st-page mt-page">
        <StampSpinner label="Loading" />
      </div>
    );

  const view = mintView(state);
  const c = state.contract;
  const kind = mintKind(view);
  const left = c && kind ? remaining(c, minted, kind) : 0;
  const q = Math.max(1, Math.min(qty, Math.max(1, left)));
  const priceWei = c ? BigInt(c.priceWei) : 0n;
  const busy = phase === 'preparing' || phase === 'switching' || phase === 'signing' || phase === 'confirming';
  const blocker = c && kind && address ? mintBlocker(c, minted, { kind, qty: q, proof }) : null;

  const mint = async () => {
    if (inFlight.current || !c || !kind || !address || !nft || !chain) return;
    inFlight.current = true;
    setError(null);
    setPhase('preparing');
    const fail = (msg: string) => {
      inFlight.current = false;
      setError(msg);
      setPhase('error');
    };
    const client = publicClientFor(chain, provider);
    if (!client) return fail('Cannot read the chain right now.');
    let price: bigint;
    try {
      // the latest price and limits, right before the wallet opens (a keeper may have re-priced)
      const [fresh, mine] = await Promise.all([getMintState(client, nft), getMintedBy(client, nft, address)]);
      const why = mintBlocker(toContractState(fresh), mine, { kind, qty: q, proof });
      if (why) return fail(`Not minted: ${why}.`);
      price = fresh.price;
    } catch {
      return fail('Cannot read the mint contract right now. Try again in a moment.');
    }
    const call =
      kind === 'allowlist' ? mintAllowlistCall(nft, { qty: q, proof: (proof?.proof ?? []) as Hex[], price }) : mintPublicCall(nft, { qty: q, price });
    const res = await sendWalletCall(call, {
      chain,
      onPhase: (p, h) => {
        setPhase(p);
        if (h) setHash(h);
      },
    });
    if (!res.ok) return fail(txErrorText(res.error));
    setIds(mintedTokenIds(res.receipt.logs, nft, address));
    setHash(res.hash);
    setPhase('done');
    inFlight.current = false;
    setTick((n) => n + 1);
  };

  if (phase === 'done') {
    const tx = hash ? explorerTx(hash, chain?.explorerUrl) : null;
    return (
      <div className="st-page mt-page mt-done" data-testid="mt-done">
        <span className="st-kicker mono">Minted</span>
        <h1 className="st-title">{ids.length === 1 ? 'Your Elymum is here.' : `Your ${ids.length || ''} Elymum are here.`}</h1>
        <ul className="mt-tokens">
          {ids.map((id) => (
            <li key={id.toString()} className="mt-token">
              <img src={nftImageUrl(id)} alt={`Elymum #${id.toString()}`} width={240} height={240} />
              <span className="mono">#{id.toString()}</span>
            </li>
          ))}
        </ul>
        <div className="st-row">
          {playOpenForHolders(state.gameAccess) && (
            <a className="st-linkbtn st-linkbtn--pink mt-play" href="/play">
              Play
            </a>
          )}
          {tx && (
            <a className="st-linkbtn" href={tx} target="_blank" rel="noreferrer">
              View transaction
            </a>
          )}
          <button type="button" className="st-textlink" onClick={() => setPhase('idle')}>
            Back to the mint
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="st-page mt-page" data-view={view}>
      <span className="st-kicker mono">Elymum NFT</span>
      <h1 className="st-title">{view === 'soldout' ? 'Sold out.' : view === 'closed' ? 'Sealed. For now.' : view === 'unavailable' ? 'The mint is not live yet.' : 'The mint is open.'}</h1>
      <dl className="mt-facts">
        <div>
          <dt className="mono">Phase</dt>
          <dd className="mt-phase" data-testid="mt-phase">
            {PHASE_LABEL[view]}
          </dd>
        </div>
        {c && (
          <>
            <div>
              <dt className="mono">Supply</dt>
              <dd className="mt-supply">
                {c.totalSupply.toLocaleString('en-US')} / {c.maxSupply.toLocaleString('en-US')}
              </dd>
            </div>
            <div>
              <dt className="mono">Price</dt>
              <dd className="mt-price" data-testid="mt-price">
                {formatHypeAmount(priceWei, 6)}
                {usdText(state.priceUsd) && <span className="mt-usd"> ≈ {usdText(state.priceUsd)}</span>}
              </dd>
            </div>
            {state.hypeUsd !== null && (
              <div>
                <dt className="mono">HYPE</dt>
                <dd className="mt-tick mono">{usdText(state.hypeUsd)}</dd>
              </div>
            )}
            <div>
              <dt className="mono">Per wallet</dt>
              <dd>
                Allowlist {c.wlLimit} · Public {c.publicLimit}
              </dd>
            </div>
          </>
        )}
      </dl>

      {view === 'unavailable' && <p className="st-deck">The contract is not deployed yet. Join the WL to be first in line.</p>}

      {view === 'closed' && (
        <div className="mt-teaser">
          <p className="st-deck">WL first, then public. The price is $1 in HYPE. The date lands on @elymum first.</p>
          {session ? (
            <p className="st-note" data-testid="mt-wl">
              {wl === undefined
                ? 'Checking your WL entry…'
                : wl === null
                  ? 'This wallet has no WL entry.'
                  : wl.legacy
                    ? 'Your WL entry is from before the move to Elysium: re-apply with an EVM wallet.'
                    : `Your WL entry: ${wl.status}.`}
            </p>
          ) : (
            <WalletSignIn label="Sign in to see my WL status" />
          )}
          <Link className="st-linkbtn" href="/wl">
            Join the WL
          </Link>
        </div>
      )}

      {view === 'soldout' && (
        <div className="st-row">
          {playOpenForHolders(state.gameAccess) && (
            <a className="st-linkbtn st-linkbtn--pink" href="/play">
              Play
            </a>
          )}
        </div>
      )}

      {kind && c && (
        <div className="mt-mint">
          {!address ? (
            <WalletSignIn label="Sign in" />
          ) : (
            <>
              {kind === 'allowlist' && (
                <p className="st-note mt-eligibility" data-testid="mt-eligibility">
                  {proof === null ? 'Checking the allowlist…' : proof.eligible ? 'This wallet is on the allowlist.' : 'This wallet is not on the allowlist.'}
                </p>
              )}
              <div className="mt-qty" role="group" aria-label="Quantity">
                <button type="button" className="mt-qty__btn" aria-label="One less" disabled={busy || q <= 1} onClick={() => setQty(q - 1)}>
                  −
                </button>
                <output className="mt-qty__n mono" aria-live="polite" data-testid="mt-qty">
                  {q}
                </output>
                <button type="button" className="mt-qty__btn" aria-label="One more" disabled={busy || q >= left} onClick={() => setQty(q + 1)}>
                  +
                </button>
              </div>
              <p className="mt-total mono">
                Total {formatHypeAmount(priceWei * BigInt(q), 6)}
                {state.priceUsd !== null && ` ≈ ${usdText(state.priceUsd * q)}`}
              </p>
              {blocker && (
                <p className="st-note is-error mt-blocker" role="alert" data-testid="mt-blocker">
                  {blocker}
                </p>
              )}
              <InkButton variant="pink" size="lg" disabled={busy || !!blocker || !chain} onClick={() => void mint()}>
                {busy ? (phase === 'switching' ? 'Switching network…' : phase === 'signing' ? 'Confirm in your wallet…' : phase === 'confirming' ? 'Minting…' : 'Preparing…') : `Mint ${q}`}
              </InkButton>
              <p className="st-note">Your wallet adds a tiny buffer to the price; the contract refunds anything above the price in the same transaction.</p>
              {error && (
                <p className="st-note is-error" role="alert" data-testid="mt-error">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
