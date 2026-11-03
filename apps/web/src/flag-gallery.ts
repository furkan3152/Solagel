import { ELYSIUM, INK, type Expression } from '@elymum/art';
import { COUNTRY_CODES, isCountryCode } from '@elymum/shared';
import { drawCoinLook } from './render/coin';
import { flagSkins } from './render/flagskin';
import { LookCache } from './render/looks';

const DISPLAY = '800 26px "Fraunces Variable", Fraunces, Georgia, serif';
const MONO = '"Geist Mono Variable", "Geist Mono", ui-monospace, monospace';

/** The sheet's default line-up: the countries the owner checks first. */
const DEFAULT = ['TR', 'US', 'GB', 'BR', 'DE', 'FR', 'JP', 'KR', 'IN', 'RU', 'ES', 'IT', 'NG', 'AR', 'CA', 'CN'];
const MOODS: Expression[] = ['happy', 'proud', 'smug', 'hungry', 'love', 'happy', 'scared', 'chomp'];

/**
 * Flag skin proof sheet (open with `?flagskins`, or `?flagskins=TR,JP`, or `?flagskins=all`): coins
 * painted with their country's flag on the paper floor, the code and the country's name under each,
 * drawn once (a still frame, so a screenshot is stable). The `data-ready` attribute marks the end.
 */
export function startFlagGallery(root: HTMLElement, list: string): void {
  const codes = list === 'all' ? COUNTRY_CODES.slice() : list ? list.split(',').map((c) => c.trim().toUpperCase()).filter(isCountryCode) : DEFAULT;
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  document.body.style.margin = '0';
  document.body.style.background = ELYSIUM.cream;
  const canvas = document.createElement('canvas');
  root.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const looks = new LookCache();
  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const cell = 180;
    const cols = Math.max(1, Math.floor((w - 32) / cell));
    const rows = Math.ceil(codes.length / cols);
    const h = 84 + rows * (cell + 24) + 16;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = ELYSIUM.cream;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = INK;
    ctx.font = DISPLAY;
    ctx.textAlign = 'left';
    ctx.fillText('Elymum · flag skins', 24, 46);
    const x0 = (w - cols * cell) / 2;
    codes.forEach((code, i) => {
      const cx = x0 + (i % cols) * cell + cell / 2;
      const cy = 84 + Math.floor(i / cols) * (cell + 24) + cell / 2 - 10;
      const r = cell * 0.34;
      const base = looks.lookFor(i % 8);
      const fill = flagSkins.fill(code, r * 2 * dpr);
      drawCoinLook(ctx, cx, cy, r, fill ? flagSkins.look(base, code) : base, {
        time: 0,
        lookX: Math.cos(i * 1.7) * 0.5,
        lookY: Math.sin(i * 1.3) * 0.4,
        expression: MOODS[i % MOODS.length],
        pxPerUnit: dpr,
        seed: i,
        skinFill: fill,
      });
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.font = `700 13px ${MONO}`;
      ctx.fillText(code, cx, cy + r + 24);
      ctx.font = `500 12px ${MONO}`;
      ctx.fillText((names.of(code) ?? code).toUpperCase().slice(0, 22), cx, cy + r + 40);
    });
    canvas.dataset.ready = '1';
  };
  void document.fonts.ready.then(draw);
  window.addEventListener('resize', draw);
}
