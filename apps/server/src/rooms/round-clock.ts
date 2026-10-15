import { RULES, roundAt, type RoundWindow } from '@slana/shared';

/**
 * The one wall clock arena rounds run on (Unix ms) and the round window it implies. The room
 * manager, every arena room and the gateway share one instance, so they always agree on the
 * round in play.
 */
export class RoundClock {
  constructor(
    private readonly clock: () => number = Date.now,
    readonly cfg: { roundMs: number; closeMs: number } = { roundMs: RULES.roundMs, closeMs: RULES.roundJoinCloseMs },
  ) {}

  now(): number {
    return this.clock();
  }

  /** The round running at `now`. */
  window(now = this.now()): RoundWindow {
    return roundAt(now, this.cfg.roundMs, this.cfg.closeMs);
  }
}
