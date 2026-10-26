// Generates iOS PWA splash screens for "Add to Home Screen".
// Why: iOS does not use manifest.json's background_color/icons to compose a
// splash like Android does. Without apple-touch-startup-image PNGs at exact
// device dimensions, iOS shows a white screen until the WebView paints.
//
// Run: bun scripts/gen_splash.ts
// Output: public/splash/*.png
// Requires: rsvg-convert (brew install librsvg)

import { $ } from "bun";

// Approved full-screen artwork and its transparent mascot cutout are kept in
// assets/halloween so all exported images can be reproduced.
const splash = Buffer.from(
	await Bun.file("assets/halloween/splash.png").arrayBuffer(),
).toString("base64");
const character = Buffer.from(
	await Bun.file("assets/halloween/puca-character.png").arrayBuffer(),
).toString("base64");

// Portrait splash sizes for current iPhones (~2020 onward).
// dw/dh = CSS px (logical), dpr = pixel ratio. PNG dimensions = dw*dpr × dh*dpr.
// iOS picks the link tag whose media query exactly matches the device — no fuzzy fallback.
const SPLASHES = [
	{ dw: 440, dh: 956, dpr: 3, name: "iphone-17-pro-max" }, // 17 Pro Max
	{ dw: 402, dh: 874, dpr: 3, name: "iphone-17" }, // 17, 17 Pro
	{ dw: 430, dh: 932, dpr: 3, name: "iphone-16-pro-max" }, // 14/15/16 Pro Max, 15/16 Plus
	{ dw: 428, dh: 926, dpr: 3, name: "iphone-plus" }, // 12/13 Pro Max, 14 Plus
	{ dw: 393, dh: 852, dpr: 3, name: "iphone-16-pro" }, // 14/15/16 Pro
	{ dw: 390, dh: 844, dpr: 3, name: "iphone-base" }, // 12/12 Pro, 13/13 Pro, 14/15/16
	{ dw: 375, dh: 667, dpr: 2, name: "iphone-se" }, // SE 2/3
];

await $`mkdir -p public/splash`.quiet();

for (const s of SPLASHES) {
	const w = s.dw * s.dpr;
	const h = s.dh * s.dpr;
	// Cover preserves the artwork's proportions. Shorter SE screens crop only
	// the outer scenery; the central mascot and wordmark stay in frame.
	const wrapperSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <image width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" href="data:image/png;base64,${splash}"/>
</svg>`;

	const tmp = `public/splash/.${s.name}.svg`;
	const png = `public/splash/${s.name}.png`;
	await Bun.write(tmp, wrapperSvg);
	await $`rsvg-convert ${tmp} -o ${png}`.quiet();
	await $`rm ${tmp}`.quiet();
	console.log(`generated ${png} (${w}x${h})`);
}

// Three physical pixels per CSS pixel for the 128px About-page mascot.
const characterSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="384" height="384"><image width="384" height="384" href="data:image/png;base64,${character}"/></svg>`;
const characterTmp = "public/splash/.puca-halloween.svg";
await Bun.write(characterTmp, characterSvg);
await $`rsvg-convert ${characterTmp} -o public/puca-halloween.png`.quiet();
await $`rm ${characterTmp}`.quiet();
console.log("generated public/puca-halloween.png (384x384, transparent)");
