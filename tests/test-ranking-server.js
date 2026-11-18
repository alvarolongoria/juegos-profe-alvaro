// Ranking server (S11): the Google Apps Script in ranking/Code.gs runs here in a
// Node sandbox with fake Google services, through its public doGet entry point.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

let uuidCount = 0;

let okCount = 0, failCount = 0;
function check(condition, label) {
  if (condition) { okCount++; console.log(`ok: ${label}`); }
  else { failCount++; console.error(`FAIL: ${label}`); }
}

// A fresh script with an empty spreadsheet, a fixed clock and fake services.
function load(now = "2026-11-14T10:00:00Z", sheets = {}, properties = { BOT_SECRET: SECRET }) {
  const makeSheet = (name) => {
    const rows = [];
    // Like Google Sheets, a text that looks like a date ("2026-11") becomes a
    // Date cell, unless it starts with an apostrophe, which keeps it as text.
    const cell = (value) => (typeof value !== "string" ? value
      : value.startsWith("'") ? value.slice(1)
      : /^\d{4}-\d{1,2}(-\d{1,2})?$/.test(value) ? new FixedDate(`${value}-01T00:00:00Z`.slice(0, 20)) : value);
    const sheet = {
      rows,
      appendRow: (row) => { rows.push(row.map(cell)); },
      getLastRow: () => rows.length,
      deleteRows: (start, count) => { rows.splice(start - 1, count); },
      getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }),
      // 1-based like Sheets: a block of cells that can be read or written.
      getRange: (row, column, height = 1, width = 1) => ({
        getValue: () => (rows[row - 1] || [])[column - 1] ?? "",
        setValue: (value) => { sheet.getRange(row, column).setValues([[value]]); },
        setValues: (values) => {
          if (values.length !== height || values.some((r) => r.length !== width)) throw new Error("setValues size mismatch");
          values.forEach((r, i) => r.forEach((value, j) => {
            while (rows.length < row + i) rows.push([]);
            rows[row - 1 + i][column - 1 + j] = cell(value);
          }));
        },
      }),
    };
    sheets[name] = sheet;
    return sheet;
  };
  const cache = new Map();
  const events = [];
  const fixed = new Date(now).getTime();
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  }
  const context = {
    Date: FixedDate,
    SpreadsheetApp: {
      flush: () => events.push("flush"),
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
    LockService: { getScriptLock: () => ({ waitLock: () => events.push("lock"), releaseLock: () => events.push("release") }) },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => (cache.has(key) ? cache.get(key) : null),
        put: (key, value) => { cache.set(key, String(value)); },
      }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => (key in properties ? properties[key] : null) }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" },
      getUuid: () => `00000000-0000-4000-8000-${String(++uuidCount).padStart(12, "0")}`,
      computeDigest: (algorithm, text) => {
        if (algorithm !== "SHA_256") throw new Error(`unexpected digest ${algorithm}`);
        return [...crypto.createHash("sha256").update(text, "utf8").digest()].map((byte) => byte > 127 ? byte - 256 : byte);
      },
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
  // The bot talks to the protected actions with a form POST.
  const postRaw = (parameter) => context.doPost({ parameter, postData: { type: "application/x-www-form-urlencoded" } });
  const post = (parameter) => JSON.parse(postRaw(parameter).text);
  const rows = () => (sheets.Ranking ? sheets.Ranking.rows.slice(1) : []);
  const keys = () => post({ action: "keys", secret: SECRET }).keys;
  return { context, get, json, post, postRaw, rows, sheets, keys, events };
}

const SECRET = "test-secret-123456";
// S5: a key a child can remember is a word plus a two-digit number.
const KEY_SHAPE = /^[a-záéíóúüñ]+ [0-9]{2}$/;
const fold = (word) => word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
// By default each score brings the right class key of its own grade.
const add = (game, fields) => {
  const grade = fields.grade ?? "5";
  const key = "key" in fields ? fields.key : (game.keys() || {})[grade] ?? "";
  return game.json({ action: "add", animal: "Tigre", adjective: "Veloz", grade, points: "1200", ...fields, key });
};
const sheetKeys = (game) => (game.sheets.Claves ? game.sheets.Claves.rows.slice(1).map((r) => r.slice()) : []);

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
  check(game.events.join() === "lock,flush,release,lock,flush,flush,release", `S2 every locked write is flushed before the result is read and before the lock is released (${game.events.join()})`);
  check(result.ok === true, `S11 a valid score is saved (${JSON.stringify(result)})`);
  const [row] = game.rows();
  check(game.rows().length === 1 && row[1] === "2026-11" && row[2] === 5 && row[3] === "Tigre Veloz" && row[4] === 1200 && row[5] === 5,
    `S11 the row keeps date, month, grade, name, points and the key's grade (${JSON.stringify(row)})`);
  check(game.sheets.Ranking.rows[0].join("|") === "Fecha|Mes|Curso|Nombre|Puntos|Curso alumno|Nivel|Candado", "S11 a new sheet gets a header row including Candado");
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
    const keys = game.keys();
    const before = allSheets(game);
    const result = add(game, { key: keys[5], ...fields });
    check(result.ok === false && typeof result.error === "string" && !("me" in result)
      && game.rows().length === 0 && allSheets(game) === before, `S11 rejects ${label} without a personal result or sheet writes (${JSON.stringify(result)})`);
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
  check(!JSON.stringify(top).includes(later.keys()[5]), "S3 the public top never reveals a class key");
}

// A month cell that Sheets already turned into a date still counts for its month.
function coercedMonth() {
  const game = load();
  add(game, { points: "300" });
  game.sheets.Ranking.appendRow([new Date(), "2026-11", 5, "Lobo Feliz", 700]); // no apostrophe
  const top = game.json({ action: "top", grade: "5" });
  check(top.top.map((e) => e.name).join() === "Lobo Feliz,Tigre Veloz", `S11 a month stored as a date still shows in its month (${JSON.stringify(top.top)})`);
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

// S3: the bot reads the keys; nobody else can.
function readKeys() {
  const game = load();
  const result = game.post({ action: "keys", secret: SECRET });
  const values = Object.values(result.keys || {});
  check(result.ok === true && result.month === "2026-11" && Object.keys(result.keys || {}).join() === "1,2,3,4,5,6",
    `S3 the bot gets the keys of the six grades and their month (${JSON.stringify(result)})`);
  check(values.length === 6 && new Set(values).size === 6 && values.every((k) => KEY_SHAPE.test(k)),
    `S5 the six keys are different easy words with a number (${values.join(",")})`);
  const words = values.map((k) => k.split(" ")[0]);
  check(new Set(words).size === 6, `S5 no two grades share the same word, even with a different number (${words.join(",")})`);
  const seen = new Set();
  for (let i = 0; i < 40; i++) Object.values(load().keys()).forEach((k) => seen.add(k));
  check([...seen].every((k) => KEY_SHAPE.test(k)) && seen.size > 120,
    `S5 every month mints new word keys, so the space stays large (${seen.size} different in 40 months)`);
  check(sheetKeys(game).map((r) => `${r[0]}|${r[1]}|${r[2]}`).join(";") === values.map((k, i) => `${i + 1}|${k}|2026-11`).join(";")
    && game.sheets.Claves.rows[0].join("|") === "Curso|Clave|Mes", "S3 the keys live in the «Claves» tab of the sheet (Curso|Clave|Mes)");
  check(JSON.stringify(game.post({ action: "keys", secret: SECRET }).keys) === JSON.stringify(result.keys), "S4 the keys stay the same within the month");
  const leaks = (text) => values.some((k) => text.includes(`"${k}"`));
  const cases = [
    ["GET", () => game.get({ action: "keys", secret: SECRET }).text, "a GET request, even with the secret"],
    ["POST", () => game.postRaw({ action: "keys", secret: "wrong" }).text, "a wrong secret"],
    ["POST", () => game.postRaw({ action: "keys" }).text, "no secret"],
    ["POST", () => game.postRaw({ action: "keys", secret: SECRET.slice(0, -1) }).text, "a secret missing its last letter"],
  ];
  for (const [, run, label] of cases) {
    const text = run();
    check(JSON.parse(text).ok === false && !leaks(text), `S3 ${label} is refused without revealing any key`);
  }
  const private_ = load(undefined, {}, {});
  vm.runInContext('var PRIVATE_BOT_SECRET = "private-secret-1234";', private_.context);
  check(private_.post({ action: "keys", secret: "private-secret-1234" }).ok === true && private_.post({ action: "keys", secret: SECRET }).ok === false,
    "S3 without the property, the private file's PRIVATE_BOT_SECRET (pushed only to Google) opens the protected actions");
  const both = load();
  vm.runInContext('var PRIVATE_BOT_SECRET = "private-secret-1234";', both.context);
  check(both.post({ action: "keys", secret: SECRET }).ok === true && both.post({ action: "keys", secret: "private-secret-1234" }).ok === false,
    "S3 the BOT_SECRET property wins over the private file");
  const short = load(undefined, {}, {});
  vm.runInContext('var PRIVATE_BOT_SECRET = "abc";', short.context);
  check(short.post({ action: "keys", secret: "abc" }).ok === false, "S3 a private secret shorter than 16 characters is ignored");
  const unset = load(undefined, {}, {});
  const open = unset.postRaw({ action: "keys", secret: "" }).text;
  check(JSON.parse(open).ok === false && JSON.parse(unset.postRaw({ action: "keys", secret: "null" }).text).ok === false,
    "S3 without the BOT_SECRET property the protected actions are switched off");
  check(game.post({ action: "add", animal: "Tigre", adjective: "Veloz", grade: "5", points: "10", key: values[4] }).ok === false && game.rows().length === 0,
    "S3 POST only serves the protected actions, never saves scores");
}

// S3: the bot (or the teacher by hand) can change one grade's key.
function setKey() {
  const game = load();
  const before = game.keys();
  const result = game.post({ action: "setkey", secret: SECRET, grade: "6", key: " Cométa " });
  check(result.ok === true && result.keys["6"] === "cometa" && sheetKeys(game)[5][1] === "cometa",
    `S3 setkey changes 6º's key, trimmed, lowercase and without accents (${JSON.stringify(result)})`);
  check([1, 2, 3, 4, 5].every((g) => result.keys[g] === before[g]), "S3 setkey leaves the other grades' keys unchanged");
  check(add(game, { grade: "6", key: "cometa" }).ok === true, "S3 the new key works at once");
  check(add(game, { grade: "6", key: before["6"] }).error === "bad key" && game.rows().length === 1, "S3 the replaced key no longer works");
  const refused = [
    [{ grade: "5", key: "cometa" }, "a key already used by another grade"],
    [{ grade: "5", key: "a1" }, "a key with digits or too short"],
    [{ grade: "5", key: "a".repeat(21) }, "a key longer than 20 letters"],
    [{ grade: "7", key: "nieve" }, "grade 7"],
    [{ grade: "5", key: "nieve", secret: "wrong" }, "a wrong secret"],
  ];
  for (const [fields, label] of refused) {
    const snapshot = JSON.stringify(sheetKeys(game));
    const answer = game.post({ action: "setkey", secret: SECRET, ...fields });
    check(answer.ok === false && JSON.stringify(sheetKeys(game)) === snapshot, `S3 setkey refuses ${label} and changes nothing (${JSON.stringify(answer)})`);
  }
  const later = load("2026-11-28T10:00:00Z", game.sheets);
  check(later.keys()["6"] === "cometa", "S4 a key set by hand stays for the rest of the month");
  const handwritten = game.post({ action: "setkey", secret: SECRET, grade: "5", key: "  Tiburón 47 " });
  check(handwritten.ok === true && handwritten.keys["5"] === "tiburon 47" && add(game, { grade: "5", key: "TIBURON 47" }).ok === true,
    `S5 the teacher may hand-write a word with a number, read without capitals or accents (${JSON.stringify(handwritten)})`);
}

// S4: on the first use of a new month every key changes by itself.
function monthlyRotation() {
  const october = load("2026-10-31T21:00:00Z");
  const old = october.keys();
  const november = load("2026-11-01T06:00:00Z", october.sheets);
  const fresh = november.post({ action: "keys", secret: SECRET });
  const values = Object.values(fresh.keys);
  check(fresh.month === "2026-11" && [1, 2, 3, 4, 5, 6].every((g) => fresh.keys[g] !== old[g]) && values.every((k) => !Object.values(old).includes(k)),
    `S4 on day 1 all six keys change and none repeats last month's (${JSON.stringify(old)} -> ${JSON.stringify(fresh.keys)})`);
  check(new Set(values).size === 6 && sheetKeys(november).every((r) => r[2] === "2026-11"), "S4 the new keys are distinct and stamped with the new month");
  check(add(november, { grade: "5", key: old["5"] }).error === "bad key" && add(november, { grade: "5" }).ok === true,
    "S4 last month's key stops working and the new one works");
  const viaGame = load("2026-12-01T09:00:00Z", october.sheets);
  add(viaGame, { grade: "5", key: "x" });
  check(sheetKeys(viaGame).every((r) => r[2] === "2026-12"), "S4 the rotation also happens when the first request of the month comes from the game");
}

// S1-S2: the key decides who may enter which ranking.
function keyRules() {
  const missing = load();
  const noKey = missing.json({ action: "add", animal: "Tigre", adjective: "Veloz", grade: "5", points: "1200" });
  check(noKey.ok === false && noKey.error === "bad key" && missing.rows().length === 0, `S2 a score without key is refused and nothing is saved (${JSON.stringify(noKey)})`);
  const wrong = load();
  const bad = add(wrong, { key: "patata" });
  check(bad.ok === false && bad.error === "bad key" && wrong.rows().length === 0 && !JSON.stringify(bad).includes(wrong.keys()["5"]),
    `S2 a wrong key is refused, saves nothing and reveals no key (${JSON.stringify(bad)})`);
  const flood = load();
  const keys = flood.keys();
  const sixth = add(flood, { grade: "1", key: keys["6"] });
  check(sixth.ok === false && sixth.error === "wrong grade" && sixth.keyGrade === 6 && flood.rows().length === 0,
    `S2 6º's key cannot enter 1º's ranking (${JSON.stringify(sixth)})`);
  check(flood.json({ action: "top", grade: "1" }).top.length === 0, "S2 1º's ranking stays empty after the refused attempt");
  const young = add(flood, { grade: "2", key: keys["1"], animal: "Panda", points: "900" });
  const [row] = flood.rows();
  check(young.ok === true && row[2] === 2 && row[5] === 1, `S1 a 1º child who wins 2º is saved in 2º with real grade 1 (${JSON.stringify(row)})`);
  add(flood, { grade: "2", key: keys["2"], animal: "Lobo", points: "800" });
  const top = flood.json({ action: "top", grade: "2" }).top;
  check(JSON.stringify(top) === JSON.stringify([{ name: "Panda Veloz", points: 900, from: 1 }, { name: "Lobo Veloz", points: 800 }]),
    `S1 the top marks only entries from a younger grade with «from» (${JSON.stringify(top)})`);
  const typed = load();
  const setSol = typed.post({ action: "setkey", secret: SECRET, grade: "3", key: "sol" });
  check(setSol.ok === true && add(typed, { grade: "3", key: "  SÓL " }).ok === true, "S2 the child's key is read trimmed, without caring about capitals or accents");
  const brake = load();
  let refused = 0;
  for (let i = 0; i < 30; i++) if (add(brake, { key: `mal${"abcdefghijklmnopqrstuvwxyz"[i % 26]}` }).error === "bad key") refused++;
  check(refused === 30 && add(brake, {}).error === "too many" && brake.rows().length === 0, "S2 wrong keys count towards the per-minute brake, so guessing is slow");
}

// S2-S3: the teacher may edit «Claves» by hand; a broken tab never lets a key cross grades.
function handEdits() {
  const tabOf = (game) => game.sheets.Claves.rows;
  const setRow = (game, grade, key) => { tabOf(game)[tabOf(game).findIndex((r) => r[0] === grade)] = [grade, key, "2026-11"]; };

  const dup = load();
  const before = dup.keys();
  setRow(dup, 1, "lupa");
  setRow(dup, 6, "lupa");
  const after = dup.keys();
  check(after[1] !== "lupa" && after[6] !== "lupa" && after[1] !== after[6] && [2, 3, 4, 5].every((g) => after[g] === before[g]),
    `S2 a key repeated in two grades is replaced in both and the rest stay (${JSON.stringify(after)})`);
  check(add(dup, { grade: "1", key: "lupa" }).error === "bad key" && dup.rows().length === 0, "S2 the repeated key no longer lets anyone in");

  const hidden = load();
  const kept1 = hidden.keys();
  setRow(hidden, 1, "lupa");
  setRow(hidden, 6, "lupa");
  hidden.sheets.Claves.rows.push([6, "nubo", "2026-11"]); // a second 6º row hides the first
  const reset = hidden.keys();
  check(reset[1] !== "lupa" && reset[6] !== "lupa" && reset[6] !== "nubo" && [2, 3, 4, 5].every((g) => reset[g] === kept1[g])
    && add(hidden, { grade: "1", key: "lupa" }).error === "bad key",
    `S2 a key shared with any row of another grade is replaced, even behind a repeated grade (${JSON.stringify(reset)})`);

  const reordered = load();
  const kept = reordered.keys();
  const header = tabOf(reordered)[0];
  reordered.sheets.Claves.rows.splice(0, 7, header, ...tabOf(reordered).slice(1).reverse());
  check(JSON.stringify(reordered.keys()) === JSON.stringify(kept), "S3 rows in another order keep every grade's key");

  const missing = load();
  const old = missing.keys();
  missing.sheets.Claves.rows.splice(3, 1); // the teacher deletes 3º's row
  const fixed = missing.keys();
  check(fixed[3] && fixed[3] !== old[3] && [1, 2, 4, 5, 6].every((g) => fixed[g] === old[g])
    && tabOf(missing).slice(1).map((r) => r[0]).join() === "1,2,3,4,5,6",
    `S3 a deleted row gets a new key only for its grade and the tab is tidy again (${JSON.stringify(fixed)})`);

  const accented = load();
  const plain = accented.keys();
  setRow(accented, 4, "Tiburón 47");
  const keptAccent = accented.keys();
  check(keptAccent[4] === "Tiburón 47" && [1, 2, 3, 5, 6].every((g) => keptAccent[g] === plain[g])
    && add(accented, { grade: "4", key: "  TIBURON  47 " }).ok === true,
    `S5 a key written with an accent is kept as written and read without accents or extra spaces (${keptAccent[4]})`);
  check(add(accented, { grade: "4", key: "Tiburón47" }).ok === true && add(accented, { grade: "4", key: "TIBURON47" }).ok === true
    && add(accented, { grade: "4", key: "tiburon48" }).ok === false,
    "S5 a key typed without the space between word and number is read the same, a wrong number still fails");

  const junk = load();
  const same = junk.keys();
  setRow(junk, 2, "a1");
  junk.sheets.Claves.rows.push([9, "mesa", "2026-11"], ["", "nota de la profe", ""]);
  const cleaned = junk.keys();
  check(cleaned[2] !== "a1" && KEY_SHAPE.test(cleaned[2]) && [1, 3, 4, 5, 6].every((g) => cleaned[g] === same[g])
    && tabOf(junk).length === 7 && add(junk, { grade: "6", key: "mesa" }).error === "bad key",
    `S3 an invalid key is replaced and extra rows are removed and never accepted (${tabOf(junk).length} rows)`);
}

// S5: the keys come from a curated pool of words a child can remember.
function keyPool() {
  const context = load().context;
  const pool = context.KEY_WORDS || [];
  const blocked = context.BLOCKED_KEYS || [];
  check(Array.isArray(pool) && pool.length >= 300, `S5 the word pool is large enough to keep guessing slow (${pool && pool.length} words)`);
  check(pool.every((w) => /^[a-záéíóúüñ]+$/.test(w) && w.length >= 3 && w.length <= 20),
    `S5 every pool word is plain letters, 3 to 20 of them (${pool.filter((w) => !/^[a-záéíóúüñ]+$/.test(w)).join(",")})`);
  check(new Set(pool.map(fold)).size === pool.length, "S5 no two pool words read the same once accents are ignored");
  check(pool.every((w) => blocked.indexOf(w) < 0), `S5 the pool never holds a blocked word (${pool.filter((w) => blocked.indexOf(w) >= 0).join(",")})`);
  const minted = new Set();
  for (let i = 0; i < 20; i++) Object.values(load().keys()).forEach((k) => minted.add(k.split(" ")[0]));
  check([...minted].every((w) => pool.indexOf(w) >= 0), `S5 every minted word comes from the pool (${[...minted].filter((w) => pool.indexOf(w) < 0).join(",")})`);
  check(pool.length * 90 >= 20000, `S5 words plus a two-digit number give ${pool.length * 90} combinations instead of 5,625 meaningless syllables`);
}

// S5/D8: the teacher can mint a fresh set of keys without waiting for day 1.
function rotate() {
  const game = load();
  const before = game.keys();
  const snapshot = JSON.stringify(sheetKeys(game));
  const refused = JSON.parse(game.postRaw({ action: "rotate", secret: "wrong" }).text);
  check(refused.ok === false && JSON.stringify(sheetKeys(game)) === snapshot, "S5 rotate needs the bot secret and changes nothing without it");
  const result = game.post({ action: "rotate", secret: SECRET });
  const values = Object.values(result.keys || {});
  check(result.ok === true && result.month === "2026-11" && values.length === 6 && values.every((k) => KEY_SHAPE.test(k))
    && new Set(values).size === 6 && values.every((k) => !Object.values(before).includes(k)),
    `S5 rotate mints six new word keys for the same month (${JSON.stringify(before)} -> ${JSON.stringify(result.keys)})`);
  check(JSON.stringify(sheetKeys(game).map((r) => `${r[0]}|${r[1]}|${r[2]}`)) === JSON.stringify(values.map((k, i) => `${i + 1}|${k}|2026-11`)),
    "S5 rotate writes the new keys to the «Claves» tab of the current month");
  check(add(game, { grade: "4", key: before["4"] }).error === "bad key" && add(game, { grade: "4", key: result.keys["4"] }).ok === true,
    "S5 after rotating, the old key is dead and the new one works at once");
  check(JSON.stringify(game.keys()) === JSON.stringify(result.keys), "S5 the rotated keys stay for the rest of the month");
}

// S5: a «Claves» tab full of hand edits still answers and never hangs.
function crowdedTab() {
  const pool = load().context.KEY_WORDS;
  const withRows = (words) => {
    const game = load();
    game.keys(); // creates the tab and its header row
    const tab = game.sheets.Claves;
    tab.rows.splice(1);
    words.forEach((w, i) => tab.appendRow([i < 6 ? i + 1 : "", `${w} 10`, i < 6 ? "2026-10" : "2026-11"]));
    return game;
  };
  const used = pool.slice(0, pool.length - 6);
  const room = withRows(used);
  const fresh = room.keys();
  const values = Object.values(fresh);
  check(values.length === 6 && values.every((k) => KEY_SHAPE.test(k)) && new Set(values).size === 6
    && values.every((k) => used.indexOf(k.split(" ")[0]) < 0),
    `S5 with the tab nearly full of hand-written words, six fresh ones still come out (${values.join(",")})`);
  const full = withRows(pool);
  const answer = JSON.parse(full.postRaw({ action: "keys", secret: SECRET }).text);
  check(answer.ok === false && answer.error === "server error",
    `S5 a tab that already holds every pool word answers with an error instead of hanging (${JSON.stringify(answer)})`);
}

// Sheets created before the key keep working and gain the new column title.
function oldSheet() {
  const sheets = {};
  const legacy = load(undefined, sheets);
  legacy.context.SpreadsheetApp.getActiveSpreadsheet().insertSheet("Ranking");
  sheets.Ranking.appendRow(["Fecha", "Mes", "Curso", "Nombre", "Puntos"]);
  sheets.Ranking.appendRow([new Date(), "'2026-11", 5, "Lobo Feliz", 700]);
  const result = add(legacy, {});
  check(result.ok === true && sheets.Ranking.rows[0].join("|") === "Fecha|Mes|Curso|Nombre|Puntos|Curso alumno|Nivel|Candado",
    `S1 an existing sheet gets the «Curso alumno», «Nivel» and «Candado» titles (${sheets.Ranking.rows[0].join("|")})`);
  check(JSON.stringify(result.top) === JSON.stringify([{ name: "Tigre Veloz", points: 1200 }, { name: "Lobo Feliz", points: 700 }]),
    "S1 old rows without a real grade still show in the top");
}

// S6: only 3º may also enter after level 3; a level-4 finish always ranks above a level-3 one.
function levelThree() {
  const game = load();
  const three = (fields) => add(game, { grade: "3", ...fields });
  check(three({ level: "3", points: "900", animal: "Lince", adjective: "Feliz" }).ok === true
    && game.rows()[0][6] === 3, "S6 a level-3 score is saved in 3º with its level");
  check(add(game, { grade: "5", level: "3" }).ok === false && add(game, { grade: "2", level: "3" }).ok === false
    && three({ level: "2" }).ok === false && three({ level: "x" }).ok === false && game.rows().length === 1,
    "S6 level 3 is refused outside 3º and any other level is refused, saving nothing");
  const finished = three({ points: "300", animal: "Lobo", adjective: "Leal" });
  check(finished.ok === true && game.rows()[1][6] === 4, "S6 a score without a level counts as a level-4 finish (old pages keep working)");
  three({ level: "3", points: "5000", animal: "Panda", adjective: "Fuerte" });
  const top = game.json({ action: "top", grade: "3" }).top;
  check(JSON.stringify(top) === JSON.stringify([
    { name: "Lobo Leal", points: 300 },
    { name: "Panda Fuerte", points: 5000, level: 3 },
    { name: "Lince Feliz", points: 900, level: 3 },
  ]), `S6 level 4 ranks above level 3 whatever the points, then by points (${JSON.stringify(top)})`);
  const old = load(undefined, game.sheets);
  game.sheets.Ranking.appendRow([new Date(), "'2026-11", 3, "Zorro Ágil", 100, 3]); // no level cell: written by the old script
  check(JSON.stringify(old.json({ action: "top", grade: "3" }).top[1]) === JSON.stringify({ name: "Zorro Ágil", points: 100 }),
    "S6 an old row without a level counts as level 4");
}

// S2, S3, S5: a lock belongs to a name only for this grade and month.
const hashLock = (salt, lock) => crypto.createHash("sha256").update(`${salt}:${lock}`, "utf8").digest("hex");
const snapshot = (game) => JSON.stringify(game.sheets.Ranking?.rows || []);
const allSheets = (game) => JSON.stringify(Object.keys(game.sheets).sort().map((name) => [name, game.sheets[name].rows]));
const validHash = (value, lock) => {
  const [salt, hash] = String(value || "").split(":");
  return /^[0-9a-f-]{36}$/.test(salt || "") && hash === hashLock(salt, lock);
};
const expectedAdd = (grade, month, top, me) => ({ ok: true, grade, month, top, ...(me ? { me } : {}) });
const expectedMe = (name, points, position, total, level) => ({ name, points, position, total, ...(level === 3 ? { level: 3 } : {}) });
const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const noLockLeak = (value, locks) => {
  const text = JSON.stringify(value);
  return locks.every((lock) => !text.includes(lock)) && !/[🍎⭐🐶🚀⚽🌈🍕🐱🎈🌙🍦🦋]/u.test(text);
};

function lockedBest() {
  const game = load();
  const lock = "3,0,7";
  const first = add(game, { grade: "3", level: "3", points: "900", lock });
  const firstTop = [{ name: "Tigre Veloz", points: 900, level: 3 }];
  const row = game.rows()[0] || [];
  const [salt, digest] = String(row[7] || "").split(":");
  check(same(first, expectedAdd(3, "2026-11", firstTop, expectedMe("Tigre Veloz", 900, 1, 1, 3))) && game.rows().length === 1
    && row[0] instanceof Date && same(row.slice(1, 7), ["2026-11", 3, "Tigre Veloz", 900, 3, 3])
    && /^[0-9a-f-]{36}$/.test(salt || "") && digest === hashLock(salt, lock)
    && noLockLeak(game.sheets.Ranking.rows, [lock]) && noLockLeak(first, [lock, salt, digest]),
    "S2/S3/S5 first locked add returns its top and stores only a salted SHA-256 in the eighth column");
  if (!row[7]) return;

  for (const points of ["800", "900"]) {
    const before = snapshot(game);
    const result = add(game, { grade: "3", level: "3", points, lock });
    check(same(result, expectedAdd(3, "2026-11", firstTop, expectedMe("Tigre Veloz", 900, 1, 1, 3))) && snapshot(game) === before && game.rows().length === 1,
      `S5 same lock with ${points} points keeps the better/equal level-3 row unchanged`);
  }
  const key2 = game.keys()[2];
  const improved = add(game, { grade: "3", key: key2, level: "3", points: "1000", lock });
  const top3 = [{ name: "Tigre Veloz", points: 1000, level: 3, from: 2 }];
  check(same(improved, expectedAdd(3, "2026-11", top3, expectedMe("Tigre Veloz", 1000, 1, 1, 3))) && game.rows().length === 1
    && same(game.rows()[0].slice(1), ["2026-11", 3, "Tigre Veloz", 1000, 2, 3, `${salt}:${digest}`]),
    "S5 same lock improves level-3 points and keeps the associated pupil grade in the same row");
  const finished = add(game, { grade: "3", level: "4", points: "20", lock });
  const top4 = [{ name: "Tigre Veloz", points: 20 }];
  check(same(finished, expectedAdd(3, "2026-11", top4, expectedMe("Tigre Veloz", 20, 1, 1))) && game.rows().length === 1
    && same(game.rows()[0].slice(1), ["2026-11", 3, "Tigre Veloz", 20, 3, 4, `${salt}:${digest}`]),
    "S5 level 4 replaces level 3 even with fewer points, preserving the lock");
  for (const fields of [{ level: "3", points: "99999" }, { level: "4", points: "20" }, { level: "4", points: "10" }]) {
    const before = snapshot(game);
    const result = add(game, { grade: "3", ...fields, lock });
    check(same(result, expectedAdd(3, "2026-11", top4, expectedMe("Tigre Veloz", 20, 1, 1))) && snapshot(game) === before && game.rows().length === 1,
      `S5 same lock keeps level 4 over level ${fields.level} with ${fields.points} points`);
  }
  const later = load("2026-11-14T11:00:00Z", game.sheets);
  const better = add(later, { grade: "3", level: "4", points: "21", lock });
  check(same(better, expectedAdd(3, "2026-11", [{ name: "Tigre Veloz", points: 21 }], expectedMe("Tigre Veloz", 21, 1, 1)))
    && later.rows().length === 1 && later.rows()[0][0].toISOString() === "2026-11-14T11:00:00.000Z"
    && same(later.rows()[0].slice(1), ["2026-11", 3, "Tigre Veloz", 21, 3, 4, `${salt}:${digest}`])
    && noLockLeak(later.sheets.Ranking.rows, [lock]), "S5 a better level-4 score replaces the result and date in the same row");
  const before = snapshot(later);
  const refused = add(later, { grade: "3", lock: "7,0,3" });
  check(same(refused, { ok: false, error: "name taken" }) && snapshot(later) === before && later.rows().length === 1,
    "S2/S5 a different lock, including the same emojis in another order, is refused without writes");
  const top = later.json({ action: "top", grade: "3" });
  check(same(top, expectedAdd(3, "2026-11", [{ name: "Tigre Veloz", points: 21 }]))
    && noLockLeak(top, [lock, salt, digest]), "S5 public top never exposes the lock, salt or digest");
}

function lockedScopesAndLegacy() {
  const game = load();
  game.context.SpreadsheetApp.getActiveSpreadsheet().insertSheet("Ranking");
  game.sheets.Ranking.appendRow(["Fecha", "Mes", "Curso", "Nombre", "Puntos", "Curso alumno", "Nivel"]);
  game.sheets.Ranking.appendRow([new Date(), "'2026-11", 5, "Tigre Veloz", 300, 5, 4]);
  const legacy = snapshot(game);
  const lock = "0,0,11";
  const added = add(game, { lock, points: "400" });
  let rows = game.rows();
  check(same(added, expectedAdd(5, "2026-11", [{ name: "Tigre Veloz", points: 400 }, { name: "Tigre Veloz", points: 300 }], expectedMe("Tigre Veloz", 400, 1, 2)))
    && rows.length === 2 && same(rows[0].slice(1), ["2026-11", 5, "Tigre Veloz", 300, 5, 4])
    && same(rows[1].slice(1, 7), ["2026-11", 5, "Tigre Veloz", 400, 5, 4])
    && validHash(rows[1][7], lock) && snapshot(game) !== legacy && game.sheets.Ranking.rows[0][7] === "Candado"
    && noLockLeak(game.sheets.Ranking.rows, [lock]), "S3/S5 an old unlocked row stays unowned; a locked add appends and upgrades its header");
  if (!rows[1] || !rows[1][7]) return;
  const originalHash = rows[1][7];
  const stale = add(game, { points: "500" });
  rows = game.rows();
  check(same(stale, expectedAdd(5, "2026-11", [
    { name: "Tigre Veloz", points: 500 }, { name: "Tigre Veloz", points: 400 }, { name: "Tigre Veloz", points: 300 },
  ], expectedMe("Tigre Veloz", 500, 1, 3))) && rows.length === 3 && same(rows[2].slice(1, 7), ["2026-11", 5, "Tigre Veloz", 500, 5, 4]) && !rows[2][7],
    "S5 a stale page with no lock still appends an unlocked row even after the name is claimed");
  const update = add(game, { points: "600", lock });
  rows = game.rows();
  check(same(update, expectedAdd(5, "2026-11", [
    { name: "Tigre Veloz", points: 600 }, { name: "Tigre Veloz", points: 500 }, { name: "Tigre Veloz", points: 300 },
  ], expectedMe("Tigre Veloz", 600, 1, 3))) && rows.length === 3 && rows[0][4] === 300 && rows[1][4] === 600 && rows[1][7] === originalHash && rows[2][4] === 500,
    "S5 a returning owner updates only its locked row when old and stale duplicates exist");
  const before = allSheets(game);
  const refused = add(game, { lock: "0,11,0" });
  check(same(refused, { ok: false, error: "name taken" }) && allSheets(game) === before && game.rows().length === 3,
    "S5 unlocked duplicates cannot bypass an existing lock or change any sheet");

  const otherGrade = add(game, { grade: "6", points: "700", lock });
  rows = game.rows();
  check(same(otherGrade, expectedAdd(6, "2026-11", [{ name: "Tigre Veloz", points: 700 }], expectedMe("Tigre Veloz", 700, 1, 1))) && rows.length === 4
    && same(rows[3].slice(1, 7), ["2026-11", 6, "Tigre Veloz", 700, 6, 4])
    && validHash(rows[3][7], lock) && rows[3][7] !== originalHash,
    "S3/S5 the same name and lock in another grade gets its own independently salted row");
  const nextMonth = load("2026-12-01T10:00:00Z", game.sheets);
  const december = add(nextMonth, { points: "800", lock });
  rows = nextMonth.rows();
  check(same(december, expectedAdd(5, "2026-12", [{ name: "Tigre Veloz", points: 800 }], expectedMe("Tigre Veloz", 800, 1, 1))) && rows.length === 5
    && same(rows[4].slice(1, 7), ["2026-12", 5, "Tigre Veloz", 800, 5, 4])
    && validHash(rows[4][7], lock) && new Set([originalHash, rows[3][7], rows[4][7]]).size === 3
    && noLockLeak(nextMonth.sheets.Ranking.rows, [lock]),
    "S3/S5 the next month starts a fresh reservation with a different per-row salt");
  const top = nextMonth.json({ action: "top", grade: "5" });
  check(same(top, expectedAdd(5, "2026-12", [{ name: "Tigre Veloz", points: 800 }])) && noLockLeak(top, [lock, rows[4][7]]),
    "S5 current-month top ignores old duplicates and never exposes lock data");
}

function differentNames() {
  const game = load();
  const lock = "1,2,3", otherLock = "3,2,1";
  const first = add(game, { points: "500", lock });
  const second = add(game, { animal: "Panda", points: "200", lock });
  const third = add(game, { adjective: "Feliz", points: "100", lock: otherLock });
  const top = [{ name: "Tigre Veloz", points: 500 }, { name: "Panda Veloz", points: 200 }, { name: "Tigre Feliz", points: 100 }];
  const rows = game.rows();
  check(same(first, expectedAdd(5, "2026-11", top.slice(0, 1), expectedMe("Tigre Veloz", 500, 1, 1)))
    && same(second, expectedAdd(5, "2026-11", top.slice(0, 2), expectedMe("Panda Veloz", 200, 2, 2)))
    && same(third, expectedAdd(5, "2026-11", top, expectedMe("Tigre Feliz", 100, 3, 3))) && rows.length === 3
    && same(rows.map((row) => row.slice(1, 7)), [
      ["2026-11", 5, "Tigre Veloz", 500, 5, 4], ["2026-11", 5, "Panda Veloz", 200, 5, 4], ["2026-11", 5, "Tigre Feliz", 100, 5, 4],
    ]) && validHash(rows[0][7], lock) && validHash(rows[1][7], lock) && validHash(rows[2][7], otherLock)
    && new Set(rows.map((row) => row[7])).size === 3 && noLockLeak(game.sheets.Ranking.rows, [lock, otherLock]),
    "S5 a different animal or adjective is a separate name with its own salted row");
  const before = allSheets(game);
  const refused = add(game, { animal: "Panda", lock: otherLock });
  check(same(refused, { ok: false, error: "name taken" }) && allSheets(game) === before && game.rows().length === 3,
    "S5 another name's lock cannot unlock this name and changes no sheet");
  const improved = add(game, { animal: "Panda", points: "600", lock });
  check(same(improved, expectedAdd(5, "2026-11", [
    { name: "Panda Veloz", points: 600 }, { name: "Tigre Veloz", points: 500 }, { name: "Tigre Feliz", points: 100 },
  ], expectedMe("Panda Veloz", 600, 1, 3)))
    && game.rows().length === 3 && same(game.rows().map((row) => row[4]), [500, 600, 100])
    && game.rows()[1][7] === rows[1][7] && noLockLeak(improved, [lock, otherLock]),
    "S5 a matching lock updates only its own name and public results omit the lock");
}

function dateCellsAndForgottenLock() {
  const game = load();
  const lock = "11,4,0";
  const first = add(game, { lock, points: "300" });
  const firstRow = game.rows()[0] || [];
  check(same(first, expectedAdd(5, "2026-11", [{ name: "Tigre Veloz", points: 300 }], expectedMe("Tigre Veloz", 300, 1, 1)))
    && game.rows().length === 1 && same(firstRow.slice(1, 7), ["2026-11", 5, "Tigre Veloz", 300, 5, 4])
    && validHash(firstRow[7], lock) && noLockLeak(game.sheets.Ranking.rows, [lock]),
    "S3/S5 a new reservation stores the expected row and a real salted hash");
  if (!firstRow[7]) return;
  const previousHash = firstRow[7];
  game.sheets.Ranking.rows[1][1] = new game.context.Date("2026-11-01T00:00:00Z");
  const before = allSheets(game);
  const refused = add(game, { lock: "0,4,11" });
  check(same(refused, { ok: false, error: "name taken" }) && allSheets(game) === before && game.rows().length === 1,
    "S5 a locked row with an old date-form month still protects its name without writes");
  const updated = add(game, { lock, points: "400" });
  check(same(updated, expectedAdd(5, "2026-11", [{ name: "Tigre Veloz", points: 400 }], expectedMe("Tigre Veloz", 400, 1, 1))) && game.rows().length === 1
    && same(game.rows()[0].slice(1), ["2026-11", 5, "Tigre Veloz", 400, 5, 4, previousHash]),
    "S5 a correct lock updates a row whose month had been converted to a date");
  game.sheets.Ranking.deleteRows(2, 1); // the teacher deletes the row after a forgotten lock
  const replacement = add(game, { lock: "0,4,11", points: "200" });
  const row = game.rows()[0] || [];
  check(same(replacement, expectedAdd(5, "2026-11", [{ name: "Tigre Veloz", points: 200 }], expectedMe("Tigre Veloz", 200, 1, 1))) && game.rows().length === 1
    && same(row.slice(1, 7), ["2026-11", 5, "Tigre Veloz", 200, 5, 4]) && validHash(row[7], "0,4,11")
    && row[7] !== previousHash && noLockLeak(game.sheets.Ranking.rows, [lock, "0,4,11"]),
    "S3 deleting a forgotten lock's row frees the name for a new lock with a fresh salt");
}

// S1: identify the exact written row, including ties and old unlocked duplicates.
function ownPosition() {
  const game = load();
  const keys = game.keys();
  const tab = game.context.SpreadsheetApp.getActiveSpreadsheet().insertSheet("Ranking");
  tab.appendRow(["Fecha", "Mes", "Curso", "Nombre", "Puntos", "Curso alumno", "Nivel", "Candado"]);
  for (const row of [
    ["'2026-11", 3, "Lobo Leal", 300, 3, 4],
    ["'2026-11", 3, "Tigre Veloz", 200, 3, 4],
    ["'2026-11", 3, "Panda Veloz", 200, 3, 4],
    ["'2026-11", 3, "León Feliz", 90000, 3, 3],
    ["'2026-10", 3, "Lince Feliz", 99999, 3, 4],
    ["'2026-11", 4, "Zorro Ágil", 99999, 4, 4],
  ]) tab.appendRow([new Date(), ...row]);
  const original = JSON.stringify(tab.rows);
  const reads = [];
  const getDataRange = tab.getDataRange;
  tab.getDataRange = () => {
    reads.push({ locked: game.events.lastIndexOf("lock") > game.events.lastIndexOf("release"), lastEvent: game.events.at(-1) });
    return getDataRange();
  };
  const lock = "1,2,3";
  const first = add(game, { grade: "3", key: keys[2], points: "200", lock });
  const top = [
    { name: "Lobo Leal", points: 300 },
    { name: "Tigre Veloz", points: 200 },
    { name: "Panda Veloz", points: 200 },
    { name: "Tigre Veloz", points: 200, from: 2 },
    { name: "León Feliz", points: 90000, level: 3 },
  ];
  const ownHash = game.rows().at(-1)[7];
  check(same(first, expectedAdd(3, "2026-11", top, expectedMe("Tigre Veloz", 200, 4, 5)))
    && JSON.stringify(tab.rows.slice(0, -1)) === original && validHash(ownHash, lock)
    && noLockLeak(first, [lock, ...ownHash.split(":")]),
    "S1 a locked row's exact position respects stable ties, level order, month and grade without exposing private fields");
  check(reads.length === 2 && reads.every((read) => read.locked) && reads[1].lastEvent === "flush",
    "S1 the stored row and ordered result are read after flushing while the write lock is held");
  const before = allSheets(game);
  const lower = add(game, { grade: "3", key: keys[3], points: "100", lock });
  check(same(lower, expectedAdd(3, "2026-11", top, expectedMe("Tigre Veloz", 200, 4, 5))) && allSheets(game) === before,
    "S1 a lower run returns the stored best and its position without changing either sheet");

  const third = add(game, { grade: "3", key: keys[3], animal: "Águila", adjective: "Feliz", level: "3", points: "90000", lock: "4,5,6" });
  const topThird = [...top, { name: "Águila Feliz", points: 90000, level: 3 }];
  check(same(third, expectedAdd(3, "2026-11", topThird, expectedMe("Águila Feliz", 90000, 6, 6, 3))),
    "S1 a tied level-3 result follows every level-4 result and includes only its own level");
  const beforeThird = allSheets(game);
  const lowerThird = add(game, { grade: "3", key: keys[3], animal: "Águila", adjective: "Feliz", level: "3", points: "80000", lock: "4,5,6" });
  check(same(lowerThird, expectedAdd(3, "2026-11", topThird, expectedMe("Águila Feliz", 90000, 6, 6, 3))) && allSheets(game) === beforeThird,
    "S1 a lower level-3 run keeps its stored level-3 best and position without writes");
  const fourth = add(game, { grade: "3", key: keys[3], animal: "Águila", adjective: "Feliz", points: "10", lock: "4,5,6" });
  const topFourth = [...top.slice(0, 4), { name: "Águila Feliz", points: 10 }, top[4]];
  check(same(fourth, expectedAdd(3, "2026-11", topFourth, expectedMe("Águila Feliz", 10, 5, 6))),
    "S1 finishing level 4 moves the pupil ahead of level 3 even with fewer points");

  const stale = add(game, { grade: "3", key: keys[3], points: "200" });
  const topStale = [...top.slice(0, 4), { name: "Tigre Veloz", points: 200 }, ...topFourth.slice(4)];
  check(same(stale, expectedAdd(3, "2026-11", topStale, expectedMe("Tigre Veloz", 200, 5, 7)))
    && !game.rows().at(-1)[7] && game.rows().find((row) => row[7] === ownHash)[4] === 200,
    "S1 a stale unlocked add identifies its newly appended row, not an equal-score namesake");
  check(same(game.json({ action: "top", grade: "3" }), expectedAdd(3, "2026-11", topStale)),
    "S1 the public top action remains unchanged and has no personal result");
}

function ownPositionOutsideTop() {
  const game = load();
  const keys = game.keys();
  const tab = game.context.SpreadsheetApp.getActiveSpreadsheet().insertSheet("Ranking");
  tab.appendRow(["Fecha", "Mes", "Curso", "Nombre", "Puntos", "Curso alumno", "Nivel", "Candado"]);
  const leaders = Array.from({ length: 16 }, (_, i) => ({ name: `Piloto ${i + 1}`, points: 2000 - i * 10 }));
  for (const entry of leaders) tab.appendRow([new Date(), "'2026-11", 3, entry.name, entry.points, 3, 4, ""]);
  tab.appendRow([new Date(), "'2026-10", 3, "Other month", 99999, 3, 4, ""]);
  tab.appendRow([new Date(), "'2026-11", 4, "Other grade", 99999, 4, 4, ""]);
  const result = add(game, { grade: "3", key: keys[3], points: "1450", lock: "3,0,7" });
  check(same(result, expectedAdd(3, "2026-11", leaders.slice(0, 10), expectedMe("Tigre Veloz", 1450, 17, 17)))
    && game.rows().length === 19 && !result.top.some((entry) => entry.name === "Tigre Veloz"),
    "S1 a pupil outside the top ten receives position 17 and the full current-grade monthly total");
  check(same(game.json({ action: "top", grade: "3" }), expectedAdd(3, "2026-11", leaders.slice(0, 10))),
    "S1 the top action still returns only ten public entries and no personal result");
}

function lockRejections() {
  const empty = load();
  const noSheet = allSheets(empty);
  const invalid = empty.json({ action: "add", animal: "Tigre", adjective: "Veloz", grade: "5", points: "1", key: "sol", lock: "1,2" });
  check(same(invalid, { ok: false, error: "bad lock" }) && allSheets(empty) === noSheet,
    "S5 a malformed lock cannot even create a sheet on a fresh spreadsheet");
  const game = load();
  const keys = game.keys();
  add(game, { key: keys[5], lock: "1,2,3" });
  const before = allSheets(game);
  for (const lock of ["", "1,2", "1,2,3,4", "12,0,1", "-1,0,1", "1.5,2,3", "1,,3", "1,2,x", "🍎,⭐,🐶", "01,2,3", "1,02,3", "00,1,2", " 1,2,3", "1,2,3\n", null, 123]) {
    const result = add(game, { key: keys[5], lock });
    check(same(result, { ok: false, error: "bad lock" }) && allSheets(game) === before && game.rows().length === 1,
      `S5 malformed lock ${JSON.stringify(lock)} is rejected without changing any sheet`);
  }
  const wrongKey = add(game, { key: "patata", lock: "1,2,3", points: "9999" });
  check(same(wrongKey, { ok: false, error: "bad key" }) && allSheets(game) === before && game.rows().length === 1,
    "S5 even the right lock cannot update a row without the class key");
  const wrongGrade = add(game, { grade: "5", key: keys[6], lock: "1,2,3", points: "9999" });
  check(same(wrongGrade, { ok: false, error: "wrong grade", keyGrade: 6 }) && allSheets(game) === before,
    "S5 even the right lock cannot bypass the class-key grade check");
  const brake = load();
  const key = brake.keys()[5];
  add(brake, { key, lock: "1,2,3" });
  const locked = allSheets(brake);
  let taken = 0;
  for (let i = 0; i < 29; i++) if (same(add(brake, { key, lock: "3,2,1" }), { ok: false, error: "name taken" })) taken++;
  check(taken === 29 && same(add(brake, { key, lock: "1,2,3" }), { ok: false, error: "too many" })
    && allSheets(brake) === locked && brake.rows().length === 1, "S5 wrong locks count toward the existing rate limit, without writes or a personal result");
}

lists();
saveValid();
rejectInvalid();
monthlyTop();
coercedMonth();
callback();
rateLimit();
unknownAction();
readKeys();
keyPool();
crowdedTab();
rotate();
setKey();
monthlyRotation();
keyRules();
handEdits();
oldSheet();
levelThree();
lockedBest();
lockedScopesAndLegacy();
differentNames();
dateCellsAndForgottenLock();
ownPosition();
ownPositionOutsideTop();
lockRejections();
console.log(`TOTAL: ${okCount} ok, ${failCount} FAIL`);
process.exit(failCount ? 1 : 0);
