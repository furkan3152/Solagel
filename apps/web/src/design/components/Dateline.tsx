import type { ReactNode } from 'react';

export interface DatelineProps {
  /** Short mono facts, e.g. ["Sezon 01", "12 gün kaldı", "Havuz 84.200 $SLANA"]. */
  items: ReactNode[];
  /** Accessible name for the strip. */
  label?: string;
  className?: string;
}

/** The season strip under a masthead: thick rule over, hairline under. */
export function Dateline({ items, label, className }: DatelineProps) {
  return (
    <ul className={`kb-dateline mono${className ? ` ${className}` : ''}`} aria-label={label}>
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}
