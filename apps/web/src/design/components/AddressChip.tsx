import { useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { Icon } from '../icons';

export interface AddressChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** 0x… address (or a tx hash). */
  address: string;
  /** Hex characters kept on each side (default 4: 0x7a3f…e91c). */
  chars?: number;
  /** Show the copy button (default true). */
  copy?: boolean;
  /** Link the address (an explorer URL). Opens in a new tab. */
  href?: string;
  /** Text read before the address, e.g. "Owner". */
  label?: string;
  /** Labels for the copy button (translated). */
  copyLabel?: string;
  copiedLabel?: string;
  size?: 'sm' | 'md';
}

/** `0x7a3f…e91c`: the middle elided, the ends kept. */
export function shortAddress(address: string, chars = 4): string {
  if (!address) return '';
  const head = address.startsWith('0x') ? 2 + chars : chars;
  if (address.length <= head + chars + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-chars)}`;
}

/**
 * An address as a little sticker tag: Geist Mono, the middle elided, the full
 * value in the title, a copy button that says "Copied" for a moment.
 */
export function AddressChip({ address, chars = 4, copy = true, href, label, copyLabel = 'Copy address', copiedLabel = 'Copied', size = 'md', className, ...rest }: AddressChipProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const short = shortAddress(address, chars);
  const onCopy = async () => {
    try {
      await navigator.clipboard?.writeText(address);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard refused: nothing to do */
    }
  };
  const text = (
    <span className="kb-addr__text" title={address}>
      {label && <span className="kb-addr__label">{label}</span>}
      {short}
    </span>
  );
  return (
    <span {...rest} className={`kb-addr kb-addr--${size}${copied ? ' is-copied' : ''}${className ? ` ${className}` : ''}`}>
      {href ? (
        <a className="kb-addr__link" href={href} target="_blank" rel="noreferrer noopener" aria-label={`${label ? `${label} ` : ''}${address}`}>
          {text}
        </a>
      ) : (
        <span aria-label={`${label ? `${label} ` : ''}${address}`}>{text}</span>
      )}
      {copy && (
        <button type="button" className="kb-addr__copy" onClick={onCopy} aria-label={copied ? copiedLabel : copyLabel}>
          {copied ? <Icon name="check" size={14} /> : <CopyGlyph />}
          <span className="kb-addr__copied" aria-live="polite">
            {copied ? copiedLabel : ''}
          </span>
        </button>
      )}
    </span>
  );
}

function CopyGlyph() {
  return (
    <svg className="kb-icon" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 5.5v-.5a1.5 1.5 0 0 0-1.5-1.5H6a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6 14.5h.5" />
    </svg>
  );
}
