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
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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

/**
 * Záplata na rozbité unixové sokety.
 *
 * Na tomhle stroji vrací AF_UNIX u `connect` "Invalid argument" (bind projde,
 * spojení ne). JDK si přes něj dělá každý `Selector.open()` a na TCP loopback,
 * který funguje, samo neuhne - přepínač pro to neexistuje. Gradle proto skončí
 * hned při startu na "Unable to establish loopback connection".
 *
 * Agent ten příznak v JVM přepíše a všechno se vrátí na TCP. Přes
 * `JAVA_TOOL_OPTIONS`, aby ho dostal launcher, démon i odštěpené procesy pro
 * překlad - stačilo by, aby ho jeden z nich neměl, a build padne znovu.
 *
 * Na zdravém stroji nevadí: TCP roury byly do JDK 17 běžná cesta.
 */
function unixSocketWorkaround(javaHome) {
  const source = path.join("scripts", "uds-off", "UdsOff.java");
  if (!existsSync(source) || !javaHome) return null;

  const outDir = path.join("android", "build", "uds-off");
  const jar = path.join(outDir, "uds-off.jar");
  if (!existsSync(jar)) {
    mkdirSync(outDir, { recursive: true });
    const javac = spawnSync(path.join(javaHome, "bin", "javac"), ["-d", outDir, source], { stdio: "inherit", shell: true });
    if (javac.status !== 0) return null;
    const jarTool = spawnSync(
      path.join(javaHome, "bin", "jar"),
      ["cfm", jar, path.join("scripts", "uds-off", "manifest.txt"), "-C", outDir, "UdsOff.class"],
      { stdio: "inherit", shell: true },
    );
    if (jarTool.status !== 0) return null;
  }
  return `-javaagent:${path.resolve(jar).split(path.sep).join("/")}`;
}

const args = process.argv.slice(2);
// Dávkový soubor Node přímo spustit neumí, musí přes cmd.exe. Jinde je wrapper
// obyčejný spustitelný skript a jde zavolat rovnou.
const [command, commandArgs] =
  process.platform === "win32"
    ? ["cmd.exe", ["/c", path.resolve(wrapper), ...args]]
    : [path.resolve(wrapper), args];

const agent = unixSocketWorkaround(javaHome ?? process.env.JAVA_HOME);
const toolOptions = [process.env.JAVA_TOOL_OPTIONS, agent].filter(Boolean).join(" ");

const result = spawnSync(command, commandArgs, {
  cwd: ANDROID,
  stdio: "inherit",
  env: {
    ...process.env,
    JAVA_HOME: javaHome ?? process.env.JAVA_HOME,
    ...(toolOptions ? { JAVA_TOOL_OPTIONS: toolOptions } : {}),
  },
});

if (result.error) {
  console.error(`Gradle se nepodařilo spustit: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
