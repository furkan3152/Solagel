import { AVATAR_LIMITS, BASIC_SKINS } from '@elymum/shared';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '../../design';
import { sound } from '../../audio';
import { useT } from '../../i18n';
import { openModal, toast, updateSettings, useUi } from '../../store';
import { useChainData } from '../../wallet/chain';
import { deleteAvatar, uploadAvatar } from '../../wallet/profile';
import { signInWithWallet } from '../../wallet/signIn';
import { useAddress } from '../../wallet/store';
import { CoinPortrait } from '../game/CoinPortrait';
import {
  MAX_ZOOM,
  PictureError,
  SOURCE_TYPES,
  centerCrop,
  clampCrop,
  decodeFile,
  encodePicture,
  pictureStatus,
  sourceRect,
  wearsPicture,
  zoomCrop,
  type Crop,
  type PictureStatus,
  type Source,
} from './picture';

/** Side of the crop stage (css px). */
const STAGE = 200;

export interface PictureState {
  status: PictureStatus;
  avatar: string | null;
  /** The coin wears the picture now. */
  wearing: boolean;
  busy: boolean;
  editing: { src: Source; crop: Crop } | null;
  input: React.RefObject<HTMLInputElement | null>;
  /** The tile was picked. */
  choose(): void;
  pick(): void;
  onFile(file: File | undefined): void;
  setCrop(c: Crop): void;
  cancel(): void;
  confirm(): Promise<void>;
  remove(): Promise<void>;
}

/** "Your picture" state and actions for the coin picker. */
export function usePicture(): PictureState {
  const t = useT();
  const owner = useAddress();
  const token = useUi((s) => (s.auth && owner && s.auth.address.toLowerCase() === owner.toLowerCase() ? s.auth.token : null));
  const profile = useChainData((s) => s.profile);
  const chosen = useUi((s) => s.settings.picture);
  const avatar = profile?.avatar ?? null;
  const status = pictureStatus({ owner, token, avatar });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ src: Source; crop: Crop } | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  // a picked source image is released when the crop closes
  useEffect(() => () => editing?.src.close(), [editing?.src]);

  const pick = () => input.current?.click();
  const fail = (err: unknown) => toast('error', err instanceof Error ? err.message : String(err), undefined, 6000);
  return {
    status,
    avatar,
    wearing: wearsPicture(chosen, avatar) && status === 'ready',
    busy,
    editing,
    input,
    choose() {
      sound.click();
      if (status === 'guest') openModal('wallet');
      else if (status === 'verify') void signInWithWallet(true);
      else if (status === 'empty') pick();
      else updateSettings({ picture: true });
    },
    pick,
    onFile(file) {
      if (!file) return;
      void decodeFile(file).then(
        (src) => setEditing({ src, crop: centerCrop(src.width, src.height, STAGE) }),
        (err) => fail(err instanceof PictureError ? err : new PictureError('That picture cannot be read.')),
      );
    },
    setCrop(c) {
      setEditing((e) => (e ? { ...e, crop: clampCrop(c, e.src.width, e.src.height, STAGE) } : e));
    },
    cancel() {
      setEditing(null);
    },
    async confirm() {
      if (!editing || !token || busy) return;
      setBusy(true);
      try {
        const blob = await encodePicture(editing.src, editing.crop, STAGE, AVATAR_LIMITS.px);
        const saved = await uploadAvatar(token, blob);
        useChainData.setState({ profile: saved });
        updateSettings({ picture: true });
        setEditing(null);
        toast('success', t('pf.picSaved'), undefined, 2500);
      } catch (err) {
        fail(err);
      } finally {
        setBusy(false);
      }
    },
    async remove() {
      if (!token || busy) return;
      setBusy(true);
      try {
        const saved = await deleteAvatar(token);
        useChainData.setState({ profile: saved });
        updateSettings({ picture: false });
        toast('success', t('pf.picRemoved'), undefined, 2500);
      } catch (err) {
        fail(err);
      } finally {
        setBusy(false);
      }
    },
  };
}

/** The "Your picture" tile among the coins: the picture on the chosen coin, or a "+". */
export function PictureTile({ pic, skin, group }: { pic: PictureState; skin: number; group: string }) {
  const t = useT();
  return (
    <label className={`pf-look pf-look--pic${pic.wearing ? ' is-on' : ''}`}>
      <input type="radio" name={group} checked={pic.wearing} onChange={() => pic.choose()} aria-label={t('pf.pic')} />
      {pic.avatar ? (
        <CoinPortrait skin={skin} size={52} still={!pic.wearing} seed={31} avatar={pic.avatar} />
      ) : (
        <span className="pf-pic-add" aria-hidden="true">
          <span>+</span>
        </span>
      )}
      <span className="pf-look__name">{pic.avatar ? t('pf.pic') : t('pf.picAdd')}</span>
    </label>
  );
}

/** Under the coins: the crop stage, or what the picture does and its buttons. */
export function PicturePanel({ pic, skin }: { pic: PictureState; skin: number }) {
  const t = useT();
  const coin = BASIC_SKINS.find((s) => s.id === skin)?.name ?? 'your coin';
  const fileInput = (
    <input
      ref={pic.input}
      type="file"
      accept={SOURCE_TYPES.join(',')}
      hidden
      onChange={(e) => {
        pic.onFile(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );
  if (pic.editing) return <CropStage pic={pic} skin={skin} />;
  const note =
    pic.status === 'guest'
      ? t('pf.picGuest')
      : pic.status === 'verify'
        ? t('pf.picVerify')
        : pic.status === 'empty'
          ? t('pf.picEmpty')
          : pic.wearing
            ? t('pf.picOn', { coin })
            : t('pf.picOff');
  return (
    <div className="pf-pic" data-status={pic.status}>
      {fileInput}
      <p className="kl-note">{note}</p>
      {pic.status === 'empty' && (
        <Button variant="secondary" size="sm" icon="user" disabled={pic.busy} onClick={pic.pick}>
          {t('pf.picUpload')}
        </Button>
      )}
      {pic.status === 'verify' && (
        <Button variant="secondary" size="sm" lead="key" onClick={() => void signInWithWallet(true)}>
          {t('wl.verify')}
        </Button>
      )}
      {pic.status === 'ready' && (
        <span className="pf-pic__row">
          <Button variant="secondary" size="sm" disabled={pic.busy} onClick={pic.pick}>
            {t('pf.picReplace')}
          </Button>
          <Button variant="secondary" size="sm" disabled={pic.busy} onClick={() => void pic.remove()}>
            {t('pf.picRemove')}
          </Button>
        </span>
      )}
    </div>
  );
}

/** Drag to move, zoom to fit; the coin next to it shows the result. */
function CropStage({ pic, skin }: { pic: PictureState; skin: number }) {
  const t = useT();
  const ed = pic.editing!;
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null);

  // the stage: the image at the crop, the circle cut out in CSS over it
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.height = Math.round(STAGE * dpr);
    const { sx, sy, size } = sourceRect(ed.crop, ed.src.width, ed.src.height, STAGE);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(ed.src.image, sx, sy, size, size, 0, 0, c.width, c.height);
    // the coin preview: the same square, cut to a disc
    const p = document.createElement('canvas');
    p.width = p.height = 128;
    const pc = p.getContext('2d');
    if (pc) {
      pc.beginPath();
      pc.arc(64, 64, 64, 0, Math.PI * 2);
      pc.clip();
      pc.drawImage(ed.src.image, sx, sy, size, size, 0, 0, 128, 128);
      setPreview(p);
    }
  }, [ed]);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, cx: ed.crop.x, cy: ed.crop.y };
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    pic.setCrop({ zoom: ed.crop.zoom, x: d.cx + e.clientX - d.x, y: d.cy + e.clientY - d.y });
  };
  const up = () => {
    drag.current = null;
  };
  const zoom = (z: number) => pic.setCrop(zoomCrop(ed.crop, z, ed.src.width, ed.src.height, STAGE));

  return (
    <div className="pf-crop" role="group" aria-label={t('pf.pic')}>
      <div className="pf-crop__body">
        <div
          className="pf-crop__stage"
          style={{ width: STAGE, height: STAGE }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onWheel={(e) => zoom(ed.crop.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))}
        >
          <canvas ref={canvas} style={{ width: STAGE, height: STAGE }} aria-hidden="true" />
          <span className="pf-crop__mask" aria-hidden="true" />
        </div>
        <div className="pf-crop__side">
          <CoinPortrait skin={skin} size={96} expression="proud" seed={31} picture={preview} />
          <label className="pf-crop__zoom mono">
            {t('pf.picZoom')}
            <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={ed.crop.zoom} onChange={(e) => zoom(Number(e.target.value))} />
          </label>
        </div>
      </div>
      <p className="kl-note">{t('pf.picCrop')}</p>
      <span className="pf-pic__row">
        <Button variant="primary" size="sm" icon="check" disabled={pic.busy || (pic.status !== 'ready' && pic.status !== 'empty')} onClick={() => void pic.confirm()}>
          {pic.busy ? t('pf.picUploading') : t('pf.picUse')}
        </Button>
        <Button variant="secondary" size="sm" disabled={pic.busy} onClick={pic.cancel}>
          {t('pf.picCancel')}
        </Button>
      </span>
    </div>
  );
}
