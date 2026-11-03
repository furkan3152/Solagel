import { useT } from '../../i18n';
import { em, T } from '../../i18n/rich';
import type { PriceStory } from './logic';

/**
 * The headline and lede, honest about the price: on a testnet the fixed test price (and that
 * mainnet is much cheaper); the "one dollar" story only while the price really tracks a dollar;
 * otherwise the HYPE price as it stands.
 */
export function MintHeadline({ story, price }: { story: PriceStory; price: string | null }) {
  const t = useT();
  if (story === 'testnet')
    return (
      <>
        <h1 className="mt-h display" data-story="testnet">
          {t('mn.h.one')}
          <br />
          {price ? <T k="mn.h.testPrice" vars={{ price }} tags={{ em }} /> : <T k="mn.h.testMint" tags={{ em }} />}
          <br />
          {t('mn.h.snacks')}
        </h1>
        <p className="mt-lede">{price ? t('mn.lede.testPrice', { price }) : t('mn.lede.test')}</p>
        <p className="mt-note" data-testid="mt-mainnet-note">
          {t('mn.mainnetNote')}
        </p>
      </>
    );
  if (story === 'dollar')
    return (
      <>
        <h1 className="mt-h display" data-story="dollar">
          {t('mn.h.one')}
          <br />
          <T k="mn.h.dollar" tags={{ em }} />
          <br />
          {t('mn.h.snacks')}
        </h1>
        <p className="mt-lede">{t('mn.lede.dollar')}</p>
      </>
    );
  return (
    <>
      <h1 className="mt-h display" data-story="plain">
        {t('mn.h.one')}
        <br />
        {price ? <T k="mn.h.plainPrice" vars={{ price }} tags={{ em }} /> : <T k="mn.h.plain" tags={{ em }} />}
        <br />
        {t('mn.h.snacks')}
      </h1>
      <p className="mt-lede">{t('mn.lede.plain')}</p>
    </>
  );
}
