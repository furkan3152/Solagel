import type { HTMLAttributes, ReactNode } from 'react';

export interface DatelineProps extends Omit<HTMLAttributes<HTMLUListElement>, 'children'> {
  /** Short mono facts, e.g. ["Sezon 01", "12 gün kaldı", "Havuz 84.200 $SLANA"]. */
  items: ReactNode[];
  /** Accessible name for the strip. */
  label?: string;
}

/** The season strip under a masthead: thick rule over, hairline under. */
export function Dateline({ items, label, className, ...rest }: DatelineProps) {
  return (
    <ul {...rest} className={`kb-dateline mono${className ? ` ${className}` : ''}`} aria-label={label}>
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}
