// Ranking server (S11): the Google Apps Script in ranking/Code.gs runs here in a
// Node sandbox with fake Google services, through its public doGet entry point.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let okCount = 0, failCount = 0;
function check(condition, label) {
  if (condition) { okCount++; console.log(`ok: ${label}`); }
  else { failCount++; console.error(`FAIL: ${label}`); }
}

// A fresh script with an empty spreadsheet, a fixed clock and fake services.
function load(now = "2026-11-14T10:00:00Z", sheets = {}) {
  const makeSheet = (name) => {
    const rows = [];
    const sheet = {
      rows,
      appendRow: (row) => { rows.push(row.slice()); },
      getLastRow: () => rows.length,
      getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }),
    };
    sheets[name] = sheet;
    return sheet;
  };
  const cache = new Map();
  const fixed = new Date(now).getTime();
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  }
  const context = {
    Date: FixedDate,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => sheets[name] || null,
        insertSheet: (name) => makeSheet(name),
      }),
    },
    ContentService: {
      MimeType: { JSON: "JSON", JAVASCRIPT: "JAVASCRIPT" },
      createTextOutput: (text) => {
        const out = { text, mime: null };
        out.setMimeType = (mime) => { out.mime = mime; return out; };
        return out;
      },
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => (cache.has(key) ? cache.get(key) : null),
        put: (key, value) => { cache.set(key, String(value)); },
      }),
    },
    Utilities: {
      // Only the pattern the script needs: the month in the school's time zone.
      formatDate: (date, zone, pattern) => {
        if (zone !== "Europe/Madrid" || pattern !== "yyyy-MM") throw new Error(`unexpected formatDate ${zone} ${pattern}`);
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit" }).formatToParts(date);
        return `${parts.find((p) => p.type === "year").value}-${parts.find((p) => p.type === "month").value}`;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "ranking", "Code.gs"), "utf8"), context);
  const get = (parameter) => context.doGet({ parameter });
  const json = (parameter) => JSON.parse(get(parameter).text);
  const rows = () => (sheets.Ranking ? sheets.Ranking.rows.slice(1) : []);
  return { context, get, json, rows, sheets };
}

const add = (game, fields) => game.json({ action: "add", animal: "Tigre", adjective: "Veloz", grade: "5", points: "1200", ...fields });

function lists() {
  const { context } = load();
  const animals = vm.runInContext("ANIMALS", context), adjectives = vm.runInContext("ADJECTIVES", context);
  check(animals.length >= 12 && new Set(animals).size === animals.length, `S11 the animal list has at least 12 different names (${animals.length})`);
  check(adjectives.length >= 12 && new Set(adjectives).size === adjectives.length, `S11 the adjective list has at least 12 different words (${adjectives.length})`);
  check(animals.includes("Tigre") && adjectives.includes("Veloz"), "S11 the lists include the example «Tigre» + «Veloz»");
}

function saveValid() {
  const game = load();
  const result = add(game, {});
  check(result.ok === true, `S11 a valid score is saved (${JSON.stringify(result)})`);
  const [row] = game.rows();
  check(game.rows().length === 1 && row[1] === "2026-11" && row[2] === 5 && row[3] === "Tigre Veloz" && row[4] === 1200,
    `S11 the row keeps date, month, grade, name and points (${JSON.stringify(row)})`);
  check(game.sheets.Ranking.rows[0].join("|") === "Fecha|Mes|Curso|Nombre|Puntos", "S11 a new sheet gets a header row");
  check(Array.isArray(result.top) && result.top[0]?.name === "Tigre Veloz" && result.top[0]?.points === 1200, "S11 saving answers with the updated top 10 of the grade");
}

function rejectInvalid() {
  const cases = [
    [{ animal: "Juan" }, "a name outside the animal list"],
    [{ adjective: "García" }, "a word outside the adjective list"],
    [{ animal: "tigre" }, "a different capitalisation of a listed animal"],
    [{ grade: "0" }, "grade 0"],
    [{ grade: "7" }, "grade 7"],
    [{ grade: "3a" }, "a grade that is not a whole number"],
    [{ points: "-5" }, "negative points"],
    [{ points: "12.5" }, "points that are not a whole number"],
    [{ points: "100001" }, "impossible points"],
    [{ points: "" }, "missing points"],
  ];
  for (const [fields, label] of cases) {
    const game = load();
    const result = add(game, fields);
    check(result.ok === false && typeof result.error === "string" && game.rows().length === 0, `S11 rejects ${label} and saves nothing (${JSON.stringify(result)})`);
  }
}

function monthlyTop() {
  const game = load("2026-10-20T10:00:00Z");
  add(game, { points: "9999" }); // last month
  const later = load("2026-11-14T10:00:00Z", game.sheets); // same sheet, a new month
  for (let i = 0; i < 12; i++) add(later, { points: String(100 + i * 10) });
  add(later, { grade: "6", points: "5000" });
  const top = later.json({ action: "top", grade: "5" });
  const points = top.top.map((e) => e.points);
  check(top.ok === true && top.month === "2026-11" && top.top.length === 10, `S11 the top shows at most 10 entries of the current month (${top.top.length})`);
  check(!points.includes(9999) && !points.includes(5000), "S11 the top ignores last month and other grades");
  check(points.every((p, i) => i === 0 || points[i - 1] >= p) && points[0] === 210, `S11 the top is sorted from most to fewest points (${points.join(",")})`);
  check(top.top.every((e) => Object.keys(e).sort().join() === "name,points"), "S11 the top shares only the invented name and the points");
}

function callback() {
  const game = load();
  const wrapped = game.get({ action: "top", grade: "5", callback: "ranking_cb1" });
  check(wrapped.mime === "JAVASCRIPT" && /^ranking_cb1\(\{.*\}\);$/.test(wrapped.text), `S11 a safe callback name wraps the answer (${wrapped.text.slice(0, 40)})`);
  const plain = game.get({ action: "top", grade: "5" });
  check(plain.mime === "JSON" && JSON.parse(plain.text).ok === true, "S11 without callback the answer is plain JSON");
  const evil = game.get({ action: "top", grade: "5", callback: "alert(1)//" });
  check(evil.mime === "JSON" && JSON.parse(evil.text).ok === false && !evil.text.includes("alert(1)//("), "S11 an unsafe callback name is refused, never executed");
}

function rateLimit() {
  const game = load();
  let accepted = 0;
  for (let i = 0; i < 31; i++) if (add(game, {}).ok) accepted++;
  check(accepted === 30 && game.rows().length === 30, `S11 at most 30 scores per minute are saved (${accepted})`);
}

function unknownAction() {
  const game = load();
  const result = game.json({ action: "delete" });
  check(result.ok === false && game.rows().length === 0, "S11 an unknown action is refused");
}

lists();
saveValid();
rejectInvalid();
monthlyTop();
callback();
rateLimit();
unknownAction();
console.log(`TOTAL: ${okCount} ok, ${failCount} FAIL`);
process.exit(failCount ? 1 : 0);
