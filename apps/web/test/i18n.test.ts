import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EMOTES, PowerUpType } from '@elymum/shared';
import { describe, expect, it } from 'vitest';
import { ICON_NAMES } from '../src/design/icons';
import { translate, type TKey } from '../src/i18n';
import { en } from '../src/i18n/en';

// vitest runs in apps/web (pnpm -r / -F run each package in its own directory)
const SRC = resolve(process.cwd(), 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const code = sources(SRC)
  .filter((p) => !p.endsWith(join('i18n', 'en.ts')))
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n');
const keys = new Set(Object.keys(en));

/** The server's `ErrorCode` union, read from the shared protocol source (it is a type only). */
function errorCodes(): string[] {
  const proto = readFileSync(resolve(process.cwd(), '../../packages/shared/src/protocol.ts'), 'utf8');
  // comments inside the union may hold a ';' of their own: drop them first
  const code = proto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const union = /export type ErrorCode =([^;]+);/.exec(code)?.[1] ?? '';
  return [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** The CI guard's Turkish letters, built from code points so this file passes the guard itself. */
const TURKISH = new RegExp(`[${String.fromCodePoint(0xe7, 0x11f, 0x131, 0xf6, 0x15f, 0xfc, 0xc7, 0x11e, 0x130, 0xd6, 0x15e, 0xdc)}]`);

describe('the English string table', () => {
  it('has every key the code asks for with a literal t() call', () => {
    const used = new Set([...code.matchAll(/\b(?:t|tx)\(\s*'([a-zA-Z0-9_.]+)'/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(300);
    expect([...used].filter((k) => !keys.has(k))).toEqual([]);
  });

  it('has every key the code builds at run time', () => {
    const built = [
      ...ICON_NAMES.map((n) => `ds.icon.${n}`),
      ...EMOTES.map((e) => `g.emote.${e.id}`),
      ...Object.values(PowerUpType).map((p) => `pu.${p}`),
      ...errorCodes().map((c) => `err.${c}`),
    ];
    expect(errorCodes()).toEqual(expect.arrayContaining(['round_closed', 'no_cashout', 'round_ended']));
    expect(built.filter((k) => !keys.has(k))).toEqual([]);
  });

  it('is non-empty, English and free of emoji', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim().length, key).toBeGreaterThan(0);
      expect(value, key).not.toMatch(TURKISH);
      expect(value, key).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('fills placeholders and leaves unknown keys readable', () => {
    expect(translate('lo.onFloor', { n: '84,200', sym: '$SLANA' })).toBe('84,200 $SLANA on the floor');
    expect(translate('nope.missing' as TKey)).toBe('nope.missing');
  });
});
