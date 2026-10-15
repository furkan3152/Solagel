import { AnimatePresence, motion, type TargetAndTransition } from 'motion/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';
import { useKbTheme, type KbTheme } from '../Kb';
import { usePreset, useReducedMotion } from '../motion';
import { Tape } from './Tape';

export interface SheetProps {
  /** Passed to the dialog panel. */
  id?: string;
  className?: string;
  'aria-describedby'?: string;
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
  /** Override the stock. Defaults to the surrounding `<Kb>` theme (the sheet is portalled). */
  theme?: KbTheme;
  /**
   * Where the panel comes from instead of rising from below (e.g. the receipt
   * printed out of the HUD till): a motion target it animates in from. Ignored
   * with reduced motion.
   */
  enterFrom?: TargetAndTransition | null;
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
export function Sheet({
  id,
  className,
  'aria-describedby': describedBy,
  open,
  onClose,
  title,
  closeLabel,
  kicker,
  children,
  footer,
  theme: themeProp,
  enterFrom = null,
}: SheetProps) {
  const ctxTheme = useKbTheme();
  const theme = themeProp ?? ctxTheme;
  const narrow = useIsNarrow();
  const reduced = useReducedMotion();
  const spring = usePreset('sheet', { fade: true });
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    // the app's sound listens for this (the design system stays free of audio code)
    window.dispatchEvent(new CustomEvent('kb:sheet', { detail: { open: true } }));
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
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.getClientRects().length > 0);
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
      window.dispatchEvent(new CustomEvent('kb:sheet', { detail: { open: false } }));
    };
  }, [open]);

  // the panel rises on a spring and its paper shadow grows as it lifts off the table (`--lift`)
  const rise: TargetAndTransition = narrow ? { y: '104%', '--lift': 0 } : { opacity: 0, y: 40, rotate: -1.6, scale: 0.97, '--lift': 0 };
  const from: TargetAndTransition = reduced ? { opacity: 0 } : (enterFrom ?? rise);
  const leave: TargetAndTransition = reduced ? { opacity: 0 } : rise;
  const to: TargetAndTransition = reduced
    ? { opacity: 1 }
    : narrow
      ? { y: '0%', x: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, '--lift': 1 }
      : { opacity: 1, x: 0, y: 0, rotate: 0, scale: 1, scaleX: 1, scaleY: 1, '--lift': 1 };

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
            id={id}
            className={`kb-sheet paper${narrow ? ' is-bottom' : ''}${className ? ` ${className}` : ''}`}
            aria-describedby={describedBy}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={from}
            animate={to}
            exit={leave}
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
