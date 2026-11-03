import { Icon } from '../design';
import { isLocale, LOCALES, setLocale, useLocale, useT } from '../i18n';
import './language-picker.css';

/**
 * The language picker: a Storybook tag over a native `<select>` (the platform list on phones,
 * keyboard and screen readers for free). `compact` shows the two-letter mark (site header);
 * the full form shows the language's own name (settings).
 */
export function LanguagePicker({ compact = false, className }: { compact?: boolean; className?: string }) {
  const t = useT();
  const locale = useLocale();
  const info = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];
  return (
    <label className={`lang-pick${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`} data-testid="lang-pick">
      <Icon name="globe" size={compact ? 18 : 16} className="lang-pick__globe" />
      <span className={`lang-pick__value${compact ? ' mono' : ''}`} lang={info.tag} aria-hidden="true">
        {compact ? info.short : info.name}
      </span>
      <Icon name="chevron" size={14} className="lang-pick__chev" />
      <select
        className="lang-pick__select"
        aria-label={t('site.lang')}
        value={locale}
        onChange={(e) => {
          if (isLocale(e.target.value)) void setLocale(e.target.value);
        }}
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code} lang={l.tag}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
