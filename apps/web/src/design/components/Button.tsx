import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'teal' | 'up';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /**
   * `primary` sun sticker (one per view), `secondary` cream sticker, `ghost`
   * dashed outline (no shadow), `danger` red sticker, `teal` / `up` coloured
   * stickers for secondary actions on night / success.
   */
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  /** Trailing icon (the CTA arrow). */
  icon?: IconName;
  /** Leading icon. */
  lead?: IconName;
  /** Mono second line, e.g. "≈ $2.00 · max 3". */
  sub?: ReactNode;
  /** Full width. */
  block?: boolean;
  /** Busy: shows a little spinning coin, keeps the width, blocks clicks (aria-busy). */
  loading?: boolean;
  children: ReactNode;
}

/**
 * The Storybook button: a die-cut sticker with a 3 px ink edge and a hard
 * offset shadow. Hover lifts it a pixel, press sinks it into its shadow
 * (pure CSS, so keyboard :active and reduced motion behave the same).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, lead, sub, block = false, loading = false, className, children, type = 'button', disabled, onClick, ...rest },
  ref,
) {
  const iconSize = size === 'lg' ? 24 : size === 'md' ? 20 : 16;
  return (
    <button
      ref={ref}
      type={type}
      className={`kb-btn kb-btn--${variant} kb-btn--${size}${block ? ' kb-btn--block' : ''}${sub != null ? ' has-sub' : ''}${loading ? ' is-loading' : ''}${className ? ` ${className}` : ''}`}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick}
      {...rest}
    >
      {lead && <Icon name={lead} size={iconSize} className="kb-btn__lead" />}
      <span className="kb-btn__label">
        <span className="kb-btn__text">{children}</span>
        {sub != null && <span className="kb-btn__sub">{sub}</span>}
      </span>
      {icon && <Icon name={icon} size={iconSize} className="kb-btn__icon" />}
      {loading && <span className="kb-btn__busy" aria-hidden="true" />}
    </button>
  );
});
