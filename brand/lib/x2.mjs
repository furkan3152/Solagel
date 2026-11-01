// X profile set, round two: the coin that took a bite out of the ring (avatar) and a night chase
// along the ring floor (banner). Same Ring Storybook kit as templates.mjs.
import { C, coin, page, seigaiha, star, starfield, wordmark } from './art.mjs';

const at = (x, y, html, extra = '') => `<div class="abs" style="left:${x}px;top:${y}px;${extra}">${html}</div>`;

/** The ring habitat as a band along an SVG path: ink edge, deck, a lit window strip. */
const band = (d, w = 30, extra = '') => `
  <path d="${d}" fill="none" stroke="${C.ink}" stroke-width="${w}" stroke-linecap="butt" ${extra}/>
  <path d="${d}" fill="none" stroke="${C.current}" stroke-width="${w - 8}" stroke-linecap="butt" ${extra}/>
  <path d="${d}" fill="none" stroke="${C.reef}" stroke-width="${(w - 8) / 3}" stroke-linecap="butt" transform="translate(0 ${w / 5})" ${extra}/>
  <path d="${d}" fill="none" stroke="${C.sun}" stroke-width="${w / 6}" stroke-dasharray="2 ${w / 2.2}" stroke-linecap="round" ${extra}/>`;

/* ------------------------------------------------------------------ avatar */

export function xAvatar2() {
  const S = 400;
  // the ring is an ellipse around the coin, tilted; back half drawn first, front half after the coin
  const cx = 200;
  const cy = 214;
  const rx = 184;
  const ry = 58;
  const tilt = -12;
  const back = `M${cx - rx} ${cy} A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}`;
  // front half with a bite taken out of the middle (from ~-118 to ~-62 deg below the axis)
  const pt = (deg) => {
    const a = (deg * Math.PI) / 180;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)].map((n) => n.toFixed(1)).join(' ');
  };
  const frontL = `M${cx - rx} ${cy} A${rx} ${ry} 0 0 0 ${pt(116)}`;
  const frontR = `M${pt(64)} A${rx} ${ry} 0 0 0 ${cx + rx} ${cy}`;
  // bite marks: little scallops at both torn ends
  const bite = (deg, dir) => {
    const [x, y] = pt(deg).split(' ').map(Number);
    return `<g transform="translate(${x} ${y}) rotate(${tilt + (dir > 0 ? 8 : -8)})">
      <path d="M0 -14 q${dir * 7} 4 0 9 q${dir * 7} 4 0 9 q${dir * 6} 3 0 7" fill="none" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/></g>`;
  };
  const crumb = (x, y, r, rot) =>
    `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="${-r}" y="${-r * 0.7}" width="${2 * r}" height="${1.4 * r}" rx="2" fill="${C.current}" stroke="${C.ink}" stroke-width="3"/><circle cx="${r * 0.2}" cy="0" r="${Math.max(1.6, r * 0.25)}" fill="${C.sun}"/></g>`;
  const body = `
    <svg class="abs" style="inset:0" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
      <defs>
        <radialGradient id="a2-sky" cx=".5" cy=".42" r=".7"><stop offset="0" stop-color="${C.teal}"/><stop offset=".55" stop-color="${C.current}"/><stop offset="1" stop-color="${C.trench}"/></radialGradient>
      </defs>
      <rect width="${S}" height="${S}" fill="url(#a2-sky)"/>
      <circle cx="${cx}" cy="${cy - 10}" r="150" fill="none" stroke="${C.spray}" stroke-width="2" stroke-dasharray="3 11" opacity=".55"/>
      ${star(78, 96, 1.4)}${star(322, 82, 1.1)}${star(96, 318, 0.9)}${star(318, 330, 1.2, C.sun)}
      <circle cx="132" cy="62" r="2.2" fill="${C.cream}"/><circle cx="276" cy="48" r="1.8" fill="${C.cream}"/><circle cx="58" cy="210" r="1.8" fill="${C.cream}" opacity=".8"/><circle cx="352" cy="208" r="2" fill="${C.cream}" opacity=".8"/>
      <g transform="rotate(${tilt} ${cx} ${cy})">${band(back, 30)}</g>
    </svg>
    ${at(cx - 118, cy - 150, coin('sun', { mood: 'chomp', look: [3, 4], size: 236 }))}
    <svg class="abs" style="inset:0" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
      <g transform="rotate(${tilt} ${cx} ${cy})">
        ${band(frontL, 30)}${band(frontR, 30)}
        ${bite(116, 1)}${bite(64, -1)}
      </g>
      ${crumb(118, 318, 7, 24)}${crumb(286, 300, 5, -30)}${crumb(150, 352, 4.5, 60)}${crumb(262, 344, 6, 12)}
      <path d="M100 286 l-14 6 M96 300 l-16 -2" stroke="${C.cream}" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M302 264 l14 -8 M308 278 l17 -1" stroke="${C.cream}" stroke-width="3.5" stroke-linecap="round"/>
    </svg>`;
  return { w: S, h: S, html: page({ w: S, h: S, body, bg: C.trench }) };
}

/* ------------------------------------------------------------------ banner */

export function xBanner2() {
  const w = 1500;
  const h = 500;
  const css = `
    .title{position:absolute;left:470px;top:44px;transform:rotate(-2deg)}
    .line{position:absolute;left:520px;top:178px;font-family:var(--display);font-style:italic;font-variation-settings:"SOFT" 100,"WONK" 1;
      font-weight:500;font-size:30px;color:${C.cream};transform:rotate(-2deg);letter-spacing:-.01em}
    .live{position:absolute;right:58px;top:40px;transform:rotate(3deg);padding:12px 16px 12px;background:${C.sun};border-radius:14px}
    .live .k{font-family:var(--mono);font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:700}
    .live .n{font-family:var(--display);font-variation-settings:"SOFT" 100,"WONK" 1,"opsz" 144;font-weight:800;font-size:30px;line-height:1;margin-top:4px}
    .dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:${C.down};border:2px solid ${C.ink};margin-right:6px;vertical-align:-1px}
    .handle{position:absolute;right:62px;bottom:26px;font-family:var(--mono);font-weight:700;font-size:16px;color:${C.cream};letter-spacing:.04em}`;
  // the ring overhead: a huge arc, lights on
  const arc = 'M-80 330 C 220 -40, 1280 -40, 1580 330';
  // the floor: a hill rising to the right
  const floor = 'M-20 420 C 380 400, 900 360, 1520 300 V 520 H -20 Z';
  const floor2 = 'M-20 456 C 400 440, 920 410, 1520 360 V 520 H -20 Z';
  const food = (x, y, c) => `<g transform="translate(${x} ${y})"><circle r="9" fill="${c}" opacity=".25"/><circle r="4.5" fill="${c}" stroke="${C.ink}" stroke-width="2"/></g>`;
  const trail = (pts) => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="${C.cream}" opacity=".7"/>`).join('');
  const body = `
    <svg class="abs" style="inset:0" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <defs><linearGradient id="b2-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${C.deep}"/><stop offset=".55" stop-color="${C.trench}"/><stop offset="1" stop-color="${C.teal}"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#b2-sky)"/>
    </svg>
    <div class="abs" style="left:0;top:0;opacity:.9">${starfield(w, 300, 46, 11)}</div>
    <div class="abs" style="left:0;top:240px;opacity:.35;-webkit-mask-image:linear-gradient(to bottom,transparent,#000 60%);mask-image:linear-gradient(to bottom,transparent,#000 60%)">${seigaiha({ w, h: 200, r: 34, stroke: C.spray, width: 2.5 })}</div>
    <svg class="abs" style="inset:0" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      ${band(arc, 40)}
      <circle cx="1180" cy="118" r="34" fill="${C.cream}" stroke="${C.ink}" stroke-width="4"/>
      <circle cx="1170" cy="110" r="7" fill="${C.creamS}"/><circle cx="1192" cy="128" r="4.5" fill="${C.creamS}"/>
      <path d="${floor}" fill="${C.verdant}" stroke="${C.ink}" stroke-width="4"/>
      <path d="M-20 432 C 380 412, 900 372, 1520 312" fill="none" stroke="#7DBB72" stroke-width="7"/>
      <path d="${floor2}" fill="${C.forest}" stroke="${C.ink}" stroke-width="4"/>
      <path d="M-20 468 C 400 452, 920 422, 1520 372" fill="none" stroke="#4C8F58" stroke-width="7" stroke-dasharray="160 60 90 110"/>
      ${food(372, 412, C.sun)}${food(612, 398, C.cyan)}${food(704, 392, C.blush)}${food(1312, 322, C.sun)}${food(1418, 312, C.cyan)}
      ${trail([[1040, 352], [1068, 346], [1096, 340], [1124, 334]])}
    </svg>
    <div class="title">${wordmark({ width: 470, diecut: true })}</div>
    <div class="line">small change, big appetite.</div>
    ${at(430, 330, coin('foam', { mood: 'scared', look: [-4, -1], sweat: true, size: 62 }), 'transform:rotate(-8deg)')}
    ${at(530, 316, coin('cyan', { mood: 'scared', look: [-4, 0], size: 72 }), 'transform:rotate(-6deg)')}
    ${at(644, 290, coin('up', { mood: 'open', look: [4, -1], size: 84 }), 'transform:rotate(5deg)')}
    ${at(800, 222, coin('sun', { mood: 'chomp', look: [-7, 2], size: 176 }), 'transform:rotate(-7deg)')}
    ${at(1000, 268, coin('teal', { mood: 'smug', look: [-3, 0], size: 86 }), 'transform:rotate(4deg)')}
    ${at(1210, 272, coin('cream', { mood: 'sleepy', size: 64 }))}
    <div class="live sticker"><div class="k"><span class="dot"></span>Testnet open</div><div class="n">elymum.io</div></div>
    <div class="handle">@elymumio</div>`;
  return { w, h, html: page({ w, h, body, css, bg: C.trench }) };
}
