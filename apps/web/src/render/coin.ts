import { drawRisoCoin, lookForBasicSkin, type CoinInterior, type CoinLook, type Expression, type JellyLike } from '@elymum/art';
import type { SkinDef } from '@elymum/shared';

export interface CoinOpts {
  time: number;
  lookX: number;
  lookY: number;
  expression: Expression;
  /** Pixels per world unit (camera zoom × dpr), used for LOD and min line widths. */
  pxPerUnit: number;
  jelly?: JellyLike | null;
  flags?: number;
  seed?: number;
  alpha?: number;
  /** @deprecated the riso halftone is gone; ignored. */
  halftone?: (r: number, spacing: number) => CanvasImageSource | null;
  /** Cached interior provider (see `SpriteCache.coinInterior`). */
  interior?: (look: CoinLook, r: number) => CoinInterior | null;
  /** @deprecated ignored (every body is one flat fill now). */
  fastBody?: boolean;
  /** Below this many screen px of radius the fine interior details are skipped (see `CoinState`). */
  minPrintPx?: number;
}

/** Draws a coin character with an explicit look centred at (x, y) with world radius r. */
export function drawCoinLook(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, look: CoinLook, o: CoinOpts): void {
  ctx.save();
  ctx.translate(x, y);
  drawRisoCoin(ctx, look, r, o);
  ctx.restore();
}

/**
 * Draws a coin character centred at (x, y) with world radius r using the
 * shared Storybook coin drawing from `@elymum/art` (basic skins map onto Elysium looks).
 */
export function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, skin: SkinDef, o: CoinOpts): void {
  drawCoinLook(ctx, x, y, r, lookForBasicSkin(skin.id), o);
}
