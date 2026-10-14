import type { ReactNode } from 'react';

export interface RuleProps {
  /** `thin` hairline, `thick` 2 px, `double` thick+thin newspaper rule, `cut` perforation. */
  variant?: 'thin' | 'thick' | 'double' | 'cut';
  /** Optional centered mono label, e.g. a section kicker. */
  label?: ReactNode;
  className?: string;
}

/** Newspaper column rule. */
export function Rule({ variant = 'thin', label, className }: RuleProps) {
  const cls = `kb-rule kb-rule--${variant}${className ? ` ${className}` : ''}`;
  if (label == null) return <hr className={cls} />;
  return (
    <div className={`${cls} has-label`} role="separator">
      <span className="kb-rule__line" aria-hidden="true" />
      <span className="kb-rule__label mono">{label}</span>
      <span className="kb-rule__line" aria-hidden="true" />
    </div>
  );
}
