import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '../icons';

export interface ChipProps extends Omit<HTMLAttributes<HTMLElement>, 'onClick' | 'children'> {
  children: ReactNode;
  tone?: 'ink' | 'pink' | 'teal' | 'mustard' | 'on-dark';
  icon?: IconName;
  /** Makes it a toggle button (aria-pressed). */
  selected?: boolean;
  onClick?: () => void;
}

/**
 * Mono label in a printed frame. Static by default; with `onClick` it becomes a
 * toggle whose hit area is padded out to 44 px while the print stays compact.
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
