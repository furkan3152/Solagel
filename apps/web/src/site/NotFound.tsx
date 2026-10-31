import { ELYSIUM, SHADE } from '@elymum/shared';
import { PlateLabel, useReducedMotion } from '../design';
import { GazeCoin } from './landing/GazeCoin';
import { SitePage, SiteLinkButton } from './Shell';
import './notfound.css';

const INK = ELYSIUM.abyss;

/**
 * The unbuilt terrace: the ring's ground stops at a broken edge, a blueprint outline shows where
 * the rest will go, a crane swings the next terrace block on its cable and a traffic cone guards
 * the drop. Decoration (aria-hidden); the words live in the page.
 */
function UnbuiltTerrace() {
  return (
    <svg className="nf-art" viewBox="0 0 760 430" aria-hidden="true" focusable="false">
      <g strokeLinejoin="round" strokeLinecap="round">
        {/* a chubby cloud drifting past the crane */}
        <g className="nf-art__cloud" stroke={INK} strokeWidth={3}>
          <path d="M120 120 q-30 0 -30 -24 q0 -24 30 -22 q8 -30 44 -26 q30 2 34 30 q30 -4 30 20 q0 22 -28 22z" fill={ELYSIUM.white} />
          <path d="M112 112 h96" stroke={ELYSIUM.mist} strokeWidth={5} strokeLinecap="round" />
        </g>
        {/* the blueprint of the terrace to come */}
        <path className="nf-art__plan" d="M430 300 H760 M430 300 v40 H760 M470 300 q20 -18 40 0 M600 300 v-36 h30 v36" fill="none" stroke={ELYSIUM.cyan} strokeWidth={3} strokeDasharray="8 9" />
        {/* the crane */}
        <g stroke={INK} strokeWidth={3}>
          <path d="M650 430 V74" fill="none" strokeWidth={14} />
          <path d="M650 430 V74" fill="none" stroke={ELYSIUM.sun} strokeWidth={8} />
          <path d="M650 80 H372 M650 80 H730" fill="none" strokeWidth={12} />
          <path d="M650 80 H372 M650 80 H730" fill="none" stroke={ELYSIUM.sun} strokeWidth={6} />
          <path d="M650 74 L600 40 L650 40Z" fill={ELYSIUM.coral} />
          <rect x={700} y={86} width={34} height={26} rx={4} fill={ELYSIUM.stone} />
          <rect x={622} y={88} width={56} height={40} rx={8} fill={ELYSIUM.cream} />
          <rect x={632} y={96} width={22} height={16} rx={3} fill={ELYSIUM.mist} />
        </g>
        {/* the next terrace block on its cable, swinging */}
        <g className="nf-art__swing">
          <path d="M470 86 V196" stroke={INK} strokeWidth={2.5} />
          <path d="M462 196 h16 l-8 12z" fill={ELYSIUM.stone} stroke={INK} strokeWidth={2.5} />
          <path d="M430 210 h80 l-12 30 h-56z" fill="none" stroke={INK} strokeWidth={2.5} />
          <path d="M412 238 h116 v34 q0 8 -8 8 h-100 q-8 0 -8 -8z" fill={SHADE.up} stroke={INK} strokeWidth={3} />
          <path d="M412 238 h116 v12 h-116z" fill={ELYSIUM.meadow} stroke={INK} strokeWidth={3} />
          <path d="M430 238 l6 -10 l6 10 M490 238 l6 -12 l6 12" fill={ELYSIUM.clover} stroke={INK} strokeWidth={2.5} />
        </g>
        {/* scaffolding off the broken edge */}
        <g stroke={INK} strokeWidth={3}>
          <path d="M452 310 V430 M532 310 V430 M600 330 V430" fill="none" />
          <path d="M440 352 H612 M440 396 H612" fill="none" strokeWidth={10} />
          <path d="M440 352 H612 M440 396 H612" fill="none" stroke={ELYSIUM.sand2} strokeWidth={5} />
          <path d="M452 352 L532 396 M532 352 L600 396" fill="none" strokeWidth={2.5} />
        </g>
        {/* the built terrace, ending in a broken edge */}
        <path d="M-10 300 H418 l10 14 l-12 12 l14 16 l-10 18 l12 14 l-8 20 l10 36 H-10z" fill={ELYSIUM.verdant} stroke={INK} strokeWidth={3} />
        <path d="M-10 300 H418 l10 14 l-4 4 H-10z" fill={ELYSIUM.meadow} stroke={INK} strokeWidth={3} />
        <path d="M-10 344 H404 M-10 392 H410" fill="none" stroke={ELYSIUM.forest} strokeWidth={3} strokeDasharray="14 12" />
        {/* lollipop tree and a house on the built part */}
        <g stroke={INK} strokeWidth={3}>
          <path d="M20 300 V262" />
          <circle cx={20} cy={246} r={22} fill={ELYSIUM.clover} />
          <path d="M8 238 a12 12 0 0 1 10 -8" fill="none" stroke={ELYSIUM.meadow} strokeWidth={4} />
          <path d="M176 300 v-30 l20 -18 l20 18 v30z" fill={ELYSIUM.cream} />
          <path d="M170 272 l26 -24 l26 24" fill="none" />
          <rect x={189} y={280} width={14} height={20} rx={3} fill={ELYSIUM.coral} />
        </g>
        {/* the sign */}
        <g className="nf-art__sign" stroke={INK} strokeWidth={3}>
          <path d="M100 300 V226" />
          <rect x={36} y={196} width={128} height={44} rx={8} fill={ELYSIUM.sun} transform="rotate(-4 100 218)" />
          <text x={100} y={225} textAnchor="middle" transform="rotate(-4 100 218)" className="nf-art__signtext" stroke="none" fill={INK}>
            Terrace 404
          </text>
        </g>
        {/* the cone at the drop */}
        <g stroke={INK} strokeWidth={3}>
          <path d="M386 300 l12 -38 l12 38z" fill={ELYSIUM.coral} />
          <path d="M391 285 h14" stroke={ELYSIUM.cream} strokeWidth={5} />
          <path d="M378 300 h40" />
        </g>
      </g>
    </svg>
  );
}

/** Any path the site does not know: a lost coin on a terrace that is not built yet. */
export function NotFound({ path: normal }: { path: string }) {
  const reduced = useReducedMotion();
  // show the path as typed (the router lower-cases it for matching)
  const path = typeof location !== 'undefined' ? location.pathname : normal;
  return (
    <SitePage className="nf-root">
      <PlateLabel numeral="404" title="Off the map" aside={path} />
      <section className="nf" aria-labelledby="nf-title">
        <div className="nf__copy">
          <p className="kicker">Error 404 · nothing here yet</p>
          <h1 className="nf__title" id="nf-title">
            This terrace hasn&rsquo;t been built yet.
          </h1>
          <p className="nf__lede">
            The path <code className="nf__path mono">{path}</code> runs off the edge of the ring. The builders are on lunch, which on Elysium is most of the time.
          </p>
          <div className="nf__ctas">
            <SiteLinkButton href="/" variant="primary" icon="arrow">
              Walk back to the plain
            </SiteLinkButton>
            <SiteLinkButton href="/docs">Read the guide</SiteLinkButton>
          </div>
        </div>
        <div className="nf__scene">
          <UnbuiltTerrace />
          <div className={`nf__lost${reduced ? ' is-still' : ''}`} aria-hidden="true">
            <span className="nf__huh mono">?</span>
            <GazeCoin paint="cyan" mood="scared" size={104} look={[-3, -1]} sweat feet ground bob={!reduced} />
            <svg className="nf__map" viewBox="0 0 70 50" width="70" height="50">
              <path d="M3 6 l20 -4 l22 6 l22 -6 v40 l-22 6 l-22 -6 l-20 4z" fill={ELYSIUM.cream} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
              <path d="M23 2 v40 M45 8 v40" stroke={INK} strokeWidth={1.5} opacity={0.4} />
              <path d="M10 34 q12 -16 26 -6 t24 -14" fill="none" stroke={ELYSIUM.teal} strokeWidth={2.5} strokeDasharray="4 4" />
              <path d="M52 10 l6 6 M58 10 l-6 6" stroke={ELYSIUM.coral} strokeWidth={3} strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </section>
    </SitePage>
  );
}
