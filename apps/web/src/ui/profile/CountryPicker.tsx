import { isCountryCode } from '@elymum/shared';
import { useRef } from 'react';
import { sound } from '../../audio';
import { useT } from '../../i18n';
import { useChainData } from '../../wallet/chain';
import { saveProfile } from '../../wallet/profile';
import { useAddress } from '../../wallet/store';
import { flagSkinKind } from '../../render/flagskin';
import { toast, updateSettings, useUi } from '../../store';
import { CountryField } from '../Flag';
import { CoinPortrait } from '../game/CoinPortrait';
import { wearsPicture } from './picture';
import { Punch, Row } from './SettingsPage';

/**
 * "You play for": the flag by the player's name (`join.country`), and "Wear the flag on my coin"
 * (the flag skin, `join.flag`: the coin painted with that flag). Kept in the local settings at
 * once; a signed-in wallet with a saved profile also saves them there (they follow the player to
 * other devices). The first visit shows a guess from the browser's languages, marked as one.
 */
export function CountryPicker({ className }: { className?: string }) {
  const t = useT();
  const settings = useUi((s) => s.settings);
  const owner = useAddress();
  const token = useUi((s) => (s.auth && owner && s.auth.address.toLowerCase() === owner.toLowerCase() ? s.auth.token : null));
  const profile = useChainData((s) => s.profile);
  const seq = useRef(0);

  const store = (patch: { country?: string | null; flagSkin?: boolean }) => {
    if (!token || !profile?.name) return;
    const n = ++seq.current;
    saveProfile(token, { name: profile.name, skin: profile.skin, ...patch })
      .then((saved) => {
        if (n === seq.current) useChainData.setState({ profile: saved });
      })
      .catch((err: Error) => {
        if (n === seq.current) toast('warn', t('pf.countryFail', { msg: err.message }), undefined, 6000);
      });
  };

  const pick = (code: string) => {
    const country = isCountryCode(code) ? code : '';
    sound.click();
    updateSettings({ country, countryAuto: false });
    store({ country: country || null });
  };

  const wear = (on: boolean) => {
    sound.click();
    updateSettings({ flagSkin: on });
    store({ flagSkin: on });
  };

  const country = isCountryCode(settings.country) ? settings.country : null;
  const kind = flagSkinKind(country);
  // an uploaded picture worn on the coin wins over the flag
  const picture = !!owner && wearsPicture(settings.picture, profile?.avatar);
  const note = !country
    ? t('pf.flagSkinNone')
    : settings.flagSkin && picture
      ? t('pf.flagSkinPicture')
      : kind === 'colours'
        ? t('pf.flagSkinColours')
        : kind === null
          ? t('pf.flagSkinPlain')
          : t('pf.flagSkinNote');

  return (
    <div className={`cp-country${className ? ` ${className}` : ''}`}>
      <CountryField
        label={t('pf.country')}
        value={settings.country}
        onChange={pick}
        noneLabel={t('pf.countryNone')}
        hint={settings.countryAuto && settings.country ? t('pf.countryGuess') : t('pf.countryHint')}
      />
      <div className="g-set cp-flagskin">
        <Row label={t('pf.flagSkin')} note={note}>
          {country && kind && (
            <CoinPortrait skin={settings.skin} size={44} still seed={21} flag={country} className={`cp-flagskin__coin${settings.flagSkin && !picture ? '' : ' is-off'}`} />
          )}
          <Punch on={settings.flagSkin && !!country} onChange={wear} label={t('pf.flagSkin')} disabled={!country} />
        </Row>
      </div>
    </div>
  );
}
