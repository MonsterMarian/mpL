/**
 * Náhradní obal do notifikace a na zamykací obrazovku.
 * Spuštění: node scripts/brand-art.mjs   (po každé změně assets/logo.jpg)
 *
 * Skladba bez obalu jinak dostane systémovou notu, která nepatří nikomu.
 * Značka na tmavém čtverci vypadá v liště jako obal alba, ne jako plovoucí
 * glyf - proto se skládá, a ne jen zmenšuje.
 *
 * Schválně vlastní PNG, ne `R.mipmap.ic_launcher`: od Androidu 8 je z ikony
 * adaptivní XML a `BitmapFactory.decodeResource` na něm vrací null - přesně
 * proto zůstávala v liště cizí ikona.
 */
import sharp from "sharp";

const TARGET = "android/app/src/main/res/drawable-nodpi/brand_art.png";
const SIZE = 512;

const mark = await sharp("public/logo-brand.png")
  .resize(Math.round(SIZE * 0.62), Math.round(SIZE * 0.62), {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .toBuffer();

await sharp({
  create: { width: SIZE, height: SIZE, channels: 4, background: { r: 14, g: 14, b: 14, alpha: 1 } },
})
  .composite([{ input: mark, gravity: "center" }])
  .png()
  .toFile(TARGET);

console.log(`${TARGET}: ${SIZE}×${SIZE}`);
