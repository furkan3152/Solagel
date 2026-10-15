import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { formatToken, type PassStatus } from '@slana/shared';
import { useEffect, useRef, useState } from 'react';
import { Icon, InkButton } from '../../design';
import { sound } from '../../game/sound';
import { useT } from '../../i18n';
import { toast, useUi } from '../../store';
import { refreshChain, useChainData, useSlanaClient } from '../../solana/chain';
import { explorerTx } from '../../solana/links';
import { CAPTURE_COMPUTE_UNITS, captureFeeLamports, revealStage } from '../../solana/pass';
import { sendTx, txErrorText, type TxPhase } from '../../solana/tx';

const SOL_DECIMALS = 9;
/** How often the current slot is re-read while waiting for the target. */
const SLOT_POLL_MS = 5_000;

/**
 * Ruling R23's intermediate state: the seed is public (`reveal_pass`), the reveal completes
 * when anybody stores the target slot's hash (`capture_pass_entropy`). The game server does
 * it automatically; this panel lets any connected wallet do it too, so no single party
 * controls the timing. Usual money guards: a synchronous in-flight guard, the fee shown
 * before signing, and a fresh config re-read right before the transaction is built (if the
 * reveal already completed, nothing is signed).
 */
export function CompleteReveal({ status }: { status: PassStatus }) {
  const t = useT();
  const cluster = useUi((s) => s.chain?.cluster ?? 'devnet');
  const fake = useChainData((s) => s.fake);
  const client = useSlanaClient();
  const wallet = useWallet();
  const { connection } = useConnection();
  const [slot, setSlot] = useState<number | null>(null);
  const [phase, setPhase] = useState<'idle' | 'preparing' | TxPhase | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const waitingForSeed = !status.seedRevealed || status.revealed;
  useEffect(() => {
    if (waitingForSeed || !client) return;
    let alive = true;
    const read = () =>
      void client.connection
        .getSlot('confirmed')
        .then((s) => alive && setSlot(s))
        .catch(() => {});
    read();
    const id = setInterval(read, SLOT_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [waitingForSeed, client]);

  const stage = revealStage(status, slot);
  if (stage.kind === 'sealed' || stage.kind === 'revealed') return null;

  const fee = formatToken(captureFeeLamports(), SOL_DECIMALS, { maxFrac: SOL_DECIMALS });
  const busy = phase === 'preparing' || phase === 'signing' || phase === 'confirming';
  const owner = wallet.publicKey?.toBase58() ?? null;

  const complete = async () => {
    if (inFlight.current) return;
    if (!owner || !client || fake) return;
    inFlight.current = true;
    setError(null);
    setPhase('preparing');
    sound.click();
    const done = () => {
      inFlight.current = false;
      setPhase('idle');
    };
    try {
      // fresh re-read: never sign when the reveal already completed or the target moved ahead
      const [fresh, now] = await Promise.all([client.fetchConfig(), client.connection.getSlot('confirmed')]);
      if (!fresh || fresh.passRevealed) {
        refreshChain();
        return done();
      }
      if (!fresh.passSeedRevealed || now <= fresh.passEntropyTargetSlot) {
        setSlot(now);
        refreshChain();
        return done();
      }
      const ix = await client.ix.capturePassEntropy(owner);
      const res = await sendTx(client, connection, wallet, [ix], { onPhase: (p) => setPhase(p), computeUnits: CAPTURE_COMPUTE_UNITS });
      if (!res.ok) {
        inFlight.current = false;
        setError(txErrorText(res.error));
        setPhase('error');
        return;
      }
      toast('success', t('rv.done'), { href: explorerTx(res.signature, cluster), label: t('tf.viewTx') }, 6000);
      refreshChain();
      done();
    } catch (err) {
      inFlight.current = false;
      setError((err as Error).message);
      setPhase('error');
    }
  };

  const seconds = stage.kind === 'waiting' && stage.slotsLeft !== null ? Math.max(1, Math.ceil(stage.slotsLeft * 0.4)) : null;
  return (
    <section className="pp-box pp-complete" aria-labelledby="pp-complete-h" data-stage={stage.kind}>
      <h3 id="pp-complete-h" className="kl-h3">
        <Icon name="key" size={20} />
        {t('rv.title')}
      </h3>
      <p className="kl-note">{t('rv.body', { slot: stage.targetSlot })}</p>
      {stage.kind === 'waiting' ? (
        <p className="kl-note mono" role="status">
          {seconds !== null ? t('rv.waiting', { s: seconds }) : t('rv.waitingUnknown')}
        </p>
      ) : (
        <>
          <p className="kl-note">{t('rv.anyone', { fee })}</p>
          {error && (
            <p className="tf-warn" role="alert">
              {error}
            </p>
          )}
          {fake ? null : !owner ? (
            <p className="kl-note mono">{t('rv.connect')}</p>
          ) : (
            <InkButton variant="pink" icon="key" disabled={busy || !client} onClick={() => void complete()}>
              {busy ? (phase === 'signing' ? t('tf.signing') : t('tf.confirming')) : t('rv.cta')}
            </InkButton>
          )}
        </>
      )}
    </section>
  );
}
