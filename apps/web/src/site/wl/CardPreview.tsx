import { normalizeXHandle } from '@elymum/shared';
import { useEffect, useRef, useState } from 'react';
import { Button, useReducedMotion } from '../../design';
import { saveBlob } from '../api';
import { ticketNo } from '../coinLook';
import { cardBlob, cardFonts, drawTicketCard } from './card';
import { InkSplat } from './Juice';

/** When each piece of the pass lands during the assembly (ms from the start). */
const ASSEMBLY = { pass: 140, print: 360, type: 560, perChar: 46, details: 200, stub: 220, stampFall: 240, settle: 300 };

/**
 * Plays the pass assembling itself on `canvas` (night, blank pass, wordmark printed, handle typed
 * out, details, stub and coin, then the rubber stamp thumped on). Returns a cancel function.
 */
function assemblePass(canvas: HTMLCanvasElement, handle: string, onThump: () => void, onDone: () => void): () => void {
  const at = `@${handle || 'yourhandle'}`;
  const tType = ASSEMBLY.type;
  const tDetails = tType + at.length * ASSEMBLY.perChar + 120;
  const tStub = tDetails + ASSEMBLY.details;
  const tStamp = tStub + ASSEMBLY.stub;
  const tLand = tStamp + ASSEMBLY.stampFall;
  const tEnd = tLand + ASSEMBLY.settle;
  let raf = 0;
  let thumped = false;
  let last = '';
  const t0 = performance.now();
  const frame = (now: number) => {
    const t = now - t0;
    let key: string;
    let opts: { upto: number; chars?: number; stampScale?: number };
    if (t < ASSEMBLY.pass) opts = { upto: 0 };
    else if (t < ASSEMBLY.print) opts = { upto: 1 };
    else if (t < tType) opts = { upto: 2 };
    else if (t < tDetails) opts = { upto: 3, chars: Math.floor((t - tType) / ASSEMBLY.perChar) + 1 };
    else if (t < tStub) opts = { upto: 4 };
    else if (t < tStamp) opts = { upto: 5 };
    else if (t < tLand) {
      const k = (t - tStamp) / ASSEMBLY.stampFall;
      opts = { upto: 6, stampScale: 1.9 - 0.9 * k * k };
    } else opts = { upto: 6 };
    key = `${opts.upto}:${opts.chars ?? ''}:${opts.stampScale?.toFixed(2) ?? ''}`;
    if (key !== last) {
      drawTicketCard(canvas, handle, opts);
      last = key;
    }
    if (!thumped && t >= tLand) {
      thumped = true;
      onThump();
    }
    if (t < tEnd) raf = requestAnimationFrame(frame);
    else onDone();
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

/**
 * The live boarding pass for a handle, redrawn as the visitor types. `assemble`: the first time it
 * scrolls into view, the pass prints itself piece by piece and the WL stamp thumps on (reduced
 * motion: drawn whole).
 */
export function CardPreview({ handle, compact = false, assemble = false }: { handle: string; compact?: boolean; assemble?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const norm = normalizeXHandle(handle) ?? '';
  const [fontsReady, setFontsReady] = useState(false);
  const reduced = useReducedMotion();
  /** idle: draw live; running: the assembly owns the canvas; done: played once. */
  const [show, setShow] = useState<'wait' | 'running' | 'done'>(assemble ? 'wait' : 'done');
  const [thump, setThump] = useState(0);
  const normAtStart = useRef(norm);
  useEffect(() => {
    let live = true;
    void cardFonts().then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, []);
  // start the assembly once the pass is on screen (and its fonts are in)
  useEffect(() => {
    if (show !== 'wait' || !fontsReady) return;
    const c = ref.current;
    if (!c) return;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setShow('done');
      return;
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          io.disconnect();
          normAtStart.current = norm;
          setShow('running');
        }
      },
      { threshold: 0.35 },
    );
    io.observe(c);
    return () => io.disconnect();
  }, [show, fontsReady, reduced, norm]);
  useEffect(() => {
    const c = ref.current;
    if (!c || show !== 'running') return;
    return assemblePass(
      c,
      normAtStart.current,
      () => setThump((n) => n + 1),
      () => setShow('done'),
    );
  }, [show]);
  // typing during the assembly: skip to the live pass
  useEffect(() => {
    if (show === 'running' && norm !== normAtStart.current) setShow('done');
  }, [norm, show]);
  useEffect(() => {
    const c = ref.current;
    if (!c || show === 'running') return;
    if (show === 'wait') {
      drawTicketCard(c, norm, { upto: 0 });
      return;
    }
    const t = setTimeout(() => drawTicketCard(c, norm), 60);
    return () => clearTimeout(t);
  }, [norm, fontsReady, show]);
  return (
    <figure className={`wl-card${compact ? ' is-compact' : ''}${show === 'running' ? ' is-printing' : ''}`}>
      <div className={`wl-card__frame${thump ? ' is-thumped' : ''}`}>
        <canvas
          ref={ref}
          className="wl-card__canvas"
          width={1200}
          height={675}
          role="img"
          aria-label={norm ? `Your boarding pass: @${norm}, number ${ticketNo(norm)}` : 'Your boarding pass, waiting for your handle'}
        />
        {thump > 0 && <InkSplat key={thump} className="wl-card__splat" seed={7} />}
      </div>
      <figcaption className="wl-card__cap mono">
        <span>{norm ? `Pass No. ${ticketNo(norm)}` : 'Pass No. ????'}</span>
        <span>{norm ? `@${norm}` : 'waiting for your handle'}</span>
      </figcaption>
    </figure>
  );
}

export function SaveCardButton({ handle, label = 'Save card' }: { handle: string; label?: string }) {
  const norm = normalizeXHandle(handle);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      lead="ticket"
      disabled={!norm}
      loading={busy}
      onClick={async () => {
        if (!norm) return;
        setBusy(true);
        try {
          await cardFonts();
          const blob = await cardBlob(norm);
          if (blob) saveBlob(blob, `elymum-boarding-pass-${norm}.png`);
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}
