import type { HTMLAttributes, ReactNode } from 'react';

export interface RuleProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** `thin` hairline, `thick` 2 px, `double` thick+thin newspaper rule, `cut` perforation. */
  variant?: 'thin' | 'thick' | 'double' | 'cut';
  /** Optional centered mono label, e.g. a section kicker. */
  label?: ReactNode;
}

/** Newspaper column rule. */
export function Rule({ variant = 'thin', label, className, ...rest }: RuleProps) {
  const cls = `kb-rule kb-rule--${variant}${className ? ` ${className}` : ''}`;
  if (label == null) return <hr {...rest} className={cls} />;
  return (
    <div {...rest} className={`${cls} has-label`} role="separator">
      <span className="kb-rule__line" aria-hidden="true" />
      <span className="kb-rule__label mono">{label}</span>
      <span className="kb-rule__line" aria-hidden="true" />
    </div>
  );
}
