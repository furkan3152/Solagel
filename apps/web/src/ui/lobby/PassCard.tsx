import type { OwnedPass } from '@slana/sdk';
import { formatToken } from '@slana/shared';
import { Chip, Icon, Stamp } from '../../design';
import { useT } from '../../i18n';
import { usePassPower, usePassStatus, useChainData } from '../../solana/chain';
import { passView } from '../../solana/pass';
import { bpsPercent, feeBps } from '../../solana/ticket';
import { useUi } from '../../store';
import { CoinPortrait } from '../game/CoinPortrait';

const passNo = (n: number) => String(n).padStart(4, '0');

/**
 * The holder's Pass, printed on the teal cover stock: the Pass coin in a
 * photo box, number and state, perk chips and a "GEÇERLİ" seal. Without a Pass
 * it becomes the "Pass başvurusu" call to action.
 */
export function PassCard({ onOpen, large = false }: { onOpen?: () => void; large?: boolean }) {
  const passes = useChainData((s) => s.passes);
  const locked = useChainData((s) => s.lockedPasses);
  const passSkin = useUi((s) => s.settings.passSkin);
  if (passes.length === 0) return <PassApply onApply={onOpen} />;
  const shown = passes.find((p) => p.asset === passSkin) ?? passes[0];
  return <PassCover pass={shown} more={passes.length - 1} locked={locked.includes(shown.asset)} large={large} onOpen={onOpen} />;
}

function PassCover({ pass, more, locked, large, onOpen }: { pass: OwnedPass; more: number; locked: boolean; large: boolean; onOpen?: () => void }) {
  const t = useT();
  const power = usePassPower();
  const lang = useUi((s) => s.settings.lang);
  const skin = useUi((s) => s.settings.skin);
  const config = useChainData((s) => s.config);
  const status = usePassStatus();
  const sealed = passView(pass, status).sealed;
  const label = `${t('lo.pass.title')} ${t('lo.pass.no', { n: passNo(pass.number) })}`;
  const Tag = onOpen ? 'button' : 'section';
  return (
    <Tag
      type={onOpen ? 'button' : undefined}
      onClick={onOpen}
      className={`kl-pass${large ? ' is-large' : ''}${onOpen ? ' is-link' : ''}`}
      aria-label={onOpen ? `${label} · ${t('pp.yours')}` : label}
    >
      <div className="kl-pass__photo">
        <CoinPortrait skin={skin} pass={pass.number} size={large ? 96 : 70} expression="proud" seed={pass.number} className="kl-pass__coin" />
      </div>
      <div className="kl-pass__text">
        <span className="kl-pass__title">{t('lo.pass.title')}</span>
        <span className="kl-pass__no mono">
          {t('lo.pass.no', { n: passNo(pass.number) })} · {locked ? t('lo.pass.locked') : t('lo.pass.active')}
          {more > 0 && ` · ${t('lo.pass.more', { n: more })}`}
        </span>
        <span className="kl-pass__chips">
          <Chip tone="on-dark">{t('lo.pass.chip.rooms')}</Chip>
          <Chip tone="on-dark">{t('lo.pass.chip.fee', { n: bpsPercent(feeBps(config, true), lang) })}</Chip>
          <Chip tone="on-dark">{t('lo.pass.chip.season')}</Chip>
          <Chip tone="on-dark">{t('lo.pass.chip.mass', { n: power.startPct })}</Chip>
        </span>
      </div>
      <span className="kl-pass__seal" aria-hidden="true">
        <Stamp text={sealed ? t('pp.sealed') : t('lo.pass.valid')} tone="mustard" round size="sm" rotate={-11} />
      </span>
    </Tag>
  );
}

function PassApply({ onApply }: { onApply?: () => void }) {
  const t = useT();
  const lang = useUi((s) => s.settings.lang);
  const pass = usePassStatus();
  const Tag = onApply ? 'button' : 'div';
  return (
    <Tag type={onApply ? 'button' : undefined} className={`kl-apply${onApply ? '' : ' is-static'}`} onClick={onApply}>
      <span className="kl-apply__icon" aria-hidden="true">
        <Icon name="passport" size={30} />
      </span>
      <span className="kl-apply__text">
        <span className="kl-apply__title">{t('lo.apply.title')}</span>
        <span className="kl-apply__body">{t('lo.apply.body')}</span>
        {pass && (
          <span className="kl-apply__supply mono">
            {t('lo.apply.supply', { m: formatToken(pass.minted, 0, lang), s: formatToken(pass.supply, 0, lang) })} ·{' '}
            {pass.mintOpen && !pass.revealed && pass.minted < pass.supply ? t('lo.apply.open') : t('lo.apply.closed')}
          </span>
        )}
      </span>
      {onApply && <Icon name="chevron" size={22} className="kl-apply__go" />}
    </Tag>
  );
}
