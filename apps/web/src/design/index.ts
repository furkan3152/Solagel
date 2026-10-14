// Kâğıt Bilet design system: one import for screens (Tasks 13–16).
// CSS (tokens.css, paper.css) and fonts are loaded globally by main.tsx.
export { Kb, useKbTheme, themeFromSettings, type KbTheme, type KbProps } from './Kb';
export { Icon, ICON_NAMES, type IconName, type IconProps } from './icons';
export { springs, STAGGER, printerEase, stampKeyframes, useReducedMotion, usePreset, type SpringName } from './motion';
export { Ticket, TicketGroup, TicketStub, type TicketProps, type TicketGroupProps } from './components/Ticket';
export { Stamp, type StampProps, type StampTone } from './components/Stamp';
export { Receipt, type ReceiptProps, type ReceiptLine } from './components/Receipt';
export { Passport, Crest, WaxSeal, type PassportProps, type PassportTrait } from './components/Passport';
export { InkButton, type InkButtonProps } from './components/InkButton';
export { Counter, type CounterProps } from './components/Counter';
export { Rule, type RuleProps } from './components/Rule';
export { Dateline, type DatelineProps } from './components/Dateline';
export { Tape, type TapeProps } from './components/Tape';
export { Chip, type ChipProps } from './components/Chip';
export { Sheet, type SheetProps } from './components/Sheet';
export { Tabs, TabPanel, tabPanelProps, tabId, panelId, type TabsProps, type TabItem } from './components/Tabs';
export { Field, type FieldProps } from './components/Field';
export { Toast, ToastViewport, type ToastProps, type ToastItem, type ToastTone } from './components/Toast';
