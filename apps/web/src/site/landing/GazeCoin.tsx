import { useRef } from 'react';
import { CoinCharacter, useReducedMotion, type CoinCharacterProps } from '../../design';
import { useGaze } from './gaze';

/**
 * A coin character whose eyes follow the pointer (gaze.ts). `look` is where it looks before the
 * pointer moves and under reduced motion. `wary`: the coin sweats while the pointer is close.
 */
export function GazeCoin({ look = [0, 0], wary = false, reach = 1, sweat, ...rest }: CoinCharacterProps & { wary?: boolean; reach?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const gaze = useGaze(ref, { enabled: !reduced, rest: look, reach });
  return (
    <span ref={ref} className="ld-gaze">
      <CoinCharacter {...rest} look={gaze.look} sweat={sweat || (wary && gaze.near < 160)} />
    </span>
  );
}
