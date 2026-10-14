import { getSkin } from '@slana/shared';
import { useEffect, useRef, type ReactNode } from 'react';
import { drawCoin } from '../render/coin';
import type { Expression } from '../render/faces';
import { JellyBody } from '../render/jelly';

/* ───────── shared animation ticker (one RAF for every little canvas) ───────── */
type Tick = (now: number, dt: number) => void;
const tickers = new Set<Tick>();
let rafId = 0;
let lastTick = performance.now();
const pointer = { x: -1, y: -1 };
if (typeof window !== 'undefined') {
  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  });
}
function loop(now: number) {
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  for (const t of tickers) t(now, dt);
  rafId = tickers.size > 0 ? requestAnimationFrame(loop) : 0;
}
export function useTicker(fn: Tick, active = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const t: Tick = (n, d) => ref.current(n, d);
    tickers.add(t);
    if (!rafId) {
      lastTick = performance.now();
      rafId = requestAnimationFrame(loop);
    }
    return () => {
      tickers.delete(t);
    };
  }, [active]);
}

let rng = 99;
const rand = () => ((rng = (rng * 16807) % 2147483647) / 2147483647);

/** A coin character drawn on its own little canvas. */
export function SkinCanvas({
  skin,
  size,
  expression = 'happy',
  animate = true,
  followPointer = false,
  className,
  seed = 1,
}: {
  skin: number;
  size: number;
  expression?: Expression;
  animate?: boolean;
  followPointer?: boolean;
  className?: string;
  seed?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const jelly = useRef(new JellyBody());

  const draw = (now: number, dt: number) => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(size * dpr);
    // (a fresh canvas is 300×150, so both sides must be checked)
    if (c.width !== px || c.height !== px) {
      c.width = px;
      c.height = px;
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = size * 0.36;
    let lx = Math.cos(now / 1400 + seed) * 0.5;
    let ly = Math.sin(now / 1700 + seed) * 0.3;
    if (followPointer && pointer.x >= 0) {
      const rect = c.getBoundingClientRect();
      const dx = pointer.x - (rect.left + rect.width / 2);
      const dy = pointer.y - (rect.top + rect.height / 2);
      const d = Math.hypot(dx, dy);
      const k = Math.min(1, d / 160);
      lx = d > 0 ? (dx / d) * k : 0;
      ly = d > 0 ? (dy / d) * k : 0;
    }
    if (animate) jelly.current.update(dt, r, r, lx * 0.5, ly * 0.5, [], rand);
    drawCoin(ctx, size / 2, size / 2 + size * 0.04, r, getSkin(skin), {
      time: animate ? now : 0,
      lookX: lx,
      lookY: ly,
      expression,
      pxPerUnit: 1.4,
      jelly: animate ? jelly.current : null,
      seed,
    });
  };

  useTicker(draw, animate);
  useEffect(() => {
    if (!animate) draw(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skin, size, expression, animate]);

  return <canvas ref={ref} className={className} style={{ width: size, height: size }} />;
}

const LOGO_COLORS = ['#FF8FB8', '#FFC93C', '#7CC8FF', '#4FE0A8', '#C9B6FF', '#FFB38A'];

export function Logo({ big = false }: { big?: boolean }) {
  const letters = 'Slana'.split('');
  return (
    <div className="logo" aria-label="Slana">
      <SkinCanvas skin={0} size={big ? 62 : 46} className="logo-coin" seed={4} />
      {letters.map((ch, i) => (
        <span key={i} className="l" style={{ color: LOGO_COLORS[i % LOGO_COLORS.length] }}>
          {ch}
        </span>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`switch ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
    />
  );
}

export function Modal({ children, onClose, wide = false, title }: { children: ReactNode; onClose?: () => void; wide?: boolean; title?: ReactNode }) {
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`card modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        {onClose && (
          <button className="btn btn-icon btn-ghost modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export const medal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank));

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.floor(n));
}
