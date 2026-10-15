import { AnimatePresence, animate, usePresence, type AnimationPlaybackControls } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { DUR, EASE, clamp01 } from '../curves';
import { springs, useReducedMotion } from '../motion';

export interface Point {
  x: number;
  y: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the next wipe out of the paper opens (the punched ticket's hole), and when it was marked. */
let punch: { at: number; p: Point } | null = null;
const PUNCH_TTL_MS = 6000;

/**
 * Marks the hole the next lobby → game wipe opens from: an element (its centre)
 * or a viewport point. The ticket punch calls it; it is forgotten after a few
 * seconds so a later, unrelated screen change does not open from a stale spot.
 */
export function markTransitionOrigin(target: Element | Point | null): void {
  if (!target) {
    punch = null;
    return;
  }
  if ('getBoundingClientRect' in target) {
    const r = target.getBoundingClientRect();
    punch = { at: Date.now(), p: { x: r.left + r.width / 2, y: r.top + r.height / 2 } };
  } else {
    punch = { at: Date.now(), p: target };
  }
}

function takeOrigin(): Point | null {
  const o = punch && Date.now() - punch.at < PUNCH_TTL_MS ? punch.p : null;
  punch = null;
  return o;
}

export type WipePhase = 'boot' | 'out' | 'in';

export interface ScreenTransitionProps {
  /** The paper screen (the lobby) is up. Off: it wipes away onto the world beneath. */
  show: boolean;
  children: ReactNode;
  /**
   * Where the world sits in the paper (the lobby's front-page photo), in
   * viewport px; null when the paper has no window. The world shrinks into it
   * on the way back and grows out of it when there was no ticket punch.
   */
  home?: () => Box | null;
  /** A wipe starts (sound and camera hooks). */
  onPhase?: (phase: WipePhase) => void;
  className?: string;
}

/**
 * The one transition between the paper (lobby) and the world (game canvas
 * underneath). Out: the punched ticket's hole opens as an iris printed in two
 * misregistered inks and the paper pushes past the eye. In: the world shrinks
 * into a paper card (or the front-page photo) and the paper closes around it.
 * First mount: the sheet slides up and settles. Reduced motion: opacity only.
 */
export function ScreenTransition({ show, children, home, onPhase, className }: ScreenTransitionProps) {
  const booted = useRef(false);
  const entrance: 'boot' | 'in' = booted.current ? 'in' : 'boot';
  useEffect(() => {
    booted.current = true;
  }, []);
  return (
    <AnimatePresence>
      {show && (
        <PaperLayer key="paper" entrance={entrance} home={home} onPhase={onPhase} className={className}>
          {children}
        </PaperLayer>
      )}
    </AnimatePresence>
  );
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function viewport(): { w: number; h: number } {
  return { w: window.innerWidth || 1, h: window.innerHeight || 1 };
}

/** Farthest-corner distance from a point: the radius that uncovers the whole screen. */
function coverRadius(p: Point): number {
  const { w, h } = viewport();
  return Math.hypot(Math.max(p.x, w - p.x), Math.max(p.y, h - p.y)) + 24;
}

/** A rectangular window cut into the paper (two mask layers, xor). */
function rectMask(b: Box): string {
  return `linear-gradient(#000 0 0) 0 0 / 100% 100% no-repeat, linear-gradient(#000 0 0) ${b.x}px ${b.y}px / ${Math.max(0, b.w)}px ${Math.max(0, b.h)}px no-repeat`;
}

function lerpBox(a: Box, b: Box, t: number): Box {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t };
}

function PaperLayer({
  entrance,
  home,
  onPhase,
  className,
  children,
}: {
  entrance: 'boot' | 'in';
  home?: () => Box | null;
  onPhase?: (phase: WipePhase) => void;
  className?: string;
  children: ReactNode;
}) {
  const [isPresent, safeToRemove] = usePresence();
  const reduced = useReducedMotion();
  const paper = useRef<HTMLDivElement>(null);
  const fx = useRef<SVGSVGElement>(null);
  const running = useRef<AnimationPlaybackControls[]>([]);
  const onPhaseRef = useRef(onPhase);
  onPhaseRef.current = onPhase;
  const homeRef = useRef(home);
  homeRef.current = home;

  /** Bumped per phase: a stopped phase's completion handler must not touch the next one. */
  const gen = useRef(0);
  const stop = () => {
    gen.current++;
    for (const c of running.current) c.stop();
    running.current = [];
  };
  /** Runs `fn` when `ctl` finishes, unless another phase started meanwhile. */
  const after = (ctl: AnimationPlaybackControls, fn: () => void) => {
    const g = gen.current;
    ctl.finished.then(
      () => {
        if (g === gen.current) fn();
      },
      () => {},
    );
  };

  const clearMask = () => {
    const el = paper.current;
    if (!el) return;
    el.style.removeProperty('mask');
    el.style.removeProperty('-webkit-mask');
    el.style.removeProperty('mask-composite');
    el.style.removeProperty('-webkit-mask-composite');
    el.style.removeProperty('transform');
    el.style.removeProperty('transform-origin');
    el.style.removeProperty('opacity');
  };

  const setMask = (mask: string, composite?: boolean) => {
    const el = paper.current;
    if (!el) return;
    el.style.setProperty('mask', mask);
    el.style.setProperty('-webkit-mask', mask);
    if (composite) {
      el.style.setProperty('mask-composite', 'exclude');
      el.style.setProperty('-webkit-mask-composite', 'xor');
    }
  };

  /** Draws the ink edge of the wipe: two misregistered rings, or a card outline. */
  const drawFx = (shape: { circle: Point & { r: number } } | { box: Box } | null, alpha = 1) => {
    const svg = fx.current;
    if (!svg) return;
    svg.style.opacity = shape ? String(alpha) : '0';
    if (!shape) return;
    const [a, b] = [svg.children[0] as SVGElement, svg.children[1] as SVGElement];
    if ('circle' in shape) {
      const { x, y, r } = shape.circle;
      for (const [el, dx, dy] of [
        [a, 2.5, 1.5],
        [b, 0, 0],
      ] as const) {
        el.setAttribute('d', `M ${x + dx - r} ${y + dy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`);
      }
    } else {
      const { x, y, w, h } = shape.box;
      a.setAttribute('d', `M ${x + 6} ${y + 6} h ${w} v ${h} h ${-w} Z`);
      b.setAttribute('d', `M ${x} ${y} h ${w} v ${h} h ${-w} Z`);
    }
  };

  // entrance: the first boot slides the sheet up; coming back from the world closes the paper around it
  useLayoutEffect(() => {
    const el = paper.current;
    if (!el) return;
    if (reduced) {
      running.current.push(animate(el, { opacity: [0, 1] }, { duration: DUR.fade, ease: 'linear' }));
      return stop;
    }
    if (entrance === 'boot') {
      // the first load keeps the main thread busy (fonts, the canvas, the socket): the sheet
      // waits off-stage until the type is in and a frame has painted, so its slide is seen
      el.style.opacity = '0';
      let cancelled = false;
      let raf = 0;
      const fonts = typeof document !== 'undefined' && document.fonts?.ready ? document.fonts.ready : Promise.resolve();
      void Promise.race([fonts, new Promise((r) => setTimeout(r, 450))]).then(() => {
        raf = requestAnimationFrame(() => {
          raf = requestAnimationFrame(() => {
            if (cancelled) return;
            if (el.dataset.screenState === 'leaving') {
              el.style.removeProperty('opacity');
              return;
            }
            onPhaseRef.current?.('boot');
            const ctl = animate(el, { y: ['7vh', '0vh'], opacity: [0, 1] }, { y: springs.sheet, opacity: { duration: 0.22, ease: 'linear' } });
            running.current.push(ctl);
            // no transform left behind on the page once it has settled
            after(ctl, clearMask);
          });
        });
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
        stop();
        el.style.removeProperty('opacity');
      };
    }
    onPhaseRef.current?.('in');
    const { w, h } = viewport();
    const full: Box = { x: 0, y: 0, w, h };
    const target = homeRef.current?.() ?? null;
    // no window in the paper: the world becomes a small card that slips back into the page
    const cw = Math.min(w * 0.46, 440);
    const card: Box = target ?? { x: (w - cw) / 2, y: h * 0.42 - (cw * 0.62) / 2, w: cw, h: cw * 0.62 };
    const shrink = target ? 1 : 0.78;
    setMask(rectMask(full), true);
    drawFx({ box: full }, 0);
    const ctl = animate(0, 1, {
      duration: target ? DUR.wipe : DUR.wipe * 0.95,
      ease: EASE.wipe,
      onUpdate: (t) => {
        let box: Box;
        if (t < shrink || shrink >= 1) {
          box = lerpBox(full, card, Math.min(1, t / shrink));
        } else {
          // the card slips into the paper: it folds down to nothing along its bottom edge
          const k = (t - shrink) / (1 - shrink);
          const e = k * k;
          box = { x: card.x + card.w * 0.04 * e, y: card.y + card.h * e, w: card.w * (1 - 0.08 * e), h: card.h * (1 - e) };
        }
        setMask(rectMask(box), true);
        // the card's ink outline shows once it reads as a card, and fades as it lands
        const ink = clamp01((t - 0.25) / 0.3) * (target ? clamp01((1 - t) / 0.25) : 1);
        drawFx({ box }, ink);
      },
    });
    running.current.push(ctl);
    after(ctl, () => {
      clearMask();
      drawFx(null);
    });
    return stop;
    // the entrance runs once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // exit: the punch hole opens as an iris onto the world (or the front-page photo grows to the screen)
  const leaving = useRef(false);
  useEffect(() => {
    if (isPresent) {
      // the paper came back before it finished leaving: stand it up again as it was
      if (leaving.current && paper.current) {
        leaving.current = false;
        stop();
        clearMask();
        drawFx(null);
        paper.current.style.removeProperty('pointer-events');
      }
      return;
    }
    leaving.current = true;
    stop();
    const el = paper.current;
    if (!el) {
      safeToRemove?.();
      return;
    }
    el.style.pointerEvents = 'none';
    if (reduced) {
      const ctl = animate(el, { opacity: 0 }, { duration: DUR.fade, ease: 'linear' });
      running.current.push(ctl);
      after(ctl, () => safeToRemove?.());
      return stop;
    }
    onPhaseRef.current?.('out');
    const { w, h } = viewport();
    const origin = takeOrigin();
    const target = origin ? null : (homeRef.current?.() ?? null);
    let ctl: AnimationPlaybackControls;
    if (target) {
      const full: Box = { x: 0, y: 0, w, h };
      setMask(rectMask(target), true);
      ctl = animate(0, 1, {
        duration: DUR.wipe,
        ease: EASE.wipe,
        onUpdate: (t) => {
          const box = lerpBox(target, full, t);
          setMask(rectMask(box), true);
          drawFx({ box }, clamp01((1 - t) / 0.4));
        },
      });
    } else {
      const p = origin
        ? { x: Math.min(w - 12, Math.max(12, origin.x)), y: Math.min(h - 12, Math.max(12, origin.y)) }
        : { x: w / 2, y: h / 2 };
      const R = coverRadius(p);
      el.style.transformOrigin = `${p.x}px ${p.y}px`;
      ctl = animate(0, 1, {
        duration: DUR.wipe,
        // the punch shows for a beat before the hole opens
        delay: origin ? DUR.punch * 0.7 : 0,
        ease: EASE.wipe,
        onUpdate: (t) => {
          const r = Math.max(0.01, R * t);
          setMask(`radial-gradient(circle at ${p.x}px ${p.y}px, transparent ${r}px, #000 ${r + 1.5}px)`);
          // the paper pushes past the eye while the camera falls into the world
          el.style.transform = `scale(${1 + 0.07 * t * t})`;
          drawFx({ circle: { ...p, r } }, clamp01((1 - t) / 0.35));
        },
      });
    }
    running.current.push(ctl);
    after(ctl, () => {
      drawFx(null);
      safeToRemove?.();
    });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresent]);

  return (
    <>
      <div
        ref={paper}
        className={`kb-screen${className ? ` ${className}` : ''}`}
        data-screen-state={isPresent ? 'present' : 'leaving'}
        data-entrance={reduced ? undefined : entrance}
      >
        {children}
      </div>
      <svg ref={fx} className="kb-screen__ink" aria-hidden="true" xmlns={SVG_NS} style={{ opacity: 0 }}>
        <path className="kb-screen__ink-b" />
        <path className="kb-screen__ink-a" />
      </svg>
    </>
  );
}
