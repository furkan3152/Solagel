import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useKbTheme, type KbTheme } from '../Kb';
import { Icon, type IconName } from '../icons';
import { DUR, EASE } from '../curves';
import { springs, usePreset, useReducedMotion } from '../motion';
import { Tape } from './Tape';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastProps {
  tone?: ToastTone;
  title: ReactNode;
  message?: ReactNode;
  /** Defaults per tone: info / check / close. */
  icon?: IconName;
  onClose?: () => void;
  /** Accessible label for the dismiss button (translated). */
  closeLabel?: string;
  /** Slight hand-placed tilt in degrees. */
  tilt?: number;
}

const TONE_ICON: Record<ToastTone, IconName> = { info: 'info', success: 'check', error: 'close' };

/** A torn slip taped to the screen. Use inside `ToastViewport` for live updates. */
export function Toast({ tone = 'info', title, message, icon, onClose, closeLabel, tilt = 0 }: ToastProps) {
  return (
    <div
      className={`kb-toast kb-toast--${tone}`}
      style={{ transform: `rotate(${tilt}deg)` }}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Tape rotate={-3} width={64} tone={tone === 'error' ? 'pink' : tone === 'success' ? 'teal' : 'mustard'} style={{ left: 18, top: -9 }} />
      <div className="kb-toast__slip">
        <span className="kb-toast__mark" aria-hidden="true">
          <Icon name={icon ?? TONE_ICON[tone]} size={18} />
        </span>
        <div className="kb-toast__text">
          <div className="kb-toast__title">{title}</div>
          {message != null && <div className="kb-toast__msg">{message}</div>}
        </div>
        {onClose && (
          <button type="button" className="kb-iconbtn kb-iconbtn--sm" onClick={onClose} aria-label={closeLabel}>
            <Icon name="close" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

export interface ToastItem extends Omit<ToastProps, 'onClose'> {
  id: string | number;
}

/**
 * Fixed stack (top-right; full width on phones) with spring in / tear-off out.
 * Portalled to <body> in its own `.kb` root, themed from the surrounding <Kb>.
 */
export function ToastViewport({
  toasts,
  onDismiss,
  closeLabel,
  label,
  theme: themeProp,
}: {
  toasts: ToastItem[];
  onDismiss: (id: ToastItem['id']) => void;
  closeLabel: string;
  /** Accessible name of the region. */
  label: string;
  /** Override the stock; defaults to the `<Kb>` theme. */
  theme?: KbTheme;
}) {
  const ctxTheme = useKbTheme();
  const theme = themeProp ?? ctxTheme;
  const reduced = useReducedMotion();
  const spring = usePreset('sheet', { fade: true });
  return createPortal(
    <section className="kb kb-toasts" data-theme={theme} aria-label={label}>
      <AnimatePresence initial={false}>
        {toasts.map((t, i) => (
          <motion.div
            key={t.id}
            layout={!reduced}
            // a note pinned by its tape: it drops on, swings about the pin and hangs still;
            // dismissed, it is flicked off up and to the side
            style={{ transformOrigin: '42px 0px' }}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -30, rotate: -10, scale: 1.02 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, rotate: 0, scale: 1 }}
            exit={
              reduced
                ? { opacity: 0, transition: { duration: DUR.fade } }
                : { opacity: 0, x: 150, y: -46, rotate: 24, transition: { duration: 0.26, ease: EASE.flick, opacity: { duration: 0.26, ease: 'easeIn' } } }
            }
            transition={reduced ? spring : { ...spring, rotate: springs.pin, opacity: { duration: 0.12 } }}
          >
            <Toast {...t} tilt={t.tilt ?? (i % 2 ? 0.8 : -0.6)} onClose={() => onDismiss(t.id)} closeLabel={closeLabel} />
          </motion.div>
        ))}
      </AnimatePresence>
    </section>,
    document.body,
  );
}
