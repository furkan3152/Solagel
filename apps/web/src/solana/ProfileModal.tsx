import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { SKINS, isSkinUnlocked, sanitizeName, truncateUtf8, utf8Length } from '@slana/shared';
import { useState } from 'react';
import { useT } from '../i18n';
import { closeModal, updateSettings, useUi } from '../store';
import { Modal, SkinCanvas } from '../ui/common';
import { refreshChain, useChainData, useSlanaClient } from './chain';
import { signInWithWallet } from './siws';
import { sendWalletTx } from './tx';

/** Create or edit the on-chain profile (name + equipped skin). */
export function ProfileModal() {
  const t = useT();
  const wallet = useWallet();
  const { connection } = useConnection();
  const client = useSlanaClient();
  const profile = useChainData((s) => s.profile);
  const settings = useUi((s) => s.settings);
  const lang = settings.lang;
  const creating = !profile;
  const own = profile ? { xp: profile.xp, premiumMask: 0 } : null; // TODO(Task 15): v2 has no premium skins
  const [name, setName] = useState(profile?.name ?? (settings.name || ''));
  const [skin, setSkin] = useState(() => {
    const s = profile?.skin ?? settings.skin;
    return creating ? (s < 8 ? s : 0) : s;
  });
  const [busy, setBusy] = useState(false);

  const clean = truncateUtf8(sanitizeName(name, ''), 16);
  const valid = clean.length > 0 && utf8Length(clean) <= 16;
  const choices = SKINS.filter((s) => (creating ? s.tier === 'free' : isSkinUnlocked(s.id, own)));

  const submit = async () => {
    if (!client || !wallet.publicKey || !valid) return;
    setBusy(true);
    const ix = creating
      ? await client.ix.registerPlayer(wallet.publicKey, clean, skin)
      : await client.ix.updateProfile(wallet.publicKey, { name: clean !== profile!.name ? clean : undefined, skin: skin !== profile!.skin ? skin : undefined });
    const sig = await sendWalletTx(client, connection, wallet, [ix], { success: creating ? '🎉 Profile created!' : '✅ Profile saved' });
    setBusy(false);
    if (!sig) return;
    updateSettings({ name: clean, skin });
    refreshChain();
    // refresh the server's view of our profile (verified name, unlocked skins)
    await signInWithWallet(wallet);
    closeModal();
  };

  return (
    <Modal onClose={closeModal} title={creating ? `✨ ${t('profile.create')}` : `✏️ ${t('profile.edit')}`}>
      <div className="col">
        {creating && <div className="notice">{t('profile.createDesc')}</div>}
        <div className="row" style={{ justifyContent: 'center' }}>
          <SkinCanvas skin={skin} size={110} followPointer seed={2} />
        </div>
        <input className="input" value={name} maxLength={24} placeholder={t('lobby.name')} onChange={(e) => setName(e.target.value)} style={{ textAlign: 'center' }} />
        <div className="muted small center">
          {t('profile.nameHint')} · {utf8Length(clean)}/16
        </div>
        <div className="skin-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))' }}>
          {choices.map((s) => (
            <div key={s.id} className={`skin-tile ${s.id === skin ? 'selected' : ''}`} onClick={() => setSkin(s.id)} style={{ padding: 4 }}>
              <SkinCanvas skin={s.id} size={56} animate={s.id === skin} seed={s.id} />
              <span style={{ fontSize: 11 }}>{s.name[lang]}</span>
            </div>
          ))}
        </div>
        <button className="btn btn-gold btn-xl" disabled={!valid || busy || !client} onClick={submit}>
          {busy ? <span className="spin" /> : '⛓️'} {t('profile.saveChain')}
        </button>
      </div>
    </Modal>
  );
}
