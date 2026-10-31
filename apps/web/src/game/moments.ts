/** Window event the engine fires for each gain it hands to the HUD (`ValueFlyers`). */
export const VALUE_FLY_EVENT = 'elymum:value-fly';

/** A gain to fly into the till: where it popped (screen px) and its label ("+12"). */
export interface ValueFlyDetail {
  x: number;
  y: number;
  text: string;
}
