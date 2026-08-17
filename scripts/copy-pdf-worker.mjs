/**
 * Zkopíruje worker pdf.js do `public/`, aby se dostal do statického exportu.
 *
 * Čtečka bez něj v telefonu nefungovala. Původní zápis
 * `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` vypadá
 * správně, ale bare specifier se v `new URL` nerozbaluje jako import - adresa
 * se poskládá relativně k JS kusu (`/_next/static/chunks/pdfjs-dist/…`),
 * kde žádný soubor není. V prohlížeči to projde, protože pdf.js po neúspěchu
 * spadne na náhradní worker v hlavním vlákně; v Android WebView vrátí
 * Capacitor na 404 rovnou `index.html`, pdf.js dostane HTML místo skriptu
 * a načítání dokumentu tiše umře.
 *
 * Soubor se proto vozí v `public/` a odkazuje se na něj absolutně z kořene,
 * což je adresa, kterou appka má v obou prostředích.
 *
 * Pouští se samo před buildem (`prebuild` v package.json).
 */
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const SOURCE = path.join("node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const TARGET = path.join("public", "pdf.worker.min.mjs");

try {
  await stat(SOURCE);
} catch {
  console.error(`Chybí ${SOURCE} - spusť npm install.`);
  process.exit(1);
}

await mkdir(path.dirname(TARGET), { recursive: true });
await copyFile(SOURCE, TARGET);

const { size } = await stat(TARGET);
console.log(`Worker pdf.js zkopírován do ${TARGET} (${(size / 1024).toFixed(0)} kB)`);
