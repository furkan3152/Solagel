import { useT } from '../i18n';

/**
 * Premium skins were sold on-chain in v1; the v2 program has no `buy_skin` (Pass skins replace
 * them). TODO(Task 15): remove this button with the Pass skin UI.
 */
export function BuySkinButton(_props: { skin: number }) {
  const t = useT();
  return <span className="badge pink">{t('chain.offline')}</span>;
}
