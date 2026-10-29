/**
 * The hand-inked wobble, defined ONCE per document: an SVG with the
 * displacement filters that make straight vector edges read as drawn by hand.
 *
 *   #kb-wobble        illustrations (terraces, clouds): 4 px of drift
 *   #kb-wobble-soft   small art and decorative UI edges: 2 px
 *
 * CSS uses them with `filter: url(#kb-wobble)` (`.kb-wobble`, `.kb-wobble-soft`);
 * SVG art uses `filter="url(#kb-wobble)"`. `<Kb>` calls `ensureInkDefs()` on
 * mount; call it yourself when you draw outside a Kb root.
 * Never put the filter on text you need to read sharply.
 */
const ID = 'kb-ink-defs';

export const WOBBLE = 'kb-wobble';
export const WOBBLE_SOFT = 'kb-wobble-soft';

const MARKUP = `
<filter id="${WOBBLE}" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="${WOBBLE_SOFT}" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G"/>
</filter>`;

export function ensureInkDefs(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (!doc?.body || doc.getElementById(ID)) return;
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', ID);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none');
  svg.innerHTML = `<defs>${MARKUP}</defs>`;
  doc.body.appendChild(svg);
}
