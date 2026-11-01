import { ToastViewport, type ToastItem } from '../design';
import { useT } from '../i18n';
import { useUi } from '../store';

/** Store toasts as Paper Ticket slips (render inside a `<Kb>` root for the theme). */
export function Toasts() {
  const t = useT();
  const toasts = useUi((s) => s.toasts);
  const inGame = useUi((s) => s.screen === 'playing');
  const items: ToastItem[] = toasts.map((x) => ({
    id: x.id,
    tone: x.kind === 'success' ? 'success' : x.kind === 'error' ? 'error' : 'info',
    title: x.text,
    message: x.link ? (
      <a href={x.link.href} target="_blank" rel="noreferrer">
        {x.link.label}
      </a>
    ) : undefined,
  }));
  return (
    <ToastViewport
      toasts={items}
      onDismiss={(id) => useUi.setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))}
      closeLabel={t('lo.close')}
      label={t('lo.toasts')}
      inGame={inGame}
    />
  );
}
