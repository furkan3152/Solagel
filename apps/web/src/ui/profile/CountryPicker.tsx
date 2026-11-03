import { isCountryCode } from '@elymum/shared';
import { useRef } from 'react';
import { sound } from '../../audio';
import { useT } from '../../i18n';
import { useChainData } from '../../wallet/chain';
import { saveProfile } from '../../wallet/profile';
import { useAddress } from '../../wallet/store';
import { toast, updateSettings, useUi } from '../../store';
import { CountryField } from '../Flag';

/**
 * "You play for": the flag by the player's name (`join.country`). Kept in the local settings at
 * once; a signed-in wallet with a saved profile also saves it there (it follows the player to
 * other devices). The first visit shows a guess from the browser's languages, marked as one.
 */
export function CountryPicker({ className }: { className?: string }) {
  const t = useT();
  const settings = useUi((s) => s.settings);
  const owner = useAddress();
  const token = useUi((s) => (s.auth && owner && s.auth.address.toLowerCase() === owner.toLowerCase() ? s.auth.token : null));
  const profile = useChainData((s) => s.profile);
  const seq = useRef(0);

  const pick = (code: string) => {
    const country = isCountryCode(code) ? code : '';
    sound.click();
    updateSettings({ country, countryAuto: false });
    if (!token || !profile?.name) return;
    const n = ++seq.current;
    saveProfile(token, { name: profile.name, skin: profile.skin, country: country || null })
      .then((saved) => {
        if (n === seq.current) useChainData.setState({ profile: saved });
      })
      .catch((err: Error) => {
        if (n === seq.current) toast('warn', t('pf.countryFail', { msg: err.message }), undefined, 6000);
      });
  };

  return (
    <CountryField
      className={className}
      label={t('pf.country')}
      value={settings.country}
      onChange={pick}
      noneLabel={t('pf.countryNone')}
      hint={settings.countryAuto && settings.country ? t('pf.countryGuess') : t('pf.countryHint')}
    />
  );
}
