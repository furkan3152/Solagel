// Node-only helpers of the Pass CLI. Never imported by the core art code, so
// the browser bundle of @slana/art does not pull in @napi-rs/canvas.
import { createCanvas } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { drawPassCard, type PassTraits } from '../index';

export class CliError extends Error {}

export type Opts = Map<string, string | true>;

/** `--key value` / `--flag` parser (no positionals). */
export function parseArgs(argv: string[]): Opts {
  const opts: Opts = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new CliError(`unexpected argument: ${a}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) opts.set(a.slice(2), true);
    else {
      opts.set(a.slice(2), next);
      i++;
    }
  }
  return opts;
}

export function str(opts: Opts, key: string): string | undefined {
  const v = opts.get(key);
  if (v === true) throw new CliError(`--${key} needs a value`);
  return v;
}

export function int(opts: Opts, key: string, fallback: number): number {
  const v = str(opts, key);
  if (v === undefined) return fallback;
  if (!/^\d+$/.test(v)) throw new CliError(`--${key} must be a non-negative integer`);
  return Number(v);
}

export const expandHome = (p: string): string => (p === '~' || p.startsWith('~/') ? homedir() + p.slice(1) : p);

/** Resolves a user path against the directory the command was typed in (pnpm -F runs in the package dir). */
export const userPath = (p: string): string => resolve(process.env.INIT_CWD ?? process.cwd(), expandHome(p));

export const DEFAULT_SEED_FILE = 'keys/pass-seed.json';

/** Reads the admin seed file (JSON array of 32 bytes) as hex, like the SDK/admin and the server. */
export function readSeedHex(file: string): string {
  let bytes: number[];
  try {
    bytes = JSON.parse(readFileSync(file, 'utf8')) as number[];
  } catch {
    throw new CliError(`cannot read seed file ${file} (create it with \`pnpm admin pass-seed --new\`)`);
  }
  if (!Array.isArray(bytes) || bytes.length !== 32 || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
    throw new CliError(`${file} must hold a JSON array of 32 bytes (create it with \`pnpm admin pass-seed --new\`)`);
  }
  return Buffer.from(bytes).toString('hex');
}

/** Renders one Pass card (or the sealed one for `traits === null`) as a square PNG. */
export async function renderCard(traits: PassTraits | null, n: number, size: number): Promise<Buffer> {
  const canvas = createCanvas(size, size);
  drawPassCard(canvas.getContext('2d') as unknown as CanvasRenderingContext2D, traits, n, size);
  return canvas.encode('png');
}

export { createCanvas, drawPassCard };

/** Runs a CLI entry and turns errors into a clear message and a non-zero exit. */
export async function main(run: (argv: string[]) => Promise<void>): Promise<void> {
  try {
    await run(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}
