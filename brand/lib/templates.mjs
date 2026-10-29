// The Elymum brand kit templates. Each export returns { w, h, html } (CSS pixels; the generator
// picks the device scale). Copy follows the spec: short, specific, a little wry; the product is
// "Elymum", the chain "Elysium", the gas token HYPE, the mint "$1 in HYPE", the handle @elymum.
// No domain is written into the art (the site's domain is whatever PUBLIC_URL says).
import { C, coin, coinMark, cloud, food, page, props, seigaiha, star, starfield, terraces, wordmark } from './art.mjs';
import { ringScene } from './scene.mjs';

const HANDLE = '@elymum';

/** A positioned coin (left/top are the box's top-left in px). */
const at = (x, y, html, extra = '') => `<div class="abs" style="left:${x}px;top:${y}px;${extra}">${html}</div>`;
const arrow = `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="${C.ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h11M11 5l5 5-5 5"/></svg>`;
const flowPills = (night = false) =>
  `<div style="display:flex;align-items:center;gap:8px">
    <span class="tag ${night ? 'ghost' : ''}">WL</span><span style="width:18px;border-top:3px dotted ${night ? C.foam : C.ink}"></span>
    <span class="tag sun">Mint</span><span style="width:18px;border-top:3px dotted ${night ? C.foam : C.ink}"></span>
    <span class="tag ${night ? 'ghost' : ''}">Play</span></div>`;

/* ------------------------------------------------------------------ X profile picture */

export function xAvatar() {
  const S = 400;
  const body = `
    <svg class="abs" style="inset:0" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
      <defs><linearGradient id="av-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${C.trench}"/><stop offset=".55" stop-color="${C.teal}"/><stop offset="1" stop-color="${C.spray}"/></linearGradient></defs>
      <rect width="${S}" height="${S}" fill="url(#av-sky)"/>
      ${star(92, 78, 1.3)}${star(318, 64, 1)}${star(338, 150, 0.8)}
      <circle cx="70" cy="140" r="2.2" fill="${C.cream}"/><circle cx="250" cy="40" r="2" fill="${C.cream}"/>
      <path d="M-40 250 C 40 40, 360 40, 440 250" fill="none" stroke="${C.ink}" stroke-width="26" stroke-linecap="round"/>
      <path d="M-40 250 C 40 40, 360 40, 440 250" fill="none" stroke="${C.current}" stroke-width="20"/>
      <path d="M-40 250 C 40 40, 360 40, 440 250" fill="none" stroke="${C.sun}" stroke-width="4" stroke-dasharray="2 14" transform="translate(0,-3)"/>
      <path d="M-20 300 Q 200 380 420 300 V 420 H -20 Z" fill="${C.meadow}" stroke="${C.ink}" stroke-width="3"/>
      <path d="M-20 312 Q 200 390 420 312" fill="none" stroke="#9CC77A" stroke-width="6"/>
      <path d="M-20 336 Q 200 416 420 336 V 420 H -20 Z" fill="${C.verdant}" stroke="${C.ink}" stroke-width="3"/>
      <path d="M-20 352 Q 200 432 420 352" fill="none" stroke="#4C8F58" stroke-width="8"/>
      <g transform="translate(46 318)"><path d="M0 0 V-14" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/><circle cx="0" cy="-24" r="12" fill="${C.forest}" stroke="${C.ink}" stroke-width="2.5"/></g>
      <g transform="translate(356 314)"><path d="M0 0 V-8" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/><path d="M0 -40 L11 -8 H-11 Z" fill="${C.pine}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/></g>
      <g transform="translate(330 318)"><path d="M-12 0 V-16 L0 -27 L12 -16 V0 Z" fill="${C.cream}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/><path d="M-15 -14 L0 -29 L15 -14 L12 -16 L0 -27 L-12 -16Z" fill="${C.coral}" stroke="${C.ink}" stroke-width="2" stroke-linejoin="round"/><rect x="-4" y="-11" width="8" height="8" rx="1.5" fill="${C.sun}" stroke="${C.ink}" stroke-width="2"/></g>
    </svg>
    ${at(72, 96, coin('sun', { mood: 'smile', look: [2, 1], size: 256, ground: true }))}`;
  return { w: S, h: S, html: page({ w: S, h: S, body, bg: C.teal }) };
}

/* ------------------------------------------------------------------ X banner */

export function xBanner() {
  const w = 1500;
  const h = 500;
  const css = `
    .scene{position:absolute;left:0;top:-235px;width:1500px;height:917px}
    .card{position:absolute;right:70px;top:62px;width:560px;padding:26px 32px 28px;transform:rotate(1.4deg)}
    .card .tape{left:50%;top:-17px;margin-left:-52px;transform:rotate(-3deg)}
    .card h2{font-family:var(--body);font-weight:600;font-size:24px;line-height:1.25;margin:4px 0 16px;letter-spacing:-.01em}
    .badge{position:absolute;left:540px;top:60px;transform:rotate(-4deg);padding:12px 16px;background:var(--sun);border-radius:14px}
    .badge .n{font-family:var(--mono);font-size:28px;font-weight:600;line-height:1}
    .badge .l{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin-top:4px}`;
  const body = `
    <div class="scene">${ringScene({ par: 'xMidYMid slice', style: 'width:100%;height:100%' })}</div>
    ${at(262, 384, coin('teal', { mood: 'smile', look: [3, 1], size: 100, ground: true }))}
    ${at(380, 432, coin('foam', { mood: 'happy', size: 56, ground: true }))}
    ${at(470, 342, coin('sun', { mood: 'chomp', look: [4, 1], size: 150, ground: true }))}
    ${at(640, 428, coin('foam', { mood: 'scared', look: [-3, -1], sweat: true, size: 60, ground: true }))}
    ${at(760, 440, coin('cyan', { mood: 'smile', look: [-2, -1], size: 48, ground: true }))}
    ${at(1380, 400, coin('up', { mood: 'open', look: [-3, 0], size: 80, ground: true }))}
    <div class="sticker badge"><div class="n">05:00</div><div class="l">per round. Then lunch.</div></div>
    <div class="card sticker">
      <div class="tape"></div>
      <div class="kick" style="color:${C.teal}">A five-minute feast &middot; on Elysium</div>
      <div style="margin:10px 0 6px">${wordmark({ width: 400 })}</div>
      <h2>You are small change with a big appetite.</h2>
      <div style="display:flex;align-items:center;justify-content:space-between">${flowPills()}<span class="mono" style="font-size:15px;font-weight:600">${HANDLE}</span></div>
    </div>`;
  return { w, h, html: page({ w, h, body, css, bg: C.teal }) };
}

/* ------------------------------------------------------------------ Open Graph card */

export function ogCard() {
  const w = 1200;
  const h = 630;
  const css = `
    .scene{position:absolute;left:-60px;top:-177px;width:1320px;height:807px}
    .card{position:absolute;left:48px;top:56px;width:590px;padding:28px 34px 30px;transform:rotate(-1.6deg)}
    .card .tape{left:50%;top:-17px;margin-left:-52px;transform:rotate(3deg)}
    .card h2{font-family:var(--body);font-weight:600;font-size:26px;line-height:1.22;letter-spacing:-.01em;margin:2px 0 10px}
    .card p{font-size:18px;line-height:1.45;color:#3E3A31;margin-bottom:20px}
    .badge{position:absolute;right:58px;top:52px;transform:rotate(4deg);padding:14px 18px;background:var(--sun);border-radius:14px}
    .badge .n{font-family:var(--display);font-variation-settings:"SOFT" 100,"opsz" 144;font-weight:800;font-size:34px;line-height:1}
    .badge .l{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin-top:6px}
    .pop{position:absolute;font-family:var(--mono);font-weight:600;font-size:18px;background:var(--cream);border:2.5px solid var(--ink);border-radius:8px;padding:3px 8px;box-shadow:3px 3px 0 var(--ink);transform:rotate(-4deg)}`;
  const body = `
    <div class="scene">${ringScene({ par: 'xMidYMid slice', style: 'width:100%;height:100%' })}</div>
    ${at(46, 488, coin('teal', { mood: 'smile', look: [3, 1], size: 112, ground: true }))}
    ${at(176, 548, coin('foam', { mood: 'happy', size: 60, ground: true }))}
    ${at(650, 430, coin('sun', { mood: 'chomp', look: [4, 1], size: 170, ground: true }))}
    ${at(826, 536, coin('foam', { mood: 'scared', look: [-3, -1], sweat: true, size: 66, ground: true }))}
    ${at(1020, 486, coin('up', { mood: 'open', look: [-3, 0], size: 96, ground: true }))}
    ${at(1124, 560, coin('cyan', { mood: 'smile', look: [-2, -1], size: 52, ground: true }))}
    <div class="pop" style="left:812px;top:478px">+$0.12</div>
    <div class="sticker badge"><div class="n">$1 mint</div><div class="l">paid in HYPE</div></div>
    <div class="card sticker">
      <div class="tape"></div>
      <div class="kick" style="color:${C.teal}">A five-minute feast &middot; on Elysium</div>
      <div style="margin:10px 0 10px">${wordmark({ width: 430 })}</div>
      <h2>You are small change with a big appetite.</h2>
      <p>Eat the food. Eat coins smaller than you. When the bell rings, whatever you swallowed is yours.</p>
      <div style="display:flex;align-items:center;gap:18px">
        <span class="btn sun">Join the WL ${arrow}</span>${flowPills()}
      </div>
    </div>`;
  return { w, h, html: page({ w, h, body, css, bg: C.teal }) };
}

/* ------------------------------------------------------------------ icons */

export function favicon(px) {
  const body = `<div style="width:${px}px;height:${px}px;display:flex;align-items:center;justify-content:center">${coinMark(px, { shadow: false })}</div>`;
  return { w: px, h: px, html: page({ w: px, h: px, body }) };
}

export function appleTouchIcon() {
  const px = 180;
  const body = `<svg class="abs" style="inset:0" viewBox="0 0 180 180" width="180" height="180"><rect width="180" height="180" fill="${C.trench}"/></svg>
    <div class="abs" style="left:-30px;top:96px;opacity:.9">${seigaiha({ w: 240, h: 90, r: 22, stroke: C.reef, width: 3 })}</div>
    <div class="abs" style="left:26px;top:22px">${coinMark(128)}</div>`;
  return { w: px, h: px, html: page({ w: px, h: px, body, bg: C.trench }) };
}

/* ------------------------------------------------------------------ posts (1600 x 900) */

const plate = (num, title, route, night = false) => `
  <div class="abs plate" style="left:0;right:0;top:0;height:64px;display:flex;align-items:center;gap:14px;padding:0 48px;
    font-family:var(--mono);font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${night ? C.foam : C.stone};
    border-bottom:3px solid ${C.ink};background:${night ? C.deep : C.plain}">
    <span>Plate ${num}</span><b style="font-family:var(--display);font-variation-settings:'SOFT' 100,'WONK' 1;font-weight:700;font-size:22px;letter-spacing:0;text-transform:none;color:${night ? C.cream : C.ink}">${title}</b>
    <span style="flex:1;border-top:2px dashed ${night ? C.current : C.sand2}"></span><span>${route}</span></div>`;

export function postWlOpen() {
  const w = 1600;
  const h = 900;
  const chore = (n, kicker, title, text, paint, mood, action, done, x, y, tilt) => `
    <div class="sticker abs" style="left:${x}px;top:${y}px;width:680px;padding:20px 24px;display:flex;gap:20px;align-items:center;transform:rotate(${tilt}deg);background:${done ? C.mist : C.cream}">
      ${coin(paint, { mood, size: 74, feet: false })}
      <div style="flex:1">
        <div class="kick" style="font-size:12px;color:${C.stone}">Chore ${n} &middot; ${kicker}</div>
        <div class="disp" style="font-size:31px;margin:4px 0 6px">${title}</div>
        <div style="font-size:16px;line-height:1.4;color:#3E3A31">${text}</div>
      </div>
      ${done
        ? `<div style="font-family:var(--display);font-variation-settings:'SOFT' 100;font-weight:900;font-size:22px;letter-spacing:.06em;color:${C.upS};border:4px solid ${C.upS};border-radius:10px;padding:4px 12px;transform:rotate(-8deg)">DONE</div>`
        : `<span class="btn ${action === 'Connect' ? '' : 'teal'}" style="font-size:16px;padding:10px 16px${action === 'Connect' ? ';border-style:dashed;box-shadow:none' : ''}">${action}</span>`}
    </div>`;
  const css = '';
  const deco = `${props.tree(120, 18)}${props.pine(150, 26)}${props.house(300, 40)}${props.tree(1500, 14)}${props.house(1450, 26)}${props.pine(560, 70, 0.9)}${props.tree(1180, 64)}`;
  const body = `
    <div class="abs" style="left:0;top:690px">${terraces({ w: 1600, h: 220, rise: 34, props: deco })}</div>
    ${at(420, 560, cloud(0.75))}
    ${plate('IV', 'Three small chores', '/wl')}
    <div class="abs" style="left:72px;top:150px;width:600px">
      <div class="kick" style="color:${C.teal}">Whitelist &middot; the ascent</div>
      <div class="disp" style="font-size:86px;margin:16px 0 22px">The WL is <span class="wonk" style="color:${C.teal}">open.</span></div>
      <div style="font-size:23px;line-height:1.45;color:#3E3A31;max-width:500px">Three small chores, then the feast. Each one lifts you a terrace up the ring. Finish all three for a mint spot and a boarding pass to flex with.</div>
      <div style="display:flex;align-items:center;gap:16px;margin-top:34px">
        <span class="btn sun" style="font-size:20px">Join the WL ${arrow}</span>
        <span class="mono" style="font-size:18px;font-weight:600">${HANDLE}</span>
      </div>
    </div>
    ${chore(1, 'X', 'Follow @elymum', 'The ring noticed, and so did our follower count.', 'up', 'happy', 'Open X', true, 860, 128, -1.2)}
    ${chore(2, 'X &middot; about 20 seconds', 'Repost the pinned feast', 'The one with the coin eating a slightly smaller coin.', 'cyan', 'smile', 'Open X', false, 820, 318, 0.8)}
    ${chore(3, 'Wallet', 'Connect a wallet on Elysium', 'To sign a message, not a transaction. Nobody asks for your seed phrase. Nobody should.', 'cream', 'smile', 'Connect', false, 780, 508, -0.6)}
    ${at(1360, 724, coin('sun', { mood: 'smile', look: [-3, 0], size: 104, ground: true }))}
    ${at(250, 764, coin('foam', { mood: 'happy', size: 70, ground: true }))}
    ${at(110, 740, coin('teal', { mood: 'smile', look: [3, 0], size: 96, ground: true }))}`;
  return { w, h, html: page({ w, h, body, css, bg: C.plain }) };
}

export function postMint() {
  const w = 1600;
  const h = 900;
  const css = `
    .mintcard{position:absolute;left:790px;top:140px;width:740px;padding:26px;display:grid;grid-template-columns:290px 1fr;gap:28px;
      background:${C.cream};border:3px solid ${C.ink};border-radius:26px;box-shadow:8px 8px 0 #000507;transform:rotate(.8deg)}
    .emblem{position:relative;height:440px;background:${C.teal};border:3px solid ${C.ink};border-radius:20px;overflow:hidden;display:flex;align-items:center;justify-content:center}
    .emblem .no{position:absolute;left:12px;top:12px;font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:.08em;background:${C.cream};border:2.5px solid ${C.ink};border-radius:8px;padding:3px 8px}
    .emblem .rib{position:absolute;left:-3px;right:-3px;bottom:20px;text-align:center;background:${C.sun};border-top:3px solid ${C.ink};border-bottom:3px solid ${C.ink};
      font-family:var(--display);font-variation-settings:"SOFT" 100,"WONK" 1;font-weight:800;font-size:24px;padding:5px 0}
    .right{display:flex;flex-direction:column;gap:18px;padding-top:6px}
    .price{font-family:var(--display);font-variation-settings:"SOFT" 100,"opsz" 144;font-weight:800;font-size:76px;line-height:1;letter-spacing:-.02em}
    .row{display:flex;justify-content:space-between;align-items:center;font-size:16px;padding:10px 0;border-top:2px dashed ${C.sand2}}
    .note{display:flex;gap:12px;align-items:flex-start;background:${C.mist};border:2.5px solid ${C.ink};border-radius:14px;padding:12px 14px;font-size:15px;line-height:1.4}`;
  const rays = `<svg class="abs" style="inset:0" viewBox="0 0 290 440" width="290" height="440"><g fill="none" stroke="${C.tealS}" stroke-width="3">
      ${[60, 92, 124, 156, 188].map((r) => `<circle cx="145" cy="210" r="${r}"/>`).join('')}</g>
      <circle cx="145" cy="210" r="124" fill="none" stroke="${C.spray}" stroke-width="3" stroke-dasharray="2 12" stroke-linecap="round"/></svg>`;
  const check = `<svg width="26" height="26" viewBox="0 0 26 26" style="flex:none"><circle cx="13" cy="13" r="11" fill="${C.up}" stroke="${C.ink}" stroke-width="2.5"/><path d="M8 13.5l3.5 3.5 6.5-7" fill="none" stroke="${C.cream}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const body = `
    <div class="abs" style="left:0;top:70px">${starfield(1600, 90, 14, 11)}</div>
    <div class="abs" style="left:680px;top:150px">${starfield(110, 600, 6, 5)}</div>
    <div class="abs" style="left:0;top:770px">${seigaiha({ w: 1600, h: 130, r: 36, stroke: C.reef, width: 3, fill: C.trench })}</div>
    ${plate('II', 'The mint, after dark', '/mint', true)}
    <div class="abs" style="left:76px;top:150px;width:640px;color:${C.cream}">
      <div class="kick" style="color:${C.foam}">Elymum NFT &middot; sealed emblems</div>
      <div class="disp" style="font-size:96px;margin:18px 0 26px;color:${C.cream}">One emblem.<br>One <span class="wonk" style="color:${C.sun}">dollar.</span><br>Many snacks.</div>
      <div style="font-size:22px;line-height:1.5;color:#BFD8DD;max-width:540px">Your emblem is your ticket to the ring. The price is pinned to a dollar and paid in HYPE, so the number on the button wiggles with the market. We do the arithmetic; you do the eating.</div>
      <div style="margin-top:30px">${flowPills(true)}</div>
    </div>
    <div class="mintcard">
      <div class="emblem">${rays}<span class="no">NO. ####</span>
        <div style="position:relative;margin-top:-40px">${coin('sun', { mood: 'smug', feet: false, look: [2, 0], size: 190 })}</div>
        <div class="rib">Sealed. For now.</div></div>
      <div class="right">
        <div class="kick" style="color:${C.stone}">Mint price</div>
        <div style="display:flex;align-items:flex-end;gap:14px"><div class="price">$1.00</div><span class="tag sun" style="margin-bottom:8px">in HYPE</span></div>
        <div style="font-size:16px;color:${C.stone};line-height:1.4">Repriced to a dollar as HYPE moves. Gas is paid in HYPE on Elysium, too.</div>
        <div>
          <div class="row"><span>Allowlist</span><b class="mono">first</b></div>
          <div class="row"><span>Then</span><b class="mono">public</b></div>
          <div class="row"><span>Unlocks</span><b class="mono">the game</b></div>
        </div>
        <span class="btn sun" style="justify-content:center;font-size:21px;padding:15px">Mint an emblem</span>
        <div class="note">${check}<span><b>On the list?</b> Allowlist wallets mint first. Nobody's rushing you. Well, a little.</span></div>
      </div>
    </div>`;
  return { w, h, html: page({ w, h, body, css, bg: C.trench }) };
}

export function postGameLive() {
  const w = 1600;
  const h = 900;
  let x = 42;
  const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647;
  const cols = [C.sun, C.foam, C.up, C.blush, C.cream];
  let foods = '';
  for (let i = 0; i < 70; i++) foods += food(i % 3, 60 + rnd() * 1480, 140 + rnd() * 700, cols[i % cols.length]);
  const floor = `<svg class="abs" style="inset:0" viewBox="0 0 1600 900" width="1600" height="900">
      <rect width="1600" height="900" fill="${C.trench}"/>
      <g fill="none" stroke="${C.reef}" stroke-width="3">${[0, 1, 2, 3, 4, 5].map((i) => `<ellipse cx="800" cy="${1180 - i * 20}" rx="${420 + i * 190}" ry="${260 + i * 110}"/>`).join('')}</g>
      ${foods}</svg>`;
  const tag = (x0, y0, name, v, you = false) =>
    `<div class="abs" style="left:${x0}px;top:${y0}px;font-family:var(--mono);font-size:14px;font-weight:600;background:${you ? C.sun : C.cream};border:2.5px solid ${C.ink};border-radius:8px;padding:2px 9px;white-space:nowrap">${name} <span style="color:${you ? C.ink : C.upS}">${v}</span></div>`;
  const css = `
    .hud{position:absolute;padding:12px 16px}
    .head{position:absolute;left:64px;top:120px;width:620px;padding:30px 34px;transform:rotate(-1.4deg)}
    .lb{position:absolute;right:56px;top:116px;width:290px;padding:16px 18px}
    .lb .r{display:flex;align-items:center;gap:10px;font-size:15px;padding:5px 0;border-top:2px dashed ${C.sand2}}
    .lb .r:first-of-type{border-top:0}
    .lb .r b{margin-left:auto;font-family:var(--mono)}`;
  const dot = (c) => `<span style="width:14px;height:14px;border-radius:50%;background:${c};border:2px solid ${C.ink};flex:none"></span>`;
  const body = `
    ${floor}
    ${at(1050, 430, coin('sun', { mood: 'chomp', look: [-4, 1], size: 210, feet: false }))}
    ${tag(1080, 396, 'big_aurelius', '$9.80')}
    ${at(905, 540, coin('foam', { mood: 'scared', look: [3, -1], sweat: true, size: 66, feet: false }))}
    ${at(560, 560, `<div style="border:3px dashed ${C.sun};border-radius:50%;padding:12px">${coin('cyan', { mood: 'happy', size: 96, feet: false })}</div>`)}
    ${tag(600, 524, 'you', '$4.37', true)}
    ${at(260, 600, coin('teal', { mood: 'smile', look: [3, 0], size: 124, feet: false }))}
    ${tag(268, 566, 'lethe.hl', '$6.12')}
    ${at(1340, 700, coin('up', { mood: 'open', look: [-3, 0], size: 82, feet: false }))}
    ${tag(1320, 668, 'penny_pincher', '$3.05')}
    ${at(820, 760, coin('cream', { mood: 'sleepy', size: 58, feet: false }))}
    ${tag(800, 728, 'gm_crumbs', '$2.41')}
    ${plate('III', 'The ring is open', '/play', true)}
    <div class="sticker head">
      <div class="kick" style="color:${C.teal}">Feeding time &middot; on Elysium</div>
      <div class="disp" style="font-size:66px;margin:12px 0 14px">The floor of the ring is <span class="wonk" style="color:${C.teal}">open.</span></div>
      <div style="font-size:19px;line-height:1.45;color:#3E3A31">Five-minute rounds. Eat the food, eat smaller coins, run from bigger ones. At the bell, whatever you swallowed is paid out. Emblem holders first.</div>
      <div style="display:flex;align-items:center;gap:16px;margin-top:22px"><span class="btn sun">Play a round ${arrow}</span><span class="mono" style="font-size:17px;font-weight:600">${HANDLE}</span></div>
    </div>
    <div class="sticker hud" style="left:760px;top:120px;display:flex;align-items:center;gap:14px;transform:rotate(1.5deg)">
      <svg width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="${C.mist}" stroke="${C.ink}" stroke-width="3"/><path d="M20 20 V9 A11 11 0 0 1 30 16 Z" fill="${C.teal}"/><circle cx="20" cy="20" r="3" fill="${C.ink}"/></svg>
      <div><div class="num" style="font-size:34px;font-weight:600;line-height:1">05:00</div><div class="kick" style="font-size:11px;color:${C.stone}">until the bell</div></div>
    </div>
    <div class="sticker lb">
      <div class="disp" style="font-size:22px;margin-bottom:8px">Top of the food chain</div>
      <div class="r">${dot(C.sun)}big_aurelius<b>$9.80</b></div>
      <div class="r">${dot(C.teal)}lethe.hl<b>$6.12</b></div>
      <div class="r" style="background:${C.sun};margin:0 -8px;padding:5px 8px;border-radius:8px">${dot(C.cyan)}you<b>$4.37</b></div>
      <div class="r">${dot(C.up)}penny_pincher<b>$3.05</b></div>
    </div>
    <div class="abs" style="left:64px;top:836px;display:flex;align-items:center;gap:10px;font-family:var(--mono);font-size:14px;color:${C.foam}">
      ${[['mouse', 'steer'], ['space', 'split'], ['W', 'spit']].map(([k, v]) => `<span style="background:${C.cream};color:${C.ink};border:2.5px solid ${C.ink};border-radius:7px;padding:2px 9px;box-shadow:2px 2px 0 #000507;font-weight:600">${k}</span><span style="margin-right:10px">${v}</span>`).join('')}
    </div>`;
  return { w, h, html: page({ w, h, body, css, bg: C.trench }) };
}

/* ------------------------------------------------------------------ stickers */

export const STICKER_CAST = [
  { name: 'hunter', paint: 'sun', mood: 'chomp', look: [4, 1], label: 'The hunter' },
  { name: 'snack', paint: 'foam', mood: 'scared', look: [-3, -1], sweat: true, label: 'The snack' },
  { name: 'smug', paint: 'sun', mood: 'smug', look: [2, 0], label: 'Sealed. For now.' },
  { name: 'happy', paint: 'up', mood: 'happy', label: 'Paid at the bell' },
  { name: 'smile', paint: 'teal', mood: 'smile', look: [3, 1], label: 'Small change' },
  { name: 'open', paint: 'cyan', mood: 'open', look: [-2, 0], label: 'Lunch?' },
  { name: 'sleepy', paint: 'cream', mood: 'sleepy', label: 'Between rounds' },
];

export function sticker(c) {
  const size = 480;
  const body = `<div style="padding:10px">${coin(c.paint, { mood: c.mood, look: c.look, sweat: c.sweat, size, feet: false, diecut: 9 })}</div>`;
  return { w: size + 20, h: size + 20, html: page({ w: size + 20, h: size + 20, body }) };
}

export function stickerSheet() {
  const w = 1800;
  const h = 1200;
  const tilts = [-3, 2, -1.5, 3, 1.5, -2.5, 2];
  const cell = (x0, y0, inner, label, tilt) => `<div class="abs" style="left:${x0}px;top:${y0}px;width:340px;display:flex;flex-direction:column;align-items:center;gap:18px;transform:rotate(${tilt}deg)">
      ${inner}${label ? `<div class="tag" style="font-size:13px">${label}</div>` : ''}</div>`;
  const cells = STICKER_CAST.map((c, i) =>
    cell(70 + (i % 4) * 420, 150 + Math.floor(i / 4) * 450, coin(c.paint, { mood: c.mood, look: c.look, sweat: c.sweat, size: 300, feet: false, diecut: 9 }), c.label, tilts[i]),
  ).join('');
  const mark = cell(70 + 3 * 420, 600, `<div style="padding:20px">${coinMark(260)}</div>`, 'The mark', -2);
  const body = `
    <svg class="abs" style="inset:0" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${C.mist}"/>
      <g stroke="${C.foam}" stroke-width="2" stroke-dasharray="2 10" stroke-linecap="round">${Array.from({ length: 11 }, (_, i) => `<path d="M0 ${110 + i * 100} H${w}"/>`).join('')}</g></svg>
    <div class="abs" style="left:90px;top:48px;display:flex;align-items:baseline;gap:22px">
      <div class="disp" style="font-size:56px">The cast of coins</div>
      <div class="kick" style="color:${C.teal}">Elymum sticker sheet</div></div>
    ${cells}${mark}
    <div class="abs" style="left:96px;top:1086px" ><span class="mono" style="font-size:18px;font-weight:600">${HANDLE}</span></div>
    <div class="abs" style="right:90px;top:1050px;transform:rotate(-1.5deg)">${wordmark({ width: 420, diecut: true })}</div>`;
  return { w, h, html: page({ w, h, body, bg: C.mist }) };
}

export { cloud };

/* ------------------------------------------------------------------ arena posters (286 x 400, rendered @2x) */

export const ARENAS = [
  { id: 1, slug: 'asphodel-meadow', name: 'Asphodel Meadow', entry: '1,000', ink: C.spray, line: 'Where everybody starts. The flowers are judging you.', coin: ['foam', 'happy'] },
  { id: 2, slug: 'lethe-shore', name: 'Lethe Shore', entry: '10,000', ink: C.foam, ink2: C.teal, line: 'Forget your last round. The water insists.', coin: ['teal', 'smile'] },
  { id: 3, slug: 'golden-bough', name: 'Golden Bough', entry: '50,000', ink: C.sun, line: 'One branch, one rule: bigger coin, bigger lunch.', coin: ['sun', 'smug'] },
  { id: 4, slug: 'isles-of-the-blessed', name: 'Isles of the Blessed', entry: '250,000', ink: C.up, line: 'The heroes eat here. So, presumably, do you.', coin: ['up', 'chomp'] },
];

function posterArt(a) {
  const ink = C.ink;
  const W = 250;
  const H = 210;
  const sky = a.id === 4 ? C.trench : a.id === 2 ? C.teal : a.id === 3 ? C.reef : C.teal;
  let land = '';
  if (a.id === 1) {
    land = `<path d="M-10 120 Q125 170 260 120 V230 H-10Z" fill="${C.meadow}" stroke="${ink}" stroke-width="3"/>
      <path d="M-10 150 Q125 200 260 150 V230 H-10Z" fill="${C.verdant}" stroke="${ink}" stroke-width="3"/>
      ${[30, 70, 180, 220, 120].map((x, i) => `<g transform="translate(${x} ${150 + (i % 2) * 18})"><path d="M0 0 V-12" stroke="${ink}" stroke-width="2.5"/><circle cy="-16" r="6" fill="${i % 2 ? C.cream : C.blush}" stroke="${ink}" stroke-width="2.2"/><circle cy="-16" r="2" fill="${C.sun}"/></g>`).join('')}`;
  } else if (a.id === 2) {
    land = `<path d="M-10 132 H260 V230 H-10Z" fill="${C.tealS}" stroke="${ink}" stroke-width="3"/>
      <g fill="none" stroke="${C.foam}" stroke-width="3" stroke-linecap="round">${[146, 166, 186].map((y, i) => `<path d="M${10 + i * 18} ${y} q15 -8 30 0 t30 0 M${140 - i * 12} ${y + 6} q15 -8 30 0 t30 0"/>`).join('')}</g>
      <path d="M-10 170 Q60 150 120 176 T260 168 V230 H-10Z" fill="${C.sand}" stroke="${ink}" stroke-width="3"/>`;
  } else if (a.id === 3) {
    land = `<path d="M-10 160 Q125 140 260 160 V230 H-10Z" fill="${C.forest}" stroke="${ink}" stroke-width="3"/>
      <path d="M125 160 V90" stroke="${ink}" stroke-width="11" stroke-linecap="round"/><path d="M125 160 V90" stroke="${C.coral}" stroke-width="5" stroke-linecap="round"/>
      <path d="M125 112 Q150 96 170 76" stroke="${ink}" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M125 112 Q150 96 170 76" stroke="${C.sun}" stroke-width="4" fill="none" stroke-linecap="round"/>
      <circle cx="105" cy="70" r="34" fill="${C.pine}" stroke="${ink}" stroke-width="3"/>
      ${[[164, 70], [176, 82], [152, 86], [170, 60]].map(([x, y]) => `<path d="M${x} ${y} q8 -6 12 2 q-6 8 -12 -2z" fill="${C.sun}" stroke="${ink}" stroke-width="2"/>`).join('')}`;
  } else {
    land = `<path d="M-10 150 H260 V230 H-10Z" fill="${C.tealS}" stroke="${ink}" stroke-width="3"/>
      <path d="M40 152 Q70 112 110 124 Q140 104 170 128 Q200 124 214 152Z" fill="${C.up}" stroke="${ink}" stroke-width="3"/>
      ${props.tree(90, 128, 0.8)}${props.house(140, 126, 0.8)}${props.pine(176, 136, 0.7)}
      <g fill="none" stroke="${C.foam}" stroke-width="3" stroke-linecap="round"><path d="M20 176 q15 -8 30 0 t30 0"/><path d="M150 190 q15 -8 30 0 t30 0"/></g>`;
  }
  const stars = a.id === 4 || a.id === 3 ? `${star(30, 30, 1)}${star(210, 50, 0.8)}<circle cx="60" cy="70" r="1.8" fill="${C.cream}"/><circle cx="180" cy="24" r="2" fill="${C.cream}"/>` : '';
  const sun = a.id === 1 || a.id === 2 ? `<circle cx="196" cy="56" r="20" fill="${C.sun}" stroke="${ink}" stroke-width="3"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:block">
    <defs><clipPath id="pa${a.id}"><rect width="${W}" height="${H}" rx="14"/></clipPath></defs>
    <g clip-path="url(#pa${a.id})"><rect width="${W}" height="${H}" fill="${sky}"/>${stars}${sun}
      <path d="M-30 110 C 40 -10, 210 -10, 280 110" fill="none" stroke="${ink}" stroke-width="14"/>
      <path d="M-30 110 C 40 -10, 210 -10, 280 110" fill="none" stroke="${C.current}" stroke-width="10"/>
      <path d="M-30 110 C 40 -10, 210 -10, 280 110" fill="none" stroke="${C.sun}" stroke-width="2.5" stroke-dasharray="2 9" transform="translate(0,-2)"/>
      ${land}</g>
    <rect width="${W}" height="${H}" rx="14" fill="none" stroke="${ink}" stroke-width="3"/>
  </svg>`;
}

export function arenaPoster(a) {
  const w = 286;
  const h = 400;
  const body = `
    <div class="abs" style="inset:0;background:${C.cream};border:3px solid ${C.ink};border-radius:18px;overflow:hidden">
      <div class="abs" style="left:0;right:0;top:0;height:12px;background:${a.ink2 ? `linear-gradient(90deg,${a.ink},${a.ink2})` : a.ink};border-bottom:3px solid ${C.ink}"></div>
      <div class="abs" style="left:15px;top:24px;right:15px;display:flex;justify-content:space-between;align-items:center">
        <span class="kick" style="font-size:11px;color:${C.stone}">Arena ${a.id} &middot; Elysium</span>
        <span class="kick" style="font-size:11px;color:${C.stone}">05:00</span></div>
      <div class="abs" style="left:15px;top:46px">${posterArt(a)}</div>
      <div class="abs" style="left:15px;right:15px;top:266px">
        <div class="disp" style="font-size:${a.name.length > 16 ? 25 : 29}px">${a.name}</div>
        <div style="font-size:12.5px;line-height:1.35;color:#3E3A31;margin-top:6px">${a.line}</div></div>
      <div class="abs" style="left:15px;right:15px;bottom:14px;display:flex;justify-content:space-between;align-items:center;border-top:2px dashed ${C.sand2};padding-top:9px">
        <span class="kick" style="font-size:10.5px;color:${C.stone}">Ticket</span>
        <span class="num" style="font-size:15px;font-weight:600">${a.entry} <span style="color:${C.teal}">$ELYMUM</span></span></div>
    </div>
    <div class="abs" style="right:6px;top:178px;transform:rotate(6deg)">${coin(a.coin[0], { mood: a.coin[1], look: [-3, 1], size: 76, feet: false, diecut: 7 })}</div>`;
  return { w, h, html: page({ w, h, body }) };
}
