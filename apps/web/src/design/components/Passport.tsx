import { AnimatePresence, motion } from 'motion/react';
import type { HTMLAttributes, ReactNode } from 'react';
import { usePreset, useReducedMotion } from '../motion';
import { Stamp } from './Stamp';

export interface PassportTrait {
  label: ReactNode;
  value: ReactNode;
}

export interface PassportProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  /** Cover title (brand), e.g. "SLANA". */
  title: string;
  /** Cover subtitle, e.g. "PASS". */
  kind: string;
  /** Label before the number, e.g. "No." (translated). */
  numberLabel: string;
  /** Token number, printed after `numberLabel`. Pass it already formatted. */
  number?: string;
  /** Owner / holder line on the page, with its label. */
  holder?: ReactNode;
  holderLabel?: ReactNode;
  traits?: PassportTrait[];
  /** NFT art (square). */
  art?: ReactNode;
  /** Sealed: closed cover with a wax seal, page not shown. */
  sealed?: boolean;
  /** Stamp text on the sealed cover, e.g. "MÜHÜRLÜ". */
  sealedLabel?: string;
  /** Visa stamp on the open page, e.g. "GEÇERLİ". */
  visa?: string;
}

/** A passport booklet: teal cover with gold foil, guilloche page, MRZ footer. */
export function Passport({
  title,
  kind,
  numberLabel,
  number,
  holder,
  holderLabel,
  traits = [],
  art,
  sealed = false,
  sealedLabel,
  visa,
  className,
  ...rest
}: PassportProps) {
  const sheet = usePreset('sheet', { fade: true });
  const reduced = useReducedMotion();
  const mrz = `P<${title}<<${kind}<${(number ?? '').replace(/\D/g, '').padStart(4, '0')}`.padEnd(36, '<');
  const visaStamp = visa && <Stamp text={visa} tone="pink" size="md" round rotate={-14} />;
  return (
    <div {...rest} className={`kb-passport-c${className ? ` ${className}` : ''}`}>
      <div className={`kb-passport${sealed ? ' is-sealed' : ''}`}>
        <div className="kb-passport__cover">
          <Crest />
          <div className="kb-passport__brand">{title}</div>
          <div className="kb-passport__kind mono">{kind}</div>
          {number && (
            <div className="kb-passport__no mono">
              {numberLabel} {number}
            </div>
          )}
          {sealed && (
            <>
              <WaxSeal />
              {sealedLabel && (
                <span className="kb-passport__sealstamp">
                  <Stamp text={sealedLabel} tone="mustard" size="md" rotate={-9} />
                </span>
              )}
            </>
          )}
        </div>
        <AnimatePresence initial={false}>
          {!sealed && (
            <motion.div
              key="page"
              className="kb-passport__page"
              initial={reduced ? { opacity: 0 } : { opacity: 0, rotateY: -70, x: -16 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, rotateY: 0, x: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, rotateY: -70, x: -16 }}
              transition={sheet}
            >
              <div className="kb-passport__grid">
                {art != null && (
                  <div className="kb-passport__photo">
                    <div className="kb-passport__art">{art}</div>
                    {visaStamp && <span className="kb-passport__visa">{visaStamp}</span>}
                  </div>
                )}
                <dl className="kb-passport__fields">
                  {holder != null && (
                    <div className="kb-passport__field is-wide">
                      <dt className="mono">{holderLabel}</dt>
                      <dd>{holder}</dd>
                    </div>
                  )}
                  {traits.map((tr, i) => (
                    <div key={i} className="kb-passport__field">
                      <dt className="mono">{tr.label}</dt>
                      <dd>{tr.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              {visaStamp && art == null && <span className="kb-passport__visa is-corner">{visaStamp}</span>}
              <div className="kb-passport__mrz" aria-hidden="true">
                {mrz}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Foil crest: a crowned coin in two misregistered passes. */
function Crest() {
  return (
    <svg className="kb-passport__crest" viewBox="0 0 64 64" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="32" cy="36" r="17" />
        <circle cx="32" cy="36" r="11.5" strokeDasharray="0.1 4.2" />
        <path d="M21 17l-2-9 7.5 5L32 5l5.5 8L45 8l-2 9z" />
        <path d="M27 36h10M32 31v10" />
      </g>
    </svg>
  );
}

function WaxSeal() {
  return (
    <svg className="kb-passport__wax" viewBox="0 0 80 80" aria-hidden="true">
      <path
        d="M40 4c5 0 6 4 10 5s8-2 11 1 0 7 2 11 7 5 7 10-4 6-4 10 4 7 2 11-7 2-10 5-1 8-6 9-7-3-12-3-7 4-12 3-4-7-7-9-8 0-10-4 2-7 1-11-6-5-6-10 5-6 6-10-2-8 1-11 7 0 11-2 5-5 10-5z"
        style={{ fill: 'var(--pink)' }}
      />
      <circle cx="40" cy="41" r="21" fill="none" style={{ stroke: 'var(--pink-ink)' }} strokeWidth="2.4" opacity="0.8" />
      <path
        d="M47 32.5c-1.6-2.4-4.3-3.6-7.3-3.6-4.2 0-7.2 2.3-7.2 5.4 0 7.2 15 3.8 15 11 0 3.2-3.3 5.6-7.6 5.6-3.3 0-6.2-1.4-7.8-3.9"
        fill="none"
        style={{ stroke: 'var(--ink-fixed)' }}
        strokeWidth="3.4"
        strokeLinecap="round"
        opacity="0.82"
      />
    </svg>
  );
}
