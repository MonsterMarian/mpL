/**
 * Udělá z assets/logo-mark.jpg značku s průhledným pozadím pro použití v appce.
 * Spuštění: node scripts/logo-mark.mjs
 *
 * Předloha je JPEG - kresba na bílé, bez průhlednosti. Pozadí se proto nedá
 * jen "odmazat": okraje tvaru jsou vyhlazené a tvoří přechod mezi šedou
 * a bílou. Průhlednost se počítá ze světlosti pixelu, takže z přechodu vyjde
 * měkký okraj místo zubů - a barva se všude přepíše na jednu, aby na černém
 * pozadí nesvítil bílý lem.
 *
 * Ze stejného tvaru vypadnou dvě varianty:
 *  - logo-mark.png  v šedé z předlohy - zástupný obal u skladeb bez obrázku
 *  - logo-brand.png v žluté appky - značka v hlavičce
 * Ikona appky (assets/logo.jpg) má svůj vlastní žlutý odstín i stín; do webu
 * jde tentýž tvar přebarvený na jedinou žlutou, kterou appka používá všude.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SOURCE = path.join("assets", "logo-mark.jpg");
const OUTPUT = path.join("public", "logo-mark.png");
const BRAND_OUTPUT = path.join("public", "logo-brand.png");
/** Žlutá appky, stejná jako --brand v globals.css. */
const BRAND = [0xf5, 0xa3, 0x3a];

/** Hrana výsledku. Značka se v appce kreslí nejvýš přes 96 px, tohle stačí i na retinu. */
const SIZE = 512;
/** Vzduch kolem tvaru, aby se v kulatém rámečku značka nedotýkala okraje. */
const PADDING = 0.14;
/** Pod tímhle krytím jde už jen o zbytek vyhlazení, ne o kresbu. */
const EDGE_ALPHA = 8;

const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;

const lumaAt = (at) => 0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2];

/*
 * Barva kresby se bere jako nejčastější tmavý odstín, ne jako nejtmavší pixel.
 * JPEG kolem hran šumí a jeden ustřelený pixel by posunul měřítko průhlednosti
 * tak, že by plocha značky nikdy nedosáhla plného krytí.
 */
const histogram = new Uint32Array(256);
let darkest = 255;
let lightest = 0;
for (let at = 0; at < data.length; at += channels) {
  const luma = Math.round(lumaAt(at));
  histogram[luma] += 1;
  if (luma < darkest) darkest = luma;
  if (luma > lightest) lightest = luma;
}

const middle = (darkest + lightest) / 2;
let inkLuma = darkest;
for (let luma = 0; luma < middle; luma += 1) {
  if (histogram[luma] > histogram[inkLuma]) inkLuma = luma;
}

// Barva plochy: průměr pixelů kolem nalezeného odstínu, ať se nechytne šum.
let inkSum = [0, 0, 0];
let inkCount = 0;
for (let at = 0; at < data.length; at += channels) {
  if (Math.abs(lumaAt(at) - inkLuma) > 2) continue;
  inkSum = [inkSum[0] + data[at], inkSum[1] + data[at + 1], inkSum[2] + data[at + 2]];
  inkCount += 1;
}
const ink = inkSum.map((sum) => Math.round(sum / inkCount));

const range = Math.max(1, 255 - inkLuma);
const pixels = Buffer.alloc(width * height * 4);
let minX = width;
let minY = height;
let maxX = -1;
let maxY = -1;

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const from = (y * width + x) * channels;
    const luma = 0.299 * data[from] + 0.587 * data[from + 1] + 0.114 * data[from + 2];
    const alpha = Math.max(0, Math.min(255, Math.round(((255 - luma) / range) * 255)));

    const to = (y * width + x) * 4;
    pixels[to] = ink[0];
    pixels[to + 1] = ink[1];
    pixels[to + 2] = ink[2];
    pixels[to + 3] = alpha;

    if (alpha > EDGE_ALPHA) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}

if (maxX < 0) throw new Error(`V ${SOURCE} není nic než pozadí.`);

/** Tvar značky v dané barvě, na průhledném čtverci se vzduchem kolem. */
async function render(color) {
  const tinted = Buffer.from(pixels);
  for (let at = 0; at < tinted.length; at += 4) {
    tinted[at] = color[0];
    tinted[at + 1] = color[1];
    tinted[at + 2] = color[2];
  }

  // Předloha má kolem tvaru široký bílý rám. Ten se ořízne, jinak by značka
  // v malém čtverečku obalu vyšla jako nečitelný smítek uprostřed prázdna.
  const trimmed = await sharp(tinted, { raw: { width, height, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toBuffer();

  const box = Math.round(SIZE * (1 - 2 * PADDING));
  const mark = await sharp(trimmed)
    .resize(box, box, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  return sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toBuffer();
}

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, await render(ink));
await writeFile(BRAND_OUTPUT, await render(BRAND));

console.log(
  `${OUTPUT}: ${SIZE}x${SIZE}, barva rgb(${ink.join(", ")})\n` +
    `${BRAND_OUTPUT}: ${SIZE}x${SIZE}, barva rgb(${BRAND.join(", ")})\n` +
    `oříznuto z ${width}x${height} na ${maxX - minX + 1}x${maxY - minY + 1}`,
);
