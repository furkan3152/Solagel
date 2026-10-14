import type { OwnedPass } from '@slana/sdk';
import { formatToken } from '@slana/shared';
import { Chip, Icon, Stamp } from '../../design';
import { useT } from '../../i18n';
import { useChainData } from '../../solana/chain';
import { PASS_POWER, bpsPercent, feeBps } from '../../solana/ticket';
import { useUi } from '../../store';
import { CoinPortrait } from '../game/CoinPortrait';

const passNo = (n: number) => String(n).padStart(4, '0');

/**
 * The holder's Pass, printed on the teal cover stock: the Pass coin in a
 * photo box, number and state, perk chips and a "GEÇERLİ" seal. Without a Pass
 * it becomes the "Pass başvurusu" call to action.
 */
export function PassCard({ onApply, large = false }: { onApply?: () => void; large?: boolean }) {
  const passes = useChainData((s) => s.passes);
  const locked = useChainData((s) => s.lockedPasses);
  const passSkin = useUi((s) => s.settings.passSkin);
  if (passes.length === 0) return <PassApply onApply={onApply} />;
  const shown = passes.find((p) => p.asset === passSkin) ?? passes[0];
  return <PassCover pass={shown} more={passes.length - 1} locked={locked.includes(shown.asset)} large={large} />;
}

function PassCover({ pass, more, locked, large }: { pass: OwnedPass; more: number; locked: boolean; large: boolean }) {
  const t = useT();
  const lang = useUi((s) => s.settings.lang);
  const skin = useUi((s) => s.settings.skin);
  const config = useChainData((s) => s.config);
  return (
    <section className={`kl-pass${large ? ' is-large' : ''}`} aria-label={`${t('lo.pass.title')} ${t('lo.pass.no', { n: passNo(pass.number) })}`}>
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
          <Chip tone="on-dark">{t('lo.pass.chip.mass', { n: PASS_POWER.startPct })}</Chip>
        </span>
      </div>
      <span className="kl-pass__seal" aria-hidden="true">
        <Stamp text={t('lo.pass.valid')} tone="mustard" round size="sm" rotate={-11} />
      </span>
    </section>
  );
}

function PassApply({ onApply }: { onApply?: () => void }) {
  const t = useT();
  const lang = useUi((s) => s.settings.lang);
  const pass = useUi((s) => s.chain?.pass ?? null);
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
            {pass.mintOpen ? t('lo.apply.open') : t('lo.apply.closed')}
          </span>
        )}
      </span>
      {onApply && <Icon name="chevron" size={22} className="kl-apply__go" />}
    </Tag>
  );
}

/** The Pass tab on phones (and the desk column): the card plus what a Pass does. */
export function PassDesk({ onApply }: { onApply?: () => void }) {
  const t = useT();
  const lang = useUi((s) => s.settings.lang);
  const config = useChainData((s) => s.config);
  const passes = useChainData((s) => s.passes);
  const perks = [
    t('lo.perk.rooms'),
    t('lo.perk.fee', { base: bpsPercent(feeBps(config, false), lang), pass: bpsPercent(feeBps(config, true), lang) }),
    t('lo.perk.season'),
    t('lo.perk.power', { start: PASS_POWER.startPct, s: PASS_POWER.cashoutS }),
    t('lo.perk.look'),
  ];
  return (
    <div className="kl-desk">
      <PassCard onApply={onApply} large />
      <h3 className="kl-h3">{t('lo.pass.perks')}</h3>
      <ol className="kl-perks">
        {perks.map((p, i) => (
          <li key={i}>
            <span className="kl-perks__n mono" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span>{p}</span>
          </li>
        ))}
      </ol>
      {passes.length === 0 && <p className="kl-note">{t('lo.apply.desk')}</p>}
    </div>
  );
}
