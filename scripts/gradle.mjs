/**
 * Spustí Gradle wrapper v android/ s JDK, které si projekt drží vedle SDK.
 * Spuštění: node scripts/gradle.mjs assembleDebug
 *
 * Přímé volání `cd android && gradlew.bat …` z npm skriptu na tomhle stroji
 * neprojde ze dvou důvodů:
 *  - shell nehledá spustitelný soubor v aktuální složce, takže wrapper nenajde
 *  - wrapper potřebuje JVM už pro svůj vlastní start, a `java` v PATH není;
 *    `org.gradle.java.home` z gradle.properties se uplatní až o krok později
 *
 * Cesta k JDK se čte z gradle.properties, aby byla v projektu na jednom místě.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ANDROID = "android";
const wrapper = path.join(ANDROID, process.platform === "win32" ? "gradlew.bat" : "gradlew");

if (!existsSync(wrapper)) {
  console.error(`Chybí ${wrapper}. Nativní projekt vytvoří 'npx cap add android'.`);
  process.exit(1);
}

if (!existsSync(path.join(ANDROID, "local.properties"))) {
  console.error(
    `Chybí ${path.join(ANDROID, "local.properties")} s cestou k SDK.\n` +
      "Napiš do něj: sdk.dir=C:/Android/sdk   (dopředná lomítka, viz ANDROID.md)",
  );
  process.exit(1);
}

const properties = readFileSync(path.join(ANDROID, "gradle.properties"), "utf8");
const javaHome = properties.match(/^\s*org\.gradle\.java\.home\s*=\s*(.+)$/m)?.[1].trim();

if (javaHome && !existsSync(javaHome)) {
  console.error(`JDK z gradle.properties neexistuje: ${javaHome}`);
  process.exit(1);
}

const args = process.argv.slice(2);
// Dávkový soubor Node přímo spustit neumí, musí přes cmd.exe. Jinde je wrapper
// obyčejný spustitelný skript a jde zavolat rovnou.
const [command, commandArgs] =
  process.platform === "win32"
    ? ["cmd.exe", ["/c", path.resolve(wrapper), ...args]]
    : [path.resolve(wrapper), args];

const result = spawnSync(command, commandArgs, {
  cwd: ANDROID,
  stdio: "inherit",
  env: { ...process.env, JAVA_HOME: javaHome ?? process.env.JAVA_HOME },
});

if (result.error) {
  console.error(`Gradle se nepodařilo spustit: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
