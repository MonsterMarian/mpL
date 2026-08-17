/**
 * Vygeneruje ikonu a splash screen pro Android z assets/logo.jpg
 * Spuštění: node scripts/android-assets.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const RES = path.join("android", "app", "src", "main", "res");
const BG = "#000000";

async function write(file, buffer) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buffer);
}

const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const SPLASH = {
  mdpi: [320, 480],
  hdpi: [480, 800],
  xhdpi: [720, 1280],
  xxhdpi: [960, 1600],
  xxxhdpi: [1280, 1920],
};

const logoBuffer = await sharp("assets/logo.jpg").toBuffer();

for (const [density, size] of Object.entries(LAUNCHER)) {
  const icon = await sharp(logoBuffer).resize(size, size).png().toBuffer();
  await write(path.join(RES, `mipmap-${density}`, "ic_launcher.png"), icon);
  
  const circleSvg = `<svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" /></svg>`;
  const roundIcon = await sharp(logoBuffer)
    .resize(size, size)
    .composite([{ input: Buffer.from(circleSvg), blend: 'dest-in' }])
    .png()
    .toBuffer();
  await write(path.join(RES, `mipmap-${density}`, "ic_launcher_round.png"), roundIcon);
  
  const fgSize = FOREGROUND[density];
  const fgIcon = await sharp(logoBuffer)
    .resize(fgSize, fgSize)
    .png()
    .toBuffer();
  await write(
    path.join(RES, `mipmap-${density}`, "ic_launcher_foreground.png"),
    fgIcon
  );
}

for (const [density, [w, h]] of Object.entries(SPLASH)) {
  const mark = Math.round(Math.min(w, h) * 0.4);
  const splashLogo = await sharp(logoBuffer).resize(mark, mark).toBuffer();
  
  const splash = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite([{ input: splashLogo, gravity: 'center' }])
    .png()
    .toBuffer();
  await write(path.join(RES, `drawable-port-${density}`, "splash.png"), splash);
  
  const splashLand = await sharp({ create: { width: h, height: w, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite([{ input: splashLogo, gravity: 'center' }])
    .png()
    .toBuffer();
  await write(path.join(RES, `drawable-land-${density}`, "splash.png"), splashLand);
}

const defaultMark = Math.round(480 * 0.4);
const defaultLogo = await sharp(logoBuffer).resize(defaultMark, defaultMark).toBuffer();
const defaultSplash = await sharp({ create: { width: 480, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
  .composite([{ input: defaultLogo, gravity: 'center' }])
  .png()
  .toBuffer();
await write(path.join(RES, "drawable", "splash.png"), defaultSplash);

await write(
  path.join(RES, "values", "ic_launcher_background.xml"),
  Buffer.from(`<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`)
);

console.log("Ikony a splash vygenerovány do", RES);
