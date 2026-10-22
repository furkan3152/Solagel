/* Slana promo: stage bootstrap. Exposes window.renderAt(t) (async) for the
 * frame renderer and a ?t= preview mode for quick looks in a browser. */
'use strict';

const stage = document.getElementById('stage');
const sctx = stage.getContext('2d');
const tmp = mkCanvas(W, H), tctx = tmp.getContext('2d');
const acc = mkCanvas(W, H), actx = acc.getContext('2d');

/* image cache (footage frames, screenshots) */
const IMG = new Map();
function loadImg(url) {
  if (IMG.has(url)) return IMG.get(url).p;
  const im = new Image();
  const p = new Promise((res) => {
    im.onload = () => res(im);
    im.onerror = () => res(null);
  });
  im.src = url;
  IMG.set(url, { im, p, ok: false });
  p.then((v) => { const e = IMG.get(url); if (e) e.ok = !!v; });
  if (IMG.size > 220) {
    // drop the oldest entries
    const keys = [...IMG.keys()].slice(0, 60);
    keys.forEach((k) => IMG.delete(k));
  }
  return p;
}
window.getImg = (url) => {
  const e = IMG.get(url);
  return e && e.ok ? e.im : null;
};

async function boot() {
  const faces = [
    new FontFace('Brico', 'url(/fonts/brico.woff2)', { weight: '200 800', stretch: '75% 100%' }),
    new FontFace('DMMono', 'url(/fonts/dmmono-400.woff2)', { weight: '400' }),
    new FontFace('DMMono', 'url(/fonts/dmmono-500.woff2)', { weight: '500' }),
  ];
  for (const f of faces) { await f.load(); document.fonts.add(f); }
  window.TL = await (await fetch('/timeline.json')).json();
  buildTextures();
  await window.SCENES_INIT();
  window.ready = true;
}

function drawAt(ctx, t) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  window.SCENE_DRAW(ctx, t);
  ctx.restore();
}

window.renderAt = async (t) => {
  const { k, shutter } = window.SCENE_BLUR(t);
  const times = [];
  if (k <= 1) times.push(t);
  else for (let i = 0; i < k; i++) times.push(t + (i / (k - 1) - 0.5) * shutter);
  const need = new Set();
  times.forEach((ti) => window.SCENE_ASSETS(ti).forEach((u) => need.add(u)));
  await Promise.all([...need].map(loadImg));
  if (times.length === 1) {
    drawAt(sctx, t);
  } else {
    times.forEach((ti, i) => {
      drawAt(tctx, ti);
      actx.globalAlpha = i === 0 ? 1 : 1 / (i + 1);
      actx.drawImage(tmp, 0, 0);
    });
    actx.globalAlpha = 1;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.drawImage(acc, 0, 0);
  }
  // a scene set may grade its own frame (SCENE_GRAIN); the promo uses the riso grain and vignette
  if (window.SCENE_GRAIN) window.SCENE_GRAIN(sctx, t);
  else drawGrainAndVignette(sctx, t, window.SCENE_DARK(t));
  return true;
};

boot().then(async () => {
  const q = new URLSearchParams(location.search);
  if (q.has('t')) await window.renderAt(parseFloat(q.get('t')));
});
