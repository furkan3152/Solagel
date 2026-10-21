import {
  INTEGRITY_SETTINGS_DEFAULT,
  INTEGRITY_THRESHOLD_RANGES,
  INTEGRITY_THRESHOLDS_DEFAULT,
  type IntegritySettings,
  type IntegrityThresholds,
} from '@slana/shared';

/** Settings read from disk: unknown or out-of-range values fall back to the defaults (auto-hold stays off unless saved on). */
export function sanitizeSettings(raw: unknown): IntegritySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<IntegritySettings>;
  const th = { ...INTEGRITY_THRESHOLDS_DEFAULT };
  const src = (r.thresholds && typeof r.thresholds === 'object' ? r.thresholds : {}) as Partial<IntegrityThresholds>;
  for (const k of Object.keys(INTEGRITY_THRESHOLD_RANGES) as (keyof IntegrityThresholds)[]) {
    const v = src[k];
    const [lo, hi] = INTEGRITY_THRESHOLD_RANGES[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi) th[k] = v;
  }
  const hold = typeof r.holdScore === 'number' && Number.isFinite(r.holdScore) && r.holdScore >= 50 && r.holdScore <= 100 ? r.holdScore : INTEGRITY_SETTINGS_DEFAULT.holdScore;
  return { autoHold: r.autoHold === true, holdScore: hold, thresholds: th };
}

export class SettingsError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
  }
}

/**
 * Applies an admin patch (`autoHold`, `holdScore`, `thresholds: {...}`, `reset: true`) strictly:
 * a wrong type or an out-of-range value is refused, never clamped silently.
 */
export function applySettingsPatch(cur: IntegritySettings, body: Record<string, unknown>): IntegritySettings {
  if (body.reset === true) return structuredClone(INTEGRITY_SETTINGS_DEFAULT);
  const next: IntegritySettings = { ...cur, thresholds: { ...cur.thresholds } };
  for (const key of Object.keys(body)) {
    if (key !== 'autoHold' && key !== 'holdScore' && key !== 'thresholds') throw new SettingsError(`Unknown setting ${key}`, key);
  }
  if (body.autoHold !== undefined) {
    if (typeof body.autoHold !== 'boolean') throw new SettingsError('autoHold must be true or false', 'autoHold');
    next.autoHold = body.autoHold;
  }
  if (body.holdScore !== undefined) {
    const v = body.holdScore;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 50 || v > 100) throw new SettingsError('holdScore must be a number from 50 to 100', 'holdScore');
    next.holdScore = v;
  }
  if (body.thresholds !== undefined) {
    if (!body.thresholds || typeof body.thresholds !== 'object' || Array.isArray(body.thresholds)) throw new SettingsError('thresholds must be an object', 'thresholds');
    for (const [k, v] of Object.entries(body.thresholds as Record<string, unknown>)) {
      const range = INTEGRITY_THRESHOLD_RANGES[k as keyof IntegrityThresholds];
      if (!range) throw new SettingsError(`Unknown threshold ${k}`, `thresholds.${k}`);
      if (typeof v !== 'number' || !Number.isFinite(v) || v < range[0] || v > range[1]) {
        throw new SettingsError(`${k} must be a number from ${range[0]} to ${range[1]}`, `thresholds.${k}`);
      }
      next.thresholds[k as keyof IntegrityThresholds] = v;
    }
  }
  return next;
}
