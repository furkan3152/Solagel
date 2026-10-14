import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { drawPassCard, passCollection } from '../src/index';

/**
 * Pass images are minted art: the renderer's speed-ups (`fastBody`,
 * `minPrintPx`, cached halftone) must never change their bytes. These SHA-256
 * hashes of 256 px cards were taken from the code at 3e7b312 (before Task 13).
 * Numbers: two commons, a rare with an accessory (6), gold (33), holo (35), a 1/1 (139),
 * two more commons, and the sealed card.
 */
const BASE: Record<string, string> = {"1":"a88c2e6dd7768aca97cd15c276ad9b44c04592aff746927cdd3958a6c34cd72d","6":"eb1c183837296d9858bf825f26742d46750ea971f46b23cfd0606f8ac963d8eb","33":"a1c5f08a02f323215a36411a8c08c54aaec760b58560f9ef23534f2a360a1bbc","35":"a976662420100df82ac131cf0cc8d42db212cd8a175b9a910591dcecd5f1d62a","139":"32f9aacc5d491b5fcfd8f0e43f3c299656304123419abaebf6005a052bbf57e7","501":"fe26db214dfeba0341264a9a2933534bba94625bac9c5d8fa4c53715a78ba3b5","3333":"1ac8db4e2f57016e3af99c50e4aac56e55c97135aecb748fbf41fa4391bb72aa","sealed":"6923b274b0f28600bdd721ef53cda19edc80bf58f633486c0a3d01aba91e5132"};

const SEED = 'c0ffee'.repeat(10) + 'beef';

function hash(traits: Parameters<typeof drawPassCard>[1], n: number): string {
  const c = createCanvas(256, 256);
  const ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D;
  drawPassCard(ctx, traits, n, 256);
  return createHash('sha256').update(Buffer.from(ctx.getImageData(0, 0, 256, 256).data)).digest('hex');
}

describe('Pass card bytes', () => {
  const col = passCollection(SEED, 3333);
  it.each([1, 6, 33, 35, 139, 501, 3333])('card #%i is byte-identical to the pre-Task-13 render', (n) => {
    expect(hash(col[n - 1], n)).toBe(BASE[String(n)]);
  });
  it('the sealed card is byte-identical to the pre-Task-13 render', () => {
    expect(hash(null, 1)).toBe(BASE.sealed);
  });
});
