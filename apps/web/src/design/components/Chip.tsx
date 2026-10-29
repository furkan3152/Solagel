import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '../icons';

export interface ChipProps extends Omit<HTMLAttributes<HTMLElement>, 'onClick' | 'children'> {
  children: ReactNode;
  /** Tag stock: `ink` cream (default), `sun`, `teal` mist, `up` mint, `down` pink, `cyan`, `on-dark` outline on night; legacy `pink`/`mustard` → sun. */
  tone?: 'ink' | 'sun' | 'teal' | 'up' | 'down' | 'cyan' | 'pink' | 'mustard' | 'on-dark';
  icon?: IconName;
  /** Makes it a toggle button (aria-pressed). */
  selected?: boolean;
  onClick?: () => void;
}

/**
 * A little pill tag (Geist Mono caps, ink edge). Static by default; with
 * `onClick` it becomes a toggle (selected = sun with a hard shadow) whose hit
 * area is padded out to 44 px while the tag stays compact.
 */
export function Chip({ children, tone = 'ink', icon, selected, onClick, className, ...rest }: ChipProps) {
  const cls = `kb-chip mono kb-tone-${tone}${selected ? ' is-on' : ''}${onClick ? ' is-button' : ''}${className ? ` ${className}` : ''}`;
  const inner = (
    <>
      {icon && <Icon name={icon} size={14} />}
      <span>{children}</span>
    </>
  );
  if (!onClick) {
    return (
      <span {...rest} className={cls}>
        {inner}
      </span>
    );
  }
  return (
    <button {...rest} type="button" className={cls} aria-pressed={selected ?? false} onClick={onClick}>
      {inner}
    </button>
  );
}
