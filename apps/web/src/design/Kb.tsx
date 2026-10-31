import { MotionConfig } from 'motion/react';
import { createContext, forwardRef, useContext, useEffect, type HTMLAttributes, type ReactNode } from 'react';
import { ensureInkDefs } from './motifs/InkDefs';

/** `paper` (= day, the plain at dawn) or `night` (in orbit). */
export type KbTheme = 'paper' | 'night';

const ThemeContext = createContext<KbTheme>('paper');

/** Current theme (day `paper` / `night`). Portalled pieces (Sheet, toasts) read this. */
export function useKbTheme(): KbTheme {
  return useContext(ThemeContext);
}

/** Map the app's persisted settings theme to a Kb theme. */
export function themeFromSettings(theme: 'light' | 'dark' | string | undefined): KbTheme {
  return theme === 'dark' ? 'night' : 'paper';
}

export interface KbProps extends HTMLAttributes<HTMLDivElement> {
  theme?: KbTheme;
  /** Paint the page colour on the root (default true). */
  paper?: boolean;
  children?: ReactNode;
}

/**
 * Design-system root: `class="kb paper"` + `data-theme`, theme context,
 * motion's reduced-motion policy and the hand-inked SVG filters (defined once
 * per document). Wrap every screen in it.
 */
export const Kb = forwardRef<HTMLDivElement, KbProps>(function Kb(
  { theme = 'paper', paper = true, className, children, ...rest },
  ref,
) {
  useEffect(() => ensureInkDefs(), []);
  return (
    <ThemeContext.Provider value={theme}>
      <MotionConfig reducedMotion="user">
        <div
          ref={ref}
          className={`kb${paper ? ' paper' : ''}${className ? ` ${className}` : ''}`}
          data-theme={theme}
          {...rest}
        >
          {children}
        </div>
      </MotionConfig>
    </ThemeContext.Provider>
  );
});
