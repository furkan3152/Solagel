import { useId, useRef, type KeyboardEvent } from 'react';
import { clearCustomMusic, pickCustomMusic } from '../../audio/custom';
import type { MusicChoice } from '../../audio/tracks';
import { useT, type TKey } from '../../i18n';
import { updateSettings, useUi } from '../../store';

type Option = MusicChoice | 'off';

const OPTIONS: { id: Option; name: TKey; note: TKey }[] = [
  { id: 'classic', name: 'gs.track.classic', note: 'gs.track.classicNote' },
  { id: 'chill', name: 'gs.track.chill', note: 'gs.track.chillNote' },
  { id: 'arcade', name: 'gs.track.arcade', note: 'gs.track.arcadeNote' },
  { id: 'chiptune', name: 'gs.track.chiptune', note: 'gs.track.chiptuneNote' },
  { id: 'lofi', name: 'gs.track.lofi', note: 'gs.track.lofiNote' },
  { id: 'off', name: 'gs.track.off', note: 'gs.track.offNote' },
  { id: 'custom', name: 'gs.track.custom', note: 'gs.track.customNote' },
];

/** The option the settings stand for: "No music" is the switch, a missing own file is the default. */
export function selectedOption(musicOn: boolean, track: MusicChoice, hasCustom: boolean): Option {
  if (!musicOn) return 'off';
  if (track === 'custom' && !hasCustom) return 'classic';
  return track;
}

/**
 * The soundtrack picker (settings, lobby and room alike): a radio group of little tickets, the
 * picked one in sun with a hard shadow. Picking cross-fades at once (that is the preview).
 * "Your own music" opens a file picker; the file plays from a blob URL in this browser only.
 */
export function MusicPicker({ disabled = false }: { disabled?: boolean }) {
  const t = useT();
  const s = useUi((st) => st.settings);
  const custom = useUi((st) => st.customMusic);
  const refused = useUi((st) => st.customMusicRefused);
  const file = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const noteId = useId();
  const current = selectedOption(s.musicOn, s.musicTrack, !!custom);

  const choose = (id: Option, viaKeys = false) => {
    if (id === 'off') return updateSettings({ musicOn: false });
    if (id === 'custom') {
      if (custom && !custom.error) return updateSettings({ musicTrack: 'custom', musicOn: true });
      // arrows only move past it: the file dialog opens on a real press
      if (!viaKeys) file.current?.click();
      return;
    }
    updateSettings({ musicTrack: id, musicOn: true });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    // from the focused ticket (arrows may have stepped onto "your own music" without picking it)
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.track;
    const from = OPTIONS.some((o) => o.id === focused) ? focused : current;
    const i = OPTIONS.findIndex((o) => o.id === from);
    const next = OPTIONS[(i + step + OPTIONS.length) % OPTIONS.length];
    const btn = e.currentTarget.querySelector<HTMLButtonElement>(`[data-track="${next.id}"]`);
    btn?.focus();
    choose(next.id, true);
  };

  return (
    <div className="gs-music">
      <span className="gs-label">
        <span className="g-set__label" id={labelId}>
          {t('gs.music')}
        </span>
        <span className="gs-note" id={noteId}>
          {t('gs.musicNote')}
        </span>
      </span>
      <div className="gs-tracks" role="radiogroup" aria-labelledby={labelId} aria-describedby={noteId} onKeyDown={onKeyDown}>
        {OPTIONS.map((o) => {
          const on = current === o.id;
          const note = o.id === 'custom' && custom ? custom.name : t(o.note);
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              data-track={o.id}
              className={`gs-track${on ? ' is-on' : ''}${o.id === 'off' ? ' is-off' : ''}`}
              disabled={disabled}
              onClick={() => choose(o.id)}
            >
              <span className="gs-track__name">{t(o.name)}</span>
              <span className="gs-track__note mono" title={note}>
                {note}
              </span>
            </button>
          );
        })}
      </div>
      {custom && (
        <div className="gs-own">
          <p className="gs-note gs-own__note">
            {t('gs.customPrivacy')} {custom.saved ? t('gs.customSaved') : t('gs.customSession')}
          </p>
          <span className="gs-own__acts">
            <button type="button" className="kl-link mono" disabled={disabled} onClick={() => file.current?.click()}>
              {t('gs.customChange')}
            </button>
            <button type="button" className="kl-link mono" onClick={() => void clearCustomMusic()}>
              {t('gs.customClear')}
            </button>
          </span>
        </div>
      )}
      {custom?.error && (
        <p className="gs-note gs-own__warn" role="status">
          {t('gs.customError')}
        </p>
      )}
      {refused && !custom?.error && (
        <p className="gs-note gs-own__warn" role="status">
          {t('gs.customRefused')}
        </p>
      )}
      <input
        ref={file}
        className="gs-own__input"
        type="file"
        accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac,.webm"
        tabIndex={-1}
        aria-hidden="true"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void pickCustomMusic(f);
        }}
      />
    </div>
  );
}
