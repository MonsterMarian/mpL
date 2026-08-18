/**
 * Vydání nové verze.
 *
 * Vypočítá číslo verze, postaví s ním web a z toho samého buildu zabalí
 * balík pro živé aktualizace. Verze se musí propsat do obojího:
 *  - do webu, aby appka věděla, co v sobě má a nestahovala to znovu
 *  - do manifestu, aby poznala, že je venku něco novějšího
 *
 * Kdyby se stavělo dvakrát zvlášť, APK a balík by měly jiné číslo a appka
 * by si po každé instalaci stáhla balík, který už uvnitř má.
 *
 * Spuštění: npm run ota:bundle
 * Výstup:   out/ (web) + ota/bundle-<verze>.json + ota/latest.json
 */
import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

const SRC = "out";
const DEST = "ota";

const version = new Date().toISOString().replace(/[-:T]/g, ".").slice(0, 16);

console.log(`Verze ${version} - stavím web…`);
const build = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_PUBLIC_BUNDLE_VERSION: version },
});
if (build.status !== 0) {
  console.error("Build webu selhal, balík se nedělá.");
  process.exit(build.status ?? 1);
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

/*
 * Text jde do balíku jako text, všechno ostatní jako base64.
 *
 * Dřív se četlo všechno jako UTF-8 a binární soubory se tím tiše rozbily:
 * z loga v telefonu zbyla ikona nenačteného obrázku. Pozná se to zkouškou tam
 * a zpátky, ne podle přípony - seznam přípon se dřív nebo později rozejde
 * s tím, co v `out/` doopravdy leží.
 */
const files = [];
let bytes = 0;
for (const rel of await walk(SRC)) {
  const buffer = await readFile(path.join(SRC, rel));
  bytes += buffer.length;
  const text = buffer.toString("utf8");
  if (Buffer.compare(Buffer.from(text, "utf8"), buffer) === 0) {
    files.push({ path: rel, content: text });
  } else {
    files.push({ path: rel, content: buffer.toString("base64"), encoding: "base64" });
  }
}

const binary = files.filter((file) => file.encoding === "base64").length;

if (!files.some((f) => f.path === "index.html")) {
  console.error("V out/ chybí index.html.");
  process.exit(1);
}

// Pojistka: web musí opravdu vědět, jakou verzi v sobě má.
if (!files.some((f) => f.content.includes(version))) {
  console.error(`Ve webu není číslo verze ${version} - build nedostal NEXT_PUBLIC_BUNDLE_VERSION.`);
  process.exit(1);
}

// Staré balíky pryč, v repozitáři má zůstat jen ten poslední.
await rm(DEST, { recursive: true, force: true });
await mkdir(DEST, { recursive: true });

const bundleName = `bundle-${version}.json`;
await writeFile(path.join(DEST, bundleName), JSON.stringify(files));

// Plná adresa, ne jen jméno souboru: manifest se stahuje z API (kvůli
// čerstvosti), ale balík leží na raw. Relativní jméno by se skládalo vůči
// adrese manifestu a ukázalo by do prázdna.
const bundleUrl = `https://raw.githubusercontent.com/MonsterMarian/mpL/main/ota/${bundleName}`;
await writeFile(
  path.join(DEST, "latest.json"),
  JSON.stringify({ version, bundle: bundleUrl, notes: "" }, null, 2),
);

console.log(
  `\nBalík ${bundleName}: ${files.length} souborů (z toho ${binary} binárních), ${(bytes / 1024 / 1024).toFixed(2)} MB`,
);
console.log(`Manifest ota/latest.json, verze ${version}`);
console.log("Dál: npm run android:release (APK se stejnou verzí), pak commit a push ota/");
