// Generates iOS PWA splash screens for "Add to Home Screen".
// Why: iOS does not use manifest.json's background_color/icons to compose a
// splash like Android does. Without apple-touch-startup-image PNGs at exact
// device dimensions, iOS shows a white screen until the WebView paints.
//
// Run: bun scripts/gen_splash.ts
// Output: public/splash/*.png
// Requires: rsvg-convert (brew install librsvg)

import { $ } from "bun";

const BG = "#16161c";
const ICON_VIEWBOX = 512;

const iconSvg = await Bun.file("public/icon.svg").text();
const innerStart = iconSvg.indexOf(">") + 1;
const innerEnd = iconSvg.lastIndexOf("</svg>");
const iconInner = iconSvg.slice(innerStart, innerEnd);

// Portrait splash sizes for current iPhones (~2020 onward).
// dw/dh = CSS px (logical), dpr = pixel ratio. PNG dimensions = dw*dpr × dh*dpr.
// iOS picks the link tag whose media query exactly matches the device — no fuzzy fallback.
const SPLASHES = [
  { dw: 440, dh: 956, dpr: 3, name: "iphone-17-pro-max" },  // 17 Pro Max
  { dw: 402, dh: 874, dpr: 3, name: "iphone-17" },          // 17, 17 Pro
  { dw: 430, dh: 932, dpr: 3, name: "iphone-16-pro-max" },  // 14/15/16 Pro Max, 15/16 Plus
  { dw: 428, dh: 926, dpr: 3, name: "iphone-plus" },        // 12/13 Pro Max, 14 Plus
  { dw: 393, dh: 852, dpr: 3, name: "iphone-16-pro" },      // 14/15/16 Pro
  { dw: 390, dh: 844, dpr: 3, name: "iphone-base" },        // 12/12 Pro, 13/13 Pro, 14/15/16
  { dw: 375, dh: 667, dpr: 2, name: "iphone-se" },          // SE 2/3
];

await $`mkdir -p public/splash`.quiet();

for (const s of SPLASHES) {
  const w = s.dw * s.dpr;
  const h = s.dh * s.dpr;
  const iconPx = Math.round(Math.min(w, h) * 0.3);
  const x = Math.round((w - iconPx) / 2);
  const y = Math.round((h - iconPx) / 2);

  const fontSize = Math.round(iconPx * 0.18);
  const textGap = Math.round(iconPx * 0.16);
  // SVG <text> y is the baseline; approximate cap-top via 0.8 * fontSize.
  const textBaselineY = y + iconPx + textGap + Math.round(fontSize * 0.8);

  const wrapperSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="${BG}"/>
  <svg width="${iconPx}" height="${iconPx}" x="${x}" y="${y}" viewBox="0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}">${iconInner}</svg>
  <text x="${w / 2}" y="${textBaselineY}" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="600" fill="#ffffff">Púca</text>
</svg>`;

  const tmp = `public/splash/.${s.name}.svg`;
  const png = `public/splash/${s.name}.png`;
  await Bun.write(tmp, wrapperSvg);
  await $`rsvg-convert ${tmp} -o ${png}`.quiet();
  await $`rm ${tmp}`.quiet();
  console.log(`generated ${png} (${w}x${h})`);
}
