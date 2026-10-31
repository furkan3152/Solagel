import { ELYSIUM, SHADE, type ElysiumPaint } from '@elymum/shared';
import { motion } from 'motion/react';
import { StrictMode, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ICON_NAMES, Icon } from './icons';
import { Kb, type KbTheme } from './Kb';
import { useMoves } from './motion';
import { AddressChip } from './components/AddressChip';
import { ArcGauge } from './components/ArcGauge';
import { Button } from './components/Button';
import { Chip } from './components/Chip';
import { Countdown } from './components/Countdown';
import { Counter } from './components/Counter';
import { Dateline } from './components/Dateline';
import { Field } from './components/Field';
import { HypeAmount } from './components/HypeAmount';
import { InkButton } from './components/InkButton';
import { Skeleton, StampSpinner } from './components/Loading';
import { Modal, WalletPicker } from './components/Modal';
import { PlateLabel } from './components/PlateLabel';
import { QuantityStepper } from './components/QuantityStepper';
import { Receipt } from './components/Receipt';
import { Rule } from './components/Rule';
import { Stamp } from './components/Stamp';
import { StatusPill } from './components/StatusPill';
import { Stepper } from './components/Stepper';
import { Sticker } from './components/Sticker';
import { TabPanel, Tabs } from './components/Tabs';
import { Tape } from './components/Tape';
import { Ticket, TicketGroup, TicketStub } from './components/Ticket';
import { Toast, ToastViewport, type ToastItem } from './components/Toast';
import { TxPreview } from './components/TxPreview';
import { CoinCharacter, type CoinMood, type CoinPaint } from './motifs/CoinCharacter';
import { Cloud } from './motifs/Clouds';
import { FoodBit } from './motifs/FoodBits';
import { OrbitDots } from './motifs/OrbitDots';
import { RingScene, SceneProp } from './motifs/RingScene';
import { Seigaiha } from './motifs/Seigaiha';
import { CoinMark, Wordmark } from './motifs/Wordmark';
import './gallery.css';

type Theme = KbTheme;

/** The paints shown on the swatch plate, in book order. */
const PAINTS: { name: ElysiumPaint; note: string }[] = [
  { name: 'abyss', note: 'ink · outlines' },
  { name: 'trench', note: 'night page' },
  { name: 'reef', note: 'night cards' },
  { name: 'current', note: 'night lines' },
  { name: 'teal', note: 'water · buttons' },
  { name: 'cyan', note: 'light · focus' },
  { name: 'spray', note: 'night accents' },
  { name: 'foam', note: 'night text accents' },
  { name: 'mist', note: 'day tints · tape' },
  { name: 'plain', note: 'day page' },
  { name: 'linen', note: 'day surfaces' },
  { name: 'cream', note: 'sticker stock' },
  { name: 'sand', note: 'borders · the shore' },
  { name: 'stone', note: 'captions' },
  { name: 'sun', note: 'primary · money' },
  { name: 'up', note: 'gains · done' },
  { name: 'down', note: 'losses · danger' },
  { name: 'meadow', note: 'top terrace' },
  { name: 'clover', note: 'terrace' },
  { name: 'verdant', note: 'terrace' },
  { name: 'forest', note: 'trees' },
  { name: 'blush', note: 'cheeks' },
  { name: 'coral', note: 'roofs' },
];

const MOODS: CoinMood[] = ['smile', 'happy', 'smug', 'scared', 'chomp', 'sleepy', 'open'];
const COIN_PAINTS: CoinPaint[] = ['cyan', 'sun', 'teal', 'up', 'foam', 'cream', 'coral'];

export function startDesignGallery(root: HTMLElement): void {
  document.body.style.margin = '0';
  createRoot(root).render(
    <StrictMode>
      <Gallery />
    </StrictMode>,
  );
}

function Plate({ n, title, aside, children, className }: { n: number; title: string; aside?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`gal-plate${className ? ` ${className}` : ''}`}>
      <PlateLabel numeral={n} title={title} aside={aside} level={2} />
      <div className="gal-plate__body">{children}</div>
    </section>
  );
}

function Spec({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <figure className={`gal-spec${wide ? ' is-wide' : ''}`}>
      <figcaption className="gal-spec__label">{label}</figcaption>
      <div className="gal-spec__art">{children}</div>
    </figure>
  );
}

export function Gallery() {
  // `?gallery&theme=night` (or day / paper) pins the proof for screenshots.
  const [theme, setTheme] = useState<Theme>(() => {
    const q = new URLSearchParams(location.search).get('theme');
    if (q === 'night' || q === 'dark') return 'night';
    if (q === 'paper' || q === 'day' || q === 'light') return 'paper';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'night' : 'paper';
  });
  const night = theme === 'night';
  const time = night ? 'night' : 'dawn';
  const moves = useMoves();

  const [tab, setTab] = useState<'feast' | 'ring' | 'ledger'>('feast');
  const [room, setRoom] = useState<string | null>('lethe');
  const [qty, setQty] = useState(2);
  const [minted, setMinted] = useState(2614);
  const [sheet, setSheet] = useState(false);
  const [wallets, setWallets] = useState(false);
  const [busyWallet, setBusyWallet] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [deadline] = useState(() => Date.now() + (3 * 60 + 12) * 1000);
  const toastId = useRef(0);

  useEffect(() => {
    document.title = 'Elymum · Storybook proof';
  }, []);
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = night ? 'night' : 'light';
  }, [night]);

  const pushToast = (tone: ToastItem['tone']) => {
    const id = ++toastId.current;
    const copy = {
      info: { title: 'Price refreshed', message: 'HYPE/USD 46.94. One emblem is still a dollar.' },
      success: { title: 'Minted. Two of them.', message: 'They are in your wallet. Try not to eat them.' },
      error: { title: 'The wallet said no', message: 'Nothing was sent. Nothing was spent.' },
    }[tone ?? 'info'];
    setToasts((ts) => [...ts, { id, tone, ...copy }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 5200);
  };

  return (
    <Kb ref={rootRef} theme={theme} className="gal">
      {/* ── masthead ── */}
      <header className="gal-head">
        <div className="gal-head__brand">
          <CoinMark size={52} title="Elymum" />
          <div>
            <div className="kicker">Design system · Ring Storybook</div>
            <h1 className="gal-head__title display">The proof sheet</h1>
          </div>
        </div>
        <div className="gal-head__tools" role="group" aria-label="Theme">
          <Chip tone="ink" icon="sun" selected={!night} onClick={() => setTheme('paper')}>
            Day
          </Chip>
          <Chip tone="ink" icon="moon" selected={night} onClick={() => setTheme('night')}>
            Night
          </Chip>
        </div>
      </header>

      {/* ── I: the ring ── */}
      <Plate n={1} title={night ? 'The plain, after dark' : 'The plain at dawn'} aside="RingScene · full">
        <RingScene time={time} className="gal-hero">
          <div className="gal-hero__inner">
            <Sticker pad="lg" tilt={-1.6} tape className="gal-hero__card">
              <div className="kicker">A five-minute feast · on Elysium</div>
              <Wordmark height={104} className="gal-hero__mark" />
              <h2 className="gal-hero__h">You are small change with a big appetite.</h2>
              <p className="gal-hero__lede">
                Eat the food. Eat coins smaller than you. Run from the ones that are bigger. Five minutes later the bell rings and
                whatever you&rsquo;ve swallowed is yours.
              </p>
              <p className="gal-hero__homer">
                <i className="quote">&ldquo;No snow is there, nor heavy storm, nor ever rain.&rdquo;</i>
                <br />
                Homer, on the Elysian plain. He didn&rsquo;t mention lunch.
              </p>
              <div className="gal-hero__ctas">
                <Button variant="primary" icon="arrow">
                  Join the WL
                </Button>
                <Button>Collab</Button>
                <span className="gal-hero__flow mono">WL → Mint → Play</span>
              </div>
            </Sticker>
            <Sticker tone="sun" pad="sm" tilt={4} className="gal-hero__badge">
              <div className="num gal-hero__badge-n">05:00</div>
              <div className="mono gal-hero__badge-l">per round. Then lunch.</div>
            </Sticker>
          </div>
          <div className="gal-pond" aria-hidden="true">
            <CoinCharacter paint="teal" size={120} look={[3, 1]} feet ground bob phase={0} className="gal-pond__c" style={{ left: '4%' }} />
            <CoinCharacter paint="foam" mood="happy" size={64} feet ground bob phase={0.6} className="gal-pond__c" style={{ left: '14%' }} />
            <CoinCharacter paint="cream" size={84} look={[-3, 2]} feet ground bob phase={1.1} className="gal-pond__c gal-pond__c--far" style={{ left: '23%', bottom: 46 }} />
            <CoinCharacter paint="sun" mood="chomp" size={150} look={[4, 1]} feet ground bob phase={0.3} className="gal-pond__c" style={{ left: '60%' }} />
            <CoinCharacter paint="foam" mood="scared" sweat size={62} look={[-3, -1]} feet ground className="gal-pond__c" style={{ left: '72%', bottom: 10 }} />
            <CoinCharacter paint="up" mood="open" size={96} look={[-3, 0]} feet ground bob phase={1.4} className="gal-pond__c gal-pond__c--far" style={{ left: '84%', bottom: 40 }} />
            <CoinCharacter paint="cyan" size={56} look={[-2, -1]} feet ground bob phase={0.9} className="gal-pond__c" style={{ left: '93%' }} />
          </div>
        </RingScene>
        <div className="gal-grid gal-grid--2">
          <Spec label="RingScene · compact">
            <RingScene time={time} variant="compact" className="gal-ring-sm" />
          </Spec>
          <Spec label="RingScene · horizon (footers, seams)">
            <div className="gal-horizon">
              <RingScene time={time} variant="horizon" clouds={false} />
            </div>
          </Spec>
        </div>
      </Plate>

      {/* ── II: paints ── */}
      <Plate n={2} title="The paint box" aside="tokens.css · palette.ts">
        <ul className="gal-swatches">
          {PAINTS.map((p) => (
            <li key={p.name} className="gal-swatch">
              <span className="gal-swatch__chip" style={{ background: ELYSIUM[p.name] }}>
                <span className="gal-swatch__shade" style={{ background: SHADE[p.name] }} />
              </span>
              <span className="gal-swatch__name">{p.name}</span>
              <span className="gal-swatch__hex num">
                {ELYSIUM[p.name]} / {SHADE[p.name]}
              </span>
              <span className="gal-swatch__note">{p.note}</span>
            </li>
          ))}
        </ul>
        <p className="gal-note">Every fill has one hard shade (right half of each chip). Outlines and offset shadows are always abyss.</p>
      </Plate>

      {/* ── III: type ── */}
      <Plate n={3} title="Type, set by hand" aside="Fraunces · DM Sans · Geist Mono">
        <div className="gal-type">
          <div className="gal-type__display display">
            One emblem.
            <br />
            One <em className="gal-type__em wonk">dollar.</em>
            <br />
            Many snacks.
          </div>
          <div className="gal-type__specs">
            <p className="kicker">Kicker · Geist Mono 12 · uppercase +0.08em</p>
            <h2 className="gal-type__h2">Fraunces 800, SOFT 100</h2>
            <h3 className="gal-type__h3">Three small chores, then the feast.</h3>
            <p className="lede">DM Sans for everything you read. The ring noticed, and so did our follower count. Copy is short, specific and a little wry.</p>
            <p className="gal-type__body">
              Body 16/1.5. Numbers are always Geist Mono: <span className="num">0.0213 HYPE</span>, <span className="num">2,614 / 5,000</span>,{' '}
              <span className="num">0x7a3f…e91c</span>.
            </p>
            <p className="quote gal-type__quote">&ldquo;To the Elysian plain, where life is easiest for men.&rdquo;</p>
          </div>
        </div>
      </Plate>

      {/* ── IV: characters ── */}
      <Plate n={4} title="The cast" aside="CoinCharacter · FoodBit">
        <div className="gal-moods">
          {MOODS.map((m, i) => (
            <figure key={m} className="gal-mood">
              <CoinCharacter paint={COIN_PAINTS[i % COIN_PAINTS.length]} mood={m} size={104} sweat={m === 'scared'} feet bob phase={i * 0.4} />
              <figcaption className="mono">{m}</figcaption>
            </figure>
          ))}
        </div>
        <div className="gal-row gal-row--paints" aria-label="Coin paints">
          {COIN_PAINTS.map((p, i) => (
            <CoinCharacter key={p} paint={p} size={56} mood={i % 2 ? 'smile' : 'happy'} look={[i - 3, 0]} />
          ))}
          <span className="gal-row__sep" />
          <FoodBit kind="pear" size={40} glow={night} wiggle />
          <FoodBit kind="grapes" size={40} glow={night} wiggle />
          <FoodBit kind="seed" paint="sun" size={34} glow={night} />
          <FoodBit kind="seed" paint="foam" size={34} glow={night} />
          <FoodBit kind="seed" paint="up" size={34} glow={night} />
          <FoodBit kind="seed" paint="blush" size={34} glow={night} />
          <span className="gal-row__sep" />
          <SceneProp kind="house" time={time} size={44} />
          <SceneProp kind="tree" time={time} size={44} />
          <SceneProp kind="pine" time={time} size={48} />
        </div>
        <div className="gal-grid gal-grid--3">
          <Spec label="Cloud × 3">
            <div className="gal-clouds">
              <Cloud shape={0} width={150} />
              <Cloud shape={1} width={130} />
              <Cloud shape={2} width={100} />
            </div>
          </Spec>
          <Spec label="Seigaiha · night / day / ink">
            <div className="gal-seig">
              <div className="gal-seig__night">
                <Seigaiha rows={3} r={30} span={600} tone="night" style={{ '--sg-fill': ELYSIUM.trench } as CSSProperties} />
              </div>
              <div className="gal-seig__day">
                <Seigaiha rows={3} r={30} span={600} tone="day" style={{ '--sg-fill': ELYSIUM.plain } as CSSProperties} />
              </div>
              <div className="gal-seig__ink">
                <Seigaiha rows={3} r={24} span={600} tone="ink" />
              </div>
            </div>
          </Spec>
          <Spec label="OrbitDots · a round, in orbit">
            <OrbitDots
              tone={night ? 'night' : 'day'}
              width={420}
              height={200}
              coins={3}
              title="A round: ticket, eat, bell, paid"
              stations={[
                { at: 0, label: 'ticket', done: true },
                { at: 0.25, label: 'eat', done: true },
                { at: 0.5, label: 'bell' },
                { at: 0.75, label: 'paid' },
              ]}
            />
          </Spec>
        </div>
        <div className="gal-grid gal-grid--2">
          <Spec label="Wordmark · cyan / die-cut / sun / cream">
            <div className="gal-marks">
              <Wordmark height={72} />
              <Wordmark height={72} diecut />
              <Wordmark height={52} paint="sun" playful={false} />
              <Wordmark height={40} paint="cream" playful={false} />
            </div>
          </Spec>
          <Spec label="CoinMark (favicon) · 64 / 40 / 24">
            <div className="gal-row">
              <CoinMark size={64} />
              <CoinMark size={40} paint="sun" />
              <CoinMark size={24} />
              <CoinMark size={40} paint="teal" />
            </div>
          </Spec>
        </div>
      </Plate>

      {/* ── V: buttons & stickers ── */}
      <Plate n={5} title="Stickers, buttons, stamps" aside="Button · Sticker · Stamp · Tape · Chip · StatusPill">
        <div className="gal-grid gal-grid--2">
          <Spec label="Button · primary / secondary / teal / up / danger / ghost">
            <div className="gal-row">
              <Button variant="primary" icon="arrow">
                Mint 2 emblems
              </Button>
              <Button>Collab</Button>
              <Button variant="teal">Open X</Button>
              <Button variant="up" lead="check">
                Claim
              </Button>
              <Button variant="danger">Withdraw</Button>
              <Button variant="ghost">Connect</Button>
            </div>
            <div className="gal-row">
              <Button variant="primary" size="lg" sub="≈ $2.00 · max 3" icon="arrow">
                Mint now
              </Button>
              <Button size="sm" lead="wallet">
                0x7a3…e91c
              </Button>
              <Button disabled>Locked</Button>
              <Button variant="primary" loading>
                Waiting for wallet
              </Button>
            </div>
            <div className="gal-row">
              <InkButton variant="pink">InkButton pink</InkButton>
              <InkButton>InkButton ink</InkButton>
              <InkButton variant="paper">InkButton paper</InkButton>
            </div>
          </Spec>
          <Spec label="Sticker tones (with tape)">
            <div className="gal-stickers">
              <Sticker pad="sm" tape>
                cream
              </Sticker>
              <Sticker pad="sm" tone="white" tilt={1.2}>
                white
              </Sticker>
              <Sticker pad="sm" tone="sun" tilt={-1}>
                sun
              </Sticker>
              <Sticker pad="sm" tone="mist">
                mist
              </Sticker>
              <Sticker pad="sm" tone="mint" tilt={0.8}>
                mint
              </Sticker>
              <Sticker pad="sm" tone="night" lift="lg">
                night
              </Sticker>
            </div>
          </Spec>
          <Spec label="Stamp · up / down / teal / sun / round / lg">
            <div className="gal-row gal-row--stamps">
              <Stamp text="DONE" />
              <Stamp text="EATEN" tone="down" rotate={6} />
              <Stamp text="SEALED" tone="teal" size="sm" />
              <Stamp text="PAID" tone="sun" rotate={-4} />
              <Stamp text="WL" sub="2026" tone="up" round />
              <Stamp text="SOLD OUT" tone="down" size="lg" rotate={-5} />
            </div>
          </Spec>
          <Spec label="Tape · Chip · StatusPill · keys">
            <div className="gal-row">
              <Tape inline tone="mist" rotate={-3} width={90} />
              <Tape inline tone="sun" rotate={2} width={90} />
              <Tape inline tone="blush" rotate={-1} width={90} />
              <Tape inline tone="cream" rotate={3} width={90}>
                fragile
              </Tape>
            </div>
            <div className="gal-row">
              <Chip>Asphodel</Chip>
              <Chip tone="teal" icon="users">
                41 in
              </Chip>
              <Chip tone="up">Gains</Chip>
              <Chip tone="down">Losses</Chip>
              <Chip selected onClick={() => {}}>
                Selected
              </Chip>
            </div>
            <div className="gal-row">
              <StatusPill tone="live">Live</StatusPill>
              <StatusPill tone="ok">Synced</StatusPill>
              <StatusPill tone="warn">Price stale</StatusPill>
              <StatusPill tone="danger">Paused</StatusPill>
              <StatusPill tone="idle">Closed</StatusPill>
              <StatusPill tone="mainnet">Mainnet</StatusPill>
              <StatusPill tone="testnet">Testnet</StatusPill>
            </div>
            <div className="gal-row gal-keys">
              <span className="kb-key">mouse</span> steer <span className="kb-key">space</span> split <span className="kb-key">W</span> spit
            </div>
          </Spec>
        </div>
      </Plate>

      {/* ── VI: the mint card ── */}
      <Plate n={6} title="The mint, after dark" aside="ArcGauge · HypeAmount · QuantityStepper · Countdown · AddressChip" className="gal-plate--mint">
        <div className="gal-mint">
          <div className="gal-mint__copy">
            <div className="kicker">Sealed emblems · supply 5,000</div>
            <h2 className="gal-mint__h display">
              One emblem.
              <br />
              One <em>dollar.</em>
              <br />
              Many snacks.
            </h2>
            <p>Your emblem is your ticket to the ring. The price is pinned to a dollar and paid in HYPE, so the number on the button wiggles with the market.</p>
            <div className="gal-row">
              <Countdown seconds={2 * 86400 + 6 * 3600 + 14 * 60} label="WL window closes" />
              <Countdown to={deadline} label="until the bell" tone="sun" />
            </div>
          </div>
          <motion.div className="gal-mint__card kb-island" variants={moves.stickerDrop} custom={0.8} initial="hidden" animate="shown">
            <div className="gal-emblem">
              <Seigaiha rows={4} r={26} span={260} tone="night" className="gal-emblem__sg" style={{ '--sg-fill': ELYSIUM.teal, '--sg-line': SHADE.teal } as CSSProperties} />
              <span className="gal-emblem__no num">NO. 2615</span>
              <CoinCharacter paint="sun" mood="smug" size={150} look={[2, 0]} bob className="gal-emblem__seal" />
              <span className="gal-emblem__rib display">Sealed. For now.</span>
            </div>
            <div className="gal-mint__right">
              <ArcGauge value={minted} max={5000} caption={`${Math.round((minted / 5000) * 100)}% minted. The rest are still deciding.`} />
              <div className="gal-mint__price">
                <HypeAmount value={0.0213} usd={1} size="lg" />
                <div className="gal-mint__tick num">HYPE/USD 46.94 · updated 4s ago · gas on Elysium, also in HYPE</div>
              </div>
              <div className="gal-mint__qty">
                <div>
                  <div className="kicker gal-mint__lbl">How many</div>
                  <QuantityStepper value={qty} onChange={setQty} max={3} label="How many emblems" />
                </div>
                <div className="gal-mint__tot">
                  Total
                  <HypeAmount value={0.0213 * qty} usd={qty} size="sm" stack />
                </div>
              </div>
              <Button variant="primary" size="lg" block onClick={() => setMinted((m) => Math.min(5000, m + qty))}>
                Mint {qty} emblem{qty > 1 ? 's' : ''}
              </Button>
              <div className="gal-mint__wl">
                <AddressChip address="0x7a3f9c2e1b4d5a6f708192a3b4c5d6e7f809e91c" /> <span>is on the list. Nobody&rsquo;s rushing you. Well, a little.</span>
              </div>
            </div>
          </motion.div>
        </div>
        <div className="gal-mint__band" aria-hidden="true">
          <Seigaiha rows={3} r={40} tone="night" style={{ '--sg-fill': 'var(--paper)' } as CSSProperties} />
        </div>
      </Plate>

      {/* ── VII: the ascent ── */}
      <Plate n={7} title="Three small chores" aside="Stepper">
        <div className="gal-wl">
          <div>
            <div className="kicker">Whitelist · the ascent</div>
            <h2 className="gal-wl__h display">Three small chores, then the feast.</h2>
            <p className="lede">Each chore lifts you one terrace up the ring. Finish all three and you get a mint spot and a boarding pass to flex with.</p>
          </div>
          <Stepper
            label="Whitelist chores"
            steps={[
              {
                id: 'follow',
                state: 'done',
                meta: 'Chore 1 · X',
                title: 'Follow @elymumio',
                body: 'Done. The ring noticed, and so did our follower count.',
                art: <CoinCharacter paint="up" mood="happy" size={76} />,
              },
              {
                id: 'repost',
                state: 'active',
                meta: 'Chore 2 · X · about 20 seconds',
                title: 'Repost the pinned feast',
                body: 'The one with the coin eating a slightly smaller coin.',
                art: <CoinCharacter paint="cyan" size={76} look={[4, 0]} />,
                action: <Button variant="teal">Open X</Button>,
              },
              {
                id: 'wallet',
                state: 'locked',
                meta: 'Chore 3 · wallet',
                title: 'Connect a wallet on Elysium',
                body: 'To sign a message, not a transaction. We will never ask for your seed phrase.',
                art: <CoinCharacter paint="cream" mood="scared" size={76} look={[0, -3]} />,
                action: <Button disabled>Connect</Button>,
              },
            ]}
          />
        </div>
      </Plate>

      {/* ── VIII: admin ── */}
      <Plate n={8} title="Before every wallet prompt" aside="TxPreview · Modal · WalletPicker">
        <div className="gal-grid gal-grid--2">
          <TxPreview
            fn="setToken"
            contract={{ name: 'ElymumArena', address: '0x5FbDB2315678afecb367f032d93F642f64180aa3' }}
            args={[{ name: 'token', type: 'address', value: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' }]}
            network={{ name: 'Elysium Testnet', chainId: 4207 }}
            from="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
            onConfirm={() => new Promise((r) => setTimeout(r, 1200))}
            onCancel={() => {}}
          />
          <TxPreview
            fn="ownerMint"
            contract={{ name: 'ElymumNFT', address: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' }}
            args={[
              { name: 'to', type: 'address', value: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
              { name: 'quantity', type: 'uint256', value: '3' },
            ]}
            value={{ wei: 63_900_000_000_000_000n, usd: 3 }}
            network={{ name: 'Elysium', chainId: 4206, mainnet: true }}
            note="This is mainnet. Real HYPE leaves the owner wallet."
            confirmLabel="Sign on mainnet"
            onConfirm={() => {}}
            onCancel={() => {}}
          />
        </div>
        <div className="gal-row">
          <Button onClick={() => setSheet(true)}>Open a Modal</Button>
          <Button variant="primary" lead="wallet" onClick={() => setWallets(true)}>
            Connect wallet
          </Button>
          <Button variant="teal" onClick={() => pushToast('success')}>
            Toast: success
          </Button>
          <Button variant="ghost" onClick={() => pushToast('error')}>
            Toast: error
          </Button>
        </div>
        <Modal
          open={sheet}
          onClose={() => setSheet(false)}
          title="Buy this ticket?"
          kicker="Asphodel Meadow · round 418"
          closeLabel="Close"
          footer={
            <>
              <Button variant="ghost" onClick={() => setSheet(false)}>
                Not yet
              </Button>
              <Button variant="primary" onClick={() => setSheet(false)}>
                Approve and join
              </Button>
            </>
          }
        >
          <p>1,000 $ELYMUM for a seat at the next round. If the round never starts, you get it back.</p>
        </Modal>
        <WalletPicker
          open={wallets}
          onClose={() => {
            setWallets(false);
            setBusyWallet(null);
          }}
          busyId={busyWallet}
          onPick={(id) => setBusyWallet(id)}
          wallets={[
            { id: 'io.rabby', name: 'Rabby', detected: true },
            { id: 'io.metamask', name: 'MetaMask', detected: true, note: 'Recent' },
            { id: 'xyz.frame', name: 'Frame' },
          ]}
        />
        <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((ts) => ts.filter((x) => x.id !== id))} closeLabel="Dismiss" label="Notifications" />
      </Plate>

      {/* ── IX: the old cast, redrawn ── */}
      <Plate n={9} title="Tickets, report cards and odds and ends" aside="Ticket · Receipt · Counter · Field · Tabs · Toast · Loading">
        <div className="gal-grid gal-grid--3">
          <Spec label="Ticket (boarding pass) in a TicketGroup">
            <TicketGroup label="Arenas" value={room} onChange={setRoom} className="gal-tickets">
              <Ticket value="asphodel" title="Asphodel Meadow" meta="23 players · open" stub={<TicketStub value="1,000" unit="$ELYMUM" />} />
              <Ticket value="lethe" title="Lethe Shore" meta="9 players · open" stub={<TicketStub value="10K" unit="$ELYMUM" />} />
              <Ticket value="bough" title="Golden Bough" meta="closed till 18:00" stamp="HELD" stub={<TicketStub value="50K" unit="$ELYMUM" />} />
              <Ticket value="isles" title="Isles of the Blessed" meta="for holders" disabled stub={<TicketStub value="250K" unit="$ELYMUM" />} />
            </TicketGroup>
          </Spec>
          <Spec label="Receipt (sticker report card)">
            <Receipt
              title="Round 418, eaten"
              meta="Lethe Shore · 5:00 · 41 coins"
              stamp="PAID"
              lines={[
                { label: 'Ticket', value: '10,000' },
                { label: 'You ate', value: '+7,412' },
                { label: 'House cut 5%', value: '−370', muted: true },
                { label: 'Paid out', value: '17,042', strong: true },
              ]}
              code="0x9a4e1c"
              footer="tx 0x9a4e…1c07 · Elysium"
            />
          </Spec>
          <Spec label="Counter · Field · Tabs · Dateline · Rule">
            <div className="gal-stack">
              <div className="gal-counter">
                <Counter value={minted} unit="minted" />
              </div>
              <Field label="X handle" placeholder="elymumio" prefix="@" hint="We check it once. No DMs." />
              <Field label="Token address" defaultValue="0xnope" error="That is not an address. It is a mood." />
              <Tabs
                label="Board"
                idBase="galtabs"
                value={tab}
                onChange={setTab}
                items={[
                  { id: 'feast', label: 'Feast' },
                  { id: 'ring', label: 'Ring' },
                  { id: 'ledger', label: 'Ledger' },
                ]}
              />
              <TabPanel idBase="galtabs" id={tab} className="gal-tabpanel">
                {tab === 'feast' ? 'Five minutes. Eat or be eaten.' : tab === 'ring' ? 'Four arenas on the ring.' : 'Every bite, on the books.'}
              </TabPanel>
              <Dateline items={['Arenas open', 'Fee 5% of profit', '42 online']} label="Today" />
              <Rule label="or" />
              <Rule variant="thick" />
              <Rule variant="cut" />
            </div>
          </Spec>
        </div>
        <div className="gal-grid gal-grid--3">
          <Spec label="Toast · info / success / error">
            <div className="gal-stack">
              <Toast tone="info" title="Price refreshed" message="HYPE/USD 46.94. Still a dollar." />
              <Toast tone="success" title="You made the list" message="0x7a3…e91c is in. Mint opens soon." tilt={-0.6} />
              <Toast tone="error" title="Wrong network" message="Switch to Elysium and try again." onClose={() => {}} closeLabel="Dismiss" />
            </div>
          </Spec>
          <Spec label="Loading · StampSpinner · Skeleton">
            <div className="gal-row">
              <StampSpinner size="sm" />
              <StampSpinner />
              <StampSpinner size="lg" label="Loading" />
            </div>
            <Skeleton rows={4} label="Standings loading" />
          </Spec>
          <Spec label="Bottom nav (phones)">
            <Tabs
              variant="nav"
              label="Main menu"
              value="play"
              onChange={() => {}}
              items={[
                { id: 'play', label: 'Play', icon: 'play' },
                { id: 'ranks', label: 'Ranks', icon: 'trophy' },
                { id: 'wallet', label: 'Wallet', icon: 'wallet' },
                { id: 'me', label: 'Me', icon: 'user' },
              ]}
            />
            <div className="gal-icons">
              {ICON_NAMES.map((n) => (
                <span key={n} title={n}>
                  <Icon name={n} size={22} />
                </span>
              ))}
            </div>
          </Spec>
        </div>
      </Plate>

      <footer className="gal-foot">
        <RingScene time={time} variant="horizon" clouds={false} />
        <p className="mono gal-foot__note">Elymum · Ring Storybook · every component in {night ? 'night' : 'day'}</p>
      </footer>
    </Kb>
  );
}
