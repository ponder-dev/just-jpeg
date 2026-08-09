// Generates build/icon.svg.
//
// Two things macOS cares about that a plain rounded rectangle gets wrong:
//
//   1. Size. An app icon is drawn at about 824x824 inside a 1024x1024
//      canvas. Filling the whole canvas makes the icon look oversized next to
//      every other app in the Dock.
//   2. Shape. The corners are a superellipse ("squircle"), not a circular
//      arc. A rounded rect reads as subtly wrong beside real Mac icons.
//
// The third constraint is legibility: this has to survive being drawn at
// 16 pixels, so the artwork is deliberately chunky and low on detail.
//
//   node scripts/make-icon.mjs && npx electron scripts/icons.cjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CANVAS = 1024;
const ART = 824;                 // Apple's drawing size within the canvas
const INSET = (CANVAS - ART) / 2;
const N = 5;                     // superellipse exponent; ~5 matches macOS

/** Superellipse |x/a|^n + |y/b|^n = 1, sampled densely enough to look smooth. */
function squirclePath(cx, cy, radius, exponent, steps = 720) {
  const points = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const x = cx + radius * Math.sign(cos) * Math.abs(cos) ** (2 / exponent);
    const y = cy + radius * Math.sign(sin) * Math.abs(sin) ** (2 / exponent);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

const outline = squirclePath(CANVAS / 2, CANVAS / 2, ART / 2, N);

// Artwork sits in the middle of the squircle, well inside the corners.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="#6d8bff"/>
      <stop offset="1" stop-color="#8a5cf6"/>
    </linearGradient>
    <clipPath id="card">
      <rect x="266" y="330" width="492" height="364" rx="44"/>
    </clipPath>
  </defs>

  <path d="${outline}" fill="url(#bg)"/>

  <!-- One photo, drawn big. At 16 pixels this is the whole icon, so the
       shapes have to be few and fat. -->
  <g clip-path="url(#card)">
    <rect x="266" y="330" width="492" height="364" fill="#ffffff"/>
    <circle cx="382" cy="438" r="52" fill="#ffb43f"/>
    <!-- Hills: one silhouette, no thin gaps to close up when scaled down. -->
    <path d="M266 694 L438 512 L566 640 L648 556 L758 666 L758 694 Z" fill="#5570e8"/>
  </g>
  <rect x="266" y="330" width="492" height="364" rx="44"
        fill="none" stroke="#ffffff" stroke-width="34"/>
</svg>
`;

await fs.writeFile(path.join(root, 'build/icon.svg'), svg);
console.log(`build/icon.svg written: ${ART}x${ART} artwork inside a ${CANVAS}x${CANVAS} canvas`);
