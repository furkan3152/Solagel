import { ELYSIUM, SHADE } from '@elymum/shared';
import { SceneCoin, useOffscreenPause, useReducedMotion } from '../../design';

const INK = ELYSIUM.abyss;
const ln = { stroke: INK, strokeWidth: 2.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export interface ValueFlowLabels {
  ticket: string;
  vault: string;
  wallet: string;
  fee: string;
}

function Tok({ className, delay }: { className: string; delay: number }) {
  return (
    <g className={className} style={{ animationDelay: `${delay}s` }}>
      <circle r={8} fill={ELYSIUM.sun} {...ln} strokeWidth={2.2} />
      <path d="M-3.5 0 H3.5" stroke={SHADE.sun} strokeWidth={2.2} strokeLinecap="round" />
    </g>
  );
}

/**
 * The value flow as a moving diagram: tokens leave the ticket for the arena's vault, change
 * hands inside it when a coin is eaten, and at the bell travel on to the player's wallet while
 * a thin slice of the profit drops to the fee wallet. One 7 s loop while on screen; a still
 * picture under reduced motion. The numbered steps under it carry the words.
 */
export function ValueFlow({ labels }: { labels: ValueFlowLabels }) {
  const reduced = useReducedMotion();
  const [ref, visible] = useOffscreenPause<SVGSVGElement>();
  return (
    <figure className="vf">
      <svg ref={ref} className={`vf__svg${reduced ? ' is-still' : ''}`} viewBox="0 0 640 200" aria-hidden="true" focusable="false" data-paused={!visible || undefined}>
        <rect x={2} y={2} width={636} height={196} rx={18} fill={ELYSIUM.mist} />
        {/* the rails */}
        <path d="M128 92 H250" stroke={ELYSIUM.teal} strokeWidth={3} strokeDasharray="2 8" strokeLinecap="round" />
        <path d="M392 80 H510" stroke={ELYSIUM.teal} strokeWidth={3} strokeDasharray="2 8" strokeLinecap="round" />
        <path d="M420 80 Q430 150 470 160" fill="none" stroke={ELYSIUM.coral} strokeWidth={3} strokeDasharray="2 8" strokeLinecap="round" />

        {/* the ticket */}
        <g transform="translate(40 70)">
          <path d="M0 0 h84 v14 a8 8 0 0 0 0 16 v14 h-84 v-14 a8 8 0 0 0 0 -16 Z" fill={ELYSIUM.sun} {...ln} />
          <path d="M60 4 V40" stroke={INK} strokeWidth={1.6} strokeDasharray="3 4" />
          <path d="M12 14 h34 M12 24 h26" stroke={SHADE.sun} strokeWidth={3} strokeLinecap="round" />
        </g>
        <text x={82} y={140} textAnchor="middle" className="vf__t">
          {labels.ticket}
        </text>

        {/* the vault: two coins inside, one eats the other and its tokens hop over */}
        <g transform="translate(250 34)">
          <rect width={142} height={112} rx={14} fill={ELYSIUM.teal} {...ln} />
          <rect x={10} y={10} width={122} height={92} rx={10} fill={ELYSIUM.trench} {...ln} strokeWidth={2} />
          <rect x={50} y={-6} width={42} height={9} rx={4} fill={INK} />
          <g className="vf-eater">
            <SceneCoin x={44} y={62} r={20} paint="cyan" mood="chomp" look={[4, 0]} stroke={2.2} />
          </g>
          <g className="vf-prey">
            <SceneCoin x={102} y={68} r={12} paint="blush" mood="scared" look={[-3, 0]} stroke={2} />
          </g>
          <g transform="translate(102 46)">
            <Tok className="vf-hop" delay={0} />
          </g>
        </g>
        <text x={321} y={168} textAnchor="middle" className="vf__t">
          {labels.vault}
        </text>

        {/* the wallet */}
        <g transform="translate(510 50)">
          <rect width={92} height={62} rx={10} fill={ELYSIUM.coral} {...ln} />
          <path d="M0 18 H92" stroke={INK} strokeWidth={2} />
          <rect x={60} y={26} width={36} height={22} rx={6} fill={ELYSIUM.cream} {...ln} strokeWidth={2} />
          <circle cx={74} cy={37} r={4} fill={INK} />
        </g>
        <text x={556} y={134} textAnchor="middle" className="vf__t">
          {labels.wallet}
        </text>

        {/* the fee wallet */}
        <g transform="translate(470 148)">
          <rect width={52} height={30} rx={7} fill={ELYSIUM.cream} {...ln} strokeWidth={2.2} />
          <circle cx={26} cy={15} r={6} fill={ELYSIUM.sun} {...ln} strokeWidth={1.8} />
        </g>
        <text x={540} y={182} className="vf__t vf__t--sm">
          {labels.fee}
        </text>

        {/* the travellers: ticket → vault, then vault → wallet with one slice to the fee wallet */}
        <g transform="translate(128 92)">
          <Tok className="vf-in" delay={0} />
          <Tok className="vf-in" delay={0.25} />
        </g>
        <g transform="translate(392 80)">
          <Tok className="vf-out" delay={0} />
          <Tok className="vf-out" delay={0.25} />
          <Tok className="vf-fee" delay={0.1} />
        </g>
        <g transform="translate(321 22)">
          <g className="vf-bell">
            <path d="M-12 8 Q-12 -10 0 -12 Q12 -10 12 8 Q14 11 0 11 Q-14 11 -12 8Z" fill={ELYSIUM.sun} {...ln} strokeWidth={2} />
            <circle cy={14} r={3} fill={INK} />
          </g>
        </g>
      </svg>
    </figure>
  );
}
