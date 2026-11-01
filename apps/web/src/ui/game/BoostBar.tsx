import { BOOST_KEY_LABELS, BOOST_KINDS, boostCooldownMs, type BoostKind } from '@elymum/shared';
import { useRef, useState } from 'react';
import { engine } from '../../game/instance';
import { useT } from '../../i18n';
import { openModal, useUi } from '../../store';
import { useTicker } from '../ticker';

/** Bought power-up glyphs in the icon set's hand (24 grid, round 2.2 px strokes). */
export const BOOST_PATH: Record<BoostKind, string> = {
  magnet: 'M6.5 4.5v8a5.5 5.5 0 0 0 11 0v-8h-3.6v8a1.9 1.9 0 0 1-3.8 0v-8zM6.5 8.2h3.6M13.9 8.2h3.6',
  shock: 'M12 9.2a2.8 2.8 0 1 1 0 5.6a2.8 2.8 0 1 1 0-5.6zM6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4M3.6 3.6a11.8 11.8 0 0 0 0 16.8M20.4 3.6a11.8 11.8 0 0 1 0 16.8',
  speed: 'M13.5 2.8L5.8 13.2h5.4l-1.4 8 7.9-10.6h-5.5z',
};

/** Ring fraction still to recharge (1 = just used, 0 = ready). */
export function cooldownFrac(readyAt: number, now: number, kind: BoostKind): number {
  return Math.min(1, Math.max(0, (readyAt - now) / boostCooldownMs(kind)));
}

/** The kinds the HUD shows: every power-up with a charge (or still recharging). */
export function shownKinds(charges: Record<BoostKind, number>, readyAt: Record<BoostKind, number>, now: number, disabled: readonly BoostKind[] = []): BoostKind[] {
  return BOOST_KINDS.filter((k) => !disabled.includes(k) && (charges[k] > 0 || readyAt[k] > now));
}

/**
 * One power-up button: the glyph on a cream sticker, its key cap, the charges left, and a teal
 * ring that refills while it recharges (drawn through a ref every frame, no React render per frame).
 */
function BoostButton({ kind, touch }: { kind: BoostKind; touch: boolean }) {
  const t = useT();
  const n = useUi((s) => s.boosts?.charges[kind] ?? 0);
  const readyAt = useUi((s) => s.boostReady[kind]);
  const blocked = useUi((s) => s.boosts?.arena?.left === 0);
  const ring = useRef<SVGCircleElement>(null);
  const [cooling, setCooling] = useState(() => readyAt > Date.now());
  useTicker(() => {
    const f = cooldownFrac(readyAt, Date.now(), kind);
    ring.current?.setAttribute('stroke-dasharray', `${(f * 100).toFixed(1)} 100`);
    const c = f > 0;
    setCooling((prev) => (prev === c ? prev : c));
  }, readyAt > Date.now() || cooling);
  const name = t(`boost.${kind}` as 'boost.magnet');
  const label = t('boost.use', { name, key: BOOST_KEY_LABELS[kind], n });
  return (
    <button
      type="button"
      className={`g-boost g-boost--${kind}${cooling ? ' is-cooling' : ''}${n === 0 || blocked ? ' is-empty' : ''}${touch ? ' is-touch' : ''}`}
      onPointerDown={(e) => {
        // a tap must not steal the joystick's pointer or the canvas focus
        e.preventDefault();
        engine()?.boost(kind);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          engine()?.boost(kind);
        }
      }}
      aria-label={label}
      title={label}
      data-kind={kind}
    >
      <svg className="g-boost__ring" viewBox="0 0 40 40" aria-hidden="true">
        <circle ref={ring} cx="20" cy="20" r="17" pathLength="100" strokeDasharray={`${(cooldownFrac(readyAt, Date.now(), kind) * 100).toFixed(1)} 100`} />
      </svg>
      <svg className="g-boost__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d={BOOST_PATH[kind]} />
      </svg>
      {!touch && <kbd className="g-boost__key mono">{BOOST_KEY_LABELS[kind]}</kbd>}
      <span className="g-boost__n num">{n}</span>
    </button>
  );
}

/**
 * The bought power-ups on the HUD: one button per owned power-up (R / F / G on desktop, thumbs on
 * phones), the arena's "uses left this round", and a small shop button. Guests see nothing (they
 * cannot buy); signed-in players with no charges see only the shop button.
 */
export function BoostBar({ touch = false }: { touch?: boolean }) {
  const t = useT();
  const state = useUi((s) => s.boosts);
  const charges = useUi((s) => s.boosts?.charges);
  const ready = useUi((s) => s.boostReady);
  if (!state || !state.signedIn || !charges) return null;
  const kinds = shownKinds(charges, ready, Date.now(), state.disabled);
  return (
    <div className={`g-boosts${touch ? ' is-touch' : ''}`} role="group" aria-label={t('boost.label')}>
      {kinds.map((k) => (
        <BoostButton key={k} kind={k} touch={touch} />
      ))}
      {state.arena && kinds.length > 0 && (
        <span className={`g-boosts__arena mono${state.arena.left === 0 ? ' is-out' : ''}`}>{t('boost.arenaLeft', { left: state.arena.left, max: state.arena.max })}</span>
      )}
      <button type="button" className="g-boosts__shop mono" onClick={() => openModal('shop')} aria-label={t('boost.openShop')} title={t('boost.openShop')}>
        <span aria-hidden="true">+</span>
        {kinds.length === 0 && <span>{t('boost.label')}</span>}
      </button>
    </div>
  );
}
