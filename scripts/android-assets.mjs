/**
 * Vygeneruje ikonu a splash screen pro Android z jednoho SVG.
 *
 * Proč skript a ne hotové PNG: assety se dají kdykoli přegenerovat ze zdroje,
 * takže se nerozejdou s paletou appky. Barvy odpovídají tokenům v globals.css
 * (--background a --win v tmavém režimu).
 *
 * Spuštění: node scripts/android-assets.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const RES = path.join("android", "app", "src", "main", "res");

const BG = "#09090B";
const WIN = "#F5A33A";
const INK = "#FAFAFA";

/**
 * Tři stoupající sloupce, nejvyšší v barvě winu, nad ním šipka nahoru.
 * Drží se odděleně, aby to bylo čitelné i na 48 px v šuplíku aplikací.
 */
function markSvg(size, inset = 0) {
  const s = size;
  const pad = s * inset;
  const w = s - pad * 2;
  const bar = w * 0.16;
  const gap = w * 0.08;
  const baseY = pad + w * 0.84;
  const heights = [0.3, 0.44, 0.58];
  const bars = heights
    .map((h, i) => {
      const x = pad + w * 0.15 + i * (bar + gap);
      const height = w * h;
      const last = i === 2;
      return `<rect x="${x}" y="${baseY - height}" width="${bar}" height="${height}" rx="${bar * 0.3}" fill="${last ? WIN : INK}" opacity="${last ? 1 : 0.4}"/>`;
    })
    .join("");
  const cx = pad + w * 0.71;
  const cy = pad + w * 0.15;
  const arm = w * 0.1;
  const caret = `<path d="M ${cx - arm} ${cy + arm * 0.8} L ${cx} ${cy} L ${cx + arm} ${cy + arm * 0.8}" fill="none" stroke="${WIN}" stroke-width="${w * 0.085}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${bars}${caret}</svg>`;
}

function iconSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="${BG}"/>
  ${markSvg(size, 0.06).replace(/<svg[^>]*>|<\/svg>/g, "")}
</svg>`;
}

/** Adaptivní ikona: kresba musí sedět do vnitřních 66 % plochy. */
function foregroundSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${markSvg(size, 0.26).replace(/<svg[^>]*>|<\/svg>/g, "")}
</svg>`;
}

function splashSvg(w, h) {
  const mark = Math.round(Math.min(w, h) * 0.26);
  const x = Math.round((w - mark) / 2);
  const y = Math.round((h - mark) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${BG}"/>
  <g transform="translate(${x} ${y})">${markSvg(mark, 0.02).replace(/<svg[^>]*>|<\/svg>/g, "")}</g>
</svg>`;
}

const png = (svg) => sharp(Buffer.from(svg)).png().toBuffer();

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

for (const [density, size] of Object.entries(LAUNCHER)) {
  const icon = await png(iconSvg(size));
  await write(path.join(RES, `mipmap-${density}`, "ic_launcher.png"), icon);
  await write(path.join(RES, `mipmap-${density}`, "ic_launcher_round.png"), icon);
  await write(
    path.join(RES, `mipmap-${density}`, "ic_launcher_foreground.png"),
    await png(foregroundSvg(FOREGROUND[density])),
  );
}

for (const [density, [w, h]] of Object.entries(SPLASH)) {
  await write(path.join(RES, `drawable-port-${density}`, "splash.png"), await png(splashSvg(w, h)));
  await write(path.join(RES, `drawable-land-${density}`, "splash.png"), await png(splashSvg(h, w)));
}
await write(path.join(RES, "drawable", "splash.png"), await png(splashSvg(480, 800)));

// Adaptivní ikona kreslí pozadí barvou, ne obrázkem - proto sem, ne do PNG.
await write(
  path.join(RES, "values", "ic_launcher_background.xml"),
  Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`,
  ),
);

console.log("Ikony a splash vygenerovány do", RES);
