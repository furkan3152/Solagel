import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon, useKbTheme } from '../design';
import { LOCALES, setLocale, useLocale, useT } from '../i18n';
import './language-picker.css';

/** Phones get the list as a bottom sheet (thumb reach, big rows); wider screens a popover. */
const SHEET_QUERY = '(max-width: 479px)';
const GAP = 8;
const EDGE = 8;

function useSheetMode(): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(SHEET_QUERY).matches === true);
  useEffect(() => {
    const m = window.matchMedia?.(SHEET_QUERY);
    if (!m) return;
    const sync = () => setOn(m.matches);
    m.addEventListener('change', sync);
    return () => m.removeEventListener('change', sync);
  }, []);
  return on;
}

type Place = { left: number; width: number; maxHeight: number; top?: number; bottom?: number };

/**
 * The language picker: a cream Storybook tag that opens a sticker list of the languages, each in
 * its own name, the current one checked. On phones the list rises as a bottom sheet. A listbox
 * for keyboards and screen readers: arrows, Home/End, Enter or Space to pick, Esc or Tab to close
 * (focus goes back to the tag). `compact` shows the two-letter mark (site header); the full form
 * shows the language's own name (settings).
 */
export function LanguagePicker({ compact = false, className }: { compact?: boolean; className?: string }) {
  const t = useT();
  const locale = useLocale();
  const theme = useKbTheme();
  const sheet = useSheetMode();
  const uid = useId();
  const listId = `${uid}-list`;
  const optId = (i: number) => `${uid}-opt-${i}`;
  const current = Math.max(
    0,
    LOCALES.findIndex((l) => l.code === locale),
  );
  const info = LOCALES[current];

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(current);
  const [place, setPlace] = useState<Place | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  }, []);
  const choose = useCallback(
    (i: number) => {
      const l = LOCALES[i];
      close();
      if (l && l.code !== locale) void setLocale(l.code);
    },
    [close, locale],
  );
  const show = (i = current) => {
    setActive(i);
    setOpen(true);
  };

  // the popover hangs under the tag (or over it near the bottom of the window), inside the screen
  const measure = useCallback(() => {
    const b = btn.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 244), window.innerWidth - 2 * EDGE);
    const left = Math.min(Math.max(EDGE, r.right - width), window.innerWidth - width - EDGE);
    const h = panel.current?.scrollHeight ?? LOCALES.length * 46 + 16;
    const below = window.innerHeight - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    // the side with room for the whole list (else the roomier one, the list scrolling inside)
    if (below < h && above > below) setPlace({ left, width, maxHeight: Math.min(420, above), bottom: window.innerHeight - r.top + GAP });
    else setPlace({ left, width, maxHeight: Math.min(420, below), top: r.bottom + GAP });
  }, []);
  useLayoutEffect(() => {
    if (!open || sheet) return;
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, sheet, measure]);

  useEffect(() => {
    if (!open) return;
    list.current?.focus({ preventScroll: true });
    const n = LOCALES.length;
    // capture on the window: runs before a surrounding sheet's own Escape and focus trap
    const onKey = (e: KeyboardEvent) => {
      let handled = true;
      switch (e.key) {
        case 'Escape':
          close();
          break;
        case 'Tab':
          close();
          break;
        case 'ArrowDown':
          setActive((a) => (a + 1) % n);
          break;
        case 'ArrowUp':
          setActive((a) => (a - 1 + n) % n);
          break;
        case 'Home':
          setActive(0);
          break;
        case 'End':
          setActive(n - 1);
          break;
        case 'Enter':
        case ' ':
          choose(activeRef.current);
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onDown = (e: PointerEvent) => {
      const at = e.target as Node | null;
      if (at && (panel.current?.contains(at) || btn.current?.contains(at))) return;
      close(false);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, close, choose]);

  useEffect(() => {
    if (open) document.getElementById(`${uid}-opt-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, uid]);

  const onTriggerKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      show(e.key === 'ArrowUp' ? LOCALES.length - 1 : current);
    }
  };

  const label = t('site.lang');
  const popup = open
    ? createPortal(
        <div className={`kb lang-pop-layer${sheet ? ' is-sheet' : ''}`} data-theme={theme}>
          {sheet && <div className="lang-pop-scrim" aria-hidden="true" />}
          <div
            ref={panel}
            className={`lang-pop${sheet ? ' is-sheet' : ''}${place?.bottom !== undefined ? ' is-up' : ''}`}
            style={sheet || !place ? undefined : { left: place.left, width: place.width, maxHeight: place.maxHeight, top: place.top, bottom: place.bottom }}
            data-testid="lang-pop"
          >
            {sheet && (
              <>
                <span className="lang-pop__grip" aria-hidden="true" />
                <div className="lang-pop__title" aria-hidden="true">
                  <Icon name="globe" size={18} />
                  {label}
                </div>
              </>
            )}
            <ul ref={list} id={listId} className="lang-pop__list" role="listbox" aria-label={label} tabIndex={-1} aria-activedescendant={optId(active)}>
              {LOCALES.map((l, i) => {
                const on = l.code === locale;
                return (
                  <li
                    key={l.code}
                    id={optId(i)}
                    role="option"
                    aria-selected={on}
                    lang={l.tag}
                    className={`lang-pop__opt${i === active ? ' is-active' : ''}${on ? ' is-on' : ''}`}
                    onPointerMove={() => i !== activeRef.current && setActive(i)}
                    onClick={() => choose(i)}
                  >
                    <span className="lang-pop__check" aria-hidden="true">
                      {on && <Icon name="check" size={18} />}
                    </span>
                    <span className="lang-pop__name">{l.name}</span>
                    <span className="lang-pop__code mono" aria-hidden="true">
                      {l.short}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`lang-pick${compact ? ' is-compact' : ''}${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
        data-testid="lang-pick"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${info.name}`}
        onClick={() => (open ? close() : show())}
        onKeyDown={onTriggerKey}
      >
        <Icon name="globe" size={compact ? 18 : 16} className="lang-pick__globe" />
        <span className={`lang-pick__value${compact ? ' mono' : ''}`} lang={info.tag} aria-hidden="true">
          {compact ? info.short : info.name}
        </span>
        <Icon name="chevron" size={14} className="lang-pick__chev" />
      </button>
      {popup}
    </>
  );
}
