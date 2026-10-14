import { MotionConfig } from 'motion/react';
import { createContext, forwardRef, useContext, type HTMLAttributes, type ReactNode } from 'react';

export type KbTheme = 'paper' | 'night';

const ThemeContext = createContext<KbTheme>('paper');

/** Current Kâğıt Bilet stock. Portalled pieces (Sheet, toasts) read this. */
export function useKbTheme(): KbTheme {
  return useContext(ThemeContext);
}

/** Map the app's persisted settings theme to a print stock. */
export function themeFromSettings(theme: 'light' | 'dark' | string | undefined): KbTheme {
  return theme === 'dark' ? 'night' : 'paper';
}

export interface KbProps extends HTMLAttributes<HTMLDivElement> {
  theme?: KbTheme;
  /** Grain background on the root (default true). */
  paper?: boolean;
  children?: ReactNode;
}

/**
 * Design-system root: `class="kb paper"` + `data-theme`, theme context and
 * motion's reduced-motion policy. Wrap every Kâğıt Bilet screen in it.
 */
export const Kb = forwardRef<HTMLDivElement, KbProps>(function Kb(
  { theme = 'paper', paper = true, className, children, ...rest },
  ref,
) {
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
