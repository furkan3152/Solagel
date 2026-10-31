// The film's end card (media/gameplay-film), drawn with the web app's own Ring Storybook design
// system: the night ring, a taped cream card with the wordmark, "Join the WL" and @elymumio (no
// domain). Served by the web dev server (/@fs/...) and rendered frame by frame by replay.mjs.
import '/src/design/tokens.css';
import '/src/design/storybook.css';
import { motion } from 'motion/react';
import { createRoot } from 'react-dom/client';
import { CoinCharacter, FoodBit, Icon, Kb, RingScene, Seigaiha, Sticker, Tape, Wordmark, springs } from '/src/design';
import './endcard.css';

function Card() {
  return (
    <Kb theme="night" className="ec">
      <div className="ec-sky">
        <RingScene time="night" variant="full" clouds animate preserveAspectRatio="xMidYMid slice" />
      </div>
      <div className="ec-band">
        <Seigaiha rows={3} r={44} span={1920} tone="night" />
      </div>
      <motion.div className="ec-card" initial={{ y: -520, rotate: -9, scale: 0.9 }} animate={{ y: 0, rotate: -1.5, scale: 1 }} transition={{ ...springs.drop, delay: 0.05 }}>
        <Sticker tone="cream" lift="lg" pad="lg" round="lg" className="ec-sticker">
          <Tape className="ec-tape" rotate={-3} width={150} />
          <motion.div className="ec-mark" initial={{ scale: 1.35, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 520, damping: 17, delay: 0.32 }}>
            <Wordmark height={176} />
          </motion.div>
          <motion.p className="ec-line" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.95 }}>
            Small change, big appetite.
          </motion.p>
          <div className="ec-row">
            <motion.span className="kb-btn kb-btn--primary kb-btn--lg ec-cta" initial={{ scale: 0, rotate: -12 }} animate={{ scale: 1, rotate: -2 }} transition={{ type: 'spring', stiffness: 560, damping: 15, delay: 1.25 }}>
              <span className="kb-btn__label"><span className="kb-btn__text">Join the WL</span></span>
              <Icon name="arrow" size={30} />
            </motion.span>
            <motion.span className="ec-x" initial={{ scale: 0, rotate: 14 }} animate={{ scale: 1, rotate: 3 }} transition={{ type: 'spring', stiffness: 560, damping: 15, delay: 1.75 }}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z"/></svg>
              @elymumio
            </motion.span>
          </div>
        </Sticker>
        <motion.div className="ec-coin" initial={{ x: -160, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 160, damping: 16, delay: 2.3 }}>
          <CoinCharacter paint="sun" mood="chomp" size={132} feet ground bob chewing />
        </motion.div>
        <motion.div className="ec-pear" initial={{ y: -300, opacity: 0, rotate: -30 }} animate={{ y: 0, opacity: 1, rotate: 8 }} transition={{ type: 'spring', stiffness: 220, damping: 14, delay: 2.0 }}>
          <FoodBit kind="pear" size={48} />
        </motion.div>
        <motion.div className="ec-shy" initial={{ x: 120, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 160, damping: 16, delay: 2.7 }}>
          <CoinCharacter paint="cyan" mood="scared" size={74} feet ground sweat bob phase={0.7} />
        </motion.div>
      </motion.div>
    </Kb>
  );
}

const host = document.getElementById('root')! as HTMLElement & { __root?: ReturnType<typeof createRoot> };
host.__root ??= createRoot(host);
host.__root.render(<Card />);
