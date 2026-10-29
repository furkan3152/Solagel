import { normalizeXHandle } from '@elymum/shared';
import { useEffect, useRef, useState } from 'react';
import { InkButton } from '../../design';
import { saveBlob } from '../api';
import { ticketNo } from '../coinLook';
import { cardBlob, cardFonts, drawTicketCard } from './card';

/** The live ticket card for a handle, redrawn as the visitor types. */
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
      <canvas ref={ref} className="wl-card__canvas" width={1200} height={675} role="img" aria-label={norm ? `Your ticket card: @${norm}, number ${ticketNo(norm)}` : 'Your ticket card, waiting for your handle'} />
      <figcaption className="wl-card__cap mono">{norm ? `Card No. ${ticketNo(norm)} · @${norm}` : 'Card No. ???? · waiting for your handle'}</figcaption>
    </figure>
  );
}

export function SaveCardButton({ handle, label = 'Save card' }: { handle: string; label?: string }) {
  const norm = normalizeXHandle(handle);
  const [busy, setBusy] = useState(false);
  return (
    <InkButton
      variant="paper"
      size="sm"
      lead="ticket"
      disabled={!norm || busy}
      onClick={async () => {
        if (!norm) return;
        setBusy(true);
        try {
          await cardFonts();
          const blob = await cardBlob(norm);
          if (blob) saveBlob(blob, `slana-wl-${norm}.png`);
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </InkButton>
  );
}
