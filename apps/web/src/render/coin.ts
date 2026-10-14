import { drawRisoCoin, lookForBasicSkin, type Expression, type JellyLike } from '@slana/art';
import type { SkinDef } from '@slana/shared';

export interface CoinOpts {
  time: number;
  lookX: number;
  lookY: number;
  expression: Expression;
  /** Pixels per world unit (camera zoom × dpr) — used for LOD and min line widths. */
  pxPerUnit: number;
  jelly?: JellyLike | null;
  flags?: number;
  seed?: number;
  alpha?: number;
}

/**
 * Draws a coin character centred at (x, y) with world radius r using the
 * shared risograph drawing from `@slana/art` (basic skins map onto riso looks).
 */
export function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, skin: SkinDef, o: CoinOpts): void {
  ctx.save();
  ctx.translate(x, y);
  drawRisoCoin(ctx, lookForBasicSkin(skin.id), r, o);
  ctx.restore();
}
