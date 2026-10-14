import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { TOKEN_2022_PROGRAM_ID } from '@slana/sdk';
import { PRIZE_SHARES_BPS, formatToken, shortAddress } from '@slana/shared';
import { useEffect, useRef, useState } from 'react';
import { Icon, InkButton, Sheet, Stamp } from '../../design';
import { sound } from '../../game/sound';
import { useT } from '../../i18n';
import { refreshChain, useChainData, useSlanaClient } from '../../solana/chain';
import { loadDevFake } from '../../solana/devFakeLoader';
import { explorerTx } from '../../solana/links';
import { claimState, buildClaimTx, prizeAmount, type ClaimState } from '../../solana/season';
import { ACCOUNT_BYTES, BASE_FEE_LAMPORTS, PRIORITY_MICRO_LAMPORTS, bpsPercent, defaultRent } from '../../solana/ticket';
import { sendTx, txErrorText, type TxPhase } from '../../solana/tx';
import { toast, useUi } from '../../store';
import { useTokenText } from '../lobby/useLobby';

/** Compute-unit limit of the claim transaction (bounds the priority fee). */
const CLAIM_COMPUTE_UNITS = 90_000;
const SOL_DECIMALS = 9;

type Phase = 'review' | 'preparing' | TxPhase | 'done' | 'error';
type Prize = Extract<ClaimState, { kind: 'claimable' | 'claimed' | 'expired' }>;

/**
 * The winner's prize cheque (spec §7.2.7, "talep"): shown to a top-10 player
 * of the last finalized season. Claimable → a cheque with the amount and the
 * claim deadline, and a sheet that shows what is signed; claimed → stamped
 * "Paid"; past the 30-day window → stamped "Expired".
 */
export function SeasonClaim() {
  const me = useWallet().publicKey?.toBase58() ?? null;
  // a new wallet starts with a fresh cheque (no "paid" stamp or open claim carried over)
  return <WalletCheque key={me ?? 'none'} me={me} />;
}

function WalletCheque({ me }: { me: string | null }) {
  const season = useChainData((s) => s.season);
  const [open, setOpen] = useState(false);
  /** The prize as it was when the sheet opened: the sheet stays up after the claim lands (the state turns "claimed"). */
  const [claiming, setClaiming] = useState<Extract<ClaimState, { kind: 'claimable' }> | null>(null);
  const [paidNow, setPaidNow] = useState(false);
  const nowS = Math.floor(Date.now() / 1000);
  const state = claimState(season?.previous ?? null, me, nowS);
  if (state.kind === 'none' || !season?.previous) return null;
  const payee = season.previous.entries[state.rank]?.name ?? (me ? shortAddress(me, 4, 4) : '');
  return (
    <>
      <Cheque
        prize={state}
        payee={payee}
        onClaim={() => {
          if (state.kind !== 'claimable') return;
          setClaiming(state);
          setOpen(true);
        }}
        stamped={paidNow}
      />
      {claiming && (
        <ClaimSheet
          open={open}
          prize={claiming}
          payee={payee}
          onClose={() => setOpen(false)}
          onPaid={() => setPaidNow(true)}
        />
      )}
    </>
  );
}

function Cheque({ prize, payee, onClaim, stamped, compact = false }: { prize: Prize; payee: string; onClaim?: () => void; stamped?: boolean; compact?: boolean }) {
  const t = useT();
  const lang = useUi((s) => s.settings.lang);
  const tok = useTokenText();
  const n = String(prize.seasonId).padStart(2, '0');
  const rank = prize.rank + 1;
  const deadline =
    prize.kind === 'claimable'
      ? new Date(prize.closesAt * 1000).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : null;
  return (
    <article className={`sc-cheque is-${prize.kind}${compact ? ' is-compact' : ''}`} aria-labelledby={`sc-h-${prize.seasonId}`}>
      <div className="sc-cheque__stub" aria-hidden="true">
        <span className="mono">S{n}</span>
        <span className="sc-cheque__rank">{rank}</span>
        <span className="mono">{t('nw.col.rank')}</span>
      </div>
      <div className="sc-cheque__body">
        <span className="sc-cheque__kicker mono">{t('sc.kicker')}</span>
        <h3 id={`sc-h-${prize.seasonId}`} className="sc-cheque__title">
          {t('sc.title', { rank, n })}
        </h3>
        <div className="sc-cheque__pay">
          <span className="mono">{t('sc.payTo')}</span>
          <span className="sc-cheque__payee">{payee}</span>
        </div>
        <div className="sc-cheque__amount">
          <span className="sc-cheque__value">{tok.fee(prize.amount)}</span>
          <span className="mono">{tok.symbol}</span>
          <span className="sc-cheque__share mono">{t('sc.share', { pct: bpsPercent(PRIZE_SHARES_BPS[prize.rank], lang) })}</span>
        </div>
        {prize.kind === 'claimable' && !stamped && (
          <>
            <span className="sc-cheque__until mono">{t('sc.until', { date: deadline ?? '' })}</span>
            {onClaim && (
              <InkButton variant="pink" size="md" icon="cashout" onClick={onClaim}>
                {t('sc.cta')}
              </InkButton>
            )}
          </>
        )}
        {(prize.kind === 'claimed' || stamped) && <p className="kl-note">{t('sc.claimedNote', { n, amount: tok.fee(prize.amount), sym: tok.symbol })}</p>}
        {prize.kind === 'expired' && <p className="kl-note">{t('sc.expiredNote')}</p>}
      </div>
      {(prize.kind === 'claimed' || stamped) && (
        <span className="sc-cheque__stamp" aria-hidden="true">
          <Stamp text={t('sc.claimed')} tone="teal" size="lg" rotate={-10} animateIn={!!stamped} />
        </span>
      )}
      {prize.kind === 'expired' && (
        <span className="sc-cheque__stamp" aria-hidden="true">
          <Stamp text={t('sc.expired')} tone="ink" size="md" rotate={-8} />
        </span>
      )}
    </article>
  );
}

interface Review {
  amount: bigint;
  rank: number;
  seasonId: number;
  ata: boolean;
  sol: number;
}

/**
 * Claim confirm sheet, with the ticket flow's guards: in-flight ref, a
 * 'preparing' phase before the first await, frozen values, and the season
 * re-read from the chain right before the transaction is built.
 */
function ClaimSheet({ open, prize, payee, onClose, onPaid }: { open: boolean; prize: Extract<ClaimState, { kind: 'claimable' }>; payee: string; onClose: () => void; onPaid: () => void }) {
  const t = useT();
  const lang = useUi((s) => s.settings.lang);
  const cluster = useUi((s) => s.chain?.cluster ?? 'devnet');
  const wallet = useWallet();
  const { connection } = useConnection();
  const client = useSlanaClient();
  const data = useChainData();
  const tok = useTokenText();
  const [phase, setPhase] = useState<Phase>('review');
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [frozen, setFrozen] = useState<Review | null>(null);
  const [rent, setRent] = useState<number | null>(null);
  const inFlight = useRef(false);
  const owner = wallet.publicKey?.toBase58() ?? null;
  const config = data.config;
  const token2022 = config?.tokenProgram === TOKEN_2022_PROGRAM_ID.toBase58();
  const ataBytes = token2022 ? ACCOUNT_BYTES.ata2022 : ACCOUNT_BYTES.ata;

  useEffect(() => {
    if (!open) return;
    inFlight.current = false;
    setPhase('review');
    setError(null);
    setSignature(null);
    setFrozen(null);
  }, [open]);
  useEffect(() => {
    if (!open || !client) return;
    let alive = true;
    void client
      .rentExemptMinimum(ataBytes)
      .catch(() => defaultRent(ataBytes))
      .then((r) => alive && setRent(r));
    return () => {
      alive = false;
    };
  }, [open, client, ataBytes]);

  const needAta = data.ataExists !== true;
  const fees = BASE_FEE_LAMPORTS + Math.ceil((CLAIM_COMPUTE_UNITS * PRIORITY_MICRO_LAMPORTS) / 1_000_000);
  const live: Review = { amount: prize.amount, rank: prize.rank, seasonId: prize.seasonId, ata: needAta, sol: fees + (needAta ? (rent ?? defaultRent(ataBytes)) : 0) };
  const v = frozen ?? live;
  const busy = phase === 'preparing' || phase === 'signing' || phase === 'confirming';
  const done = phase === 'done';
  const sol = (lamports: number) => formatToken(lamports, SOL_DECIMALS, lang, { maxFrac: 6 });
  const n = String(prize.seasonId).padStart(2, '0');

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
  const paid = (sig: string) => {
    setPhase('done');
    onPaid();
    const href = sig.startsWith('DevFake') ? undefined : { href: explorerTx(sig, cluster), label: t('tf.viewTx') };
    toast('success', t('sc.ok'), href, 7000);
    refreshChain();
  };

  const claim = async () => {
    if (inFlight.current) return;
    if (!owner || !config) return;
    inFlight.current = true;
    setPhase('preparing');
    sound.click();
    const review = live;
    setFrozen(review);
    try {
      if (data.fake) {
        const dev = await loadDevFake();
        if (!dev) return fail(t('tf.err.NetworkError'));
        const sig = `DevFakeSig${Date.now().toString(36)}`;
        await dev.fakeSimpleTx(onPhase, () => {
          dev.fakeWallet.claimed.push(review.rank);
          dev.fakeWallet.tokenBalance += review.amount;
          dev.fakeWallet.ataExists = true;
        });
        return paid(sig);
      }
      if (!client) return fail(t('tf.err.NetworkError'));
      // re-read the season: the prize signed for must be the prize shown
      const fresh = await client.fetchSeason(review.seasonId);
      const now = Math.floor(Date.now() / 1000);
      const still = claimState(
        fresh ? { id: fresh.id, prizePool: fresh.prizePool, endedAt: fresh.endedAt, entries: fresh.entries, claimedMask: fresh.claimedMask } : null,
        owner,
        now,
      );
      if (!fresh?.finalized || still.kind !== 'claimable' || still.rank !== review.rank || prizeAmount(fresh.prizePool, review.rank) !== review.amount) {
        return fail(t('sc.err.Changed'));
      }
      const ixs = await buildClaimTx(client.ix, { claimer: owner, seasonId: review.seasonId, token: config, ataExists: review.ata ? false : true });
      const res = await sendTx(client, connection, wallet, ixs, { onPhase, computeUnits: CLAIM_COMPUTE_UNITS });
      if (!res.ok) return fail(txErrorText(res.error));
      setSignature(res.signature);
      paid(res.signature);
    } catch (err) {
      fail((err as Error).message);
    }
  };

  const footer = done ? (
    <InkButton variant="ink" size="lg" icon="check" onClick={onClose}>
      {t('tf.close')}
    </InkButton>
  ) : phase === 'review' || phase === 'error' ? (
    <>
      {/* no autofocus on the sign button */}
      <InkButton variant="pink" size="lg" icon="cashout" disabled={!owner || !config || busy} onClick={() => void claim()}>
        {phase === 'error' ? t('tf.retry') : t('sc.confirm', { amount: tok.exact(v.amount), sym: tok.symbol })}
      </InkButton>
      <InkButton variant="paper" size="lg" onClick={onClose} className="tf-cancel">
        {t('tf.cancel')}
      </InkButton>
    </>
  ) : (
    <div className="tf-status" role="status" aria-live="polite">
      <span className="tf-status__line">
        <span className="kl-dots" aria-hidden="true" />
        {phase === 'preparing' ? t('tf.preparing') : phase === 'signing' ? t('tf.signing') : t('tf.confirming')}
      </span>
      <span className="tf-status__note mono">
        {phase === 'preparing'
          ? t('sc.preparingNote')
          : phase === 'signing'
            ? t('sc.signingNote', { amount: tok.exact(v.amount), sym: tok.symbol })
            : t('sc.confirmingNote')}
      </span>
      {signature && !signature.startsWith('DevFake') && (
        <a className="tf-status__tx mono" href={explorerTx(signature, cluster)} target="_blank" rel="noreferrer">
          {t('tf.viewTx')}
        </a>
      )}
    </div>
  );

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} closeLabel={t('tf.close')} kicker={t('sc.kicker')} title={t('sc.sheetTitle')} className="tf-sheet sc-sheet" footer={footer}>
      <div className="tf-body">
        <Cheque prize={prize} payee={payee} stamped={done} compact />
        {phase === 'error' && error && (
          <p className="tf-error" role="alert">
            <Icon name="info" size={18} />
            <span>
              <b>{t('sc.failed')}.</b> {error}
            </span>
          </p>
        )}
        {!done && (
          <>
            <dl className="tf-lines">
              <div className="tf-line is-strong">
                <dt className="mono">{t('sc.l.prize')}</dt>
                <dd>
                  {tok.exact(v.amount)} {tok.symbol}
                </dd>
              </div>
              <div className="tf-line">
                <dt className="mono">{t('sc.l.rank')}</dt>
                <dd>
                  {v.rank + 1} · {t('lo.season', { n })}
                </dd>
              </div>
              <div className="tf-line">
                <dt className="mono">{t('sc.l.sol')}</dt>
                <dd>{v.ata ? t('sc.l.solAtaV', { sol: sol(v.sol) }) : t('sc.l.solV', { sol: sol(v.sol) })}</dd>
              </div>
            </dl>
            <p className="tf-note">{t('sc.note')}</p>
            <section className="tf-steps" aria-label={t('tf.signs')}>
              <h3 className="tf-steps__h mono">{t('tf.signs')}</h3>
              <ol>
                {[...(v.ata ? [t('tf.step.ata')] : []), t('sc.step.claim', { n, rank: v.rank + 1 })].map((s, i) => (
                  <li key={i}>
                    <span className="tf-steps__n mono" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </div>
    </Sheet>
  );
}
