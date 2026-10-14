import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { BASIC_SKINS, isBasicSkin, sanitizeName, truncateUtf8, utf8Length } from '@slana/shared';
import { useEffect, useId, useState } from 'react';
import { Field, InkButton, Sheet } from '../design';
import { sound } from '../game/sound';
import { useT } from '../i18n';
import { closeModal, toast, updateSettings, useUi } from '../store';
import { CoinPortrait } from '../ui/game/CoinPortrait';
import { refreshChain, useChainData, useSlanaClient } from './chain';
import { signInWithWallet } from './siws';
import { sendWalletTx } from './tx';

const passNo = (n: number) => String(n).padStart(4, '0');

/**
 * Name and look. Basic coins are free for everyone; Pass looks come from the
 * Passes in the wallet (`/api/pass/owned`) and are checked by the server at
 * join. With an on-chain profile, a changed name or basic coin is saved with
 * `updateProfile`; without one, the profile is created by the first ticket.
 */
export function ProfileModal() {
  const t = useT();
  const open = useUi((s) => s.modal === 'profile');
  const settings = useUi((s) => s.settings);
  const wallet = useWallet();
  const { connection } = useConnection();
  const client = useSlanaClient();
  const profile = useChainData((s) => s.profile);
  const passes = useChainData((s) => s.passes);
  const fake = useChainData((s) => s.fake);
  const groupId = useId();

  const [name, setName] = useState('');
  const [skin, setSkin] = useState(0);
  const [pass, setPass] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(profile?.name ?? settings.name);
    setSkin(isBasicSkin(settings.skin) ? settings.skin : (profile?.skin ?? 0));
    setPass(passes.some((p) => p.asset === settings.passSkin) ? settings.passSkin : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const clean = truncateUtf8(sanitizeName(name, ''), 16);
  const valid = clean.length > 0 && utf8Length(clean) <= 16;
  const chainDiff = !!profile && (clean !== profile.name || skin !== profile.skin);

  const saveLocal = () => {
    updateSettings({ name: clean, skin, passSkin: pass });
  };

  const save = async () => {
    if (!valid) return;
    sound.click();
    if (chainDiff && client && wallet.publicKey && !fake) {
      setBusy(true);
      const ix = await client.ix.updateProfile(wallet.publicKey, {
        name: clean !== profile!.name ? clean : undefined,
        skin: skin !== profile!.skin ? skin : undefined,
      });
      const sig = await sendWalletTx(client, connection, wallet, [ix], { success: t('pf.saved') });
      setBusy(false);
      if (!sig) return;
      saveLocal();
      refreshChain();
      // the server reads the verified name from the profile on sign-in
      await signInWithWallet(wallet);
    } else {
      saveLocal();
      toast('success', t('pf.saved'), undefined, 2500);
    }
    closeModal();
  };

  return (
    <Sheet
      open={open}
      onClose={closeModal}
      closeLabel={t('pf.close')}
      kicker={t('pf.kicker')}
      title={t('pf.title')}
      className="kl-sheet pf-sheet"
      footer={
        <>
          <InkButton variant="pink" size="lg" icon="check" disabled={!valid || busy} onClick={() => void save()} data-autofocus>
            {chainDiff && !fake ? t('pf.saveChain') : t('pf.save')}
          </InkButton>
          <InkButton variant="paper" size="lg" onClick={closeModal}>
            {t('tf.cancel')}
          </InkButton>
        </>
      }
    >
      <div className="pf-body">
        <div className="pf-hero" aria-hidden="true">
          <CoinPortrait key={`${skin}-${pass}`} skin={skin} pass={passes.find((p) => p.asset === pass)?.number ?? 0} size={112} expression="proud" seed={5} />
        </div>
        <Field
          label={t('pf.name')}
          hint={t('pf.nameHint')}
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          suffix={`${utf8Length(clean)}/16`}
          error={!valid && name.length > 0 ? t('tf.err.InvalidName') : undefined}
        />
        <fieldset className="pf-looks">
          <legend className="mono pf-cap">{t('pf.skins')}</legend>
          <div className="pf-grid">
            {BASIC_SKINS.map((s) => {
              const on = pass === null && skin === s.id;
              return (
                <label key={s.id} className={`pf-look${on ? ' is-on' : ''}`}>
                  <input
                    type="radio"
                    name={groupId}
                    checked={on}
                    onChange={() => {
                      setSkin(s.id);
                      setPass(null);
                    }}
                    aria-label={s.name[settings.lang]}
                  />
                  <CoinPortrait skin={s.id} size={52} still={!on} seed={s.id + 1} />
                  <span className="pf-look__name">{s.name[settings.lang]}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <fieldset className="pf-looks">
          <legend className="mono pf-cap">{t('pf.passSkins')}</legend>
          {passes.length === 0 ? (
            <p className="kl-note">{t('pf.noPass')}</p>
          ) : (
            <div className="pf-grid">
              {passes.map((p) => {
                const on = pass === p.asset;
                return (
                  <label key={p.asset} className={`pf-look is-pass${on ? ' is-on' : ''}`}>
                    <input
                      type="radio"
                      name={groupId}
                      checked={on}
                      onChange={() => setPass(p.asset)}
                      aria-label={`Slana Pass ${t('tf.pass.no', { n: passNo(p.number) })}`}
                    />
                    <CoinPortrait skin={skin} pass={p.number} size={52} still={!on} seed={p.number} />
                    <span className="pf-look__name mono">{t('tf.pass.no', { n: passNo(p.number) })}</span>
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>
        <p className="kl-note">
          {profile ? t('pf.chainNote') : t('pf.createNote')} {passes.length > 0 && t('pf.passNote')}
        </p>
      </div>
    </Sheet>
  );
}
