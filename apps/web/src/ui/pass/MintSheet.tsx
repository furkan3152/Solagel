import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Keypair } from '@solana/web3.js';
import { parseCoreAsset, passNumberFromName, type OwnedPass } from '@slana/sdk';
import { formatToken, shortAddress } from '@slana/shared';
import { useEffect, useRef, useState } from 'react';
import { Icon, InkButton, Sheet, useReducedMotion } from '../../design';
import { announce, sound } from '../../audio';
import { useT } from '../../i18n';
import { goPage, toast, useUi } from '../../store';
import { refreshChain, rememberMint, useChainData, usePassStatus, useSlanaClient } from '../../solana/chain';
import { loadDevFake } from '../../solana/devFakeLoader';
import { explorerTx } from '../../solana/links';
import { MINT_COMPUTE_UNITS, MINT_COUNTER_BYTES, buildMintTx, coreAssetBytes, mintGate, mintSolCost, passNo, type MintCost } from '../../solana/pass';
import { defaultRent } from '../../solana/ticket';
import { sendTx, txErrorText, type TxPhase } from '../../solana/tx';
import { useTokenText } from '../lobby/useLobby';
import { RevealAnimation } from './RevealAnimation';

type Phase = 'review' | 'preparing' | TxPhase | 'delivered' | 'error';

const SOL_DECIMALS = 9;

/** What was on the sheet when the player pressed confirm. */
interface Review {
  number: number;
  cost: MintCost;
  minTokens: bigint;
  perWallet: number;
  collection: string;
  mintedByMe: number;
}

/**
 * The free mint (spec §4.1): a confirm sheet that shows exactly what is
 * signed (no $SLANA, only the asset rent and the network fee in SOL), one
 * wallet signature for `mintPass` co-signed by a fresh asset key made in this
 * browser, then the envelope from the Slana post opens and the sealed
 * passport comes out.
 *
 * Money safety, as in the ticket flow: a synchronous in-flight guard, no
 * autofocus on the sign button, values frozen at confirm, and the collection
 * and this wallet's mint counter re-read from the chain right before the
 * transaction is built (a mint that landed during a timeout is never repeated).
 */
export function MintSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const chain = useUi((s) => s.chain);
  const cluster = chain?.cluster ?? 'devnet';
  const wallet = useWallet();
  const { connection } = useConnection();
  const client = useSlanaClient();
  const data = useChainData();
  const status = usePassStatus();
  const tok = useTokenText();
  const reduced = useReducedMotion();

  const [phase, setPhase] = useState<Phase>('review');
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [frozen, setFrozen] = useState<Review | null>(null);
  const [minted, setMinted] = useState<OwnedPass | null>(null);
  const [opened, setOpened] = useState(false);
  const [rents, setRents] = useState<{ asset: number; counter: number } | null>(null);
  const inFlight = useRef(false);
  /**
   * The asset key of this sheet session. A retry after an unknown outcome reuses it, so a
   * transaction that did land makes the retry fail (the account exists) instead of minting twice.
   */
  const assetKey = useRef<Keypair | null>(null);
  /** This wallet's mint count when the sheet opened: a higher count later means a mint landed. */
  const openedAt = useRef<number | null>(null);

  const owner = wallet.publicKey?.toBase58() ?? null;
  const config = data.config;
  const nextNumber = (status?.minted ?? 0) + 1;
  const baseUri = config?.passBaseUri ?? '';

  useEffect(() => {
    if (!open) return;
    inFlight.current = false;
    assetKey.current = null;
    openedAt.current = data.mintedByMe;
    setPhase('review');
    setError(null);
    setSignature(null);
    setFrozen(null);
    setMinted(null);
    setOpened(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // the count arrived after the sheet opened: that is the baseline
  useEffect(() => {
    if (open && openedAt.current === null && data.mintedByMe !== null && !inFlight.current) openedAt.current = data.mintedByMe;
  }, [open, data.mintedByMe]);

  // the cluster's rent for the asset and the counter (falls back to the usual mainnet values)
  useEffect(() => {
    if (!open || !client) return;
    let alive = true;
    const bytes = coreAssetBytes(nextNumber, baseUri);
    void Promise.all([client.rentExemptMinimum(bytes).catch(() => defaultRent(bytes)), client.rentExemptMinimum(MINT_COUNTER_BYTES).catch(() => defaultRent(MINT_COUNTER_BYTES))]).then(
      ([asset, counter]) => alive && setRents({ asset, counter }),
    );
    return () => {
      alive = false;
    };
  }, [open, client, nextNumber, baseUri]);

  const minTokens = config?.passMinTokens ?? 0n;
  const counterExists = (data.mintedByMe ?? 0) > 0;
  const cost = mintSolCost({
    number: nextNumber,
    baseUri,
    counterExists,
    rent: (b) => (rents ? (b === MINT_COUNTER_BYTES ? rents.counter : rents.asset) : defaultRent(b)),
  });
  const live: Review | null =
    status && status.collection
      ? { number: nextNumber, cost, minTokens, perWallet: status.perWallet, collection: status.collection, mintedByMe: data.mintedByMe ?? 0 }
      : null;
  const v = frozen ?? live;
  const gate = mintGate({
    status,
    walletConnected: !!owner,
    mintedByMe: data.mintedByMe,
    minTokens,
    tokenBalance: data.tokenBalance,
    nowS: Math.floor(Date.now() / 1000),
    seedCommitted: config ? config.passSeedHash !== null : undefined,
  });
  const busy = phase === 'preparing' || phase === 'signing' || phase === 'confirming';
  const sol = (lamports: number) => formatToken(lamports, SOL_DECIMALS, { maxFrac: 6 });
  const lowSol = data.balance !== null && v !== null && data.balance < v.cost.total;
  // a mint landed after all (e.g. the confirmation timed out): never offer to mint twice
  const landed =
    (phase === 'review' || phase === 'error') && openedAt.current !== null && data.mintedByMe !== null && data.mintedByMe > openedAt.current;

  const fail = (text: string) => {
    inFlight.current = false;
    setFrozen(null);
    setError(text);
    setPhase('error');
    refreshChain();
  };
  const onPhase = (p: TxPhase, sig?: string) => {
    setPhase(p);
    if (sig) setSignature(sig);
  };
  const deliver = (pass: OwnedPass, sig: string) => {
    if (owner) rememberMint(owner, pass);
    setMinted(pass);
    setPhase('delivered');
    announce('minted');
    const href = sig.startsWith('DevFake') ? undefined : { href: explorerTx(sig, cluster), label: t('tf.viewTx') };
    toast('success', t('mt.ok'), href, 6000);
    refreshChain();
  };

  const mint = async () => {
    if (inFlight.current) return;
    if (!owner || !config || !live || gate.kind !== 'ready') return;
    inFlight.current = true;
    setPhase('preparing');
    sound.click();
    const review = live;
    setFrozen(review);

    try {
      if (data.fake) {
        const dev = await loadDevFake();
        if (!dev || !chain) return fail(t('tf.err.NetworkError'));
        const res = await dev.fakeMintPass(chain, data.passes, owner, onPhase);
        if (!res.ok) return fail(txErrorText({ code: null, name: res.name, message: res.name }));
        setSignature(res.signature);
        return deliver(res.pass, res.signature);
      }
      if (!client) return fail(t('tf.err.NetworkError'));
      // re-read the collection and this wallet's counter: what is signed must be what was shown
      const [fresh, count] = await Promise.all([client.fetchConfig(), client.fetchMintedCount(owner)]);
      if (count > review.mintedByMe) {
        inFlight.current = false;
        setFrozen(null);
        refreshChain();
        setPhase('review');
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      if (
        !fresh ||
        fresh.passCollection !== review.collection ||
        fresh.passSeedHash === null ||
        !fresh.passMintOpen ||
        fresh.passRevealed ||
        fresh.passMintStartTs > now ||
        fresh.passMinted >= fresh.passSupply ||
        count >= fresh.passPerWallet ||
        fresh.passMinTokens !== review.minTokens
      ) {
        return fail(t('mt.err.Changed'));
      }
      // the new Core asset's key: made in this browser for this sheet session, never stored
      assetKey.current ??= Keypair.generate();
      const asset = assetKey.current;
      const { ixs } = await buildMintTx(client.ix, { minter: owner, asset: asset.publicKey, config: fresh });
      const res = await sendTx(client, connection, wallet, ixs, { onPhase, computeUnits: MINT_COMPUTE_UNITS, signers: [asset] });
      if (!res.ok) return fail(txErrorText(res.error));
      // the number comes from the asset's name (`Slana Pass #n`); the shown estimate is the fallback
      const info = await connection.getAccountInfo(asset.publicKey, 'confirmed').catch(() => null);
      const parsed = info ? parseCoreAsset(info.data) : null;
      const number = (parsed && passNumberFromName(parsed.name)) ?? fresh.passMinted + 1;
      assetKey.current = null;
      deliver({ asset: asset.publicKey.toBase58(), number }, res.signature);
    } catch (err) {
      fail((err as Error).message);
    }
  };

  const goPassport = () => {
    onClose();
    goPage('pass');
    requestAnimationFrame(() => document.querySelector('.pp-passports')?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' }));
  };

  // the price and rules signed come from the chain config: no config, no mint button
  const offline = !config && !data.fake;
  const canConfirm = gate.kind === 'ready' && !!config && !busy && !landed && !!live;
  const delivered = phase === 'delivered' && minted !== null;

  const footer = delivered ? (
    <InkButton variant="pink" size="lg" icon="arrow" onClick={goPassport}>
      {t('mt.toPassport')}
    </InkButton>
  ) : landed ? (
    <InkButton variant="pink" size="lg" icon="arrow" onClick={goPassport}>
      {t('mt.toPassport')}
    </InkButton>
  ) : phase === 'review' || phase === 'error' ? (
    <>
      {/* no autofocus: the Enter that opened the sheet must never land on the sign button */}
      <InkButton variant="pink" size="lg" icon="passport" disabled={!canConfirm} onClick={() => void mint()}>
        {phase === 'error' ? t('tf.retry') : t('mt.confirm')}
      </InkButton>
      <InkButton variant="paper" size="lg" onClick={onClose} className="tf-cancel">
        {t('tf.cancel')}
      </InkButton>
    </>
  ) : (
    <div className="tf-status" role="status" aria-live="polite">
      <span className="tf-status__line">
        <span className="kl-dots" aria-hidden="true" />
        {phase === 'preparing' ? t('mt.preparing') : phase === 'signing' ? t('tf.signing') : t('tf.confirming')}
      </span>
      <span className="tf-status__note mono">
        {phase === 'preparing' ? t('mt.preparingNote') : phase === 'signing' ? t('mt.signingNote', { sym: tok.symbol }) : t('mt.confirmingNote')}
      </span>
      {signature && !signature.startsWith('DevFake') && (
        <a className="tf-status__tx mono" href={explorerTx(signature, cluster)} target="_blank" rel="noreferrer">
          {t('tf.viewTx')}
        </a>
      )}
    </div>
  );

  return (
    <Sheet
      open={open}
      onClose={() => !busy && onClose()}
      closeLabel={t('tf.close')}
      kicker={t('mt.kicker')}
      title={delivered ? t('mt.deliveredTitle', { n: passNo(minted.number) }) : t('mt.title')}
      className="tf-sheet mt-sheet"
      footer={footer}
    >
      <div className="tf-body mt-body">
        <RevealAnimation
          kind="envelope"
          number={passNo(delivered ? minted.number : (v?.number ?? nextNumber))}
          to={owner ? shortAddress(owner, 4, 4) : undefined}
          play={delivered}
          onDone={() => setOpened(true)}
          className={busy ? 'is-waiting' : undefined}
        />

        {delivered ? (
          <p className={`mt-delivered tf-lede${opened ? ' is-on' : ''}`} role="status">
            {status?.revealed ? t('mt.deliveredOpen') : t('mt.deliveredNote')}
          </p>
        ) : (
          <>
            {landed ? (
              <p className="tf-ok" role="status">
                <Icon name="check" size={18} />
                <span>{t('mt.landed')}</span>
              </p>
            ) : (
              phase === 'error' &&
              error && (
                <p className="tf-error" role="alert">
                  <Icon name="info" size={18} />
                  <span>
                    <b>{t('mt.failed')}.</b> {error}
                  </span>
                </p>
              )
            )}
            {v && (
              <dl className="tf-lines">
                <Line label={t('mt.price')} value={t('mt.priceV', { sym: tok.symbol })} strong />
                <Line label={t('mt.number')} value={t('mt.numberV', { n: passNo(v.number) })} />
                <Line label={t('mt.rent')} value={t('mt.rentV', { sol: sol(v.cost.rent) })} />
                <Line label={t('mt.fees')} value={t('mt.feesV', { sol: sol(v.cost.fees) })} />
                <Line label={t('mt.total')} value={t('mt.totalV', { sol: sol(v.cost.total) })} />
                {data.balance !== null && <Line label={t('mt.balance')} value={`${sol(data.balance)} SOL`} />}
              </dl>
            )}
            <p className="tf-note">{t('mt.note')}</p>
            {lowSol && !busy && data.balance !== null && <p className="tf-warn">{t('mt.lowSol', { sol: sol(data.balance) })}</p>}
            {offline && !busy && <p className="tf-warn" role="status">{t('mt.offline')}</p>}
            {gate.kind === 'needTokens' && <p className="tf-warn">{t('ap.g.needTokens', { n: tok.fee(gate.min), sym: tok.symbol })}</p>}
            {v && (
              <section className="tf-steps" aria-label={t('mt.signs')}>
                <h3 className="tf-steps__h mono">{t('mt.signs')}</h3>
                <ol>
                  {[
                    t('mt.step.mint'),
                    t('mt.step.counter', { n: v.perWallet }),
                    ...(v.minTokens > 0n ? [t('mt.step.tokens', { sym: tok.symbol, n: tok.fee(v.minTokens) })] : []),
                  ].map((s, i) => (
                    <li key={i}>
                      <span className="tf-steps__n mono" aria-hidden="true">
                        {i + 1}
                      </span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`tf-line${strong ? ' is-strong' : ''}`}>
      <dt className="mono">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
