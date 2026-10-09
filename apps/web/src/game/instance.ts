import type { GameEngine } from './engine';

let current: GameEngine | null = null;

export const setEngine = (e: GameEngine | null) => {
  current = e;
};

/** The running engine (null until the game canvas has mounted). */
export const engine = (): GameEngine | null => current;
