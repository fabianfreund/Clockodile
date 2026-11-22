// Generates the app icon and the menu-bar icons (no dependencies):
//   build/icon.png                 1024×1024, electron-builder turns it into .icns / .ico / Linux icons
//   src/assets/icon-128.png        shown in Settings → About
//   src/assets/trayTemplate*.png   macOS menu bar (template image, black + alpha)
//   src/assets/tray.png            Windows / Linux tray
// Design: a crocodile peeking out of the water, with a clock face for a head. Green tile, white
// clock at 10:10, two eyes on top.
// Run: npm run icon
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from './png.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const cov = (d) => clamp(0.5 - d, 0, 1); // signed distance → antialiased coverage

function sdRoundRect(x, y, cx, cy, half, r) {
  const qx = Math.abs(x - cx) - (half - r), qy = Math.abs(y - cy) - (half - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdSegment(x, y, ax, ay, bx, by, r) {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay;
  const t = clamp((px * dx + py * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - dx * t, py - dy * t) - r;
}

/**
 * The mark in a unit space (0..1). Returns { white, pupil } coverages for a point, given the pixel
 * size `px` (in unit space) for antialiasing.
 */
function mark(u, v, px, { bold = 1 } = {}) {
  const s = (d) => cov(d / px);
  const cx = 0.5, cy = 0.56, R = 0.25, stroke = 0.045 * bold;
  const d = Math.hypot(u - cx, v - cy);
  const ring = s(Math.abs(d - R) - stroke / 2);
  const face = s(d - R);
  // Hands at 10:10, from the centre.
  const hand = (ang, len, w) => s(sdSegment(u, v, cx, cy, cx + Math.cos(ang) * len, cy + Math.sin(ang) * len, w));
  const hands = Math.max(hand(-Math.PI / 2 + (10 / 60) * 2 * Math.PI, R * 0.62, 0.026 * bold), hand(-Math.PI / 2 - (2 / 12) * 2 * Math.PI, R * 0.45, 0.03 * bold));
  const hub = s(d - 0.035 * bold);
  // Eyes peeking over the top of the head: low domes with slit pupils (crocodile, not frog).
  let eye = 0, pupil = 0;
  for (const ex of [cx - 0.12, cx + 0.12]) {
    const ey = cy - R + 0.035;
    eye = Math.max(eye, s(Math.hypot((u - ex) / 1.12, v - ey) * 1.0 - 0.068));
    const a = 0.015 * bold, b = 0.045;
    pupil = Math.max(pupil, s((Math.hypot((u - ex) / a, (v - ey + 0.006) / b) - 1) * a));
  }
  // Hour ticks at 12, 3, 6, 9.
  let ticks = 0;
  for (let k = 0; k < 4; k++) {
    const ang = (k * Math.PI) / 2;
    const r0 = R * 0.78, r1 = R * 0.9;
    ticks = Math.max(ticks, s(sdSegment(u, v, cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0, cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1, 0.012 * bold)));
  }
  return { ring, face, hands: Math.max(hands, hub), eye, pupil, ticks };
}

const MARK_SCALE = 1.22;

function appIcon(S) {
  const INSET = S * 0.098, TILE = S - INSET * 2, RAD = TILE * 0.225;
  const top = [0x5e, 0xe0, 0x96], mid = [0x1f, 0xae, 0x6b], bot = [0x0d, 0x6e, 0x48];
  const px = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const tile = cov(sdRoundRect(x + 0.5, y + 0.5, S / 2, S / 2, TILE / 2, RAD));
      if (!tile) continue;
      const t = clamp((y - INSET) / TILE * 0.8 + (x - INSET) / TILE * 0.2, 0, 1);
      let c = t < 0.5 ? mix(top, mid, t * 2) : mix(mid, bot, (t - 0.5) * 2);
      const hl = clamp(1 - Math.hypot(x - S * 0.3, y - S * 0.22) / (S * 0.6), 0, 1) * 0.16;
      c = mix(c, [255, 255, 255], hl);
      // Water line: a slightly darker band across the lower third.
      const u = (x + 0.5 - INSET) / TILE, v = (y + 0.5 - INSET) / TILE;
      const wave = 0.80 + Math.sin(u * Math.PI * 4) * 0.012;
      if (v > wave) c = mix(c, [0x08, 0x4f, 0x34], 0.28 * clamp((v - wave) * TILE, 0, 1));
      // The croc fills more of the tile: scale the mark up around its visual centre.
      const mu = (u - 0.5) / MARK_SCALE + 0.5, mv = (v - 0.54) / MARK_SCALE + 0.54;
      const m = mark(mu, mv, 1 / (TILE * MARK_SCALE));
      // Soft shadow under the head.
      const sh = clamp(1 - (Math.hypot(mu - 0.5, mv - 0.585) - 0.25) / 0.06, 0, 1) * 0.18;
      c = mix(c, [0, 40, 20], sh * (1 - m.face));
      c = mix(c, [255, 255, 255], Math.max(m.face, m.eye));
      c = mix(c, [0x14, 0x8f, 0x58], m.hands);
      c = mix(c, [0xb5, 0xd9, 0xc4], m.ticks * (1 - m.hands));
      c = mix(c, [0x0c, 0x3d, 0x28], m.pupil);
      const i = (y * S + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = Math.round(tile * 255);
    }
  }
  return px;
}

/** Monochrome menu-bar glyph: outlined clock with eyes, as alpha. */
function trayIcon(S, color = [0, 0, 0]) {
  const px = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, v = (y + 0.5) / S;
      const m = mark((u - 0.5) * 1.12 + 0.5, (v - 0.5) * 1.12 + 0.5 + 0.03, 1.12 / S, { bold: 1.6 });
      // Outline style: ring + hands + eyes (with pupils cut out).
      const a = Math.max(m.ring, m.hands, m.eye * (1 - m.face));
      const i = (y * S + x) * 4;
      px[i] = color[0]; px[i + 1] = color[1]; px[i + 2] = color[2]; px[i + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
  }
  return px;
}

/** Box-downsamples an RGBA image by an integer factor (premultiplied, so edges stay clean). */
function downsample(src, S, f) {
  const D = S / f, out = new Uint8Array(D * D * 4);
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) {
      const k = ((y * f + j) * S + x * f + i) * 4, al = src[k + 3];
      r += src[k] * al; g += src[k + 1] * al; b += src[k + 2] * al; a += al;
    }
    const o = (y * D + x) * 4;
    out[o + 3] = Math.round(a / (f * f));
    if (a) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
  }
  return out;
}

function write(rel, size, rgba) {
  const out = path.join(root, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, encodePNG(size, size, rgba));
  console.log('wrote', rel);
}

const big = appIcon(1024);
write('build/icon.png', 1024, big);
write('src/assets/icon-128.png', 128, downsample(big, 1024, 8));
write('src/assets/trayTemplate.png', 16, downsample(trayIcon(128), 128, 8));
write('src/assets/trayTemplate@2x.png', 32, downsample(trayIcon(128), 128, 4));
write('src/assets/tray.png', 32, downsample(trayIcon(128, [0x1f, 0xae, 0x6b]), 128, 4));
