import { normalizeXHandle } from '@elymum/shared';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../design';
import { saveBlob } from '../api';
import { ticketNo } from '../coinLook';
import { cardBlob, cardFonts, drawTicketCard } from './card';

/** The live boarding pass for a handle, redrawn as the visitor types. */
export function CardPreview({ handle, compact = false }: { handle: string; compact?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const norm = normalizeXHandle(handle) ?? '';
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let live = true;
    void cardFonts().then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const t = setTimeout(() => drawTicketCard(c, norm), 60);
    return () => clearTimeout(t);
  }, [norm, fontsReady]);
  return (
    <figure className={`wl-card${compact ? ' is-compact' : ''}`}>
      <div className="wl-card__frame">
        <canvas
          ref={ref}
          className="wl-card__canvas"
          width={1200}
          height={675}
          role="img"
          aria-label={norm ? `Your boarding pass: @${norm}, number ${ticketNo(norm)}` : 'Your boarding pass, waiting for your handle'}
        />
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
