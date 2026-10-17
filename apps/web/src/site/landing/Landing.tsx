import { lookForBasicSkin } from '@slana/art';
import { BASIC_SKINS } from '@slana/shared';
import { motion, type Variants } from 'motion/react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Icon, Stamp, useReducedMotion } from '../../design';
import { Link } from '../router';
import { SiteFooter, SiteHeader, Wordmark, XIcon } from '../Shell';
import { X_URL, useSiteSettings } from '../settings';
import { Kb } from '../../design';
import { CoinArt } from './CoinArt';
import { CoinPond } from './CoinPond';
import { useLandingSound } from './sound';
import './landing.css';

const rise: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: (i: number = 0) => ({ opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 26, delay: i * 0.08 } }),
};

const view = { once: true, amount: 0.25 } as const;

function SectionHead({ no, kicker, title, id }: { no: string; kicker: string; title: ReactNode; id: string }) {
  return (
    <motion.header className="ld-sechead" variants={rise} initial="hidden" whileInView="show" viewport={view}>
      <span className="ld-sechead__no mono" aria-hidden="true">
        {no}
      </span>
      <span className="ld-sechead__kicker mono">{kicker}</span>
      <h2 className="ld-sechead__title" id={id}>
        {title}
      </h2>
    </motion.header>
  );
}

/** Printer's registration mark, in the hero's corners. */
function RegMark({ className }: { className: string }) {
  return (
    <svg className={`ld-reg ${className}`} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="9" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M20 2v36M2 20h36" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function Hero({ collabOpen, gamePublic, wlOpen, sound }: { collabOpen: boolean; gamePublic: boolean; wlOpen: boolean; sound: ReturnType<typeof useLandingSound> }) {
  const reduced = useReducedMotion();
  const copy = useRef<HTMLDivElement>(null);
  const avoid = useCallback(() => copy.current?.getBoundingClientRect() ?? null, []);
  return (
    <section className="ld-hero" aria-labelledby="ld-hero-title">
      <CoinPond still={reduced} avoid={avoid} events={{ onEat: sound.chomp }} />
      <RegMark className="ld-reg--tl" />
      <RegMark className="ld-reg--tr" />
      <RegMark className="ld-reg--bl" />
      <RegMark className="ld-reg--br" />
      <div className="ld-hero__copy" ref={copy}>
        <p className="ld-hero__kicker mono">On-chain coin arenas · Solana · 5-minute rounds</p>
        <h1 id="ld-hero-title" className="ld-hero__title">
          <Wordmark size="xl" live={!reduced} />
        </h1>
        <p className="ld-hero__tag">
          <span>Eat.</span> <span>Grow.</span> <span className="ld-hero__tag-hi">Last the round.</span>
        </p>
        <div className="ld-hero__ctas">
          <Link href="/wl" className="ld-btn ld-btn--pink" onClick={sound.click}>
            <span>Join the WL</span>
            <Icon name="arrow" size={22} />
          </Link>
          {collabOpen ? (
            <Link href="/collab" className="ld-btn ld-btn--paper" onClick={sound.click}>
              <span>Collab</span>
              <Icon name="users" size={20} />
            </Link>
          ) : (
            <Link href="/collab" className="ld-btn ld-btn--paper is-soon" onClick={sound.click} aria-label="Collab, soon">
              <span>Collab</span>
              <span className="ld-soon mono">Soon</span>
            </Link>
          )}
          {gamePublic && (
            <a href="/play" className="ld-btn ld-btn--ink" onClick={sound.click}>
              <Icon name="play" size={20} />
              <span>Play</span>
            </a>
          )}
        </div>
        <p className="ld-hero__note mono">{wlOpen ? 'WL is open · signing in is free, no transaction' : 'WL is closed for now · follow @slanaio'}</p>
        <Stamp className="ld-hero__stamp" text={wlOpen ? 'WL open' : 'WL soon'} sub="slana.io" tone={wlOpen ? 'pink' : 'teal'} round size="md" rotate={-12} animateIn={!reduced} delay={0.9} />
      </div>
      <div className="ld-hero__foot">
        <span className="ld-hero__edition mono">No. 001 · Autumn 2026 · Tap the paper to feed them</span>
        <button type="button" className="ld-sound mono" aria-pressed={sound.on} onClick={sound.toggle}>
          <Icon name={sound.on ? 'sound' : 'mute'} size={18} />
          <span>Sound {sound.on ? 'on' : 'off'}</span>
        </button>
      </div>
    </section>
  );
}

const FACTS: { big: string; label: string; body: string; tone: string }[] = [
  { big: '5:00', label: 'Minutes a round', body: 'Short rounds on a wall clock. Every arena rings its bell on time.', tone: 'pink' },
  { big: 'SOL', label: 'Arenas on Solana', body: 'Tickets and payouts settle on-chain, in the open.', tone: 'teal' },
  { big: 'Bell', label: 'Alive is paid', body: 'Everyone still on the paper at the bell is paid their till.', tone: 'mustard' },
];

function What() {
  return (
    <section className="ld-sec ld-what" aria-labelledby="ld-what-h" id="what">
      <SectionHead no="01" kicker="What it is" title="Coins that eat coins." id="ld-what-h" />
      <div className="ld-what__grid">
        <motion.p className="ld-lede" variants={rise} initial="hidden" whileInView="show" viewport={view} custom={1}>
          Slana is a cute arena game with an on-chain heart. You are a jelly coin on a sheet of riso paper. Eat confetti and smaller coins to grow, slip
          away from the bigger ones, and still be on the paper when the bell rings.
        </motion.p>
        <ul className="ld-facts">
          {FACTS.map((f, i) => (
            <motion.li key={f.label} className={`ld-fact ld-fact--${f.tone}`} variants={rise} initial="hidden" whileInView="show" viewport={view} custom={i + 1}>
              <span className="ld-fact__big" aria-hidden="true">
                {f.big}
              </span>
              <strong className="ld-fact__label">{f.label}</strong>
              <span className="ld-fact__body">{f.body}</span>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ── the round, as a strip of tickets ─────────────────────────────── */

function ArtTicket() {
  return (
    <svg viewBox="0 0 120 80" aria-hidden="true">
      <rect x="14" y="16" width="92" height="48" rx="6" fill="var(--teal)" transform="translate(4 4)" />
      <rect x="14" y="16" width="92" height="48" rx="6" fill="var(--card)" stroke="var(--ink)" strokeWidth="2.5" />
      <path d="M78 16v48" stroke="var(--ink)" strokeWidth="2" strokeDasharray="3 4" />
      <circle className="ld-art-punch" cx="92" cy="40" r="7" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2.5" />
      <path d="M26 32h38M26 42h28M26 52h20" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
function ArtEat() {
  return (
    <svg viewBox="0 0 120 80" aria-hidden="true">
      <circle cx="94" cy="40" r="9" fill="var(--mustard)" stroke="var(--ink)" strokeWidth="2.5" className="ld-art-snack" />
      <g className="ld-art-chomp">
        <circle cx="50" cy="44" r="26" fill="var(--teal)" transform="translate(3 3)" />
        <path d="M50 18a26 26 0 1 0 22.5 13L50 44l22.5 13A26 26 0 0 0 50 18z" fill="var(--pink)" stroke="var(--ink)" strokeWidth="2.5" className="ld-art-mouth" />
        <circle cx="48" cy="32" r="3.4" fill="var(--ink)" />
      </g>
    </svg>
  );
}
function ArtBell() {
  return (
    <svg viewBox="0 0 120 80" aria-hidden="true">
      <g className="ld-art-bell">
        <path d="M60 12c-14 0-22 11-22 26v12l-7 9h58l-7-9V38c0-15-8-26-22-26z" fill="var(--mustard)" transform="translate(3 3)" />
        <path d="M60 12c-14 0-22 11-22 26v12l-7 9h58l-7-9V38c0-15-8-26-22-26z" fill="var(--card)" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" />
        <circle cx="60" cy="66" r="6" fill="var(--ink)" />
      </g>
      <path d="M22 26l-8-4M22 40H12M98 26l8-4M98 40h10" stroke="var(--pink)" strokeWidth="3" strokeLinecap="round" className="ld-art-ring" />
    </svg>
  );
}
function ArtPaid() {
  return (
    <svg viewBox="0 0 120 80" aria-hidden="true">
      <path d="M34 8h52v62l-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5L34 70z" fill="var(--pink)" transform="translate(4 3)" />
      <path d="M34 8h52v62l-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5L34 70z" fill="var(--card)" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M44 22h32M44 32h22M44 46h32" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="74" cy="56" r="8" fill="var(--mustard)" stroke="var(--ink)" strokeWidth="2.5" className="ld-art-coin" />
    </svg>
  );
}

const STEPS: { no: string; title: string; body: string; stamp: string; tone: 'pink' | 'teal' | 'mustard' | 'ink'; art: ReactNode }[] = [
  { no: '01', title: 'Buy a ticket', body: 'Pick an arena and punch a ticket. The entry is the value your coin carries in.', stamp: 'Punched', tone: 'teal', art: <ArtTicket /> },
  { no: '02', title: 'Eat', body: 'Swallow confetti and smaller coins. Whatever they carried is now in your till.', stamp: 'Nom', tone: 'pink', art: <ArtEat /> },
  { no: '03', title: 'The bell', body: 'Five minutes on the clock. Dodge the big ones until it rings.', stamp: 'Ding', tone: 'mustard', art: <ArtBell /> },
  { no: '04', title: 'Paid', body: 'Every coin still alive at the bell is paid its till, settled on Solana.', stamp: 'Paid', tone: 'ink', art: <ArtPaid /> },
];

function Round() {
  const reduced = useReducedMotion();
  return (
    <section className="ld-sec ld-round" aria-labelledby="ld-round-h" id="round">
      <SectionHead no="02" kicker="How a round works" title={<>Four tickets, one round.</>} id="ld-round-h" />
      <motion.ol className="ld-strip" initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }}>
        {STEPS.map((s, i) => (
          <motion.li
            key={s.no}
            className="ld-tix"
            variants={{
              hidden: { opacity: 0, x: 60, rotate: 2 },
              show: { opacity: 1, x: 0, rotate: i % 2 ? 0.8 : -0.8, transition: { type: 'spring', stiffness: 220, damping: 22, delay: i * 0.18 } },
            }}
          >
            <div className="ld-tix__art">{s.art}</div>
            <div className="ld-tix__body">
              <span className="ld-tix__no mono">Step {s.no}</span>
              <h3 className="ld-tix__title">{s.title}</h3>
              <p className="ld-tix__text">{s.body}</p>
            </div>
            <span className="ld-tix__stub mono" aria-hidden="true">
              Admit one · {s.no}
            </span>
            <motion.span
              className="ld-tix__stamp"
              variants={{
                hidden: { opacity: 0, scale: reduced ? 1 : 1.6 },
                show: { opacity: 1, scale: 1, transition: { delay: 0.35 + i * 0.18, type: 'spring', stiffness: 600, damping: 16 } },
              }}
            >
              <Stamp text={s.stamp} tone={s.tone} size="md" rotate={i % 2 ? 7 : -9} />
            </motion.span>
          </motion.li>
        ))}
      </motion.ol>
      <p className="ld-round__foot mono">The arena opens soon · follow @slanaio for the first bell</p>
    </section>
  );
}

/* ── the coins ────────────────────────────────────────────────────── */

const LOOKS = BASIC_SKINS.map((s) => ({ id: s.id, name: s.name, desc: s.desc, look: lookForBasicSkin(s.id) }));

function Coins() {
  const reduced = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  return (
    <section className="ld-sec ld-coins" aria-labelledby="ld-coins-h" id="coins">
      <SectionHead no="03" kicker="The coins" title="Meet the pond." id="ld-coins-h" />
      <ul className="ld-gallery">
        {LOOKS.map((c, i) => (
          <motion.li
            key={c.id}
            className="ld-coin"
            style={{ ['--coin-ink' as string]: c.look.body, ['--coin-over' as string]: c.look.overprint }}
            variants={rise}
            initial="hidden"
            whileInView="show"
            viewport={view}
            custom={i % 4}
            onPointerEnter={() => setHover(c.id)}
            onPointerLeave={() => setHover(null)}
          >
            <div className="ld-coin__plate">
              <CoinArt look={c.look} size={176} still={reduced} seed={i * 3 + 1} expression={hover === c.id ? 'love' : i === 5 ? 'sleep' : 'happy'} className="ld-coin__art" />
            </div>
            <span className="ld-coin__no mono">No. {String(c.id + 1).padStart(2, '0')}</span>
            <strong className="ld-coin__name">{c.name}</strong>
            <span className="ld-coin__desc">{c.desc}</span>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}

/* ── the NFT teaser ───────────────────────────────────────────────── */

function SealedCard({ i }: { i: number }) {
  return (
    <motion.div
      className={`ld-sealed ld-sealed--${i}`}
      variants={{
        hidden: { opacity: 0, y: 60, rotate: 0 },
        show: { opacity: 1, y: 0, rotate: [-7, 2, 8][i], transition: { type: 'spring', stiffness: 160, damping: 18, delay: 0.15 + i * 0.12 } },
      }}
    >
      <div className="ld-sealed__inner">
        <div className="ld-sealed__face">
          <span className="ld-sealed__q" aria-hidden="true">
            ?
          </span>
          <span className="ld-sealed__no mono">Card {String(i + 1).padStart(3, '0')} / ???</span>
        </div>
        <span className="ld-sealed__band mono" aria-hidden="true">
          Sealed · do not open
        </span>
        <span className="ld-sealed__seal" aria-hidden="true">
          <Stamp text="Sealed" tone={i === 1 ? 'mustard' : 'pink'} round size="sm" rotate={-14 + i * 9} />
        </span>
      </div>
    </motion.div>
  );
}

function Nft() {
  return (
    <section className="ld-nft" aria-labelledby="ld-nft-h" id="nft">
      <div className="ld-nft__inner">
        <motion.div className="ld-nft__copy" variants={rise} initial="hidden" whileInView="show" viewport={view}>
          <span className="ld-nft__kicker mono">04 · On the press</span>
          <h2 className="ld-nft__title" id="ld-nft-h">
            Slana NFT
            <span className="ld-nft__soon mono">Coming soon</span>
          </h2>
          <p className="ld-nft__text">
            The first Slana collection is still on the press. WL holders and collab communities get first access to the mint. The date lands on @slanaio
            first.
          </p>
          <div className="ld-nft__ctas">
            <Link href="/wl" className="ld-btn ld-btn--pink">
              <span>Join the WL</span>
              <Icon name="arrow" size={22} />
            </Link>
            <a href={X_URL} target="_blank" rel="noreferrer" className="ld-btn ld-btn--ghost">
              <XIcon size={18} />
              <span>Follow @slanaio</span>
            </a>
          </div>
        </motion.div>
        <motion.div className="ld-nft__cards" initial="hidden" whileInView="show" viewport={view}>
          {[0, 1, 2].map((i) => (
            <SealedCard key={i} i={i} />
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* ── FAQ ──────────────────────────────────────────────────────────── */

const FAQ: { q: string; a: ReactNode }[] = [
  { q: 'What is Slana?', a: 'A cute arena game where coins eat coins, with arenas, tickets and payouts on Solana. Rounds last five minutes.' },
  {
    q: 'Can I play now?',
    a: (
      <>
        Not yet. The arena opens soon, and the launch lands on <a href={X_URL} target="_blank" rel="noreferrer">@slanaio</a> first. The player guide is
        already up at <Link href="/docs">slana.io/docs</Link>.
      </>
    ),
  },
  { q: 'What is the WL?', a: 'The allowlist for the Slana NFT mint. A few short tasks on X, your handle and your Solana wallet. Every entry is checked by hand.' },
  { q: 'Does signing in cost anything?', a: 'No. You sign one message with your wallet to prove it is yours. It is free and sends no transaction.' },
  {
    q: 'How do collabs work?',
    a: (
      <>
        DAOs, guilds, alpha groups and NFT projects can apply for WL spots to raffle to their members. Approved communities get spots, a deadline and a
        page to add their winners. <Link href="/collab">Read more on the collab page</Link>.
      </>
    ),
  },
  { q: 'When is the mint?', a: 'Soon. The date, the price and the supply are posted on @slanaio first. We never DM first and never ask for a seed phrase.' },
];

function Faq() {
  return (
    <section className="ld-sec ld-faq" aria-labelledby="ld-faq-h" id="faq">
      <SectionHead no="05" kicker="Questions" title="Small print." id="ld-faq-h" />
      <div className="ld-faq__list">
        {FAQ.map((f, i) => (
          <motion.details key={f.q} className="ld-qa" variants={rise} initial="hidden" whileInView="show" viewport={view} custom={i % 3}>
            <summary className="ld-qa__q">
              <span className="ld-qa__no mono" aria-hidden="true">
                Q{i + 1}
              </span>
              <span>{f.q}</span>
              <span className="ld-qa__plus" aria-hidden="true" />
            </summary>
            <div className="ld-qa__a">{f.a}</div>
          </motion.details>
        ))}
      </div>
    </section>
  );
}

function Closing({ collabOpen }: { collabOpen: boolean }) {
  return (
    <section className="ld-close" aria-labelledby="ld-close-h">
      <motion.div className="ld-close__ticket" variants={rise} initial="hidden" whileInView="show" viewport={view}>
        <div className="ld-close__main">
          <span className="mono ld-close__kicker">Admit one · the first round</span>
          <h2 className="ld-close__title" id="ld-close-h">
            Get on the list.
          </h2>
          <p className="ld-close__text">Five short steps, one free signature. Your own riso ticket card comes with it.</p>
        </div>
        <div className="ld-close__stub">
          <Link href="/wl" className="ld-btn ld-btn--pink">
            <span>Join the WL</span>
            <Icon name="arrow" size={22} />
          </Link>
          <Link href="/collab" className="ld-close__collab mono">
            {collabOpen ? 'Bring your community' : 'Collabs open soon'}
          </Link>
        </div>
      </motion.div>
    </section>
  );
}

/** `/`: the slana.io landing. No way into the game unless the game is public. */
export function Landing() {
  const { settings } = useSiteSettings();
  const sound = useLandingSound();
  return (
    <Kb theme="paper" className="st-root ld-root">
      <a className="st-skip" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="ld-main" tabIndex={-1}>
        <Hero collabOpen={settings.collabOpen} gamePublic={settings.gamePublic} wlOpen={settings.wlOpen} sound={sound} />
        <What />
        <Round />
        <Coins />
        <Nft />
        <Faq />
        <Closing collabOpen={settings.collabOpen} />
      </main>
      <SiteFooter />
    </Kb>
  );
}
