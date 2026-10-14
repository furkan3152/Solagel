import { motion } from 'motion/react';
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { usePreset } from '../motion';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: IconName;
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Accessible name of the tab list. */
  label: string;
  /** `bar`: newspaper section tabs. `nav`: phone bottom bar (icon over label). */
  variant?: 'bar' | 'nav';
  /** Stable id prefix; pair panels with `tabPanelProps(idBase, id)`. */
  idBase?: string;
  className?: string;
}

export const tabId = (base: string, id: string) => `${base}-tab-${id}`;
export const panelId = (base: string, id: string) => `${base}-panel-${id}`;

/** Spread on the panel element for a tab: id, role and labelling. */
export function tabPanelProps(base: string, id: string) {
  return { id: panelId(base, id), role: 'tabpanel' as const, 'aria-labelledby': tabId(base, id), tabIndex: 0 };
}

/**
 * WAI-ARIA tabs with automatic activation: roving tabindex, arrows / Home / End.
 * The pink underline is a single shared element that slides between tabs.
 */
export function Tabs<T extends string>({ items, value, onChange, label, variant = 'bar', idBase, className }: TabsProps<T>) {
  const auto = useId();
  const base = idBase ?? `kb${auto.replace(/[^a-zA-Z0-9]/g, '')}`;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const spring = usePreset('dial');

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((it) => it.id === value);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div
      className={`kb-tabs kb-tabs--${variant}${className ? ` ${className}` : ''}`}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={onKey}
    >
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
            aria-controls={panelId(base, it.id)}
            tabIndex={on ? 0 : -1}
            className={`kb-tab${on ? ' is-on' : ''}`}
            onClick={() => onChange(it.id)}
          >
            {it.icon && <Icon name={it.icon} size={variant === 'nav' ? 22 : 18} />}
            <span className={variant === 'nav' ? 'mono' : undefined}>{it.label}</span>
            {on && <motion.span layoutId={`${base}-ink`} className="kb-tab__ink" transition={spring} />}
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
