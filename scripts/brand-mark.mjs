/**
 * Vypeče značku appky do `src/lib/brand.ts` jako data URI.
 * Spuštění: node scripts/brand-mark.mjs   (po každé změně assets/logo.jpg)
 *
 * Proč ne prostý `<img src="/logo-brand.png">`: balík živé aktualizace vozí
 * soubory jako text a binární PNG se v něm rozbije. Značka pak v telefonu
 * svítila jako ikona nenačteného obrázku - a to na všech místech naráz,
 * protože ji appka používá jako zástupný obal každé skladby bez obalu.
 *
 * Uvnitř JS je značka součástí kódu, takže projde všude, kudy projde kód.
 */
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const SOURCE = "public/logo-brand.png";
const TARGET = "src/lib/brand.ts";
// 192 px stačí i na velký obal v detailu skladby; víc už jen nafukuje balík.
const SIZE = 192;

const png = await sharp(await readFile(SOURCE))
  .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ palette: true, compressionLevel: 9, effort: 10 })
  .toBuffer();

const dataUri = `data:image/png;base64,${png.toString("base64")}`;

await writeFile(
  TARGET,
  `/**
 * Značka appky jako data URI - vygenerováno \`node scripts/brand-mark.mjs\`
 * z ${SOURCE}. Needituj ručně.
 *
 * Uvnitř kódu schválně: balík živé aktualizace vozí soubory jako text
 * a binární PNG se v něm rozbije, takže odkaz na \`/logo-brand.png\` v telefonu
 * skončil jako ikona nenačteného obrázku.
 */
export const BRAND_MARK =
  "${dataUri}";
`,
  "utf8",
);

console.log(`${TARGET}: ${(dataUri.length / 1024).toFixed(1)} kB (z ${SIZE}px PNG)`);
