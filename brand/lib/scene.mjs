// The ring habitat at dawn: the hero plate of docs/design/storybook-reference.html (the "Ring Storybook"
// reference), copied as one 1440x880 SVG drawing. Clouds sit at fixed spots (no drift: these are stills).
// Ids are prefixed with rs- so the scene can share a page with other drawings.

/** Inner markup of the scene, for `<svg viewBox="0 0 1440 880">`. */
export const RING_SCENE_INNER = `
    <defs>
      <linearGradient id="rs-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0F2A30"/>
        <stop offset=".34" stop-color="#2D7388"/>
        <stop offset=".62" stop-color="#6FCDE8"/>
        <stop offset=".8" stop-color="#DBF2F9"/>
      </linearGradient>
      <g id="rs-cloud">
        <g stroke="#04181C" stroke-width="6" fill="#04181C">
          <circle cx="40" cy="40" r="28"/><circle cx="80" cy="26" r="36"/><circle cx="124" cy="38" r="30"/><circle cx="154" cy="52" r="20"/><rect x="18" y="44" width="150" height="26" rx="13"/>
        </g>
        <g fill="#FFFFFF">
          <circle cx="40" cy="40" r="28"/><circle cx="80" cy="26" r="36"/><circle cx="124" cy="38" r="30"/><circle cx="154" cy="52" r="20"/><rect x="18" y="44" width="150" height="26" rx="13"/>
        </g>
        <path d="M18 58 H168 V57 a13 13 0 0 1 -13 13 H31 a13 13 0 0 1 -13 -13z" fill="#DBF2F9"/>
        <path d="M58 22 q10 -14 26 -10" stroke="#04181C" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".35"/>
      </g>
      <g id="rs-house">
        <path d="M-12 0 V-16 L0 -27 L12 -16 V0 Z" fill="#F6EEDA" stroke="#04181C" stroke-width="2.5" stroke-linejoin="round"/>
        <path d="M-15 -14 L0 -29 L15 -14" fill="none" stroke="#04181C" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="M-15 -14 L0 -29 L15 -14 L12 -16 L0 -27 L-12 -16Z" fill="#D9714F"/>
        <rect x="-4" y="-11" width="8" height="8" rx="1.5" fill="#F2C14E" stroke="#04181C" stroke-width="2"/>
      </g>
      <g id="rs-tree">
        <path d="M0 0 V-14" stroke="#04181C" stroke-width="3" stroke-linecap="round"/>
        <circle cx="0" cy="-24" r="12" fill="#3E8A5C" stroke="#04181C" stroke-width="2.5"/>
        <path d="M-5 -30 a8 8 0 0 1 8 -3" stroke="#8CC47A" stroke-width="3" fill="none" stroke-linecap="round"/>
      </g>
      <g id="rs-pine">
        <path d="M0 0 V-8" stroke="#04181C" stroke-width="3" stroke-linecap="round"/>
        <path d="M0 -40 L11 -8 H-11 Z" fill="#2F6E4F" stroke="#04181C" stroke-width="2.5" stroke-linejoin="round"/>
      </g>
      <g id="rs-star"><path d="M0 -7 Q1 -1 7 0 Q1 1 0 7 Q-1 1 -7 0 Q-1 -1 0 -7Z" fill="#F6EEDA"/></g>
      <clipPath id="rs-planetClip"><circle cx="1010" cy="600" r="250"/></clipPath>
      <filter id="rs-wob" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="4"/></filter>
    </defs>

    <rect width="1440" height="880" fill="url(#rs-sky)"/>
    <!-- stars in the night band -->
    <g opacity=".9">
      <use href="#rs-star" x="700" y="60"/><use href="#rs-star" x="910" y="120" transform="scale(1)"/><use href="#rs-star" x="1180" y="48"/>
      <use href="#rs-star" x="640" y="170"/><use href="#rs-star" x="1330" y="160"/><use href="#rs-star" x="820" y="200"/>
      <circle cx="760" cy="110" r="2.2" fill="#F6EEDA"/><circle cx="1040" cy="70" r="2" fill="#F6EEDA"/><circle cx="1260" cy="110" r="2.4" fill="#F6EEDA"/><circle cx="980" cy="190" r="1.8" fill="#F6EEDA"/><circle cx="1400" cy="80" r="2" fill="#F6EEDA"/>
    </g>

    <!-- the far side of the ring arching overhead -->
    <g>
      <path d="M-60 520 C 180 40, 1260 40, 1500 520" fill="none" stroke="#04181C" stroke-width="58" stroke-linecap="round"/>
      <path d="M-60 520 C 180 40, 1260 40, 1500 520" fill="none" stroke="#1E4D5A" stroke-width="50"/>
      <path d="M-60 520 C 180 40, 1260 40, 1500 520" fill="none" stroke="#163B44" stroke-width="18" transform="translate(0,16)"/>
      <path d="M-60 520 C 180 40, 1260 40, 1500 520" fill="none" stroke="#F2C14E" stroke-width="6" stroke-dasharray="3 22" transform="translate(0,-6)"/>
      <path d="M-60 520 C 180 40, 1260 40, 1500 520" fill="none" stroke="#04181C" stroke-width="3" transform="translate(0,28)"/>
      <!-- spokes -->
      <g stroke="#04181C" stroke-width="3" fill="#163B44">
        <path d="M352 210 L376 210 L396 520 L338 520 Z"/>
        <path d="M1064 210 L1088 210 L1102 520 L1046 520 Z"/>
      </g>
      <g fill="#1E4D5A"><rect x="356" y="212" width="6" height="300"/><rect x="1068" y="212" width="6" height="300"/></g>
    </g>

    <!-- planet seen through the sky band -->
    <g>
      <circle cx="1010" cy="600" r="262" fill="none" stroke="#6FCDE8" stroke-width="4" opacity=".5"/>
      <circle cx="1010" cy="600" r="250" fill="#1F5566"/>
      <g clip-path="url(#rs-planetClip)">
        <circle cx="976" cy="566" r="250" fill="#2D7388"/>
        <path d="M850 440 q30 -26 70 -14 q22 10 46 0 q26 -8 30 14 q4 18 -28 22 q-36 4 -58 18 q-30 14 -56 0 q-26 -16 -4 -40z" fill="#3C9A87" stroke="#04181C" stroke-width="3"/>
        <path d="M1090 410 q50 -12 90 18 q26 26 -6 40 q-40 16 -66 -6 q-30 -28 -18 -52z" fill="#3C9A87" stroke="#04181C" stroke-width="3"/>
        <g stroke="#DBF2F9" stroke-width="6" fill="none" stroke-linecap="round"><path d="M790 400 q60 -24 120 -12"/><path d="M960 470 q50 -12 100 0 q20 6 10 16"/><path d="M1000 380 q40 -10 70 4"/><path d="M1150 470 q30 -6 50 6"/></g>
        <path d="M1260 600 A250 250 0 0 0 1060 354 A250 250 0 0 1 1260 600Z" fill="#1F5566"/>

        <path d="M1260 600 A250 250 0 0 1 1010 850 L1260 850Z" fill="#04181C" opacity=".0"/>
      </g>
      <circle cx="1010" cy="600" r="250" fill="none" stroke="#04181C" stroke-width="3"/>
      <!-- little moon -->
      <circle cx="1238" cy="288" r="20" fill="#DCCDA8"/>
      <clipPath id="rs-moonClip"><circle cx="1238" cy="288" r="20"/></clipPath>
      <circle cx="1232" cy="282" r="20" fill="#F6EEDA" clip-path="url(#rs-moonClip)"/>
      <circle cx="1233" cy="282" r="3.5" fill="#DCCDA8"/><circle cx="1243" cy="292" r="2.5" fill="#DCCDA8"/>
      <circle cx="1238" cy="288" r="20" fill="none" stroke="#04181C" stroke-width="3"/>
    </g>

    <!-- clouds -->
    <use href="#rs-cloud" x="250" y="250"/>
    <use href="#rs-cloud" x="1240" y="330"/>
    <use href="#rs-cloud" x="760" y="150"/>

    <!-- terraces: the ground curving up both sides -->
    <g filter="url(#rs-wob)">
<path d="M-40 300 Q 720 760 1480 300 V 900 H -40 Z" fill="#B9D98F" stroke="#04181C" stroke-width="3"/>
<path d="M-40 316 Q 720 776 1480 316" fill="none" stroke="#9CC77A" stroke-width="10"/>
<path d="M-40 334 Q 720 794 1480 334" fill="none" stroke="#9CC77A" stroke-width="3" stroke-linecap="round" stroke-dasharray="140 70 50 120 90 60" stroke-dashoffset="0"/>
<path d="M-40 346 Q 720 806 1480 346" fill="none" stroke="#9CC77A" stroke-width="3" stroke-linecap="round" stroke-dasharray="140 70 50 120 90 60" stroke-dashoffset="6"/>
<path d="M-40 358 Q 720 818 1480 358" fill="none" stroke="#9CC77A" stroke-width="3" stroke-linecap="round" stroke-dasharray="140 70 50 120 90 60" stroke-dashoffset="12"/>
<path d="M-40 372 Q 720 840 1480 372 V 900 H -40 Z" fill="#8CC47A" stroke="#04181C" stroke-width="3"/>
<path d="M-40 388 Q 720 856 1480 388" fill="none" stroke="#74B064" stroke-width="12"/>
<path d="M-40 406 Q 720 874 1480 406" fill="none" stroke="#74B064" stroke-width="3" stroke-linecap="round" stroke-dasharray="60 40 120 90 30 160" stroke-dashoffset="37"/>
<path d="M-40 418 Q 720 886 1480 418" fill="none" stroke="#74B064" stroke-width="3" stroke-linecap="round" stroke-dasharray="60 40 120 90 30 160" stroke-dashoffset="43"/>
<path d="M-40 430 Q 720 898 1480 430" fill="none" stroke="#74B064" stroke-width="3" stroke-linecap="round" stroke-dasharray="60 40 120 90 30 160" stroke-dashoffset="49"/>
<path d="M590 600 Q 720 625 860 598" fill="none" stroke="#04181C" stroke-width="13" stroke-linecap="round"/>
    <path d="M590 600 Q 720 625 860 598" fill="none" stroke="#6FCDE8" stroke-width="7" stroke-linecap="round"/>
    <path d="M640 604 h18 M760 612 h14" stroke="#DBF2F9" stroke-width="2.5" stroke-linecap="round"/>
<path d="M-40 452 Q 720 930 1480 452 V 900 H -40 Z" fill="#5FA36A" stroke="#04181C" stroke-width="3"/>
<path d="M-40 468 Q 720 946 1480 468" fill="none" stroke="#4C8F58" stroke-width="14"/>
<path d="M-40 486 Q 720 964 1480 486" fill="none" stroke="#4C8F58" stroke-width="3" stroke-linecap="round" stroke-dasharray="140 70 50 120 90 60" stroke-dashoffset="74"/>
<path d="M-40 498 Q 720 976 1480 498" fill="none" stroke="#4C8F58" stroke-width="3" stroke-linecap="round" stroke-dasharray="140 70 50 120 90 60" stroke-dashoffset="80"/>
<path d="M-40 510 Q 720 988 1480 510" fill="none" stroke="#4C8F58" stroke-width="3" stroke-linecap="round" stroke-dasharray="140 70 50 120 90 60" stroke-dashoffset="86"/>
<path d="M-40 548 Q 720 1030 1480 548 V 900 H -40 Z" fill="#3E8A5C" stroke="#04181C" stroke-width="3"/>
<path d="M-40 564 Q 720 1046 1480 564" fill="none" stroke="#2F7049" stroke-width="16"/>
<path d="M-40 582 Q 720 1064 1480 582" fill="none" stroke="#2F7049" stroke-width="3" stroke-linecap="round" stroke-dasharray="60 40 120 90 30 160" stroke-dashoffset="111"/>
<path d="M-40 594 Q 720 1076 1480 594" fill="none" stroke="#2F7049" stroke-width="3" stroke-linecap="round" stroke-dasharray="60 40 120 90 30 160" stroke-dashoffset="117"/>
<path d="M-40 606 Q 720 1088 1480 606" fill="none" stroke="#2F7049" stroke-width="3" stroke-linecap="round" stroke-dasharray="60 40 120 90 30 160" stroke-dashoffset="123"/>
<path d="M-40 680 Q 720 1010 1480 680 V 900 H -40 Z" fill="#EBE6DD" stroke="#04181C" stroke-width="3"/>
    <path d="M-40 700 Q 720 1030 1480 700" fill="none" stroke="#DDD6C7" stroke-width="10"/>
    </g>
    <g fill="#DDD6C7" stroke="#04181C" stroke-width="2">
      <ellipse cx="160" cy="808" rx="10" ry="5"/><ellipse cx="420" cy="852" rx="7" ry="4"/><ellipse cx="1180" cy="826" rx="9" ry="4.5"/><ellipse cx="1320" cy="790" rx="6" ry="3"/><ellipse cx="640" cy="872" rx="8" ry="4"/>
    </g>
    <g fill="#2F6E4F" stroke="#04181C" stroke-width="2.5">
      <path d="M150 482 a9 9 0 0 1 16 -6 a9 9 0 0 1 16 4 a7 7 0 0 1 -2 10 h-28 a6 6 0 0 1 -2 -8z"/>
      <path d="M560 668 a9 9 0 0 1 16 -6 a9 9 0 0 1 16 4 a7 7 0 0 1 -2 10 h-28 a6 6 0 0 1 -2 -8z"/>
      <path d="M1250 560 a9 9 0 0 1 16 -6 a9 9 0 0 1 16 4 a7 7 0 0 1 -2 10 h-28 a6 6 0 0 1 -2 -8z"/>
      <path d="M860 728 a9 9 0 0 1 16 -6 a9 9 0 0 1 16 4 a7 7 0 0 1 -2 10 h-28 a6 6 0 0 1 -2 -8z"/>
    </g>
    <!-- a tiny zig-zag path climbing the terraces -->
    <path d="M1100 700 L1130 640 L1100 600 L1135 560 L1110 520" fill="none" stroke="#F6EEDA" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 9" filter="url(#rs-wob)"/>

    <!-- houses and trees placed on the terrace tops (approx points on curves) -->
    <g>
      <!-- t0 -->
      <use href="#rs-house" x="560" y="503" transform="scale(1)"/><use href="#rs-tree" x="600" y="510"/><use href="#rs-tree" x="880" y="508"/><use href="#rs-house" x="840" y="504"/>
      <use href="#rs-pine" x="300" y="420"/><use href="#rs-pine" x="318" y="428"/><use href="#rs-tree" x="1160" y="436"/>
      <!-- t1 -->
      <use href="#rs-tree" x="140" y="460"/><use href="#rs-house" x="190" y="482"/><use href="#rs-tree" x="236" y="498"/>
      <use href="#rs-house" x="1236" y="490"/><use href="#rs-tree" x="1290" y="466"/><use href="#rs-pine" x="1196" y="506"/>
      <!-- t2 -->
      <use href="#rs-pine" x="70" y="500"/><use href="#rs-pine" x="96" y="512"/><use href="#rs-tree" x="440" y="634"/><use href="#rs-house" x="1010" y="638"/><use href="#rs-tree" x="1052" y="632"/><use href="#rs-pine" x="1380" y="498"/>
      <!-- t3 -->
      <use href="#rs-tree" x="300" y="704"/><use href="#rs-tree" x="326" y="712"/><use href="#rs-pine" x="352" y="722"/>
      <use href="#rs-tree" x="470" y="640"/><use href="#rs-pine" x="496" y="648"/><use href="#rs-tree" x="930" y="650"/><use href="#rs-tree" x="960" y="646"/>
      <use href="#rs-pine" x="680" y="520"/><use href="#rs-tree" x="700" y="524"/><use href="#rs-house" x="740" y="528"/><use href="#rs-house" x="770" y="528"/>
      <use href="#rs-tree" x="400" y="560"/><use href="#rs-house" x="370" y="552"/><use href="#rs-tree" x="1090" y="556"/><use href="#rs-pine" x="1120" y="548"/><use href="#rs-tree" x="1180" y="684"/><use href="#rs-house" x="1230" y="664"/><use href="#rs-tree" x="40" y="590"/>
    </g>

`;

/**
 * The scene as an <svg>. `preserveAspectRatio` decides the crop: the default keeps the bottom
 * (terraces and shore) and centres horizontally, like the landing hero.
 */
export function ringScene({ par = 'xMidYMax slice', style = '' } = {}) {
  return `<svg class="ring-scene" viewBox="0 0 1440 880" preserveAspectRatio="${par}" style="${style}" aria-hidden="true">${RING_SCENE_INNER}</svg>`;
}
