import { BASIC_SKINS, MAX_NAME_LENGTH, isBasicSkin, sanitizeName, shortAddress, utf8Length } from '@elymum/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Button, Field, Icon, Seigaiha, staggerIn, useReducedMotion } from '../../design';
import { levelProgress } from '../../game/engine';
import { sound } from '../../audio';
import { useT } from '../../i18n';
import { useChainData } from '../../wallet/chain';
import { saveProfile } from '../../wallet/profile';
import { signInWithWallet } from '../../wallet/signIn';
import { useAddress } from '../../wallet/store';
import { openModal, toast, updateSettings, useUi } from '../../store';
import { CoinPortrait } from '../game/CoinPortrait';
import { PageHead } from '../PageHead';
import { SettingsPage } from './SettingsPage';
import './profile.css';

/** Names are at most 16 UTF-8 bytes (the server refuses longer ones). */
const MAX_NAME_BYTES = 16;

/**
 * Profile: the member card (coin, name, level and XP), the name and the coin you wear (saved on
 * the server with `PUT /api/profile` once the wallet is signed in; locally otherwise) and the
 * record; settings sit next to it.
 */
export function ProfilePage() {
  const t = useT();
  return (
    <div className="pf-page">
      <PageHead kicker={t('pf.kicker')} title={t('pf.title')} />
      <div className="pf-cols">
        <div className="pf-col">
          <MemberCard />
          <NameAndCoin />
        </div>
        <div className="pf-col">
          <Record />
          <section className="pf-box" aria-labelledby="pf-settings-h">
            <h3 id="pf-settings-h" className="kl-h3">
              <Icon name="settings" size={20} />
              {t('st.title')}
            </h3>
            <SettingsPage />
          </section>
        </div>
      </div>
    </div>
  );
}

function MemberCard() {
  const t = useT();
  const settings = useUi((s) => s.settings);
  const auth = useUi((s) => s.auth);
  const profile = useChainData((s) => s.profile);
  const owner = useAddress();
  const nf = new Intl.NumberFormat('en-US');
  const name = profile?.name ?? auth?.profile?.name ?? (settings.name || t('pf.guest'));
  const xp = auth?.profile?.xp ?? 0;
  const prog = levelProgress(xp);
  return (
    <section className="pf-card" aria-labelledby="pf-card-h">
      <span className="pf-card__band mono" aria-hidden="true">
        <span>{t('pf.card')} · ELYMUM</span>
        <span>{owner ? `NO. ${owner.slice(2, 6).toUpperCase()}` : t('pf.guestNo')}</span>
      </span>
      <Seigaiha rows={3} r={22} span={600} tone="ink" className="pf-card__waves" />
      <div className="pf-card__grid">
        <span className="pf-card__photo">
          <CoinPortrait skin={settings.skin} size={104} expression="proud" seed={11} />
        </span>
        <div className="pf-card__id">
          <h3 id="pf-card-h" className="pf-card__name">
            {name}
          </h3>
          {owner ? (
            <>
              <span className="pf-card__lvl mono">
                {t('pf.level', { n: prog.level })} · {t('pf.xp', { xp: nf.format(xp), next: nf.format(prog.next) })}
              </span>
              <span className="kl-xp pf-card__xp" role="progressbar" aria-label={t('pf.level', { n: prog.level })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(prog.pct * 100)}>
                <span style={{ width: `${Math.round(prog.pct * 100)}%` }} />
              </span>
              <span className="pf-card__meta mono">
                {shortAddress(owner, 6, 4)}
              </span>
            </>
          ) : (
            <>
              <span className="pf-card__lvl mono">{t('pf.guest')}</span>
              <p className="kl-note">{t('pf.guestNote')}</p>
              <Button variant="teal" size="md" lead="wallet" onClick={() => openModal('wallet')}>
                {t('wl.connect')}
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function NameAndCoin() {
  const t = useT();
  const settings = useUi((s) => s.settings);
  const owner = useAddress();
  const token = useUi((s) => (s.auth && owner && s.auth.address.toLowerCase() === owner.toLowerCase() ? s.auth.token : null));
  const profile = useChainData((s) => s.profile);
  const groupId = useId();
  const [name, setName] = useState(profile?.name ?? settings.name);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  // the server's name arrives after the page: take it unless the player already typed
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) setName(profile?.name ?? settings.name);
  }, [profile?.name, settings.name]);

  // never cut a name silently: over 16 UTF-8 bytes is an error the player sees and fixes
  const clean = sanitizeName(name, '');
  const bytes = utf8Length(clean);
  const valid = clean.length > 0 && bytes <= MAX_NAME_BYTES;
  const skin = isBasicSkin(settings.skin) ? settings.skin : 0;
  const serverDiff = !!token && (!profile || clean !== profile.name || skin !== profile.skin);
  const localDiff = clean !== settings.name;
  const dirty = valid && (serverDiff || localDiff);

  const save = async () => {
    if (inFlight.current || !valid) return;
    inFlight.current = true;
    sound.click();
    try {
      if (serverDiff && token) {
        setBusy(true);
        try {
          const saved = await saveProfile(token, { name: clean, skin });
          useChainData.setState({ profile: saved });
          toast('success', t('pf.saved'), undefined, 2500);
        } catch (err) {
          toast('error', (err as Error).message, undefined, 6000);
          return;
        }
        updateSettings({ name: clean });
      } else {
        updateSettings({ name: clean });
        toast('success', t('pf.saved'), undefined, 2500);
      }
      typed.current = false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="pf-box" aria-labelledby="pf-name-h">
      <h3 id="pf-name-h" className="kl-h3">
        <Icon name="user" size={20} />
        {t('pf.nameSection')}
      </h3>
      <Field
        label={t('pf.name')}
        hint={t('pf.nameHint')}
        value={name}
        maxLength={MAX_NAME_LENGTH}
        disabled={busy}
        onChange={(e) => {
          typed.current = true;
          setName(e.target.value);
        }}
        suffix={`${bytes}/${MAX_NAME_BYTES}`}
        error={!valid && name.length > 0 ? t('tf.err.InvalidName') : undefined}
      />

      <fieldset className="pf-looks" disabled={busy}>
        <legend className="mono pf-cap">{t('pf.coin')}</legend>
        <div className="pf-grid">
          {BASIC_SKINS.map((s) => {
            const on = skin === s.id;
            return (
              <label key={s.id} className={`pf-look${on ? ' is-on' : ''}`}>
                <input
                  type="radio"
                  name={groupId}
                  checked={on}
                  onChange={() => {
                    sound.click();
                    updateSettings({ skin: s.id });
                  }}
                  aria-label={s.name}
                />
                <CoinPortrait skin={s.id} size={52} still={!on} seed={s.id + 1} />
                <span className="pf-look__name">{s.name}</span>
              </label>
            );
          })}
        </div>
        <p className="kl-note">{t('pf.coinNote')}</p>
      </fieldset>

      <div className={`pf-save${dirty ? ' is-dirty' : ''}`}>
        <span className="pf-save__state mono" role="status">
          {busy ? t('pf.saving') : dirty ? t('pf.unsaved') : token ? t('pf.serverNote') : t('pf.createNote')}
        </span>
        <Button variant={dirty ? 'primary' : 'secondary'} size="md" icon="check" disabled={!dirty || busy} onClick={() => void save()}>
          {t('pf.save')}
        </Button>
        {owner && !token && (
          <Button variant="secondary" size="md" lead="key" disabled={busy} onClick={() => void signInWithWallet(true)}>
            {t('wl.verify')}
          </Button>
        )}
      </div>
    </section>
  );
}

function Record() {
  const t = useT();
  const reduced = useReducedMotion();
  const profile = useChainData((s) => s.profile);
  const nf = new Intl.NumberFormat('en-US');
  if (!profile) {
    return (
      <section className="pf-box" aria-labelledby="pf-record-h">
        <h3 id="pf-record-h" className="kl-h3">
          <Icon name="trophy" size={20} />
          {t('pf.record')}
        </h3>
        <p className="kl-note">{t('pf.createNote')}</p>
      </section>
    );
  }
  const stats: [string, string][] = [
    [t('pf.games'), nf.format(profile.stats.games)],
    [t('pf.kills'), nf.format(profile.stats.kills)],
    [t('pf.best'), nf.format(profile.stats.best)],
  ];
  return (
    <section className="pf-box" aria-labelledby="pf-record-h">
      <h3 id="pf-record-h" className="kl-h3">
        <Icon name="trophy" size={20} />
        {t('pf.record')}
      </h3>
      <dl className="pf-stats">
        {stats.map(([k, v], i) => (
          <motion.div key={k} {...staggerIn(i, reduced)}>
            <dt className="mono">{k}</dt>
            <dd className="num">{v}</dd>
          </motion.div>
        ))}
      </dl>
    </section>
  );
}
