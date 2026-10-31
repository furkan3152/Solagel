import { DEFAULT_ARENAS, arenaMeta, type GameAccess } from '@elymum/shared';
import { motion, useInView } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  CoinCharacter,
  FoodBit,
  Icon,
  Kb,
  OrbitDots,
  PlateLabel,
  RingScene,
  Seigaiha,
  Stamp,
  StatusPill,
  Sticker,
  Wordmark,
  useMoves,
  useReducedMotion,
  type CoinMood,
  type CoinPaint,
} from '../../design';
import { FACTS } from '../../ui/docs/facts';
import { usePeelLetters } from '../peel';
import { Link } from '../router';
import { SiteFooter, SiteHeader, SiteLinkButton } from '../Shell';
import { useSiteSettings, xProfile } from '../settings';
import { ArenaTram } from './ArenaTram';
import { CoinPond } from './CoinPond';
import { DuskSeam } from './DuskSeam';
import { GazeCoin } from './GazeCoin';
import { SeedRail } from './SeedRail';
import { useLandingSound } from './sound';
import './landing.css';

/** The game token's display symbol (server `TOKEN_SYMBOL`; the landing has no chain status). */
const SYMBOL = '$ELYMUM';
const view = { once: true, amount: 0.3 } as const;
const nf = new Intl.NumberFormat('en-US');
const pct = (bps: number) => `${bps / 100}%`;

/* ── Plate I · the plain at dawn ──────────────────────────────────────── */

function Hero({ collabOpen, gameAccess, wlOpen, sound }: { collabOpen: boolean; gameAccess: GameAccess; wlOpen: boolean; sound: ReturnType<typeof useLandingSound> }) {
  const reduced = useReducedMotion();
  const m = useMoves();
  const peel = usePeelLetters<HTMLHeadingElement>();
  return (
    <section className="ld-hero" aria-labelledby="ld-hero-title">
      <RingScene time="dawn" variant="full" animate={!reduced} className="ld-hero__ring">
        <div className="ld-hero__inner">
          <motion.div className="ld-hero__drop" variants={m.stickerDrop} custom={-1.6} initial="hidden" animate="shown">
            <Sticker pad="lg" lift="lg" tape className="ld-hero__card">
              <p className="kicker ld-hero__kicker">A five-minute feast · on Elysium</p>
              <h1 id="ld-hero-title" ref={peel.ref} className={`ld-hero__title ${peel.className}`}>
                <Wordmark height={104} playful={!reduced} className="ld-hero__mark" />
              </h1>
              <p className="ld-hero__tag">You are small change with a big appetite.</p>
              <p className="ld-hero__lede">
                Eat the food. Eat coins smaller than you. Run from the ones that are bigger. Five minutes later the bell rings and whatever you&rsquo;ve swallowed is
                yours.
              </p>
              <p className="ld-hero__homer">
                <i className="quote">&ldquo;No snow is there, nor heavy storm, nor ever rain.&rdquo;</i>
                <br />
                Homer, on the Elysian plain. He didn&rsquo;t mention lunch.
              </p>
              <div className="ld-hero__ctas">
                <SiteLinkButton href="/wl" variant="primary" icon="arrow" onClick={sound.click}>
                  Join the WL
                </SiteLinkButton>
                {collabOpen ? (
                  <SiteLinkButton href="/collab" onClick={sound.click}>
                    Collab
                  </SiteLinkButton>
                ) : (
                  <Link href="/collab" className="kb-btn kb-btn--secondary kb-btn--md st-btn ld-soon" onClick={sound.click} aria-label="Collab, soon">
                    <span className="kb-btn__label">
                      <span className="kb-btn__text">Collab</span>
                    </span>
                    <span className="ld-soon__tag mono">Soon</span>
                  </Link>
                )}
                {gameAccess !== 'admins' && (
                  <a href="/play" className="kb-btn kb-btn--teal kb-btn--md st-btn" onClick={sound.click}>
                    <Icon name="play" size={20} className="kb-btn__lead" />
                    <span className="kb-btn__label">
                      <span className="kb-btn__text">{gameAccess === 'holders' ? 'Play (holders)' : 'Play'}</span>
                    </span>
                  </a>
                )}
              </div>
              <p className="ld-hero__note mono">
                <span className="ld-flowline">WL → Mint → Play</span>
                <span>{wlOpen ? 'WL is open · signing is free' : 'WL is closed for now'}</span>
              </p>
            </Sticker>
          </motion.div>
          <motion.div className="ld-hero__badge-wrap" variants={m.popIn} initial="hidden" animate="shown" transition={{ delay: 0.5 }}>
            <Sticker tone="sun" pad="sm" tilt={4} className="ld-hero__badge">
              <span className="num ld-hero__badge-n">05:00</span>
              <span className="mono ld-hero__badge-l">per round. Then lunch.</span>
            </Sticker>
          </motion.div>
        </div>
        <CoinPond still={reduced} events={{ onEat: sound.chomp }} />
        {!reduced && (
          <p className="ld-pond__hint mono" aria-hidden="true">
            Psst: tap a coin to feed it
          </p>
        )}
        <button type="button" className="ld-sound mono" aria-pressed={sound.on} onClick={sound.toggle}>
          <Icon name={sound.on ? 'sound' : 'mute'} size={16} />
          <span>Sound {sound.on ? 'on' : 'off'}</span>
        </button>
      </RingScene>
    </section>
  );
}

/* ── Plate II · the feast ─────────────────────────────────────────────── */

function MenuLine({ art, dish, note, price }: { art: ReactNode; dish: string; note: string; price: string }) {
  return (
    <li className="ld-menu__line">
      <span className="ld-menu__art" aria-hidden="true">
        {art}
      </span>
      <span className="ld-menu__dish">
        <strong>{dish}</strong>
        <span className="ld-menu__note">{note}</span>
      </span>
      <span className="ld-menu__dots" aria-hidden="true" />
      <span className="ld-menu__price mono">{price}</span>
    </li>
  );
}

function Feast() {
  const m = useMoves();
  return (
    <section className="ld-plate ld-feast" id="feast" aria-labelledby="ld-feast-h">
      <PlateLabel numeral={2} title="The feast on Elysium" aside="What it is" />
      <div className="ld-wrap ld-feast__grid">
        <motion.div className="ld-feast__copy" variants={m.popIn} initial="hidden" whileInView="shown" viewport={view}>
          <p className="kicker">What Elymum is</p>
          <h2 className="ld-h2" id="ld-feast-h">
            On Elysium, everything is a <span className="wonk ld-ul">feast.</span> Including you.
          </h2>
          <p className="lede">
            Elymum is a coin-eats-coin arena on Elysium, Kinetiq&rsquo;s ring in orbit. You are a coin. Rounds run five minutes on the wall clock, every arena on the same
            bell. Eat food and smaller coins to grow; whatever you are worth at the bell is paid to your wallet in {SYMBOL}.
          </p>
          <ul className="ld-facts" aria-label="In numbers">
            <li>
              <b className="num">{FACTS.rules.roundMin}:00</b>
              <span className="mono">a round</span>
            </li>
            <li>
              <b className="num">{FACTS.capacity.arena}</b>
              <span className="mono">coins a room</span>
            </li>
            <li>
              <b className="num">{pct(FACTS.fee.bps)}</b>
              <span className="mono">of profit, no more</span>
            </li>
          </ul>
        </motion.div>
        <motion.div className="ld-feast__menu-wrap" variants={m.stickerDrop} custom={1.2} initial="hidden" whileInView="shown" viewport={view}>
          <Sticker tone="white" pad="lg" lift="lg" className="ld-menu">
            <header className="ld-menu__head">
              <span className="kicker">Menu · served every five minutes</span>
              <h3 className="ld-menu__title">Today on the plain</h3>
            </header>
            <ul className="ld-menu__list">
              <MenuLine art={<FoodBit kind="pear" size={44} />} dish="Pears" note="Ripe, slow, everywhere." price="a bite" />
              <MenuLine art={<FoodBit kind="grapes" size={44} />} dish="Grapes" note="They glow a little after dark." price="a mouthful" />
              <MenuLine art={<FoodBit kind="seed" size={34} paint="up" />} dish="Seeds" note="Crunchy. Count as food, not as friends." price="a crumb" />
              <MenuLine art={<CoinCharacter paint="foam" mood="scared" size={46} />} dish="Coins smaller than you" note="Their whole till comes with them." price="market price" />
              <MenuLine art={<CoinCharacter paint="sun" mood="smug" size={46} />} dish="Coins bigger than you" note="Not on the menu. You are." price="sold out" />
            </ul>
            <footer className="ld-menu__foot">
              <span className="mono">Service ends at the bell. Leftovers are burned.</span>
              <Stamp text="Chef's pick" tone="teal" size="sm" rotate={-9} className="ld-menu__stamp" />
            </footer>
          </Sticker>
        </motion.div>
      </div>
    </section>
  );
}

/* ── Plate III · a round, in orbit ────────────────────────────────────── */

const STATIONS: { no: string; title: string; body: string }[] = [
  { no: '01', title: 'Ticket', body: `Pick an arena and buy a ticket in ${SYMBOL}. Two signatures at most: an exact approval, then the ticket.` },
  { no: '02', title: 'Eat', body: 'Food makes you bigger. Smaller coins make you richer: their whole till moves into yours.' },
  { no: '03', title: 'Bell', body: `Every five minutes, in every arena at once. Joins close ${FACTS.rules.joinCloseS} seconds before it rings.` },
  { no: '04', title: 'Paid', body: `Alive at the bell? Your till goes to your wallet, minus ${pct(FACTS.fee.bps)} of the profit. Eaten? Someone else says thanks.` },
];

function Round() {
  const m = useMoves();
  return (
    <section className="ld-plate ld-round" id="round" aria-labelledby="ld-round-h">
      <PlateLabel numeral={3} title="A round, in orbit" aside="05:00 a lap" />
      <div className="ld-wrap ld-round__grid">
        <motion.div className="ld-round__orbit-wrap" variants={m.stickerDrop} custom={-0.8} initial="hidden" whileInView="shown" viewport={view}>
          <Sticker tone="night" pad="none" lift="lg" round="lg" className="ld-orbit">
            <span className="ld-orbit__tag kb-tag">Round 418 · in progress</span>
            <OrbitDots
              width={640}
              height={330}
              coins={4}
              duration={20}
              tone="night"
              className="ld-orbit__svg"
              title="A round as an orbit: ticket, eat, bell, paid"
              stations={[
                { at: 0, label: 'Ticket', done: true },
                { at: 0.25, label: 'Eat', done: true },
                { at: 0.5, label: 'Bell' },
                { at: 0.75, label: 'Paid' },
              ]}
            />
            <span className="ld-orbit__core" aria-hidden="true">
              <GazeCoin paint="sun" mood="chomp" size={112} look={[2, 1]} reach={0.7} />
            </span>
            <Seigaiha tone="night" rows={2} r={30} className="ld-orbit__waves" />
          </Sticker>
        </motion.div>
        <div className="ld-round__copy">
          <p className="kicker">How a round goes</p>
          <h2 className="ld-h2" id="ld-round-h">
            One lap, four stops, then lunch.
          </h2>
          <ol className="ld-stops">
            {STATIONS.map((s, i) => (
              <motion.li key={s.no} className="ld-stop" variants={m.popIn} initial="hidden" whileInView="shown" viewport={view} transition={{ delay: i * 0.08 }}>
                <span className="ld-stop__no num" aria-hidden="true">
                  {s.no}
                </span>
                <span className="ld-stop__text">
                  <strong className="ld-stop__title">{s.title}</strong>
                  <span>{s.body}</span>
                </span>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ── Plate IV · the cast ──────────────────────────────────────────────── */

const CAST: { handle: string; paint: CoinPaint; mood: CoinMood; size: number; worth: string; bio: string; look: [number, number]; sweat?: boolean }[] = [
  { handle: 'nibbler', paint: 'foam', mood: 'scared', size: 64, worth: '$0.71', bio: 'Small, fast, mostly worried.', look: [3, -1], sweat: true },
  { handle: 'gm_crumbs', paint: 'cream', mood: 'happy', size: 92, worth: '$2.41', bio: 'Says gm to everyone. Eats some of them.', look: [0, 0] },
  { handle: 'big_aurelius', paint: 'sun', mood: 'smug', size: 176, worth: '$9.80', bio: 'Has eaten forty-one coins. Mentions it.', look: [2, 0] },
  { handle: 'obol', paint: 'spray', mood: 'sleepy', size: 82, worth: '$1.30', bio: 'Plays the long game. Very long.', look: [0, 0] },
  { handle: 'lethe.hl', paint: 'teal', mood: 'open', size: 132, worth: '$6.12', bio: 'Forgot what it was doing. Still hungry.', look: [-2, 1] },
  { handle: 'chompers', paint: 'coral', mood: 'chomp', size: 112, worth: '$4.37', bio: 'Knows one move. It works.', look: [-3, 1] },
  { handle: 'penny_pincher', paint: 'up', mood: 'smile', size: 100, worth: '$3.05', bio: 'Counts every seed. Out loud.', look: [-3, 0] },
];

function Cast() {
  const m = useMoves();
  return (
    <section className="ld-plate ld-cast" id="cast" aria-labelledby="ld-cast-h">
      <PlateLabel numeral={4} title="The cast" aside="Sizes are worth, not age" />
      <div className="ld-wrap">
        <div className="ld-cast__head">
          <div>
            <p className="kicker">The line-up</p>
            <h2 className="ld-h2" id="ld-cast-h">
              Usual suspects of the plain.
            </h2>
          </div>
          <p className="ld-cast__aside">
            Every coin wears a face and a mood. A coin&rsquo;s size is what it carries: the bigger it stands, the more it is worth, and the more everyone else looks at it
            like lunch.
          </p>
        </div>
        <div className="ld-lineup">
          <div className="ld-lineup__chart" aria-hidden="true">
            {['$10', '$5', '$1'].map((v) => (
              <span key={v} className="ld-lineup__mark mono">
                {v}
              </span>
            ))}
          </div>
          <motion.ul className="ld-lineup__list" variants={m.stagger} initial="hidden" whileInView="shown" viewport={view}>
            {CAST.map((c, i) => (
              <motion.li key={c.handle} className="ld-suspect" variants={m.popIn} style={{ ['--i' as string]: i } as CSSProperties}>
                <span className="ld-suspect__stand">
                  <span className="ld-suspect__tag kb-tag">
                    {c.handle} <b className="num">{c.worth}</b>
                  </span>
                  <span className="ld-suspect__coin">
                    <GazeCoin paint={c.paint} mood={c.mood} size={c.size} look={c.look} sweat={c.sweat} wary={c.mood === 'scared'} feet ground bob phase={i * 0.37} title={`${c.handle}, ${c.mood}`} />
                  </span>
                </span>
                <span className="ld-suspect__bio">{c.bio}</span>
              </motion.li>
            ))}
          </motion.ul>
        </div>
      </div>
    </section>
  );
}

/* ── Plate V · the mint, after dark ───────────────────────────────────── */

/** The three sealed emblems of the fan: which paint each wears and the slot it starts in. */
const EMBLEMS: { paint: CoinPaint; tilt: number }[] = [
  { paint: 'cyan', tilt: -8 },
  { paint: 'sun', tilt: -1.5 },
  { paint: 'up', tilt: 7 },
];
const SLOTS = ['left', 'front', 'right'] as const;

function Emblem({ paint, front, waking }: { paint: CoinPaint; front: boolean; waking: boolean }) {
  return (
    <div className={`ld-emblem${front ? ' is-front' : ''}`}>
      <div className="ld-emblem__panel">
        <Seigaiha tone="ink" rows={5} r={26} span={360} filled={false} className="ld-emblem__waves" />
        <span className="ld-emblem__no kb-tag num">No. ????</span>
        <span className="ld-emblem__coin">
          <CoinCharacter paint={paint} mood={!front ? 'sleepy' : waking ? 'open' : 'smug'} size={150} look={waking ? [3, -3] : [2, 0]} bob={front} />
        </span>
        <Stamp text="Sealed" tone="ink" size="sm" rotate={-12} className="ld-emblem__stamp" />
      </div>
      <span className="ld-emblem__rib">Sealed. For now.</span>
    </div>
  );
}

/**
 * The fan of sealed emblems shuffles itself like a hand of cards while it is on screen (every
 * 4.6 s, not while the visitor hovers it): the front card slides off to a side and tucks behind,
 * a side card comes forward and its sleepy coin wakes up and peeks out. The sticker button deals
 * the next card at once. Reduced motion: no automatic shuffle; the button still deals (no tween).
 */
function EmblemFan() {
  const m = useMoves();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const [turn, setTurn] = useState(0);
  const [hold, setHold] = useState(false);
  const [waking, setWaking] = useState(false);
  const deal = () => {
    setTurn((t) => t + 1);
    setWaking(true);
  };
  useEffect(() => {
    if (!waking) return;
    const t = setTimeout(() => setWaking(false), 1300);
    return () => clearTimeout(t);
  }, [waking, turn]);
  useEffect(() => {
    if (reduced || !inView || hold) return;
    const t = setInterval(deal, 4600);
    return () => clearInterval(t);
  }, [reduced, inView, hold]);
  return (
    <motion.div
      ref={ref}
      className="ld-nft__fan"
      initial="hidden"
      whileInView="shown"
      viewport={view}
      variants={m.stagger}
      onPointerEnter={() => setHold(true)}
      onPointerLeave={() => setHold(false)}
    >
      {EMBLEMS.map((e, i) => {
        const slot = SLOTS[(i + turn) % 3];
        return (
          <div key={e.paint} className="ld-fan__card" data-slot={slot}>
            <motion.div variants={m.stickerDrop} custom={0}>
              <Emblem paint={e.paint} front={slot === 'front'} waking={slot === 'front' && waking} />
            </motion.div>
          </div>
        );
      })}
      <motion.div className="ld-price" variants={m.popIn}>
        <span className="num ld-price__n">$1.00</span>
        <span className="mono ld-price__l">in HYPE · each</span>
      </motion.div>
      <motion.button type="button" className="ld-fan__deal mono" onClick={deal} variants={m.popIn}>
        Shuffle the deck
      </motion.button>
    </motion.div>
  );
}

function Nft() {
  const m = useMoves();
  return (
    <section className="ld-plate ld-nft" id="nft" aria-labelledby="ld-nft-h">
      <PlateLabel numeral={5} title="The mint, after dark" aside="/mint" />
      <div className="ld-nft__body">
        <div className="ld-wrap ld-nft__grid">
          <motion.div className="ld-nft__copy" variants={m.popIn} initial="hidden" whileInView="shown" viewport={view}>
            <p className="kicker">Elymum NFT · sealed emblems</p>
            <h2 className="ld-h2 ld-nft__title" id="ld-nft-h">
              Your seat at the feast costs <em>one dollar.</em>
            </h2>
            <p className="ld-nft__text">
              An emblem is a sealed coin portrait and your way into the game when it opens for holders. The price is pinned to $1 and paid in HYPE, so the number on the
              button moves with the market. We do the arithmetic; you do the eating.
            </p>
            <ol className="ld-flow" aria-label="The order of things">
              <li className="is-on">
                <span>WL</span>
              </li>
              <li>
                <span>Mint</span>
              </li>
              <li>
                <span>Play</span>
              </li>
            </ol>
            <div className="ld-nft__ctas">
              <SiteLinkButton href="/wl" variant="primary" icon="arrow">
                Join the WL
              </SiteLinkButton>
              <SiteLinkButton href="/mint" variant="teal">
                See the mint
              </SiteLinkButton>
            </div>
          </motion.div>
          <EmblemFan />
        </div>
        <Seigaiha tone="night" rows={3} r={36} className="ld-nft__waves" />
      </div>
    </section>
  );
}

/* ── Plate VI · the four arenas ───────────────────────────────────────── */

const PLACES: Record<number, { line: string; x: number; y: number }> = {
  1: { line: 'Where everyone starts. Mostly flowers, some teeth.', x: 12, y: 152 },
  2: { line: 'Drink from the river and forget your last round. Handy.', x: 37, y: 57 },
  3: { line: 'Bring a golden bough. Or fifty thousand.', x: 63, y: 57 },
  4: { line: 'Heroes only. Heroes with a quarter of a million.', x: 88, y: 152 },
};

// where the tram pulls in, beside each place's pin and clear of the tickets
const STOPS_X = [17, 31, 57, 82];

function Arenas({ gameAccess }: { gameAccess: GameAccess }) {
  const m = useMoves();
  const reduced = useReducedMotion();
  const mapRef = useRef<HTMLDivElement>(null);
  const open = gameAccess === 'public' ? { tone: 'live' as const, text: 'Open now' } : gameAccess === 'holders' ? { tone: 'ok' as const, text: 'Open to emblem holders' } : { tone: 'idle' as const, text: 'Opens after the mint' };
  return (
    <section className="ld-plate ld-arenas" id="arenas" aria-labelledby="ld-arenas-h">
      <PlateLabel numeral={6} title="Four places on the ring" aside="Arenas" />
      <div className="ld-wrap">
        <div className="ld-arenas__head">
          <div>
            <p className="kicker">The arenas</p>
            <h2 className="ld-h2" id="ld-arenas-h">
              Pick a table. Same rules, bigger plates.
            </h2>
          </div>
          <div className="ld-arenas__aside">
            <StatusPill tone={open.tone}>{open.text}</StatusPill>
            <p>Entry fees are in {SYMBOL}. Practice is free and needs no wallet at all.</p>
          </div>
        </div>
        <div className="ld-map" ref={mapRef}>
          <svg className="ld-map__ring" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path d="M-20 290 C 180 -40, 820 -40, 1020 290" fill="none" className="ld-map__band" strokeWidth="34" />
            <path d="M-20 290 C 180 -40, 820 -40, 1020 290" fill="none" className="ld-map__edge" strokeWidth="3" />
            <path d="M-20 290 C 180 -40, 820 -40, 1020 290" fill="none" className="ld-map__lights" strokeWidth="5" strokeDasharray="2 20" strokeLinecap="round" />
          </svg>
          <ArenaTram stopsX={STOPS_X} places={mapRef} still={reduced} />
          <motion.ol className="ld-map__list" variants={m.stagger} initial="hidden" whileInView="shown" viewport={view}>
            {DEFAULT_ARENAS.map((a, i) => {
              const meta = arenaMeta(a.id);
              const p = PLACES[a.id];
              return (
                <motion.li
                  key={a.id}
                  className="ld-place"
                  variants={m.stickerDrop}
                  custom={i % 2 ? 1.2 : -1.2}
                  style={{ ['--x' as string]: `${p?.x ?? 50}%`, ['--y' as string]: `${p?.y ?? 50}px`, ['--ink-a' as string]: meta.ink, ['--ink-b' as string]: meta.inkTo ?? meta.ink } as CSSProperties}
                >
                  <span className="ld-place__pin" aria-hidden="true" />
                  <div className="ld-ticket">
                    <div className="ld-ticket__body">
                      <span className="ld-ticket__no mono">Arena {a.id}</span>
                      <h3 className="ld-ticket__name">{meta.name}</h3>
                      <p className="ld-ticket__line">{p?.line}</p>
                    </div>
                    <div className="ld-ticket__stub">
                      <b className="num ld-ticket__fee">{nf.format(a.entryTokens)}</b>
                      <span className="mono ld-ticket__unit">{SYMBOL}</span>
                      <span className="mono ld-ticket__unit">entry</span>
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </motion.ol>
          <div className="ld-map__here" aria-hidden="true">
            <span className="kb-tag">You, at 05:00</span>
            <CoinCharacter paint="cyan" mood="happy" size={84} feet ground bob />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Plate VII · small print ──────────────────────────────────────────── */

function Faq({ handle }: { handle: string }) {
  const m = useMoves();
  const items: { q: string; a: ReactNode }[] = [
    {
      q: 'Which wallet do I need?',
      a: 'Any EVM wallet: MetaMask, Rabby, or whatever your browser speaks. When a transaction needs Elysium, the site asks your wallet to add or switch to it.',
    },
    {
      q: 'What is Elysium?',
      a: "Kinetiq's chain: an Arbitrum Orbit L2 that settles to HyperEVM. In our pictures it is a ring in orbit with fields on the inside. In practice it is where the arenas, their vaults and the emblems live.",
    },
    { q: 'Why do I need HYPE?', a: 'HYPE is the gas token on Elysium. Every transaction you send costs a little of it, and the mint is paid in it too.' },
    {
      q: 'How is the mint $1?',
      a: 'The price is pinned to one US dollar and paid in HYPE at the current rate, so the HYPE figure moves a little with the market. The mint page shows both numbers before you sign.',
    },
    {
      q: 'When does the game open?',
      a: (
        <>
          After the mint: holders first. The date lands on{' '}
          <a href={xProfile(handle)} target="_blank" rel="noreferrer">
            @{handle}
          </a>{' '}
          before anywhere else. Until then, <Link href="/docs">the docs</Link> explain every rule.
        </>
      ),
    },
    { q: 'What does signing in cost?', a: 'Nothing. One message signature, no transaction. We never DM first and never ask for a seed phrase. Nobody should.' },
    {
      q: 'Can my community get WL spots?',
      a: (
        <>
          DAOs, guilds and NFT projects can apply for spots to hand out to their members. <Link href="/collab">The collab page</Link> has the details.
        </>
      ),
    },
  ];
  return (
    <section className="ld-plate ld-faq" id="faq" aria-labelledby="ld-faq-h">
      <PlateLabel numeral={7} title="Small print" aside="FAQ" />
      <div className="ld-wrap ld-faq__grid">
        <div className="ld-faq__side">
          <div>
            <p className="kicker">Questions</p>
            <h2 className="ld-h2" id="ld-faq-h">
              Small print, large font.
            </h2>
          </div>
          <span className="ld-faq__coin" aria-hidden="true">
            <GazeCoin paint="cream" mood="open" size={120} look={[3, -2]} feet ground bob />
          </span>
        </div>
        <div className="ld-faq__list">
          {items.map((f, i) => (
            <motion.details key={f.q} className="ld-qa" variants={m.popIn} initial="hidden" whileInView="shown" viewport={view}>
              <summary className="ld-qa__q">
                <span className="ld-qa__no num" aria-hidden="true">
                  Q{i + 1}
                </span>
                <span className="ld-qa__text">{f.q}</span>
                <span className="ld-qa__plus" aria-hidden="true" />
              </summary>
              <div className="ld-qa__a">{f.a}</div>
            </motion.details>
          ))}
        </div>
      </div>
    </section>
  );
}

/** `/`: the landing, a picture book from dawn into night. No way into the game unless the game is public. */
export function Landing() {
  const { settings } = useSiteSettings();
  const sound = useLandingSound();
  return (
    <Kb theme="paper" className="st-root ld-root">
      <a className="st-skip" href="#main">
        Skip to content
      </a>
      <SiteHeader>
        <SeedRail />
      </SiteHeader>
      <main id="main" className="ld-main" tabIndex={-1}>
        <PlateLabel numeral={1} title="The plain at dawn" aside="05:00 AM" className="ld-plate1" />
        <Hero collabOpen={settings.collabOpen} gameAccess={settings.gameAccess} wlOpen={settings.wlOpen} sound={sound} />
        <Feast />
        <Round />
        <Cast />
        <DuskSeam />
        <Kb theme="night" className="ld-night">
          <Nft />
          <Arenas gameAccess={settings.gameAccess} />
          <Faq handle={settings.xHandle.replace(/^@/, '')} />
        </Kb>
      </main>
      <SiteFooter />
    </Kb>
  );
}
