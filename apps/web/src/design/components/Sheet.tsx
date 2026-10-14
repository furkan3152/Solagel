import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';
import { usePreset, useReducedMotion } from '../motion';
import { Tape } from './Tape';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Accessible label for the close button (translated). */
  closeLabel: string;
  /** Mono kicker above the title. */
  kicker?: ReactNode;
  children?: ReactNode;
  /** Sticky action row at the bottom. */
  footer?: ReactNode;
  /** Theme to print the sheet in (it is portalled out of the themed tree). */
  theme?: 'paper' | 'night';
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function useIsNarrow(): boolean {
  const q = '(max-width: 639px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

/**
 * Modal on desktop, bottom sheet on phones. Paper texture, taped corners.
 * Traps focus, closes on Esc and on the scrim, restores focus to the opener.
 */
export function Sheet({ open, onClose, title, closeLabel, kicker, children, footer, theme = 'paper' }: SheetProps) {
  const narrow = useIsNarrow();
  const reduced = useReducedMotion();
  const spring = usePreset('sheet', { fade: true });
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFirst = () => {
      const el = panel.current;
      if (!el) return;
      const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? el).focus();
    };
    const raf = requestAnimationFrame(focusFirst);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open]);

  const from = reduced ? { opacity: 0 } : narrow ? { y: '104%' } : { opacity: 0, y: 28, rotate: -1.2, scale: 0.98 };
  const to = reduced ? { opacity: 1 } : narrow ? { y: '0%' } : { opacity: 1, y: 0, rotate: 0, scale: 1 };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div key="sheet" className="kb kb-sheet-layer" data-theme={theme}>
          <motion.div
            className="kb-sheet-scrim"
            onClick={() => onCloseRef.current()}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.1 : 0.22 }}
          />
          <motion.div
            ref={panel}
            className={`kb-sheet paper${narrow ? ' is-bottom' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={from}
            animate={to}
            exit={from}
            transition={spring}
          >
            {!narrow && (
              <>
                <Tape rotate={-38} width={92} style={{ left: -24, top: 10 }} />
                <Tape rotate={36} width={92} tone="pink" style={{ right: -24, top: 10 }} />
              </>
            )}
            {narrow && <span className="kb-sheet__grip" aria-hidden="true" />}
            <header className="kb-sheet__head">
              <div className="kb-sheet__titles">
                {kicker != null && <div className="kb-sheet__kicker mono">{kicker}</div>}
                <h2 id={titleId} className="kb-sheet__title">
                  {title}
                </h2>
              </div>
              <button type="button" className="kb-iconbtn" onClick={() => onCloseRef.current()} aria-label={closeLabel}>
                <Icon name="close" size={22} />
              </button>
            </header>
            <div className="kb-sheet__body">{children}</div>
            {footer != null && <footer className="kb-sheet__foot">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
