import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ELYSIUM } from '@elymum/shared';
import { SceneCoin, useOffscreenPause, type CoinMood } from '../../design';
import type { AdminApi } from '../../site/api';

export interface TabProps {
  api: AdminApi;
}

/** A one-line result of the last action (aria-live). */
export function useFlash(): [ReactNode, (kind: 'ok' | 'err', text: string) => void] {
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((kind: 'ok' | 'err', text: string) => {
    setMsg({ kind, text });
    if (timer.current) clearTimeout(timer.current);
    if (kind === 'ok') timer.current = setTimeout(() => setMsg(null), 4000);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const node = (
    <p className={msg?.kind === 'err' ? 'ad-bad' : 'ad-note ad-flash'} role={msg?.kind === 'err' ? 'alert' : 'status'} aria-live="polite">
      {msg?.text ?? ''}
    </p>
  );
  return [node, flash];
}

export const errText = (err: unknown): string => (err as Error)?.message || 'Something went wrong.';

export const fmtDate = (ms: number | null | undefined): string =>
  ms ? new Date(ms).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** `datetime-local` value for a Unix ms time (local clock). */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const fromLocalInput = (v: string): number => new Date(v).getTime();

/** An outbound link that is safe to click from the admin (http(s) only). */
export function Ext({ href, children }: { href: string | null | undefined; children?: ReactNode }) {
  if (!href || !/^https?:\/\//i.test(href)) return <span>{children ?? href ?? '—'}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children ?? href}
    </a>
  );
}

/** Which little hand-drawn scene sits beside an empty table. */
export type EmptyScene = 'nap' | 'queue' | 'mail' | 'clear' | 'vault';

const INK = ELYSIUM.abyss;
const ln = { stroke: INK, strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

/** A small picture-book vignette for an empty drawer (decorative, 150 x 96). */
function EmptyArt({ scene, mood }: { scene: EmptyScene; mood: CoinMood }) {
  const face = mood === 'sleepy' ? 'sleepy' : mood === 'scared' ? 'scared' : mood === 'happy' ? 'happy' : 'smile';
  const ground = <path d="M4 86 Q75 74 146 86" fill="none" {...ln} />;
  switch (scene) {
    case 'queue':
      // the velvet rope is up, nobody in line: the doorman naps on his post
      return (
        <g>
          {ground}
          <path d="M22 82 V46 M104 80 V44" {...ln} />
          <circle cx={22} cy={42} r={5} fill={ELYSIUM.sun} {...ln} />
          <circle cx={104} cy={40} r={5} fill={ELYSIUM.sun} {...ln} />
          <path className="ad-es__rope" d="M24 50 Q64 72 102 48" fill="none" stroke={ELYSIUM.coral} strokeWidth={5} strokeLinecap="round" />
          <path d="M24 50 Q64 72 102 48" fill="none" stroke={INK} strokeWidth={1.2} strokeDasharray="2 6" />
          <g className="ad-es__float">
            <SceneCoin x={130} y={66} r={14} stroke={2} paint="cream" mood={face} feet />
          </g>
          {face === 'sleepy' && <path className="ad-es__z" d="M138 34 h7 l-7 8 h7" fill="none" {...ln} strokeWidth={2} />}
        </g>
      );
    case 'mail':
      // the mailbox flag is down; a coin peeks in, a paper plane loops overhead
      return (
        <g>
          {ground}
          <path d="M50 84 V54" {...ln} />
          <path d="M30 54 V38 Q30 26 44 26 H66 Q78 26 78 38 V54 Z" fill={ELYSIUM.teal} {...ln} />
          <path d="M30 38 Q30 26 44 26 Q56 26 56 38 V54" fill="none" {...ln} />
          <path d="M78 46 H86 V58 H82" fill="none" stroke={ELYSIUM.down} strokeWidth={3.4} strokeLinecap="round" />
          <g className="ad-es__float">
            <SceneCoin x={108} y={68} r={14} stroke={2} paint="spray" mood={face} look={[-3, -2]} feet />
          </g>
          <g className="ad-es__plane">
            <path d="M96 18 L126 8 L112 30 L108 22 Z M108 22 L126 8" fill="#FFFFFF" {...ln} strokeWidth={2} />
          </g>
        </g>
      );
    case 'clear':
      // a coin inspects the floor with a magnifier: spotless
      return (
        <g>
          {ground}
          <g className="ad-es__float">
            <SceneCoin x={56} y={60} r={18} stroke={2.2} paint="up" mood={face} look={[3, 1]} feet />
          </g>
          <g className="ad-es__lens">
            <path d="M84 62 L104 80" stroke={INK} strokeWidth={5} strokeLinecap="round" />
            <circle cx={80} cy={56} r={11} fill={ELYSIUM.mist} fillOpacity={0.7} {...ln} />
          </g>
          <g className="ad-es__spark" fill={ELYSIUM.sun} {...ln} strokeWidth={1.6}>
            <path d="M118 34 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 Z" />
            <path d="M132 60 l2 4 l4 2 l-4 2 l-2 4 l-2 -4 l-4 -2 l4 -2 Z" />
          </g>
        </g>
      );
    case 'vault':
      // the vault door stands open on an empty shelf
      return (
        <g>
          {ground}
          <rect x={20} y={30} width={56} height={52} rx={6} fill={ELYSIUM.sand2} {...ln} />
          <rect x={28} y={38} width={40} height={36} rx={3} fill={ELYSIUM.linen} {...ln} />
          <path className="ad-es__door" d="M76 30 L100 36 V78 L76 82 Z" fill={ELYSIUM.stone} {...ln} />
          <circle cx={90} cy={57} r={5} fill={ELYSIUM.sun} {...ln} strokeWidth={1.8} />
          <g className="ad-es__float">
            <SceneCoin x={126} y={68} r={14} stroke={2} paint="sun" mood={face} feet look={[-3, 0]} />
          </g>
        </g>
      );
    default:
      return (
        <g>
          <path d="M8 86 Q60 56 112 86" fill={ELYSIUM.meadow} {...ln} />
          <g className="ad-es__float">
            <SceneCoin x={60} y={58} r={18} stroke={2.2} paint="cream" mood={face} feet />
          </g>
          {face === 'sleepy' && (
            <g className="ad-es__z" fill="none" {...ln} strokeWidth={2}>
              <path d="M84 30 h7 l-7 8 h7" />
              <path d="M98 16 h5 l-5 6 h5" opacity={0.7} />
            </g>
          )}
        </g>
      );
  }
}

/** An empty table: a little hand-drawn scene and one honest line. */
export function Empty({ children, mood = 'sleepy', scene = 'nap' }: { children: ReactNode; mood?: CoinMood; scene?: EmptyScene }) {
  const [ref, visible] = useOffscreenPause<SVGSVGElement>();
  return (
    <div className="ad-empty" data-scene={scene}>
      <svg ref={ref} className="ad-empty__art" viewBox="0 0 150 96" width={150} height={96} aria-hidden="true" focusable="false" data-paused={!visible || undefined}>
        <EmptyArt scene={scene} mood={mood} />
      </svg>
      <p>{children}</p>
    </div>
  );
}
