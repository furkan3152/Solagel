import { COUNTRY_CODES, isCountryCode } from '@elymum/shared';
import { memo, useId, useMemo, type SelectHTMLAttributes } from 'react';
import { intlLocale, useLocale } from '../i18n';
import { FLAG_H, FLAG_W, flagArt, type FlagOp } from '../render/flags';
import './flag.css';

const namers = new Map<string, Intl.DisplayNames | null>();

/** A country's name in the reader's language (`Intl.DisplayNames`), the code itself where the browser has none. */
export function countryName(code: string, locale: string = intlLocale()): string {
  let names = namers.get(locale);
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames([locale, 'en'], { type: 'region', fallback: 'code' });
    } catch {
      names = null;
    }
    namers.set(locale, names);
  }
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
}

function starPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.4;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}`);
  }
  return pts.join(' ');
}

function pairs(op: FlagOp, from: number): string {
  const out: string[] = [];
  for (let i = from; i + 1 < op.length; i += 2) out.push(`${op[i]},${op[i + 1]}`);
  return out.join(' ');
}

/** One table shape (`render/flags.ts`) as SVG. */
function shape(op: FlagOp, key: number) {
  const n = op as readonly number[];
  const c = (i: number) => op[i] as string;
  switch (op[0]) {
    case 'h':
    case 'v': {
      const k = op.length - 1;
      return (
        <g key={key}>
          {op.slice(1).map((col, i) =>
            op[0] === 'h' ? (
              <rect key={i} x={0} y={(i * FLAG_H) / k} width={FLAG_W} height={FLAG_H / k + 0.05} fill={col as string} />
            ) : (
              <rect key={i} x={(i * FLAG_W) / k} y={0} width={FLAG_W / k + 0.05} height={FLAG_H} fill={col as string} />
            ),
          )}
        </g>
      );
    }
    case 'r':
      return <rect key={key} x={n[1]} y={n[2]} width={n[3]} height={n[4]} fill={c(5)} />;
    case 'c':
      return <circle key={key} cx={n[1]} cy={n[2]} r={n[3]} fill={c(4)} />;
    case 'a': {
      const [cx, cy, r, a0, a1] = [n[1], n[2], n[3], n[4], n[5]];
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const d = `M${cx} ${cy} L${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} Z`;
      return <path key={key} d={d} fill={c(6)} />;
    }
    case 's':
      return <polygon key={key} points={starPoints(n[1], n[2], n[3])} fill={c(4)} />;
    case 'p':
      return <polygon key={key} points={pairs(op, 2)} fill={c(1)} />;
    case 'o':
      return <polygon key={key} points={pairs(op, 3)} fill="none" stroke={c(1)} strokeWidth={n[2]} />;
    case 'l':
      return <line key={key} x1={n[3]} y1={n[4]} x2={n[5]} y2={n[6]} stroke={c(1)} strokeWidth={n[2]} />;
    default:
      return null;
  }
}

export interface FlagProps {
  code: string | null | undefined;
  /** Height in CSS px (the width follows 3 : 2). */
  size?: number;
  className?: string;
  /** Announce the country (title and accessible name); off where the row says it in words. */
  label?: boolean;
}

/**
 * A country's flag as a small ink-edged sticker (drawn from the same table as the game's name tags;
 * no images, no emoji). Countries without a drawn flag show their two-letter code on cream.
 * Nothing for a missing or unknown code.
 */
export const Flag = memo(function Flag({ code, size = 14, className, label = true }: FlagProps) {
  const clip = useId();
  useLocale();
  if (!isCountryCode(code)) return null;
  const art = flagArt(code);
  const name = countryName(code);
  const a11y = label ? { role: 'img', 'aria-label': name } : { 'aria-hidden': true as const };
  const cls = `kb-flag${art ? '' : ' is-code'}${className ? ` ${className}` : ''}`;
  const style = { ['--flag-h' as string]: `${size}px` };
  if (!art) {
    return (
      <span className={cls} style={style} title={label ? name : undefined} {...a11y}>
        <span className="kb-flag__code mono" aria-hidden="true">
          {code}
        </span>
      </span>
    );
  }
  return (
    <span className={cls} style={style} title={label ? name : undefined} {...a11y}>
      <svg viewBox={`0 0 ${FLAG_W} ${FLAG_H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <clipPath id={clip}>
          <rect width={FLAG_W} height={FLAG_H} />
        </clipPath>
        <g clipPath={`url(#${clip})`}>{art.map(shape)}</g>
      </svg>
    </span>
  );
});

/** Every country, by name in the reader's language. */
function useCountryOptions(): { code: string; name: string }[] {
  const locale = useLocale();
  return useMemo(() => {
    const tag = intlLocale();
    return COUNTRY_CODES.map((code) => ({ code, name: countryName(code, tag) })).sort((a, b) => a.name.localeCompare(b.name, tag));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);
}

export interface CountryFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> {
  label: string;
  /** '' for none. */
  value: string;
  onChange: (code: string) => void;
  /** The "none" option's text. */
  noneLabel: string;
  hint?: string;
}

/** The country picker: a form box like `Field` (mono caption, bold value) with the flag in front. */
export function CountryField({ label, value, onChange, noneLabel, hint, id, className, ...select }: CountryFieldProps) {
  const auto = useId();
  const selectId = id ?? `c${auto}`;
  const noteId = `${selectId}-note`;
  const options = useCountryOptions();
  return (
    <div className={`kb-field kb-country${className ? ` ${className}` : ''}`}>
      <label className="kb-field__label mono" htmlFor={selectId}>
        {label}
      </label>
      <div className="kb-field__box">
        <span className="kb-country__flag" aria-hidden="true">
          {isCountryCode(value) ? <Flag code={value} size={18} label={false} /> : <span className="kb-flag is-none" style={{ ['--flag-h' as string]: '18px' }} />}
        </span>
        <select
          id={selectId}
          className="kb-field__input kb-country__select"
          value={isCountryCode(value) ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? noteId : undefined}
          {...select}
        >
          <option value="">{noneLabel}</option>
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.name}
            </option>
          ))}
        </select>
        <svg className="kb-country__chev" viewBox="0 0 12 8" aria-hidden="true" focusable="false">
          <path d="M1 1.5 L6 6.5 L11 1.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {hint && (
        <div id={noteId} className="kb-field__note">
          {hint}
        </div>
      )}
    </div>
  );
}
