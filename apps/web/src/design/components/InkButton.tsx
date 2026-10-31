import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Button, type ButtonVariant } from './Button';
import type { IconName } from '../icons';

export interface InkButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /**
   * Legacy variants, drawn in the Storybook look: `pink` → primary (sun),
   * `ink` → teal sticker, `paper` → cream sticker. New code: `Button`.
   */
  variant?: 'ink' | 'pink' | 'paper' | ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  /** Trailing icon (the CTA arrow). */
  icon?: IconName;
  /** Leading icon. */
  lead?: IconName;
  /** Mono second line, e.g. "Asphodel Meadow · 1,000 $ELYMUM". */
  sub?: ReactNode;
  block?: boolean;
  loading?: boolean;
  children: ReactNode;
}

const MAP: Record<string, ButtonVariant> = { pink: 'primary', ink: 'teal', paper: 'secondary' };

/** Back-compat name for `Button` (screens written for Paper Ticket keep compiling). */
export function InkButton({ variant = 'ink', ...rest }: InkButtonProps) {
  return <Button variant={MAP[variant] ?? (variant as ButtonVariant)} {...rest} />;
}
