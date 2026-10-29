import type { HTMLAttributes } from 'react';

export interface QuantityStepperProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max: number;
  /** Accessible name, e.g. "How many emblems". */
  label: string;
  /** Labels for − / + (translated). */
  lessLabel?: string;
  moreLabel?: string;
  disabled?: boolean;
  size?: 'md' | 'lg';
}

/**
 * [ − | 2 | + ]: a chunky sticker with an ink frame and hard shadow, the
 * figure in Geist Mono. The figure is a spinbutton (Up/Down/Home/End work on
 * it); the buttons are the 44 px touch targets.
 */
export function QuantityStepper({ value, onChange, min = 1, max, label, lessLabel = 'One fewer', moreLabel = 'One more', disabled = false, size = 'md', className, ...rest }: QuantityStepperProps) {
  const set = (v: number) => {
    const n = Math.min(max, Math.max(min, v));
    if (n !== value) onChange(n);
  };
  return (
    <div {...rest} className={`kb-qty kb-qty--${size}${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
      <button type="button" className="kb-qty__btn" onClick={() => set(value - 1)} disabled={disabled || value <= min} aria-label={lessLabel}>
        −
      </button>
      <span
        className="kb-qty__val"
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-disabled={disabled || undefined}
        onKeyDown={(e) => {
          if (disabled) return;
          let next: number | null = null;
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = value + 1;
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = value - 1;
          else if (e.key === 'Home') next = min;
          else if (e.key === 'End') next = max;
          if (next === null) return;
          e.preventDefault();
          set(next);
        }}
      >
        {value}
      </span>
      <button type="button" className="kb-qty__btn" onClick={() => set(value + 1)} disabled={disabled || value >= max} aria-label={moreLabel}>
        +
      </button>
    </div>
  );
}
