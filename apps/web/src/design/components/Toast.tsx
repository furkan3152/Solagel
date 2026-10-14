import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { usePreset, useReducedMotion } from '../motion';
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

/** Fixed stack (top-right; top-center on phones) with spring in / tear-off out. */
export function ToastViewport({
  toasts,
  onDismiss,
  closeLabel,
  label,
}: {
  toasts: ToastItem[];
  onDismiss: (id: ToastItem['id']) => void;
  closeLabel: string;
  /** Accessible name of the region. */
  label: string;
}) {
  const reduced = useReducedMotion();
  const spring = usePreset('sheet', { fade: true });
  return (
    <section className="kb-toasts" aria-label={label}>
      <AnimatePresence initial={false}>
        {toasts.map((t, i) => (
          <motion.div
            key={t.id}
            layout={!reduced}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -24, rotate: -4, scale: 0.96 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, rotate: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: 40, rotate: 6, transition: { duration: 0.2 } }}
            transition={spring}
          >
            <Toast {...t} tilt={t.tilt ?? (i % 2 ? 0.8 : -0.6)} onClose={() => onDismiss(t.id)} closeLabel={closeLabel} />
          </motion.div>
        ))}
      </AnimatePresence>
    </section>
  );
}
