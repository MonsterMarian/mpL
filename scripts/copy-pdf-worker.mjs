/**
 * Zkopíruje běhové soubory pdf.js do `public/`, aby se dostaly do statického
 * exportu - a s ním do APK i do balíku živé aktualizace.
 *
 * **Worker.** Čtečka bez něj v telefonu nefungovala. Původní zápis
 * `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` vypadá
 * správně, ale bare specifier se v `new URL` nerozbaluje jako import - adresa
 * se poskládá relativně k JS kusu (`/_next/static/chunks/pdfjs-dist/…`),
 * kde žádný soubor není. V prohlížeči to projde, protože pdf.js po neúspěchu
 * spadne na náhradní worker v hlavním vlákně; v Android WebView vrátí
 * Capacitor na 404 rovnou `index.html`, pdf.js dostane HTML místo skriptu
 * a načítání dokumentu tiše umře.
 *
 * **Písma.** PDF nemusí písmo obsahovat - u čtrnácti základních (Helvetica,
 * Times, Courier…) se spoléhá na to, že je má prohlížeč. Ten je nemá, takže
 * si je pdf.js bere ze svých náhrad. Bez nich vykreslení stránky **uvázne**:
 * knihovna čeká na písmo, které nikdy nedorazí, a dokument se jen věčně
 * „zpracovává".
 *
 * Tabulky znaků (`cmaps`) se nevozí schválně - jsou potřeba jen u čínštiny,
 * japonštiny a korejštiny a přidaly by do každé aktualizace půldruhého
 * megabajtu.
 *
 * Pouští se samo před buildem (`prebuild` v package.json).
 */
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

const PACKAGE = path.join("node_modules", "pdfjs-dist");
const WORKER = path.join(PACKAGE, "build", "pdf.worker.min.mjs");
const FONTS = path.join(PACKAGE, "standard_fonts");
const TARGET_WORKER = path.join("public", "pdf.worker.min.mjs");
const TARGET_FONTS = path.join("public", "pdf-fonts");

try {
  await stat(WORKER);
} catch {
  console.error(`Chybí ${WORKER} - spusť npm install.`);
  process.exit(1);
}

await mkdir(path.dirname(TARGET_WORKER), { recursive: true });
await copyFile(WORKER, TARGET_WORKER);

const { size } = await stat(TARGET_WORKER);
console.log(`Worker pdf.js zkopírován do ${TARGET_WORKER} (${(size / 1024).toFixed(0)} kB)`);

await mkdir(TARGET_FONTS, { recursive: true });
let fonts = 0;
let fontBytes = 0;
for (const entry of await readdir(FONTS, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const from = path.join(FONTS, entry.name);
  await copyFile(from, path.join(TARGET_FONTS, entry.name));
  fontBytes += (await stat(from)).size;
  fonts += 1;
}
console.log(`Náhradní písma zkopírována do ${TARGET_FONTS} (${fonts} souborů, ${(fontBytes / 1024).toFixed(0)} kB)`);
