import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '../icons';

export interface InkButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: 'ink' | 'pink' | 'paper';
  size?: 'sm' | 'md' | 'lg';
  /** Trailing icon (the CTA arrow), printed in the accent ink. */
  icon?: IconName;
  /** Leading icon. */
  lead?: IconName;
  /** Mono second line (lg only reads well), e.g. "Kuruş Gölü · 1.000 $SLANA". */
  sub?: ReactNode;
  block?: boolean;
  children: ReactNode;
}

/**
 * Printed button. The offset shadow is the second riso pass (misregistration):
 * it slides out a hair on hover and the button collapses 4 px into it on press.
 * Pure CSS so keyboard :active and reduced motion behave the same.
 */
export function InkButton({
  variant = 'ink',
  size = 'md',
  icon,
  lead,
  sub,
  block = false,
  className,
  children,
  type = 'button',
  ...rest
}: InkButtonProps) {
  const iconSize = size === 'lg' ? 28 : size === 'md' ? 22 : 18;
  return (
    <button
      type={type}
      className={`kb-btn kb-btn--${variant} kb-btn--${size}${block ? ' kb-btn--block' : ''}${sub ? ' has-sub' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {lead && <Icon name={lead} size={iconSize} className="kb-btn__lead" />}
      <span className="kb-btn__label">
        <span className="kb-btn__text">{children}</span>
        {sub != null && <span className="kb-btn__sub mono">{sub}</span>}
      </span>
      {icon && <Icon name={icon} size={iconSize} className="kb-btn__icon" />}
    </button>
  );
}
