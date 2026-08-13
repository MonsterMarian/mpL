/**
 * Převod CSV exportu z aplikace Progress na zálohu MicroWins.
 *
 * Vyrobí soubor, který appka načte přes Nastavení → Data → Obnovit ze souboru
 * (s rozsahem "jen projekty", takže strom winů zůstane, jak je).
 *
 * Spuštění:
 *   node scripts/import-progress.mjs --in <složka s CSV> [--out <soubor.json>]
 *
 * Co se převádí:
 *   projects.csv   -> projekty (ikona z header_emoji, archivace, deadline)
 *   tasks.csv      -> úkoly
 *   subtasks.csv   -> podúkoly (parentId na úkol)
 *   comments.csv   -> dopíší se do popisu úkolu, appka komentáře nemá
 *   attachments    -> jen poznámka v popisu, přílohy appka neumí
 *
 * Skript si na konci sám přepočítá procenta podle pravidel MicroWins a porovná
 * je s hodnotou `achieve` ze zdroje. Když se rozejdou, mapování je špatně
 * a je to hned vidět.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

// --- argumenty --------------------------------------------------------------

const args = process.argv.slice(2);
function arg(name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at !== -1 && args[at + 1] ? args[at + 1] : fallback;
}

const IN_DIR = arg("in", "C:/Users/mvystavel/Downloads/progress");
const OUT_FILE = arg("out", path.join(IN_DIR, "microwins-projekty.json"));
/** Volitelně i modul se seedem, který se zabalí do appky (viz lib/seed-import.ts). */
const SEED_FILE = args.includes("--seed") ? arg("seed", "src/lib/seed-import-data.ts") : null;

// --- CSV --------------------------------------------------------------------

/**
 * Minimalistický parser CSV podle RFC 4180 - hodnoty v uvozovkách smí
 * obsahovat čárky i odřádkování (popisy projektů je obsahují).
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Řádky CSV na objekty podle hlavičky; prázdné řádky se zahodí. */
async function readTable(file) {
  let text;
  try {
    text = await readFile(path.join(IN_DIR, file), "utf8");
  } catch {
    console.log(`  ${file}: není, přeskakuju`);
    return [];
  }
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows
    .slice(1)
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// --- pomocníci --------------------------------------------------------------

/**
 * "2026-01-24T07:01:55.882+01:00" -> "2026-01-24".
 *
 * Bere prvních deset znaků, ne přepočet na UTC: datum ve zdroji je místní den
 * a MicroWins s daty pracuje taky jako s místními. Přes UTC by se u zápisů
 * pozdě večer nebo po půlnoci posunul den.
 */
function toDay(value) {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

/** Časová značka na jeden tvar, ať se dá řadit přes localeCompare. */
function toStamp(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

function num(value) {
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function bool(value) {
  return String(value).trim().toLowerCase() === "true";
}

/** "1. 1. 2026" pro poznámky v popisu. */
function czDate(day) {
  const [y, m, d] = day.split("-");
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

/** Pořadí 0..n podle `sort` a data vzniku; 2147483647 znamená "na konec". */
function normalizeOrder(rows) {
  return [...rows]
    .sort((a, b) => num(a.sort) - num(b.sort) || toStamp(a.create_date).localeCompare(toStamp(b.create_date)))
    .map((row, i) => ({ row, order: i }));
}

// --- procenta podle pravidel MicroWins --------------------------------------

function taskPercent(task, byParent) {
  const children = byParent.get(task.id) ?? [];
  if (children.length > 0) {
    const weight = children.reduce((s, c) => s + (c.weight || 1), 0);
    if (weight === 0) return 0;
    return Math.min(
      100,
      children.reduce((s, c) => s + taskPercent(c, byParent) * (c.weight || 1), 0) / weight,
    );
  }
  if (task.target <= 0) return task.current > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, (task.current / task.target) * 100));
}

function projectPercent(projectId, tasks) {
  const byParent = new Map();
  for (const t of tasks) {
    const key = t.parentId ?? "";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(t);
  }
  const top = tasks.filter((t) => t.projectId === projectId && t.parentId === null);
  if (top.length === 0) return 0;
  const weight = top.reduce((s, t) => s + (t.weight || 1), 0);
  if (weight === 0) return 0;
  return top.reduce((s, t) => s + taskPercent(t, byParent) * (t.weight || 1), 0) / weight;
}

// --- mapování hodnot úkolu --------------------------------------------------

/**
 * Zdroj drží postup třemi způsoby, MicroWins jen jedním (hodnota / cíl):
 *
 *  - `individual_calc = true`: vlastní čísla, přenesou se 1:1 (145 / 200)
 *  - položka s podúkoly: procenta se stejně počítají z dětí, čísla jsou jen
 *    záloha pro případ, že by podúkoly zmizely
 *  - zaškrtávací položka (achieve 0 nebo 100): 0 / 1 nebo 1 / 1
 *  - ruční procenta (achieve 19): 19 / 100
 */
function mapValues(row, hasChildren) {
  const max = num(row.max_value);
  const value = num(row.individual_value);
  const achieve = Math.min(100, Math.max(0, num(row.achieve)));

  if (bool(row.individual_calc) && max > 0) {
    return { target: max, current: Math.min(value, max) };
  }
  if (hasChildren) return { target: 100, current: achieve };
  if (achieve === 0 || achieve === 100) return { target: 1, current: achieve === 100 ? 1 : 0 };
  return { target: 100, current: achieve };
}

// --- převod -----------------------------------------------------------------

console.log(`Čtu CSV z ${IN_DIR}`);
const [projectRows, taskRows, subtaskRows, commentRows, attachmentRows] = await Promise.all([
  readTable("projects.csv"),
  readTable("tasks.csv"),
  readTable("subtasks.csv"),
  readTable("comments.csv"),
  readTable("attachments.csv"),
]);

const projectIds = new Set(projectRows.map((r) => r.id));
const skipped = [];

// Komentáře a přílohy k úkolu - appka je nemá, ať se aspoň neztratí text.
const notesByTask = new Map();
function addNote(taskId, note) {
  if (!taskId) return;
  if (!notesByTask.has(taskId)) notesByTask.set(taskId, []);
  notesByTask.get(taskId).push(note);
}
for (const c of [...commentRows].sort((a, b) => toStamp(a.create_date).localeCompare(toStamp(b.create_date)))) {
  const target = c.subtask_id || c.task_id;
  addNote(target, `[${czDate(toDay(c.create_date))}] ${c.body.trim()}`);
}
for (const a of attachmentRows) {
  const target = a.subtask_id || a.task_id;
  addNote(target, `[příloha ${czDate(toDay(a.create_date))}] ${a.original_name} - appka přílohy neumí, soubor zůstal v exportu`);
}

function withNotes(id, description) {
  const notes = notesByTask.get(id);
  const base = description.trim();
  if (!notes || notes.length === 0) return base;
  return [base, ...notes].filter(Boolean).join("\n\n");
}

// --- projekty ---------------------------------------------------------------

const projects = normalizeOrder(projectRows).map(({ row, order }) => {
  const start = toDay(row.start_date) || toDay(row.create_date);
  const deadline = toDay(row.due_date) || null;
  return {
    id: row.id,
    name: row.name.trim() || "Bez názvu",
    icon: row.header_emoji.trim() || "📁",
    startDate: start,
    // Deadline před startem by appka odmítla jako nesmysl.
    deadline: deadline && deadline >= start ? deadline : null,
    description: row.description.trim(),
    order,
    createdAt: toStamp(row.create_date),
    archivedAt: bool(row.archived) ? toStamp(row.update_date) : null,
  };
});

// --- úkoly a podúkoly -------------------------------------------------------

const childrenOfTask = new Set(subtaskRows.map((s) => s.task_id));
const tasks = [];

// Pořadí se čísluje uvnitř projektu, ne přes celý export - appka to tak dělá
// taky (`createTask` bere počet sourozenců).
const tasksByProject = new Map();
for (const row of taskRows) {
  if (!projectIds.has(row.project_id)) {
    skipped.push(`úkol "${row.name.trim() || row.id}" bez projektu`);
    continue;
  }
  if (!tasksByProject.has(row.project_id)) tasksByProject.set(row.project_id, []);
  tasksByProject.get(row.project_id).push(row);
}

for (const { row, order } of [...tasksByProject.values()].flatMap((rows) => normalizeOrder(rows))) {
  const { target, current } = mapValues(row, childrenOfTask.has(row.id));
  tasks.push({
    id: row.id,
    projectId: row.project_id,
    parentId: null,
    name: row.name.trim() || "Bez názvu",
    icon: row.header_emoji.trim() || "📝",
    target,
    current,
    unit: undefined,
    step: 1,
    weight: 1,
    dueDate: toDay(row.due_date) || null,
    milestoneId: null,
    description: withNotes(row.id, row.description),
    order,
    createdAt: toStamp(row.create_date),
    completedAt: current >= target ? toStamp(row.update_date) : null,
  });
}

const taskIds = new Set(tasks.map((t) => t.id));

// Podúkoly se řadí v rámci svého rodiče, ne globálně.
const byParentTask = new Map();
for (const row of subtaskRows) {
  if (!byParentTask.has(row.task_id)) byParentTask.set(row.task_id, []);
  byParentTask.get(row.task_id).push(row);
}

for (const [parentId, rows] of byParentTask) {
  if (!taskIds.has(parentId)) {
    for (const row of rows) skipped.push(`podúkol "${row.name.trim()}" bez rodiče`);
    continue;
  }
  const parent = tasks.find((t) => t.id === parentId);
  for (const { row, order } of normalizeOrder(rows)) {
    const { target, current } = mapValues(row, false);
    tasks.push({
      id: row.id,
      projectId: parent.projectId,
      parentId,
      name: row.name.trim() || "Bez názvu",
      icon: "📝",
      target,
      current,
      unit: undefined,
      step: 1,
      weight: 1,
      dueDate: toDay(row.due_date) || null,
      milestoneId: null,
      description: withNotes(row.id, row.description),
      order,
      createdAt: toStamp(row.create_date),
      completedAt: current >= target ? toStamp(row.update_date) : null,
    });
  }
}

// --- otisky postupu ---------------------------------------------------------

/**
 * Historie postupu.
 *
 * Zdroj graf ani deník změn neexportuje, ale u každého úkolu a podúkolu zná
 * den vzniku a den poslední změny. Z toho se historie dá poskládat zpátky:
 *
 *  - zaškrtávací podúkol: skok v den, kdy byl odškrtnutý (`update_date`).
 *    Tohle je přesné, binární věc se neděje postupně.
 *  - číselný úkol: hodnotu známe jen ke dni poslední změny. Mezi vznikem
 *    a tímhle dnem se odhaduje rovnoměrně - kdo dělal 1485 kliků, nedělal je
 *    všechny v jeden den. Je to odhad, ale bližší pravdě než skok na konci.
 *
 * Bez toho by graf devadesátiprocentní většiny projektů byl jedna přímka
 * z nuly do dneška.
 */
const now = new Date();
function localDay(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
const TODAY_DAY = localDay(now);
const YESTERDAY_DAY = localDay(new Date(now.getTime() - 86_400_000));

function dayDiff(a, b) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

function addDays(day, count) {
  return localDay(new Date(Date.parse(`${day}T12:00:00Z`) + count * 86_400_000));
}

/** Doplní ke každému úkolu dny vzniku a poslední změny (pro model historie). */
const timeline = new Map();
for (const row of [...taskRows, ...subtaskRows]) {
  timeline.set(row.id, {
    created: toDay(row.create_date),
    updated: toDay(row.update_date) || toDay(row.create_date),
  });
}

const childrenByTask = new Map();
for (const t of tasks) {
  const key = t.parentId ?? "";
  if (!childrenByTask.has(key)) childrenByTask.set(key, []);
  childrenByTask.get(key).push(t);
}

function valueAt(task, day) {
  const when = timeline.get(task.id);
  if (!when || !when.created) return task.current;
  if (day < when.created) return 0;
  if (day >= when.updated) return task.current;

  // Zaškrtnutí je skok, ne růst - do dne odškrtnutí je to nula.
  if (task.target === 1) return 0;

  const span = dayDiff(when.created, when.updated);
  if (span <= 0) return task.current;
  return (task.current * dayDiff(when.created, day)) / span;
}

function taskPercentAt(task, day) {
  const children = childrenByTask.get(task.id) ?? [];
  if (children.length > 0) {
    const weight = children.reduce((s, c) => s + (c.weight || 1), 0);
    if (weight === 0) return 0;
    return Math.min(
      100,
      children.reduce((s, c) => s + taskPercentAt(c, day) * (c.weight || 1), 0) / weight,
    );
  }
  const value = valueAt(task, day);
  if (task.target <= 0) return value > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, (value / task.target) * 100));
}

function projectPercentAt(projectId, day) {
  const top = (childrenByTask.get("") ?? []).filter((t) => t.projectId === projectId);
  if (top.length === 0) return 0;
  const weight = top.reduce((s, t) => s + (t.weight || 1), 0);
  if (weight === 0) return 0;
  return top.reduce((s, t) => s + taskPercentAt(t, day) * (t.weight || 1), 0) / weight;
}

const snapshots = [];
let snapshotCount = 0;

for (const row of projectRows) {
  const project = projects.find((p) => p.id === row.id);
  const projectTasks = tasks.filter((t) => t.projectId === project.id);
  const percent = Math.round(projectPercent(project.id, tasks) * 10) / 10;

  // Poslední otisk musí padnout nejpozději na včerejšek. Appka počítá "dnešní
  // přírůstek" jako rozdíl proti včerejšku, takže s otiskem k dnešku by celý
  // přenesený postup vypadal jako práce odvedená v den importu.
  const events = projectTasks
    .flatMap((t) => {
      const when = timeline.get(t.id);
      return when ? [when.created, when.updated] : [];
    })
    .filter(Boolean);
  const lastEvent = events.length ? events.reduce((a, b) => (a > b ? a : b)) : project.startDate;
  const end = lastEvent < TODAY_DAY ? lastEvent : YESTERDAY_DAY;

  if (end <= project.startDate) {
    snapshots.push({ projectId: project.id, date: project.startDate, percent });
    snapshotCount++;
    continue;
  }

  // Dny, kdy se prokazatelně něco stalo, plus týdenní vzorky, aby postupný
  // růst číselných úkolů nebyl jedna dlouhá vodorovná čára.
  const days = new Set([project.startDate, end]);
  for (const day of events) {
    if (day > project.startDate && day < end) days.add(day);
  }
  const span = dayDiff(project.startDate, end);
  const step = Math.max(7, Math.ceil(span / 180));
  for (let i = step; i < span; i += step) days.add(addDays(project.startDate, i));

  let previous = null;
  for (const day of [...days].sort()) {
    const value = Math.round(projectPercentAt(project.id, day) * 10) / 10;
    // Stejná hodnota jako minule se zahodí - appka mezi otisky drží poslední
    // známou, takže by to jen nafouklo soubor.
    if (value === previous) continue;
    previous = value;
    snapshots.push({ projectId: project.id, date: day, percent: day === end ? percent : value });
    snapshotCount++;
  }

  // Poslední bod musí sedět na skutečném stavu, ať se graf potká s číslem
  // nahoře na detailu projektu.
  const last = snapshots[snapshots.length - 1];
  if (last.projectId !== project.id || last.date !== end) {
    snapshots.push({ projectId: project.id, date: end, percent });
    snapshotCount++;
  }
}

// --- výstup -----------------------------------------------------------------

const backup = {
  format: "microwins-backup",
  backupVersion: 1,
  stateVersion: 2,
  exportedAt: new Date().toISOString(),
  settings: {},
  state: {
    version: 2,
    nodes: [],
    entries: [],
    microwins: [],
    projects,
    tasks,
    milestones: [],
    snapshots,
  },
};

await mkdir(path.dirname(OUT_FILE), { recursive: true });
await writeFile(OUT_FILE, JSON.stringify(backup, null, 2));

/**
 * Modul se seedem: stejná data, ale zabalená rovnou do appky. Používá se
 * na jednorázové doručení přes živou aktualizaci - uživatel si stáhne balík,
 * projekty si sednou do localStorage a další verze už seed nemusí obsahovat.
 */
if (SEED_FILE) {
  const id = `progress-${TODAY_DAY}`;
  const module = `/**
 * VYGENEROVANÁ DATA - \`node scripts/import-progress.mjs --seed\`.
 *
 * Dočasná zásilka projektů z aplikace Progress. Přišla živou aktualizací,
 * usadila se do localStorage a v další verzi balíku už tenhle soubor
 * i jeho volání v \`seed-import.ts\` můžou pryč.
 */
import type { MicroWinsState } from "./types";

/** Značka v localStorage - seed se použije jen jednou. */
export const SEED_ID = ${JSON.stringify(id)};

export const SEED_STATE: MicroWinsState = ${JSON.stringify(backup.state, null, 2)};
`;
  await writeFile(SEED_FILE, module);
  console.log(`\nSeed modul: ${SEED_FILE} (id ${id})`);
}

// --- kontrola ---------------------------------------------------------------

console.log(`\nProjekty: ${projects.length}, úkoly: ${tasks.filter((t) => !t.parentId).length}, podúkoly: ${tasks.filter((t) => t.parentId).length}`);
console.log(`Poznámky z komentářů a příloh: ${[...notesByTask.values()].reduce((s, n) => s + n.length, 0)}`);
console.log(`Otisky historie: ${snapshotCount}`);

console.log("\nHistorie (od startu, počet otisků):");
for (const project of [...projects].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
  const mine = snapshots.filter((s) => s.projectId === project.id);
  const days = dayDiff(project.startDate, TODAY_DAY);
  console.log(
    `  ${project.icon} ${project.name.padEnd(30)} ${String(days).padStart(4)} dní  ${String(mine.length).padStart(3)} otisků  ${mine[0].percent} % → ${mine[mine.length - 1].percent} %`,
  );
}

console.log("\nKontrola procent (zdroj → MicroWins):");
let mismatch = 0;
for (const row of [...projectRows].sort((a, b) => a.name.localeCompare(b.name, "cs"))) {
  const project = projects.find((p) => p.id === row.id);
  const mine = Math.floor(projectPercent(project.id, tasks) + 1e-9);
  const theirs = Math.floor(num(row.achieve));
  const ok = Math.abs(mine - theirs) <= 1;
  if (!ok) mismatch++;
  console.log(
    `  ${ok ? "ok " : "!! "} ${String(theirs).padStart(3)} % → ${String(mine).padStart(3)} %  ${project.icon} ${project.name}${project.archivedAt ? " (archiv)" : ""}`,
  );
}

if (skipped.length > 0) {
  console.log(`\nVynecháno (${skipped.length}), v MicroWins by to nemělo kam patřit:`);
  for (const s of skipped) console.log(`  - ${s}`);
}

const files = await readdir(path.join(IN_DIR, "files")).catch(() => []);
if (files.length > 0) {
  console.log(`\nPřílohy (${files.length}) se nepřenesou, appka je neumí. Zůstávají v ${path.join(IN_DIR, "files")}`);
}

console.log(`\nHotovo: ${OUT_FILE}`);
if (mismatch > 0) {
  console.error(`\nPOZOR: u ${mismatch} projektů nesedí procenta - mapování je špatně.`);
  process.exit(1);
}
