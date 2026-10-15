import { PAPERS, SEALED_LOOK, lookForPass } from '@slana/art';
import type { OwnedPass } from '@slana/sdk';
import { shortAddress, type MarketUrls, type PassStatus } from '@slana/shared';
import { useWallet } from '@solana/wallet-adapter-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Chip, Counter, Icon, InkButton, Passport, Stamp, StampSpinner, springs, useReducedMotion } from '../../design';
import { sound } from '../../audio';
import { useT } from '../../i18n';
import { usePassPower, usePassStatus, useChainData } from '../../solana/chain';
import { mintGate, passNo, passView, previewSeed, previewTraits, splitDuration, type MintGate } from '../../solana/pass';
import { bpsPercent, feeBps } from '../../solana/ticket';
import { openModal, toast, updateSettings, useUi } from '../../store';
import { CoinPortrait } from '../game/CoinPortrait';
import { useTokenText } from '../lobby/useLobby';
import { PageHead } from '../PageHead';
import { Punch } from '../profile/SettingsPage';
import { CompleteReveal } from './CompleteReveal';
import { MintSheet } from './MintSheet';
import { RevealAnimation } from './RevealAnimation';
import { lookLine, rarityKey, traitRows } from './traitNames';
import './pass.css';

const SEEN_KEY = 'slana.revealSeen.v1';

function seenReveals(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function markSeen(asset: string): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...seenReveals(), asset])].slice(-200)));
  } catch {
    /* storage unavailable: the seal can be broken again next time */
  }
}

/** Unix seconds, ticking every `everyMs` while `active`. */
function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs]);
  return now;
}

/**
 * The Pass office (spec §7.2.6). Holders get their passports (art, number,
 * traits, rarity, perks, the session it is locked to, and an "equipped"
 * switch); everybody else gets the application form (supply counter, mint
 * countdown, a rolling preview of looks and the stamped mint button). The
 * mint itself and the envelope live in `MintSheet`; the reveal's seal break
 * plays on the passport.
 */
export function PassPage() {
  const t = useT();
  const markets = useUi((s) => s.chain?.markets);
  const status = usePassStatus();
  const passes = useChainData((s) => s.passes);
  const mintedByMe = useChainData((s) => s.mintedByMe);
  const tokenBalance = useChainData((s) => s.tokenBalance);
  const minTokens = useChainData((s) => s.config?.passMinTokens ?? 0n);
  const seedCommitted = useChainData((s) => (s.config ? s.config.passSeedHash !== null : undefined));
  const wallet = useWallet();
  const owner = wallet.publicKey?.toBase58() ?? null;
  const [mintOpen, setMintOpen] = useState(false);
  const waiting = !!status && status.mintStartTs > Date.now() / 1000;
  const nowS = useNow(waiting || mintOpen);
  const nf = new Intl.NumberFormat('en-US');

  const gate = mintGate({ status, walletConnected: !!owner, mintedByMe, minTokens, tokenBalance, nowS, seedCommitted });
  const holding = passes.length > 0;

  return (
    <div className="pp-page">
      <PageHead
        kicker={t('pp.kicker')}
        title={t('pp.title')}
        deck={t('pp.deck')}
        aside={status && status.collection ? <SupplyHead status={status} nf={nf} /> : undefined}
      />
      <div className="pp-grid">
        <div className="pp-main">
          {status?.collection && status.seedRevealed && !status.revealed && <CompleteReveal status={status} />}
          {!status?.collection ? (
            <p className="pp-empty">
              <Icon name="passport" size={28} />
              <span>{t('pp.offline')}</span>
            </p>
          ) : holding ? (
            <Passports passes={passes} status={status} />
          ) : (
            <ApplyForm status={status} gate={gate} nowS={nowS} onMint={() => setMintOpen(true)} />
          )}
          {holding && gate.kind === 'ready' && (
            <button type="button" className="pp-again" onClick={() => setMintOpen(true)}>
              <Icon name="passport" size={22} />
              <span>
                <b>{t('ap.title')}</b>
                <span className="mono">{t('ap.ctaSub')}</span>
              </span>
              <Icon name="chevron" size={20} />
            </button>
          )}
        </div>
        <aside className="pp-side">
          <Perks />
          {status?.collection && !status.revealed && <RevealSteps />}
          <Markets markets={markets} collection={status?.collection ?? null} />
        </aside>
      </div>
      <MintSheet open={mintOpen} onClose={() => setMintOpen(false)} />
    </div>
  );
}

function SupplyHead({ status, nf }: { status: PassStatus; nf: Intl.NumberFormat }) {
  const t = useT();
  return (
    <div className="pp-supply-head">
      <span className="pp-supply-head__n">
        <Counter value={status.minted} format={(n) => nf.format(Math.round(n))} />
      </span>
      <span className="pp-supply-head__of mono">
        {t('pp.of', { n: nf.format(status.supply) })} · {t('pp.minted')}
      </span>
    </div>
  );
}

/* ── holders ─────────────────────────────────────────────────────────── */

function Passports({ passes, status }: { passes: OwnedPass[]; status: PassStatus }) {
  const t = useT();
  return (
    <section className="pp-passports" aria-labelledby="pp-yours-h">
      <div className="pp-section-head">
        <h3 id="pp-yours-h" className="kl-h3">
          <Icon name="passport" size={20} />
          {t('pp.yours')}
        </h3>
        <span className="kl-sub mono">{passes.length === 1 ? t('pp.yoursSub1') : t('pp.yoursSub', { n: passes.length })}</span>
      </div>
      <ol className="pp-list">
        {passes.map((p, i) => (
          <motion.li key={p.asset} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springs.sheet, delay: i * 0.03 }}>
            <PassportCard pass={p} status={status} />
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

function PassportCard({ pass, status }: { pass: OwnedPass; status: PassStatus }) {
  const t = useT();
  const worn = useUi((s) => s.settings.passSkin === pass.asset);
  const name = useUi((s) => s.settings.name);
  const profile = useChainData((s) => s.profile);
  const locked = useChainData((s) => s.lockedPasses.includes(pass.asset));
  const owner = useWallet().publicKey?.toBase58() ?? null;
  const view = passView(pass, status);
  const [seen, setSeen] = useState(() => seenReveals().includes(pass.asset));
  const [breaking, setBreaking] = useState(false);
  const [broken, setBroken] = useState(false);
  const [wax, setWax] = useState<CSSProperties | null>(null);
  const book = useRef<HTMLDivElement>(null);
  const needsBreak = !view.sealed && !seen;
  const sealed = view.sealed || (needsBreak && !broken);
  const no = passNo(pass.number);
  const holder = profile?.name || name || (owner ? shortAddress(owner, 4, 4) : '—');

  const startBreak = () => {
    // put the breaking seal exactly over the passport's own wax seal
    const root = book.current;
    const w = root?.querySelector('.kb-passport__wax');
    if (root && w) {
      const a = root.getBoundingClientRect();
      const b = w.getBoundingClientRect();
      setWax({ left: b.left - a.left, top: b.top - a.top, width: b.width, height: b.height });
    }
    setBreaking(true);
  };

  const traits = view.traits;
  const fields = traits
    ? [
        { label: t('pp.f.rarity'), value: t(rarityKey(traits.rarity)) },
        ...traitRows(traits, t).map((r) => ({ label: t(r.label), value: r.value })),
        { label: t('pp.f.session'), value: locked ? t('pp.session.locked') : t('pp.session.free') },
      ]
    : [];

  return (
    <article className={`pp-card${sealed ? ' is-sealed' : ''}${breaking ? ' is-breaking' : ''}`} aria-label={`Slana Pass ${t('lo.pass.no', { n: no })}`}>
      <div className="pp-card__book" ref={book}>
        <Passport
          title={t('pp.brand')}
          kind={t('pp.kind')}
          numberLabel={t('pp.no')}
          number={no}
          sealed={sealed}
          sealedLabel={t('pp.sealed')}
          visa={t('pp.valid')}
          holderLabel={t('pp.f.holder')}
          holder={holder}
          art={
            traits ? (
              <span className={`pp-photo is-${traits.rarity}`} style={{ background: PAPERS[traits.paper] }}>
                <CoinPortrait skin={0} look={lookForPass(traits)} size={156} expression="proud" seed={pass.number} />
              </span>
            ) : undefined
          }
          traits={fields}
        />
        {breaking && (
          <RevealAnimation
            kind="seal"
            number={no}
            play
            className="pp-card__seal"
            style={wax ?? undefined}
            onBreak={() => setBroken(true)}
            onDone={() => {
              markSeen(pass.asset);
              setSeen(true);
              setBreaking(false);
            }}
          />
        )}
      </div>

      <div className="pp-card__side">
        {sealed ? (
          needsBreak ? (
            <div className="pp-card__note">
              <h4 className="pp-card__h">{t('pp.revealedNew')}</h4>
              <p className="kl-note">{t('pp.revealReady')}</p>
              <InkButton variant="pink" size="md" lead="key" onClick={startBreak} disabled={breaking}>
                {t('pp.breakSeal')}
              </InkButton>
            </div>
          ) : (
            <div className="pp-card__note">
              <span className="pp-card__sealed-coin" aria-hidden="true">
                <CoinPortrait skin={0} look={SEALED_LOOK} size={64} expression="happy" seed={pass.number} still />
              </span>
              <h4 className="pp-card__h">{t('pp.sealedTitle')}</h4>
              <p className="kl-note">{t('pp.sealedNote')}</p>
            </div>
          )
        ) : (
          traits && (
            <div className="pp-card__chips">
              <Chip tone={traits.rarity === 'legendary' ? 'mustard' : traits.rarity === 'rare' ? 'pink' : 'ink'}>{t(rarityKey(traits.rarity))}</Chip>
              {locked ? (
                <Chip tone="teal" icon="lock">
                  {t('pp.session.locked')}
                </Chip>
              ) : (
                <Chip tone="teal" icon="check">
                  {t('pp.session.free')}
                </Chip>
              )}
            </div>
          )
        )}
        <div className="pp-wear">
          <span className="pp-wear__label">
            <span className="pp-wear__title">{worn ? t('pp.wearing') : t('pp.wear')}</span>
            <span className="kl-note">{view.sealed ? t('pp.wearSealed') : t('pp.wearNote')}</span>
          </span>
          <Punch
            on={worn}
            label={t('pp.wearLabel', { n: no })}
            onChange={(on) => {
              sound.click();
              updateSettings({ passSkin: on ? pass.asset : null });
            }}
          />
        </div>
      </div>
    </article>
  );
}

/* ── applicants ──────────────────────────────────────────────────────── */

function ApplyForm({ status, gate, nowS, onMint }: { status: PassStatus; gate: MintGate; nowS: number; onMint: () => void }) {
  const t = useT();
  const owner = useWallet().publicKey?.toBase58() ?? null;
  const minTokens = useChainData((s) => s.config?.passMinTokens ?? 0n);
  const tok = useTokenText();
  const nf = new Intl.NumberFormat('en-US');
  const left = Math.max(0, status.supply - status.minted);
  const over = gate.kind === 'soldOut' || gate.kind === 'closed';

  return (
    <section className={`pp-form${over ? ' is-over' : ''}`} aria-labelledby="pp-form-h">
      <div className="pp-form__band">
        <span className="mono">{t('ap.kicker')}</span>
        {!over && <span className="mono">No. {passNo(Math.min(status.supply, status.minted + 1))}</span>}
      </div>
      <div className="pp-form__grid">
        <div className="pp-form__head">
          <h3 id="pp-form-h" className="pp-form__title">
            {t('ap.title')}
          </h3>
          <p className="pp-form__lede">{t('ap.lede', { sym: tok.symbol, per: status.perWallet })}</p>
        </div>
        <RollingPreview />
        <dl className="pp-form__dl">
          <FormRow label={t('ap.f.applicant')} value={owner ? shortAddress(owner, 4, 4) : t('ap.f.applicantNone')} mono={!!owner} muted={!owner} />
          <FormRow label={t('ap.f.fee')} value={t('ap.f.feeV')} />
          <FormRow label={t('ap.f.limit')} value={nf.format(status.perWallet)} />
          {!over && <FormRow label={t('ap.f.number')} value={`No. ${passNo(Math.min(status.supply, status.minted + 1))}`} mono />}
          <FormRow label={t('ap.f.require')} value={minTokens > 0n ? t('ap.f.requireV', { n: tok.fee(minTokens), sym: tok.symbol }) : t('ap.f.none')} />
        </dl>
        <div className="pp-meter">
          <div className="pp-meter__nums">
            <span className="mono">{t('ap.supply')}</span>
            <span className="mono">{t('ap.left', { n: nf.format(left) })}</span>
          </div>
          <div
            className="pp-meter__track"
            role="progressbar"
            aria-label={t('ap.supply')}
            aria-valuemin={0}
            aria-valuemax={status.supply}
            aria-valuenow={status.minted}
            aria-valuetext={`${nf.format(status.minted)} / ${nf.format(status.supply)}`}
          >
            <motion.span
              className="pp-meter__fill"
              initial={false}
              animate={{ width: `${Math.min(100, (status.minted / Math.max(1, status.supply)) * 100)}%` }}
              transition={springs.dial}
            />
          </div>
        </div>
        {gate.kind === 'notStarted' && <Countdown startsAt={gate.startsAt} nowS={nowS} />}
        <div className="pp-form__cta">
          <MintButton gate={gate} onMint={onMint} />
        </div>
      </div>
      {over && (
        <span className="pp-form__over" aria-hidden="true">
          <Stamp text={gate.kind === 'soldOut' ? t('ap.g.soldOut') : t('ap.g.closed')} tone="red" size="lg" rotate={-12} />
        </span>
      )}
    </section>
  );
}

function FormRow({ label, value, mono = false, muted = false }: { label: string; value: string; mono?: boolean; muted?: boolean }) {
  return (
    <div className="pp-form__row">
      <dt className="mono">{label}</dt>
      <dd className={`${mono ? 'mono ' : ''}${muted ? 'is-muted' : ''}`}>{value}</dd>
    </div>
  );
}

function MintButton({ gate, onMint }: { gate: MintGate; onMint: () => void }) {
  const t = useT();
  const tok = useTokenText();
  const reduced = useReducedMotion();
  switch (gate.kind) {
    case 'ready':
      return (
        <span className="pp-mint">
          <InkButton variant="pink" size="lg" icon="passport" sub={t('ap.ctaSub')} onClick={onMint} block>
            {t('ap.cta')}
          </InkButton>
          <span className="pp-mint__stamp" aria-hidden="true">
            <Stamp text={t('lo.free')} tone="teal" round size="sm" rotate={-14} animateIn={!reduced} delay={0.25} />
          </span>
        </span>
      );
    case 'connect':
      return (
        <InkButton variant="ink" size="lg" lead="wallet" onClick={() => openModal('wallet')} block>
          {t('ap.g.connect')}
        </InkButton>
      );
    case 'limit':
      return <GateNote icon="check" title={t('ap.g.limit')} body={t('ap.g.limitNote', { n: gate.perWallet })} />;
    case 'needTokens':
      return <GateNote icon="coin" title={t('ap.g.needTokens', { n: tok.fee(gate.min), sym: tok.symbol })} />;
    case 'closed':
    case 'soldOut':
      return <GateNote icon="lock" title={gate.kind === 'soldOut' ? t('ap.g.soldOut') : t('ap.g.closed')} body={t('ap.g.closedNote')} />;
    case 'notStarted':
      return (
        <InkButton variant="pink" size="lg" icon="passport" disabled block>
          {t('ap.cta')}
        </InkButton>
      );
    case 'loading':
      return (
        <InkButton variant="pink" size="lg" disabled block>
          <span className="kb-wait">
            <StampSpinner size="sm" />
            {t('ap.g.loading')}
          </span>
        </InkButton>
      );
    default:
      return <GateNote icon="info" title={t('ap.g.unavailable')} />;
  }
}

function GateNote({ icon, title, body }: { icon: Parameters<typeof Icon>[0]['name']; title: string; body?: string }) {
  return (
    <p className="pp-gate" role="status">
      <Icon name={icon} size={20} />
      <span>
        <b>{title}</b>
        {body && <span className="kl-note">{body}</span>}
      </span>
    </p>
  );
}

function Countdown({ startsAt, nowS }: { startsAt: number; nowS: number }) {
  const t = useT();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (n: number) => {
    const { d, h, m, s } = splitDuration(n);
    return `${d > 0 ? `${d}${t('ap.cd.d')} ` : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
  };
  const date = new Date(startsAt * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="pp-count">
      <span className="pp-count__label mono">{t('ap.g.notStarted')}</span>
      <Counter value={Math.max(0, startsAt - nowS)} format={fmt} className="pp-count__dial" />
      <span className="pp-count__date mono">{t('ap.g.opensAt', { date })}</span>
    </div>
  );
}

/** "Might come out like": looks rolled from a client-side preview seed, never the collection's seed. */
function RollingPreview() {
  const t = useT();
  const reduced = useReducedMotion();
  const [seed, setSeed] = useState(previewSeed);
  const looks = useMemo(() => previewTraits(seed, 24), [seed]);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const capId = useId();
  const still = reduced || paused;
  useEffect(() => {
    if (still) return;
    const id = setInterval(() => setI((x) => (x + 1) % looks.length), 1900);
    return () => clearInterval(id);
  }, [still, looks.length]);
  const look = looks[i % looks.length];
  const next = () => {
    sound.click();
    if (i + 1 >= looks.length) {
      setSeed(previewSeed());
      setI(0);
    } else setI(i + 1);
  };
  return (
    <figure className="pp-preview" aria-labelledby={capId}>
      <div className="pp-preview__photo" style={{ background: PAPERS[look.paper] }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={`${seed}:${i}`}
            className="pp-preview__coin"
            initial={reduced ? { opacity: 0 } : { x: 46, rotate: 8, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { x: 0, rotate: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { x: -46, rotate: -8, opacity: 0 }}
            transition={reduced ? { duration: 0.15 } : springs.sheet}
          >
            <CoinPortrait skin={0} look={lookForPass(look)} size={148} expression="happy" seed={i + 3} still={still} />
          </motion.span>
        </AnimatePresence>
        <span className="pp-preview__sample mono" aria-hidden="true">
          {t('ap.preview')}
        </span>
      </div>
      <figcaption id={capId} className="pp-preview__cap">
        <span className="pp-preview__line">{lookLine(look)}</span>
        <span className="pp-preview__ctl">
          {!reduced && (
            <button
              type="button"
              className="kb-iconbtn kb-iconbtn--sm"
              aria-pressed={paused}
              aria-label={paused ? t('ap.previewPlay') : t('ap.previewPause')}
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? (
                <Icon name="play" size={16} />
              ) : (
                <svg className="kb-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5v14M16 5v14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
                </svg>
              )}
            </button>
          )}
          <button type="button" className="kb-iconbtn kb-iconbtn--sm" aria-label={t('ap.preview')} onClick={next}>
            <Icon name="chevron" size={16} />
          </button>
        </span>
      </figcaption>
      <p className="pp-preview__note">{t('ap.previewNote')}</p>
    </figure>
  );
}

/* ── side column ─────────────────────────────────────────────────────── */

function Perks() {
  const t = useT();
  const config = useChainData((s) => s.config);
  const power = usePassPower();
  const perks = [
    t('lo.perk.rooms'),
    t('lo.perk.fee', { base: bpsPercent(feeBps(config, false)), pass: bpsPercent(feeBps(config, true)) }),
    t('lo.perk.season'),
    t('lo.perk.power', { start: power.startPct, s: power.cashoutS }),
    t('lo.perk.look'),
  ];
  return (
    <section className="pp-box" aria-labelledby="pp-perks-h">
      <h3 id="pp-perks-h" className="kl-h3">
        {t('pp.perks')}
      </h3>
      <ol className="kl-perks">
        {perks.map((p, i) => (
          <li key={i}>
            <span className="kl-perks__n mono" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span>{p}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RevealSteps() {
  const t = useT();
  const steps = [t('ap.how1'), t('ap.how2'), t('ap.how3')];
  return (
    <section className="pp-box pp-how" aria-labelledby="pp-how-h">
      <h3 id="pp-how-h" className="kl-h3">
        <Icon name="key" size={20} />
        {t('ap.how')}
      </h3>
      <ol className="pp-how__list">
        {steps.map((s, i) => (
          <li key={i}>
            <span className="pp-how__n" aria-hidden="true">
              {i + 1}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

const MARKETS: { key: keyof MarketUrls; name: string }[] = [
  { key: 'magicEden', name: 'Magic Eden' },
  { key: 'tensor', name: 'Tensor' },
  { key: 'opensea', name: 'OpenSea' },
];

function Markets({ markets, collection }: { markets: MarketUrls | undefined; collection: string | null }) {
  const t = useT();
  const links = MARKETS.filter((m) => !!markets?.[m.key]);
  if (links.length === 0 && !collection) return null;
  return (
    <section className="pp-box pp-markets" aria-labelledby="pp-markets-h">
      <h3 id="pp-markets-h" className="kl-h3">
        {t('pp.markets')}
      </h3>
      {links.length > 0 && (
        <ul className="pp-markets__list">
          {links.map((m) => (
            <li key={m.key}>
              <a className="pp-market" href={markets![m.key]} target="_blank" rel="noopener noreferrer">
                <span className="pp-market__name">{m.name}</span>
                <span className="pp-market__host mono">{hostOf(markets![m.key]!)}</span>
                <Icon name="arrow" size={18} />
              </a>
            </li>
          ))}
        </ul>
      )}
      {links.length > 0 && <p className="kl-note">{t('pp.marketsNote')}</p>}
      {collection && (
        <div className="pp-collection">
          <span className="mono kl-sub">{t('pp.collection')}</span>
          <code className="pp-collection__addr">{collection}</code>
          <Chip
            icon="docs"
            onClick={() => {
              void navigator.clipboard?.writeText(collection).then(() => toast('success', t('pp.copied')));
            }}
          >
            {t('pp.copy')}
          </Chip>
        </div>
      )}
    </section>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
