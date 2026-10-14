import { motion } from 'motion/react';
import { useId, useRef, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { usePreset } from '../motion';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: IconName;
}

export interface TabsProps<T extends string> extends Omit<HTMLAttributes<HTMLElement>, 'onChange' | 'role'> {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Accessible name of the tab list / navigation. */
  label: string;
  /**
   * `bar`: newspaper section tabs (WAI-ARIA tablist).
   * `nav`: phone bottom bar, rendered as `<nav>` with `aria-current="page"`
   * because it switches screens, not panels.
   */
  variant?: 'bar' | 'nav';
  /**
   * Id prefix that pairs tabs with panels (`TabPanel` / `tabPanelProps`).
   * Tabs only emit `aria-controls` when it is given, i.e. when panels exist,
   * and only on the selected tab (inactive panels need not be mounted).
   */
  idBase?: string;
}

export const tabId = (base: string, id: string) => `${base}-tab-${id}`;
export const panelId = (base: string, id: string) => `${base}-panel-${id}`;

/** Spread on the panel element for a tab: id, role and labelling. */
export function tabPanelProps(base: string, id: string) {
  return { id: panelId(base, id), role: 'tabpanel' as const, 'aria-labelledby': tabId(base, id), tabIndex: 0 };
}

/**
 * Horizontal tabs with automatic activation: roving tabindex, Left/Right,
 * Home/End. The pink underline is one shared element that slides between tabs.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  variant = 'bar',
  idBase,
  className,
  onKeyDown,
  ...rest
}: TabsProps<T>) {
  const auto = useId();
  const base = idBase ?? `kb${auto.replace(/[^a-zA-Z0-9]/g, '')}`;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const spring = usePreset('dial');
  const cls = `kb-tabs kb-tabs--${variant}${className ? ` ${className}` : ''}`;

  const ink = <motion.span layoutId={`${base}-ink`} className="kb-tab__ink" transition={spring} />;

  if (variant === 'nav') {
    return (
      <nav {...rest} onKeyDown={onKeyDown} className={cls} aria-label={label}>
        {items.map((it) => {
          const on = it.id === value;
          return (
            <button
              key={it.id}
              type="button"
              className={`kb-tab${on ? ' is-on' : ''}`}
              aria-current={on ? 'page' : undefined}
              onClick={() => onChange(it.id)}
            >
              {it.icon && <Icon name={it.icon} size={22} />}
              <span className="mono">{it.label}</span>
              {on && ink}
            </button>
          );
        })}
      </nav>
    );
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const i = items.findIndex((it) => it.id === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div {...rest} className={cls} role="tablist" aria-label={label} onKeyDown={onKey}>
      {items.map((it, i) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={tabId(base, it.id)}
            aria-selected={on}
            aria-controls={idBase && on ? panelId(idBase, it.id) : undefined}
            tabIndex={on ? 0 : -1}
            className={`kb-tab${on ? ' is-on' : ''}`}
            onClick={() => onChange(it.id)}
          >
            {it.icon && <Icon name={it.icon} size={18} />}
            <span>{it.label}</span>
            {on && ink}
          </button>
        );
      })}
    </div>
  );
}

/** Convenience wrapper for a panel. */
export function TabPanel({ idBase, id, children, className }: { idBase: string; id: string; children: ReactNode; className?: string }) {
  return (
    <div className={className} {...tabPanelProps(idBase, id)}>
      {children}
    </div>
  );
}
