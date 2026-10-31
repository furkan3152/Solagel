import { useT } from '../../i18n';

/**
 * The small "BOT" chip next to a server bot's name (HUD standings, kill feed, round-over top 5).
 * Bots are always labelled: nobody should mistake one for a person. The in-canvas name tag draws
 * the same chip (render/labels.ts).
 */
export function BotTag() {
  const t = useT();
  return (
    <span className="g-bot mono" title={t('g.botTitle')} aria-label={t('g.bot')} data-testid="bot-tag">
      {t('g.botTag')}
    </span>
  );
}
