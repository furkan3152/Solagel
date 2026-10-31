import { faucetCall, getFaucetInfo, getTestTokenFaucet, getTokenInfo, type FaucetInfo, type TestTokenFaucetConfig } from '@elymum/sdk';
import type { ContractsRegistry, FaucetConfig } from '@elymum/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Address, Hash } from 'viem';
import { AddressChip, Button, CoinCharacter, Icon, Kb, Laurel, PlateLabel, StampSpinner, Sticker, type CoinMood } from '../../design';
import { isDevFake, loadDevFake } from '../../wallet/devFakeLoader';
import { explorerTx } from '../../wallet/links';
import { ensureChain, publicClientFor, serverChainInfo } from '../../wallet/network';
import { connectWallet, disconnectWallet, initWallets, useWallet } from '../../wallet/store';
import { sendWalletCall, txErrorText, type TxPhase } from '../../wallet/tx';
import { site } from '../api';
import { isTestnetChain, useServerChain } from '../serverChain';
import { SiteLinkButton, SitePage } from '../Shell';
import { faucetTokenAddress, servedConfig, faucetView, formatWait, HYPE_FAUCET_URL, holderMultiple, TEST_SYMBOL_DEFAULT, watchAssetParams, wholeTokens } from './logic';
import '../wallet/wallet.css';
import './faucet.css';

/** `/faucet` (testnet only): free tELYMUM to play the arenas with, once an hour. */
export function FaucetPage() {
  return (
    <SitePage className="fc-root">
      <Faucet />
    </SitePage>
  );
}

type Phase = 'idle' | TxPhase | 'done' | 'error';

interface TokenMeta {
  address: Address;
  symbol: string;
  decimals: number;
  cfg: TestTokenFaucetConfig;
}

/** The tap: a brass spout over a coin. `pouring` drips coins; `mood` is the coin's face. */
export function FaucetTap({ pouring, mood }: { pouring: boolean; mood: CoinMood }) {
  return (
    <div className={`fc-tap${pouring ? ' is-pouring' : ''}`} aria-hidden="true">
      <svg className="fc-tap__art" viewBox="0 0 220 150" width={220} height={150}>
        <g stroke="var(--ink-fixed)" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round">
          {/* the pipe from the wall */}
          <rect x={-6} y={40} width={92} height={26} rx={6} fill="var(--teal)" />
          <rect x={4} y={34} width={14} height={38} rx={4} fill="var(--teal-s)" />
          {/* the tap body and its spout */}
          <path d="M80 34 h44 a14 14 0 0 1 14 14 v44 h-26 v-30 h-32 z" fill="var(--sun)" />
          <rect x={108} y={88} width={34} height={14} rx={4} fill="var(--sun-s)" />
          {/* the handle on top: turns while pouring */}
          <g className="fc-tap__handle">
            <rect x={96} y={20} width={12} height={16} rx={3} fill="var(--sun-s)" />
            <rect x={74} y={8} width={56} height={14} rx={7} fill="var(--coral)" />
          </g>
          <path d="M88 46 h22" stroke="var(--cream)" strokeWidth={3} opacity={0.8} fill="none" />
        </g>
      </svg>
      <span className="fc-tap__drops">
        <i className="fc-drop" />
        <i className="fc-drop" />
        <i className="fc-drop" />
      </span>
      <span className="fc-tap__coin">
        <CoinCharacter paint="sun" mood={mood} size={92} feet ground look={[0, -3]} />
      </span>
    </div>
  );
}

function Faucet() {
  const chain = useServerChain();
  const address = useWallet((s) => (s.status === 'connected' ? s.address : null));
  const provider = useWallet((s) => s.current?.provider ?? null);
  const walletChainId = useWallet((s) => s.chainId);
  const [registry, setRegistry] = useState<ContractsRegistry | null | undefined>(undefined);
  const [meta, setMeta] = useState<TokenMeta | null | 'unreadable'>(null);
  const [info, setInfo] = useState<FaucetInfo | null>(null);
  const [wei, setWei] = useState<bigint | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<Hash | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [added, setAdded] = useState<'idle' | 'ok' | 'no'>('idle');
  const [tick, setTick] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => initWallets(), []);
  const testnet = isTestnetChain(chain);
  const fake = isDevFake(chain);

  // the server's faucet (`GET /api/site/faucet`); an older server without it: the registered contracts
  const [served, setServed] = useState<FaucetConfig | null | undefined>(undefined);
  useEffect(() => {
    if (testnet !== true) return;
    let live = true;
    site.faucet().then(
      (f) => {
        if (!live) return;
        setServed(f);
        setRegistry(null);
      },
      () => {
        if (!live) return;
        setServed(null);
        site.contracts().then(
          (r) => live && setRegistry(r),
          () => live && setRegistry(null),
        );
      },
    );
    return () => {
      live = false;
    };
  }, [testnet]);

  // the dev fake chain registers no TestToken: its game token stands in
  const tokenAddr = (fake ? (chain?.token?.address ?? null) : served ? served.token : served === null ? faucetTokenAddress(registry ?? null, chain?.token?.address) : null) as Address | null;
  const hypeUrl = served?.hypeFaucetUrl || HYPE_FAUCET_URL;

  // the token's faucet settings (amounts, cooldown, holder NFT), symbol and decimals
  useEffect(() => {
    if (testnet !== true || !tokenAddr || !chain || (!fake && served === undefined) || (served === null && registry === undefined)) return;
    let live = true;
    if (fake) {
      void loadDevFake().then((dev) => {
        if (!dev || !live) return;
        const f = dev.fakeFaucet;
        setMeta({
          address: tokenAddr,
          symbol: TEST_SYMBOL_DEFAULT,
          decimals: chain.token?.decimals ?? 18,
          cfg: { address: tokenAddr, owner: tokenAddr, amount: f.amount, holderAmount: f.holderAmount, cooldownSecs: f.cooldownSecs, holderNft: '0x000000000000000000000000000000000000E1B1' },
        });
      });
      return;
    }
    const fromServer = servedConfig(served, tokenAddr);
    const client = publicClientFor(chain, provider);
    if (!client) {
      if (fromServer) setMeta({ address: tokenAddr, symbol: TEST_SYMBOL_DEFAULT, decimals: served!.decimals, cfg: fromServer });
      return;
    }
    Promise.all([fromServer ? Promise.resolve(fromServer) : getTestTokenFaucet(client, tokenAddr), getTokenInfo(client, tokenAddr).catch(() => null)]).then(
      ([cfg, ti]) => live && setMeta({ address: tokenAddr, symbol: ti?.symbol || TEST_SYMBOL_DEFAULT, decimals: ti?.decimals ?? served?.decimals ?? 18, cfg }),
      () => live && setMeta('unreadable'),
    );
    return () => {
      live = false;
    };
  }, [testnet, tokenAddr, chain, provider, registry, served, fake]);

  // what this wallet gets and when (re-read after a claim)
  useEffect(() => {
    setInfo(null);
    setWei(null);
    if (!address || !meta || meta === 'unreadable' || !chain) return;
    let live = true;
    if (fake) {
      void loadDevFake().then((dev) => {
        if (!dev || !live) return;
        const f = dev.fakeFaucet;
        const t = Math.floor(Date.now() / 1000);
        const wait = Math.max(0, f.nextAt - t);
        setInfo({ amount: f.holder ? f.holderAmount : f.amount, nextClaimAt: f.nextAt, canClaim: wait === 0, waitSecs: wait });
        setWei(dev.fakeWallet.wei);
      });
      return;
    }
    const client = publicClientFor(chain, provider);
    if (!client) return;
    void getFaucetInfo(client, meta.address, address).then((i) => live && setInfo(i), () => {});
    void client.getBalance({ address }).then((b) => live && setWei(b), () => {});
    return () => {
      live = false;
    };
  }, [address, meta, chain, provider, fake, tick]);

  // the countdown ticks by itself
  const waiting = !!info && info.nextClaimAt > now;
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  const view = faucetView({
    chain: chain === undefined || (testnet === true && !fake && served === undefined) ? 'loading' : testnet === null ? 'off' : testnet ? 'testnet' : 'mainnet',
    token: tokenAddr,
    tokenUnreadable: meta === 'unreadable',
  });

  if (view === 'loading' || (view === 'ready' && meta === null))
    return (
      <Plate>
        <div className="fc-wrap fc-wrap--quiet">
          <StampSpinner label="Loading" />
        </div>
      </Plate>
    );
  if (view === 'mainnet' || view === 'offline' || view === 'no-token') return <Quiet view={view} />;
  const m = meta as TokenMeta;
  const chainInfo = serverChainInfo(chain);
  const chainName = chainInfo?.name ?? 'Elysium Testnet';
  const onChain = walletChainId !== null && chainInfo?.id === walletChainId;
  const mult = holderMultiple(m.cfg);
  const isHolder = !!info && mult !== null && info.amount >= m.cfg.holderAmount;
  const amount = info?.amount ?? m.cfg.amount;
  const busy = phase === 'switching' || phase === 'signing' || phase === 'confirming';
  const wait = info ? Math.max(0, info.nextClaimAt - now) : 0;
  const noGas = !fake && wei !== null && wei === 0n;

  const claim = async () => {
    if (inFlight.current || !address || !chain) return;
    inFlight.current = true;
    setError(null);
    setHash(null);
    const fail = (msg: string) => {
      inFlight.current = false;
      setError(msg);
      setPhase('error');
    };
    if (fake) {
      const dev = await loadDevFake();
      if (!dev) return fail('The dev faucet is not available.');
      const h = await dev.fakeFaucetClaim((p, hh) => {
        setPhase(p);
        if (hh) setHash(hh);
      });
      setHash(h);
    } else {
      const res = await sendWalletCall(faucetCall(m.address), {
        chain,
        onPhase: (p, h) => {
          setPhase(p);
          if (h) setHash(h);
        },
      });
      if (!res.ok) return fail(txErrorText(res.error));
      setHash(res.hash);
    }
    inFlight.current = false;
    setPhase('done');
    setNow(Math.floor(Date.now() / 1000));
    setTick((n) => n + 1);
  };

  const addToken = async () => {
    if (!provider) return;
    try {
      const ok = await provider.request({ method: 'wallet_watchAsset', params: watchAssetParams(m.address, m.symbol, m.decimals) as never });
      setAdded(ok === false ? 'no' : 'ok');
    } catch {
      setAdded('no');
    }
  };

  const mood: CoinMood = busy ? 'open' : phase === 'done' ? 'happy' : waiting ? 'sleepy' : 'smile';
  const tx = hash && !fake ? explorerTx(hash, chain?.explorerUrl) : null;

  return (
    <Plate>
      <div className="fc-wrap">
        <div className="fc-copy">
          <span className="kicker fc-kicker">Testnet · {chainName}</span>
          <h1 className="fc-h display">
            Free coins.
            <br />
            <em>Test</em> coins.
          </h1>
          <p className="fc-lede">
            Fill your pockets with {m.symbol} and play the arenas on testnet. One claim an hour. These are test tokens: they have <b>no value</b> and never move to mainnet.
          </p>
          <FaucetTap pouring={busy} mood={mood} />
        </div>
        <Sticker tone="cream" lift="lg" pad="lg" round="lg" tape className="fc-card" as="section" aria-labelledby="fc-card-h">
          <div className="fc-card__top">
            <h2 className="fc-card__h display" id="fc-card-h">
              <span className="num">{wholeTokens(amount, m.decimals)}</span> {m.symbol}
            </h2>
            {mult !== null && (
              <span className={`fc-bonus mono${isHolder ? ' is-mine' : ''}`} data-testid="fc-bonus">
                <Laurel /> {isHolder ? `Holder: you get ${mult}x` : `Emblem holders get ${mult}x`}
              </span>
            )}
          </div>
          <p className="fc-card__sub mono">per claim · every {Math.round(m.cfg.cooldownSecs / 60)} min</p>

          {!address ? (
            <ConnectOnly />
          ) : (
            <>
              <div className="fc-who">
                <AddressChip address={address} size="sm" copy={false} />
                {onChain || fake ? (
                  <span className="fc-net is-ok mono">
                    <Icon name="check" size={13} /> {chainName}
                  </span>
                ) : (
                  <button type="button" className="fc-net mono" onClick={() => provider && void ensureChain(provider, chain!).catch(() => {})}>
                    Switch to {chainName}
                  </button>
                )}
                <button type="button" className="sw-link" onClick={() => disconnectWallet()}>
                  Use another wallet
                </button>
              </div>
              {waiting && !busy ? (
                <div className="fc-wait" data-testid="fc-wait" aria-live="polite">
                  <span className="kicker">Next claim in</span>
                  <span className="fc-wait__t num">{formatWait(wait)}</span>
                </div>
              ) : (
                <Button variant="primary" size="lg" block loading={busy} disabled={busy || !info} onClick={() => void claim()} className="fc-claim" data-testid="fc-claim">
                  {busy ? BUSY[phase as keyof typeof BUSY] : `Claim ${wholeTokens(amount, m.decimals)} ${m.symbol}`}
                </Button>
              )}
              {phase === 'done' && (
                <p className="fc-ok" role="status" data-testid="fc-done">
                  <Icon name="check" size={16} /> {wholeTokens(amount, m.decimals)} {m.symbol} landed in your wallet.{' '}
                  {tx && (
                    <a href={tx} target="_blank" rel="noreferrer">
                      View transaction
                    </a>
                  )}
                </p>
              )}
              {error && (
                <p className="fc-err" role="alert">
                  {error}
                </p>
              )}
              {noGas && (
                <p className="fc-gas" role="note">
                  You need a little HYPE for gas first. Grab some from Kinetiq&rsquo;s faucet below.
                </p>
              )}
              <div className="fc-row">
                <button type="button" className="fc-add" onClick={() => void addToken()} disabled={!provider || fake}>
                  <Icon name="wallet" size={16} /> {added === 'ok' ? `${m.symbol} added` : `Add ${m.symbol} to wallet`}
                </button>
                {phase === 'done' && (
                  <SiteLinkButton href="/play" variant="teal" size="sm" icon="arrow">
                    Play
                  </SiteLinkButton>
                )}
              </div>
            </>
          )}
          <a className="fc-hype" href={hypeUrl} target="_blank" rel="noreferrer">
            <span className="fc-hype__dot" aria-hidden="true" />
            <span>
              <b>Need HYPE for gas?</b> Kinetiq&rsquo;s testnet faucet
            </span>
            <Icon name="arrow" size={16} />
          </a>
        </Sticker>
      </div>
    </Plate>
  );
}

const BUSY = {
  switching: 'Switching network…',
  signing: 'Confirm in your wallet…',
  confirming: 'Pouring…',
} as const;

function Plate({ children }: { children: ReactNode }) {
  return (
    <>
      <PlateLabel numeral="IV" title="The tap at the edge of the ring" aside="/faucet" className="fc-platelabel" />
      <Kb theme="paper" className="fc-plate">
        {children}
      </Kb>
    </>
  );
}

/** Connect only: the faucet needs a wallet address, not a sign-in. */
function ConnectOnly() {
  const providers = useWallet((s) => s.providers);
  const status = useWallet((s) => s.status);
  const current = useWallet((s) => s.current);
  const err = useWallet((s) => s.error);
  const connecting = status === 'connecting';
  if (providers.length === 0)
    return (
      <p className="sw-none">
        <span className="sw-none__icon" aria-hidden="true">
          <Icon name="wallet" size={22} />
        </span>
        <span>
          <strong>No browser wallet found.</strong> Install MetaMask, Rabby or any browser wallet, or open this page in your wallet app&apos;s browser.
        </span>
      </p>
    );
  return (
    <div className="sw fc-connect">
      <div className="sw-wallets" role="group" aria-label="Wallets">
        {providers.map((d) => {
          const busy = connecting && current?.info.uuid === d.info.uuid;
          return (
            <button key={d.info.uuid} type="button" className={`sw-opt${busy ? ' is-busy' : ''}`} disabled={connecting} aria-busy={busy} onClick={() => void connectWallet(d)}>
              <span className="sw-opt__icon" aria-hidden="true">
                {d.info.icon ? <img src={d.info.icon} alt="" /> : <Icon name="wallet" size={20} />}
              </span>
              <span className="sw-opt__name">Connect {d.info.name}</span>
              <Icon name="arrow" size={18} className="sw-opt__go" />
            </button>
          );
        })}
      </div>
      <p className="sw-note">{connecting ? 'Connecting… check your wallet.' : 'Connecting sends nothing. Claiming is one transaction (a little HYPE for gas).'}</p>
      {err && (
        <p className="sw-note is-error" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}

/** Mainnet, no chain, or no TestToken yet. */
function Quiet({ view }: { view: 'mainnet' | 'offline' | 'no-token' }) {
  const copy = {
    mainnet: { h: 'Faucet is testnet only', p: 'On mainnet the game token is real, so there is no tap to open. Mint an emblem or join the WL instead.', mood: 'smug' as const },
    offline: { h: 'The tap is dry right now', p: 'The game server is not answering, or it is not on a chain yet. Try again in a moment.', mood: 'sleepy' as const },
    'no-token': { h: 'The tap is not plumbed in yet', p: 'The testnet token is not registered on this server yet. Follow @elymumio: it opens with the testnet arenas.', mood: 'sleepy' as const },
  }[view];
  return (
    <Plate>
      <div className="fc-wrap fc-wrap--quiet" data-testid={`fc-${view}`}>
        <CoinCharacter paint="cream" mood={copy.mood} size={120} feet ground />
        <div>
          <h1 className="fc-quiet__h display">{copy.h}</h1>
          <p className="fc-lede">{copy.p}</p>
          <div className="fc-row">
            <SiteLinkButton href="/mint" variant="primary" icon="arrow">
              Mint
            </SiteLinkButton>
            <SiteLinkButton href="/wl" variant="secondary">
              Join the WL
            </SiteLinkButton>
          </div>
        </div>
      </div>
    </Plate>
  );
}

