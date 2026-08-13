/**
 * Podepíše release APK klíčem z android/keystore.properties.
 *
 * Schémata v1 + v2 + v3 schválně: v1 chce starší instalátor, bez v2/v3 se
 * appka na novém Androidu nenainstaluje. Schéma v4 je vypnuté - používá ho
 * jen `adb install --incremental` a jinak po sobě nechává soubor .apk.idsig.
 *
 * Spuštění: npm run android:sign
 * Výstup:   ../MicroWins.apk (vedle složky projektu)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const SDK = process.env.ANDROID_HOME ?? "C:/Android/sdk";
const APK_IN = "android/app/build/outputs/apk/release/app-release.apk";
const APK_OUT = process.argv[2] ?? "../MicroWins.apk";

if (!existsSync(APK_IN)) {
  console.error(`Chybí ${APK_IN} - spusť nejdřív npm run android:release.`);
  process.exit(1);
}

const propsPath = "android/keystore.properties";
if (!existsSync(propsPath)) {
  console.error(`Chybí ${propsPath} - bez podpisového klíče se podepsat nedá.`);
  process.exit(1);
}

const props = Object.fromEntries(
  readFileSync(propsPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

// Nejvyšší dostupná verze build-tools, ať skript přežije aktualizaci SDK.
const buildToolsDir = path.join(SDK, "build-tools");
const version = readdirSync(buildToolsDir).sort().pop();
const apksigner = path.join(buildToolsDir, version, "apksigner.bat");

const res = spawnSync(
  apksigner,
  [
    "sign",
    "--ks", path.join("android", props.storeFile),
    "--ks-pass", `pass:${props.storePassword}`,
    "--key-pass", `pass:${props.keyPassword}`,
    "--ks-key-alias", props.keyAlias,
    // Kvůli v1 podpisu: apksigner ho u minSdk 24+ jinak vynechá.
    "--min-sdk-version", "21",
    "--v1-signing-enabled", "true",
    "--v2-signing-enabled", "true",
    "--v3-signing-enabled", "true",
    "--v4-signing-enabled", "false",
    "--out", APK_OUT,
    APK_IN,
  ],
  { stdio: "inherit", shell: true },
);

if (res.status !== 0) process.exit(res.status ?? 1);

const check = spawnSync(
  apksigner,
  ["verify", "--min-sdk-version", "21", "--verbose", APK_OUT],
  { encoding: "utf8", shell: true },
);
const schemes = (check.stdout ?? "")
  .split("\n")
  .filter((l) => l.includes("scheme") && l.includes("true"))
  .map((l) => l.match(/v\d(?:\.\d)?/)?.[0])
  .filter(Boolean);

console.log(`\nPodepsáno: ${path.resolve(APK_OUT)}`);
console.log(`Schémata: ${schemes.join(" + ")}`);
