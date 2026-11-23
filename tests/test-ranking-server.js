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
      writes: 0,
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
          sheet.writes++;
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
// S5: word keys are a word plus a two-digit number; S3/L8 adds six picture keys.
const KEY_SHAPE = /^[a-záéíóúüñ]+ [0-9]{2}$/;
const PICTURE_KEYS = ["🦁 león", "🐸 rana", "🌻 girasol", "🚂 tren", "🐢 tortuga", "🍓 fresa"];
const fold = (word) => word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
// By default each score brings the right class key of its own grade.
const add = (game, fields) => {
  const grade = fields.grade ?? "5";
  const key = "key" in fields ? fields.key : (game.keys() || {})[grade] ?? "";
  // Like the real game, 1º and 2º always send their two-emoji lock (ranking-justo L9).
  const lock = "lock" in fields || !["1", "2"].includes(String(grade)) ? {} : { lock: "0,1" };
  return game.json({ action: "add", animal: "Tigre", adjective: "Veloz", grade, points: "1200", ...lock, ...fields, key });
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
  check(values.length === 6 && values.slice(0, 2).every((k) => PICTURE_KEYS.includes(k)) && values[0] !== values[1]
    && values.slice(2).every((k) => KEY_SHAPE.test(k)) && new Set(values).size === 6,
    `S3/L8 the bot gets two distinct canonical pictures and four different word keys (${values.join(",")})`);
  const words = values.slice(2).map((k) => k.split(" ")[0]);
  check(new Set(words).size === 4, `S5 no two word grades share the same word, even with a different number (${words.join(",")})`);
  const seen = new Set();
  for (let i = 0; i < 40; i++) Object.values(load().keys()).slice(2).forEach((k) => seen.add(k));
  check([...seen].every((k) => KEY_SHAPE.test(k)) && seen.size > 120,
    `S5 every month mints new word keys for 3º-6º, so the space stays large (${seen.size} different in 40 months)`);
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
  for (const grade of [1, 2]) {
    const before = allSheets(november);
    const expired = add(november, { grade: String(grade), key: old[grade].split(" ")[1], lock: "1,2" });
    check(same(expired, { ok: false, error: "bad key" }) && allSheets(november) === before,
      `S3/L7 last month's ${grade}º picture word stops working without writes`);
    const valid = add(november, { grade: String(grade), key: fresh.keys[grade].split(" ")[0], lock: "1,2" });
    check(same(valid, expectedAdd(grade, "2026-11", [{ name: "Tigre Veloz", points: 1200 }], expectedMe("Tigre Veloz", 1200, 1, 1)))
      && validHash(november.rows().at(-1)[7], "1,2"), `S3/L7 the new ${grade}º picture emoji works with a two-index lock`);
  }
  const viaGame = load("2026-12-01T09:00:00Z", october.sheets);
  add(viaGame, { grade: "5", key: "x" });
  check(sheetKeys(viaGame).every((r) => r[2] === "2026-12"), "S4 the rotation also happens when the first request of the month comes from the game");

  const crowded = load("2026-10-31T10:00:00Z");
  crowded.keys();
  const oldRows = ["🦁 león", "🐸 rana", "girasol", "tren", "tortuga", "fresa"];
  oldRows.forEach((key, i) => { crowded.sheets.Claves.rows[i + 1] = [i + 1, key, "2026-10"]; });
  const next = load("2026-11-01T10:00:00Z", crowded.sheets);
  vm.runInContext("Math.random = function () { return 0; }", next.context);
  const renewed = next.post({ action: "keys", secret: SECRET });
  check(renewed.ok === true && renewed.month === "2026-11"
    && PICTURE_KEYS.includes(renewed.keys[1]) && PICTURE_KEYS.includes(renewed.keys[2])
    && renewed.keys[1] !== renewed.keys[2] && [renewed.keys[1], renewed.keys[2]].every((p) => !oldRows.slice(0, 2).includes(p))
    && [3, 4, 5, 6].every((g) => KEY_SHAPE.test(renewed.keys[g])),
    "S3/L7 even when all picture words were used last month, new-month pictures differ from the previous pictures");
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
  check(cleaned[2] !== "a1" && PICTURE_KEYS.includes(cleaned[2]) && [1, 3, 4, 5, 6].every((g) => cleaned[g] === same[g])
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
  for (let i = 0; i < 20; i++) Object.values(load().keys()).slice(2).forEach((k) => minted.add(k.split(" ")[0]));
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
  check(result.ok === true && result.month === "2026-11" && values.length === 6
    && values.slice(0, 2).every((k) => PICTURE_KEYS.includes(k)) && values.slice(2).every((k) => KEY_SHAPE.test(k))
    && new Set(values).size === 6 && values.every((k) => !Object.values(before).includes(k)),
    `S3/L8 rotate mints two distinct pictures and four fresh words for the same month (${JSON.stringify(before)} -> ${JSON.stringify(result.keys)})`);
  check(JSON.stringify(sheetKeys(game).map((r) => `${r[0]}|${r[1]}|${r[2]}`)) === JSON.stringify(values.map((k, i) => `${i + 1}|${k}|2026-11`)),
    "S5 rotate writes the new keys to the «Claves» tab of the current month");
  check(add(game, { grade: "4", key: before["4"] }).error === "bad key" && add(game, { grade: "4", key: result.keys["4"] }).ok === true,
    "S5 after rotating, the old key is dead and the new one works at once");
  for (const grade of [1, 2]) {
    const snapshot = allSheets(game);
    const expired = add(game, { grade: String(grade), key: before[grade].split(" ")[1], lock: "1,2" });
    check(same(expired, { ok: false, error: "bad key" }) && allSheets(game) === snapshot,
      `S3/L8 after rotate the old ${grade}º picture word is refused without writes`);
    const valid = add(game, { grade: String(grade), key: result.keys[grade].split(" ")[1], lock: "1,2" });
    check(same(valid, expectedAdd(grade, "2026-11", [{ name: "Tigre Veloz", points: 1200 }], expectedMe("Tigre Veloz", 1200, 1, 1)))
      && validHash(game.rows().at(-1)[7], "1,2"), `S3/L8 after rotate the new ${grade}º picture word works immediately`);
  }
  check(JSON.stringify(game.keys()) === JSON.stringify(result.keys), "S5 the rotated keys stay for the rest of the month");

  const october = load("2026-10-31T10:00:00Z");
  vm.runInContext("Math.random = function () { return 0; }", october.context);
  const octoberKeys = october.keys();
  const november = load("2026-11-01T10:00:00Z", october.sheets);
  vm.runInContext("Math.random = function () { return 0; }", november.context);
  const firstRotate = november.post({ action: "rotate", secret: SECRET });
  check(firstRotate.ok === true && firstRotate.month === "2026-11" && PICTURE_KEYS.includes(firstRotate.keys[1])
    && PICTURE_KEYS.includes(firstRotate.keys[2]) && firstRotate.keys[1] !== firstRotate.keys[2]
    && [firstRotate.keys[1], firstRotate.keys[2]].every((picture) => picture !== octoberKeys[1] && picture !== octoberKeys[2])
    && sheetKeys(november).every((row) => row[2] === "2026-11"),
    "S3/L7-L8 rotate as the first request of a month does not reuse either previous picture");
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
  check(values.length === 6 && values.slice(0, 2).every((k) => PICTURE_KEYS.includes(k))
    && values.slice(2).every((k) => KEY_SHAPE.test(k)) && new Set(values).size === 6
    && values.slice(2).every((k) => used.indexOf(k.split(" ")[0]) < 0),
    `S5 with the tab nearly full of hand-written words, four fresh words and two pictures still come out (${values.join(",")})`);
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

// S6: 3º may also enter after level 3; a level-4 finish always ranks above a level-3 one.
function levelThree() {
  const game = load();
  const three = (fields) => add(game, { grade: "3", ...fields });
  check(three({ level: "3", points: "900", animal: "Lince", adjective: "Feliz" }).ok === true
    && game.rows()[0][6] === 3, "S6 a level-3 score is saved in 3º with its level");
  check(three({ level: "2" }).ok === false && three({ level: "x" }).ok === false && three({ level: "5" }).ok === false
    && game.rows().length === 1,
    "S6 any level other than 3 or 4 is refused, saving nothing");
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

// ranking-justo S2: every grade, 1º to 6º, may enter after level 3, and level 4 still ranks first.
function levelThreeEveryGrade() {
  for (const grade of ["1", "2", "3", "4", "5", "6"]) {
    const game = load();
    const early = add(game, { grade, level: "3", points: "5000", animal: "Panda", adjective: "Fuerte" });
    check(early.ok === true && game.rows().length === 1 && game.rows()[0][6] === 3,
      `C level 3 is saved in ${grade}º with its level (${JSON.stringify(early)})`);
    const finished = add(game, { grade, points: "300", animal: "Lobo", adjective: "Leal" });
    check(finished.ok === true && JSON.stringify(finished.top) === JSON.stringify([
      { name: "Lobo Leal", points: 300 },
      { name: "Panda Fuerte", points: 5000, level: 3 },
    ]), `C in ${grade}º level 4 ranks above level 3 whatever the points (${JSON.stringify(finished.top)})`);
  }
  const game = load();
  check(add(game, { grade: "7", level: "3" }).ok === false && add(game, { grade: "0", level: "3" }).ok === false
    && game.rows().length === 0, "C level 3 outside 1º-6º is refused, saving nothing");
}

// ranking-justo L9: 1º and 2º always need their two-emoji lock; 3º-6º still accept old pages without one.
function lockRequiredInPictureGrades() {
  for (const grade of ["1", "2"]) {
    const game = load();
    const keys = game.keys();
    const before = allSheets(game);
    const answer = game.json({ action: "add", animal: "Tigre", adjective: "Veloz", grade, points: "1200", key: keys[grade] });
    check(answer.ok === false && answer.error === "bad lock" && game.rows().length === 0,
      `L9 ${grade}º refuses a save without a lock, saving nothing (${JSON.stringify(answer)})`);
    check(allSheets(game) === before, `L9 a refused ${grade}º save without a lock leaves every sheet unchanged`);
    check(add(game, { grade, lock: "0,1" }).ok === true && game.rows().length === 1,
      `L9 ${grade}º still saves with a two-emoji lock`);
  }
  const older = load();
  check(add(older, { grade: "3" }).ok === true && older.rows().length === 1,
    "L9 3º-6º still accept an old page without a lock");
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
  const before = snapshot(game), beforeKeys = JSON.stringify(sheetKeys(game));
  const lower = add(game, { grade: "3", key: keys[3], points: "100", lock });
  check(same(lower, expectedAdd(3, "2026-11", top, expectedMe("Tigre Veloz", 200, 4, 5))) && snapshot(game) === before
    && JSON.stringify(sheetKeys(game)) === beforeKeys
    && same((golpes(game).at(-1) || []).slice(1), ["2026-11", 3, "Tigre Veloz", 100]),
    "S1 a lower run returns the stored best and its position, keeps both other sheets and logs only a hit");

  const third = add(game, { grade: "3", key: keys[3], animal: "Águila", adjective: "Feliz", level: "3", points: "90000", lock: "4,5,6" });
  const topThird = [...top, { name: "Águila Feliz", points: 90000, level: 3 }];
  check(same(third, expectedAdd(3, "2026-11", topThird, expectedMe("Águila Feliz", 90000, 6, 6, 3))),
    "S1 a tied level-3 result follows every level-4 result and includes only its own level");
  const beforeThird = snapshot(game), beforeThirdKeys = JSON.stringify(sheetKeys(game));
  const lowerThird = add(game, { grade: "3", key: keys[3], animal: "Águila", adjective: "Feliz", level: "3", points: "80000", lock: "4,5,6" });
  check(same(lowerThird, expectedAdd(3, "2026-11", topThird, expectedMe("Águila Feliz", 90000, 6, 6, 3))) && snapshot(game) === beforeThird
    && JSON.stringify(sheetKeys(game)) === beforeThirdKeys
    && same((golpes(game).at(-1) || []).slice(1), ["2026-11", 3, "Águila Feliz", 80000]),
    "S1 a lower level-3 run keeps its stored level-3 best and position, rewriting neither sheet but logging a hit");
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

// ranking-justo S3/L6-L8: 1º and 2º use canonical pictures, including hand edits and migration.
function pictureSheets() {
  const game = load();
  check(same(Array.from(game.context.PICTURE_KEYS || []), PICTURE_KEYS)
    && same(Array.from(game.context.PICTURE_GRADES || []), [1, 2]),
    "S3/L8 the server exposes the six pictures in the agreed order and picture grades 1º-2º");
  const initial = game.keys();
  const tab = game.sheets.Claves;
  const before = allSheets(game), writes = tab.writes;
  check(same(game.keys(), initial) && allSheets(game) === before && tab.writes === writes,
    "S3/L7 a tidy current-month picture/word sheet is read without being rewritten");

  tab.rows[1] = [1, "  🦁  L E Ó N  ", "2026-11"];
  tab.rows[2] = [2, "🐸", "2026-11"];
  const canonical = game.keys();
  check(canonical[1] === "🦁 león" && canonical[2] === "🐸 rana" && [3, 4, 5, 6].every((g) => canonical[g] === initial[g])
    && tab.rows[1][1] === "🦁 león" && tab.rows[2][1] === "🐸 rana" && tab.writes === writes + 1,
    "S3/L8 valid handwritten emoji/full aliases are kept, stored canonically and do not disturb word grades");
  const canonicalWrites = tab.writes;
  tab.rows[1][2] = new game.context.Date("2026-11-01T00:00:00Z");
  check(same(game.keys(), canonical) && tab.writes === canonicalWrites,
    "S3/L7 a canonical picture row with a Sheets date month remains tidy and is not rewritten");

  tab.rows[1] = [1, "🦁", "2026-11"];
  tab.rows[2] = [2, " LEON ", "2026-11"];
  const deduplicated = game.keys();
  check(PICTURE_KEYS.includes(deduplicated[1]) && PICTURE_KEYS.includes(deduplicated[2])
    && deduplicated[1] !== deduplicated[2] && deduplicated[1] !== "🦁 león" && deduplicated[2] !== "🦁 león"
    && [3, 4, 5, 6].every((g) => deduplicated[g] === initial[g]),
    `S3/L8 duplicate aliases in 1º-2º are replaced without sharing a picture (${JSON.stringify(deduplicated)})`);

  const migration = load();
  const old = migration.keys();
  migration.sheets.Claves.rows[1] = [1, "migración 94", "2026-11"];
  migration.sheets.Claves.rows[2] = [2, "gramática 95", "2026-11"];
  const migrated = migration.post({ action: "keys", secret: SECRET });
  check(migrated.ok === true && migrated.month === "2026-11" && PICTURE_KEYS.includes(migrated.keys[1])
    && PICTURE_KEYS.includes(migrated.keys[2]) && migrated.keys[1] !== migrated.keys[2]
    && [3, 4, 5, 6].every((g) => migrated.keys[g] === old[g])
    && sheetKeys(migration).every((r, i) => r[0] === i + 1 && r[1] === migrated.keys[i + 1] && r[2] === "2026-11"),
    `S3/L7-L8 live migration replaces this month's word keys in 1º-2º and preserves 3º-6º (${JSON.stringify(migrated)})`);
  const migratedWrites = migration.sheets.Claves.writes;
  check(same(migration.keys(), migrated.keys) && migration.sheets.Claves.writes === migratedWrites,
    "S3/L7 the migrated sheet stays tidy on the next request");

  for (const grade of [1, 2]) {
    const damaged = load();
    const previous = damaged.keys();
    const other = grade === 1 ? 2 : 1;
    damaged.sheets.Claves.rows[grade] = [grade, "wrong 88", "2026-11"];
    const repaired = damaged.keys();
    check(PICTURE_KEYS.includes(repaired[grade]) && repaired[grade] !== repaired[other]
      && repaired[other] === previous[other] && [3, 4, 5, 6].every((g) => repaired[g] === previous[g])
      && sheetKeys(damaged)[grade - 1][1] === repaired[grade],
      `S3/L8 repairing ${grade}º preserves the other picture and all four word grades`);
  }

  const constrained = load();
  constrained.keys();
  const occupied = ["🦁 león", "old word 88", "rana", "tren", "tortuga", "fresa"];
  occupied.forEach((key, i) => { constrained.sheets.Claves.rows[i + 1] = [i + 1, key, "2026-11"]; });
  const remaining = constrained.keys();
  check(remaining[1] === "🦁 león" && remaining[2] === "🌻 girasol"
    && [3, 4, 5, 6].every((g) => remaining[g] === occupied[g - 1]),
    "S3/L8 minting a picture respects the other picture and all four handwritten word aliases");

  const crowded = load();
  const kept = crowded.keys();
  PICTURE_KEYS.forEach((picture) => crowded.sheets.Claves.rows.push(["", picture, "2026-10"]));
  const cleaned = crowded.post({ action: "keys", secret: SECRET });
  check(cleaned.ok === true && PICTURE_KEYS.includes(cleaned.keys[1]) && PICTURE_KEYS.includes(cleaned.keys[2])
    && cleaned.keys[1] !== cleaned.keys[2] && [3, 4, 5, 6].every((g) => cleaned.keys[g] === kept[g])
    && crowded.sheets.Claves.rows.length === 7,
    "S3/L8 extra rows mentioning every picture are removed and leave distinct pictures and intact word keys");
}

function pictureSetKey() {
  const game = load();
  for (const grade of [1, 2]) {
    const other = grade === 1 ? 2 : 1;
    for (const picture of PICTURE_KEYS) {
      let keys = game.keys();
      let prepared = true;
      if (keys[other] === picture) {
        const spare = PICTURE_KEYS.find((p) => p !== picture && p !== keys[grade]);
        const moved = game.post({ action: "setkey", secret: SECRET, grade: String(other), key: spare });
        prepared = moved.ok === true && moved.keys[other] === spare;
      }
      check(prepared && game.keys()[other] !== picture, `S3/L8 prepare a distinct picture for ${other}º`);
      const [emoji, word] = picture.split(" ");
      const forms = [emoji, `  ${word.toUpperCase()}  `, ` ${emoji}   ${word.toUpperCase()} `, ` ${emoji} ${word.split("").join(" ")} `];
      if (word === "león") forms.push("leo\u0301n"); // a decomposed accent is also an accent
      for (const form of forms) {
        keys = game.keys();
        const rows = sheetKeys(game), ranking = snapshot(game);
        const answer = game.post({ action: "setkey", secret: SECRET, grade: String(grade), key: form });
        rows[grade - 1][1] = picture;
        check(same(answer, { ok: true, month: "2026-11", keys: { ...keys, [grade]: picture } })
          && same(sheetKeys(game), rows) && snapshot(game) === ranking,
          `S3/L8 setkey ${grade}º accepts ${JSON.stringify(form)} and stores ${picture} canonically`);
      }
    }
  }
  let keys = game.keys();
  for (const grade of [1, 2]) {
    const other = grade === 1 ? 2 : 1;
    const [emoji, word = ""] = keys[other].split(" ");
    for (const key of [emoji, word, keys[other], ` ${emoji} ${word.toUpperCase()} `]) {
      const before = allSheets(game);
      const answer = game.post({ action: "setkey", secret: SECRET, grade: String(grade), key });
      check(same(answer, { ok: false, error: "key in use" }) && allSheets(game) === before,
        `S3/L8 setkey ${grade}º refuses the other grade's picture alias ${JSON.stringify(key)} without writes`);
    }
    for (const key of ["", "sol", "león 12", "🦁 rana", "🦁🦁", "🐶", "🦁 león fresa", null]) {
      const before = allSheets(game);
      const answer = game.post({ action: "setkey", secret: SECRET, grade: String(grade), key });
      check(same(answer, { ok: false, error: "bad key" }) && allSheets(game) === before,
        `S3/L8 setkey ${grade}º rejects non-pictures ${JSON.stringify(key)} without writes`);
    }
  }
  for (const grade of [3, 4, 5, 6]) {
    for (const key of ["🦁", "🦁 león", "caca", "caca 12"]) {
      const before = allSheets(game);
      const answer = game.post({ action: "setkey", secret: SECRET, grade: String(grade), key });
      check(same(answer, { ok: false, error: "bad key" }) && allSheets(game) === before,
        `S3/L8 setkey ${grade}º rejects an invalid or blocked word key ${JSON.stringify(key)} without writes`);
    }
  }
  keys = game.keys();
  const spare = PICTURE_KEYS.find((picture) => picture !== keys[1] && picture !== keys[2]);
  const [emoji, word] = spare.split(" ");
  const wordSet = game.post({ action: "setkey", secret: SECRET, grade: "3", key: word });
  check(wordSet.ok === true && wordSet.keys[3] === fold(word) && sheetKeys(game)[2][1] === fold(word)
    && add(game, { grade: "3", key: word, lock: "0,1,2" }).ok === true,
    "S3/L8 3º-6º still accept a valid handwritten word even if it names an unused picture");
  let before = allSheets(game);
  const clashPicture = game.post({ action: "setkey", secret: SECRET, grade: "1", key: emoji });
  check(same(clashPicture, { ok: false, error: "key in use" }) && allSheets(game) === before,
    "S3/L8 a picture cannot steal a word key already assigned to 3º-6º");
  before = allSheets(game);
  const pictureWord = keys[1].split(" ")[1];
  const clashWord = game.post({ action: "setkey", secret: SECRET, grade: "4", key: pictureWord });
  check(same(clashWord, { ok: false, error: "key in use" }) && allSheets(game) === before,
    "S3/L8 a word key cannot steal a picture already assigned to 1º-2º");

  const edited = load();
  const editedKeys = edited.keys();
  add(edited, { grade: "2", key: editedKeys[2], lock: "1,2" });
  const editedWord = editedKeys[2].split(" ")[1];
  edited.sheets.Claves.rows[2][1] = ` ${editedWord.toUpperCase()} `; // valid but not canonical
  edited.sheets.Claves.rows.push(["", "teacher note", "2026-11"]);
  before = allSheets(edited);
  const editedClash = edited.post({ action: "setkey", secret: SECRET, grade: "1", key: editedWord });
  check(same(editedClash, { ok: false, error: "key in use" }) && allSheets(edited) === before,
    "S3/L8 setkey in-use refusal does not tidy handwritten Claves or change Ranking");

  const fresh = load();
  vm.runInContext("Math.random = function () { return 0; }", fresh.context);
  const firstSet = fresh.post({ action: "setkey", secret: SECRET, grade: "2", key: "🦁" });
  check(firstSet.ok === true && firstSet.keys[2] === "🦁 león" && PICTURE_KEYS.includes(firstSet.keys[1])
    && firstSet.keys[1] !== firstSet.keys[2] && sheetKeys(fresh)[1][1] === "🦁 león",
    "S3/L8 first-request setkey reserves the requested picture before minting the other grade's key");
}

function pictureAdds() {
  for (const grade of [1, 2]) {
    for (const picture of PICTURE_KEYS) {
      const [emoji, word] = picture.split(" ");
      for (const key of [emoji, word, picture, `  ${fold(word).toUpperCase().split("").join(" ")} `]) {
        const game = load();
        let keys = game.keys();
        const other = grade === 1 ? 2 : 1;
        if (keys[other] === picture) {
          const spare = PICTURE_KEYS.find((p) => p !== picture && p !== keys[grade]);
          game.post({ action: "setkey", secret: SECRET, grade: String(other), key: spare });
        }
        const set = game.post({ action: "setkey", secret: SECRET, grade: String(grade), key: picture });
        const answer = add(game, { grade: String(grade), key, lock: "0,11", points: "1234" });
        const row = game.rows()[0] || [];
        check(set.ok === true && same(answer, expectedAdd(grade, "2026-11", [{ name: "Tigre Veloz", points: 1234 }], expectedMe("Tigre Veloz", 1234, 1, 1)))
          && game.rows().length === 1 && same(row.slice(1, 7), ["2026-11", grade, "Tigre Veloz", 1234, grade, 4])
          && validHash(row[7], "0,11") && !JSON.stringify(game.sheets.Ranking.rows).includes("0,11"),
          `S3/L8 add ${grade}º accepts picture ${JSON.stringify(key)} with a two-index salted lock`);
      }
    }
  }
  const game = load();
  const keys = game.keys();
  const firstWord = keys[1].split(" ")[1];
  const secondEmoji = keys[2].split(" ")[0];
  const young = add(game, { grade: "2", key: firstWord, lock: "11,0" });
  check(same(young, expectedAdd(2, "2026-11", [{ name: "Tigre Veloz", points: 1200, from: 1 }], expectedMe("Tigre Veloz", 1200, 1, 1)))
    && game.rows()[0][5] === 1 && validHash(game.rows()[0][7], "11,0"),
    "S3/L7-L8 a 1º picture word enters 2º using the two-index form-grade lock");
  const older = add(game, { grade: "3", key: firstWord, lock: "11,0,1" });
  check(same(older, expectedAdd(3, "2026-11", [{ name: "Tigre Veloz", points: 1200, from: 1 }], expectedMe("Tigre Veloz", 1200, 1, 1)))
    && game.rows()[1][5] === 1 && validHash(game.rows()[1][7], "11,0,1"),
    "S3/L7-L8 a 1º picture word enters 3º using the three-index form-grade lock");
  for (const [fields, expected] of [
    [{ grade: "1", key: secondEmoji, lock: "1,2" }, { ok: false, error: "wrong grade", keyGrade: 2 }],
    [{ grade: "2", key: keys[3], lock: "1,2" }, { ok: false, error: "wrong grade", keyGrade: 3 }],
    [{ grade: "3", key: firstWord, lock: "1,2" }, { ok: false, error: "bad lock" }],
    [{ grade: "2", key: keys[3], lock: "1,2,3" }, { ok: false, error: "bad lock" }],
    [{ grade: "1", key: "🦁 rana", lock: "1,2" }, { ok: false, error: "bad key" }],
  ]) {
    const before = allSheets(game);
    const answer = add(game, fields);
    check(same(answer, expected) && allSheets(game) === before,
      `S3/L7-L8 add refuses ${JSON.stringify(fields)} as ${expected.error} without changing either sheet`);
  }
}

function pictureLocks() {
  for (const grade of [1, 2]) {
    const game = load();
    const keys = game.keys();
    const first = add(game, { grade: String(grade), key: keys[grade], lock: "0,0", points: "100" });
    const second = add(game, { grade: String(grade), key: keys[grade], animal: "Lobo", lock: "11,11", points: "200" });
    const rows = game.rows();
    check(same(first, expectedAdd(grade, "2026-11", [{ name: "Tigre Veloz", points: 100 }], expectedMe("Tigre Veloz", 100, 1, 1)))
      && same(second, expectedAdd(grade, "2026-11", [{ name: "Lobo Veloz", points: 200 }, { name: "Tigre Veloz", points: 100 }], expectedMe("Lobo Veloz", 200, 1, 2)))
      && rows.length === 2 && validHash(rows[0][7], "0,0") && validHash(rows[1][7], "11,11") && rows[0][7] !== rows[1][7],
      `S3/L8 ${grade}º accepts both palette endpoints and independently salts two-index locks`);
    const before = allSheets(game);
    for (const lock of ["", "1", "1,2,3", "1,2,3,4", "12,0", "-1,0", "1.5,2", "1,", "1,x", "🍎,⭐", "01,2", "1,02", "00,1", " 1,2", "1,2\n", null, 123]) {
      const answer = add(game, { grade: String(grade), key: keys[grade], lock });
      check(same(answer, { ok: false, error: "bad lock" }) && allSheets(game) === before,
        `S3/L8 ${grade}º rejects malformed lock ${JSON.stringify(lock)} without changing either sheet`);
    }
    const taken = add(game, { grade: String(grade), key: keys[grade], lock: "0,1" });
    check(same(taken, { ok: false, error: "name taken" }) && allSheets(game) === before,
      `S3/L8 ${grade}º rejects a different two-index lock for a claimed name without writes`);
    const updated = add(game, { grade: String(grade), key: keys[grade], lock: "0,0", points: "300" });
    check(same(updated, expectedAdd(grade, "2026-11", [{ name: "Tigre Veloz", points: 300 }, { name: "Lobo Veloz", points: 200 }], expectedMe("Tigre Veloz", 300, 1, 2)))
      && game.rows().length === 2 && game.rows()[0][7] === rows[0][7],
      `S3/L8 ${grade}º the matching two-index lock updates the best score and preserves its salt`);
  }
  for (const grade of [3, 4, 5, 6]) {
    const game = load();
    const key = game.keys()[grade];
    const before = allSheets(game);
    const refused = add(game, { grade: String(grade), key, lock: "0,11" });
    check(same(refused, { ok: false, error: "bad lock" }) && allSheets(game) === before,
      `S3/L8 ${grade}º refuses a two-index lock without changing either sheet`);
    const accepted = add(game, { grade: String(grade), key, lock: "0,11,0" });
    check(same(accepted, expectedAdd(grade, "2026-11", [{ name: "Tigre Veloz", points: 1200 }], expectedMe("Tigre Veloz", 1200, 1, 1)))
      && validHash(game.rows()[0]?.[7], "0,11,0"), `S3/L8 ${grade}º still accepts a three-index salted lock`);
  }
}

// ranking-justo T7/S4-L13: every saved run is a hit for the monthly villain.
const golpes = (game) => (game.sheets.Golpes ? game.sheets.Golpes.rows.slice(1) : []);
const metas = (game) => (game.sheets.Metas ? game.sheets.Metas.rows : []);
const sheetState = (game) => JSON.stringify(Object.keys(game.sheets).sort()
  .map((name) => [name, game.sheets[name].rows, game.sheets[name].writes]));

function hitLog() {
  const game = load();
  const first = add(game, { grade: "5", points: "1200" });
  const [hit] = golpes(game) || [];
  const header = game.sheets.Golpes ? game.sheets.Golpes.rows[0].join("|") : "no tab";
  check(header === "Fecha|Mes|Curso|Nombre|Puntos|Partida",
    `D a saved run creates the «Golpes» tab with its header (${header})`);
  check(first.ok === true && golpes(game).length === 1 && (hit || [])[0] instanceof game.context.Date
    && same((hit || []).slice(1), ["2026-11", 5, "Tigre Veloz", 1200]),
    `D a saved run appends one hit with date, month, form grade, name and its points (${JSON.stringify((hit || []).slice(1))})`);
  const improving = add(game, { grade: "5", points: "1500", lock: "1,2,3" });
  check(improving.ok === true && game.rows().length === 2 && golpes(game).length === 2
    && same(golpes(game).map((row) => row[4]), [1200, 1500])
    && same((golpes(game).at(-1) || []).slice(1), ["2026-11", 5, "Tigre Veloz", 1500]),
    "D an improving save appends its own hit next to the better stored row");
  const before = snapshot(game);
  const lower = add(game, { grade: "5", points: "900", lock: "1,2,3" });
  check(lower.ok === true && snapshot(game) === before && golpes(game).length === 3
    && same(golpes(game).map((row) => row[4]), [1200, 1500, 900]),
    "D a run that does not beat the stored best still appends its hit and leaves the ranking row alone");
  const young = add(game, { grade: "1", points: "777" });
  check(young.ok === true && same((golpes(game).at(-1) || []).slice(1), ["2026-11", 1, "Tigre Veloz", 777]),
    "D a 1º-2º save logs its form grade and its points");
  const guest = load();
  const keys = guest.keys();
  add(guest, { grade: "2", key: keys["1"], animal: "Panda", points: "600" });
  check(guest.rows()[0][5] === 1 && same((golpes(guest)[0] || []).slice(1), ["2026-11", 2, "Panda Veloz", 600]),
    "D the hit keeps the form grade (2º) even when the class key comes from 1º");
}

function noHitOnFailure() {
  const game = load();
  add(game, { grade: "5", lock: "1,2,3", points: "100" });
  const cases = [
    [{ key: "patata" }, "a wrong class key"],
    [{ grade: "5", key: game.keys()["6"] }, "another grade's key"],
    [{ animal: "Juan" }, "a name outside the animal list"],
    [{ points: "12.5" }, "points that are not a whole number"],
    [{ level: "2" }, "a level other than 3 or 4"],
    [{ lock: "1,2" }, "a malformed lock"],
    [{ grade: "7" }, "grade 7"],
    [{ lock: "9,8,7" }, "a different lock for a claimed name"],
  ];
  for (const [fields, label] of cases) {
    const before = sheetState(game);
    const answer = add(game, fields);
    check(answer.ok === false && sheetState(game) === before && golpes(game).length === 1,
      `D ${label} appends no hit and changes no sheet (${JSON.stringify(answer)})`);
  }
  const fresh = load();
  const refused = add(fresh, { key: "patata" });
  check(refused.ok === false && fresh.sheets.Golpes === undefined,
    "D a refused save never creates the «Golpes» tab");
  const brake = load();
  let saved = 0;
  for (let i = 0; i < 31; i++) if (add(brake, {}).ok) saved++;
  check(saved === 30 && golpes(brake).length === 30,
    `D the run refused by the per-minute brake logs no hit (${golpes(brake).length})`);
}

function villainScreen() {
  const october = load("2026-10-20T10:00:00Z");
  add(october, { grade: "3", points: "5000" });
  add(october, { grade: "1", points: "7000" });
  const game = load("2026-11-14T10:00:00Z", october.sheets);
  add(game, { grade: "3", points: "1000" });
  add(game, { grade: "3", points: "2000", lock: "1,2,3" });
  add(game, { grade: "3", points: "3000", lock: "1,2,3" });
  add(game, { grade: "3", points: "4000", lock: "1,2,3" });
  add(game, { grade: "3", points: "1500", lock: "1,2,3" }); // does not beat the stored 4000
  add(game, { grade: "1", points: "900" });
  if (game.sheets.Golpes) {
    game.sheets.Golpes.appendRow([new Date(), "2026-10", 3, "Fantasma Feliz", 99999]); // last month, converted to a date
    game.sheets.Golpes.appendRow([new Date(), "'2026-09", 3, "Sombra Feliz", 88888]);
  }
  const result = game.json({ action: "villain" });
  const grades = result.grades || [];
  check(same(Object.keys(result).sort(), ["grades", "month", "ok"]) && result.ok === true && result.month === "2026-11"
    && grades.map((entry) => entry.grade).join() === "1,2,3,4,5,6",
    `D villain answers the six grades of the current month in order (${JSON.stringify(grades.map((entry) => entry.grade))})`);
  check(same(grades.map((entry) => entry.taken), [900, 0, 11500, 0, 0, 0]),
    `D each grade's energy sums only its own rows of this month (${grades.map((entry) => entry.taken).join(",")})`);
  check(same((grades[2] || {}).hits, [
    { name: "Tigre Veloz", points: 1500 }, { name: "Tigre Veloz", points: 4000 }, { name: "Tigre Veloz", points: 3000 },
  ]), `D villain shows the three newest hits of a grade, newest first (${JSON.stringify((grades[2] || {}).hits)})`);
  check(grades.length === 6 && grades.every((entry) => Object.keys(entry).sort().join() === "goal,grade,hits,taken"
    && entry.hits.every((hit) => Object.keys(hit).sort().join() === "name,points"))
    && !JSON.stringify(result).includes("Fantasma") && !JSON.stringify(result).includes("Sombra"),
    "D villain shares only grade, goal, taken and the name and points of the newest hits");
  check(same(grades.map((entry) => entry.goal), [30000, 60000, 100000, 120000, 150000, 200000]),
    `D villain starts with the agreed default goal of each grade (${grades.map((entry) => entry.goal).join(",")})`);
}

// The teacher edits one «Metas» cell by hand, if the tab exists.
const setGoal = (game, grade, value) => {
  const row = metas(game).find((entry) => Number(entry[0]) === grade);
  if (row) row[1] = value;
};
const goalOf = (game, grade) => ((metas(game).find((entry) => Number(entry[0]) === grade) || [])[1]);

function villainGoals() {
  const game = load();
  game.json({ action: "villain" });
  check((metas(game)[0] || []).join("|") === "Curso|Meta"
    && same(metas(game).slice(1), [[1, 30000], [2, 60000], [3, 100000], [4, 120000], [5, 150000], [6, 200000]]),
    `D the first villain read creates the «Metas» tab with the six default goals (${JSON.stringify(metas(game).slice(1))})`);
  const before = sheetState(game);
  game.json({ action: "villain" });
  check(sheetState(game) === before, "D a later villain read writes nothing at all");

  setGoal(game, 4, 45000); // the teacher raises 4º's goal by hand
  const edited = game.json({ action: "villain" });
  check(same((edited.grades || []).map((entry) => entry.goal), [30000, 60000, 100000, 45000, 150000, 200000])
    && goalOf(game, 4) === 45000,
    "D a goal edited by the teacher in «Metas» is used as written");
  setGoal(game, 2, "80000"); // a number typed as text still counts
  check(same((game.json({ action: "villain" }).grades || []).map((entry) => entry.goal), [30000, 80000, 100000, 45000, 150000, 200000]),
    "D a goal typed as text is read as a number");
  for (const [value, label] of [["", "an empty cell"], ["mucha", "a cell that is not a number"], ["0", "a goal of zero"], [-500, "a negative goal"], [null, "a blank cell"]]) {
    setGoal(game, 2, value);
    const answer = game.json({ action: "villain" });
    check(((answer.grades || [])[1] || {}).goal === 60000 && same(goalOf(game, 2), value),
      `D ${label} falls back to 2º's default goal without rewriting the teacher's cell (${JSON.stringify(((answer.grades || [])[1] || {}).goal)})`);
  }

  const fresh = load();
  const empty = sheetState(fresh);
  const answer = fresh.json({ action: "villain" });
  const afterFirst = sheetState(fresh);
  fresh.json({ action: "villain" });
  check(answer.ok === true && afterFirst !== empty && sheetState(fresh) === afterFirst
    && fresh.sheets.Ranking === undefined && golpes(fresh).length === 0 && metas(fresh).length === 7,
    "D villain only creates its two tabs, with header and defaults, and never a ranking row");
}

function villainCallback() {
  const game = load();
  const wrapped = game.get({ action: "villain", callback: "capitan_cb2" });
  check(wrapped.mime === "JAVASCRIPT" && /^capitan_cb2\(\{.*"grades":\[.*\]\}\);$/.test(wrapped.text),
    `D villain wraps its answer for a JSONP callback (${wrapped.text.slice(0, 40)})`);
  check(((JSON.parse(wrapped.text.slice("capitan_cb2(".length, -2)).grades) || []).length === 6,
    "D the wrapped villain answer is the same JSON");
  const plain = game.get({ action: "villain" });
  check(plain.mime === "JSON" && JSON.parse(plain.text).ok === true, "D without a callback villain answers plain JSON");
  const evil = game.get({ action: "villain", callback: "alert(1)//" });
  check(evil.mime === "JSON" && JSON.parse(evil.text).ok === false, "D an unsafe callback name is refused for villain too");
}

// ranking-justo T9/L15: every run of the game, also one lost at level 1-2, feeds the
// villain through an anonymous hit. The ranking save itself does not change.
const hit = (game, fields) => game.json({ action: "hit", ...fields });

function hitAppends() {
  const game = load();
  const result = hit(game, { grade: "3", points: "1234", run: "run00000001" });
  const [row] = golpes(game) || [];
  check(same(result, { ok: true }) && golpes(game).length === 1 && (row || [])[0] instanceof game.context.Date
    && same((row || []).slice(1), ["2026-11", 3, "", 1234, "run00000001"]),
    `L15 an anonymous hit appends date, month, form grade, no name, points and its run id (${JSON.stringify((row || []).slice(1))})`);
  const header = game.sheets.Golpes ? game.sheets.Golpes.rows[0].join("|") : "no tab";
  check(header === "Fecha|Mes|Curso|Nombre|Puntos|Partida",
    `L15 a hit creates the «Golpes» tab with its six-column header (${header})`);
  check(game.sheets.Ranking === undefined, "L15 an anonymous hit never writes a ranking row");
  const answer = game.json({ action: "villain" });
  check(same((answer.grades || [])[2], { grade: 3, goal: 100000, taken: 1234, hits: [{ name: "", points: 1234 }] }),
    `L15 the villain counts an anonymous hit under an empty name (${JSON.stringify((answer.grades || [])[2])})`);
}

function hitKeepsTheBest() {
  const game = load();
  hit(game, { grade: "4", points: "500", run: "abcdefgh1111" });
  const raised = hit(game, { grade: "4", points: "900", run: "abcdefgh1111" });
  const [row] = golpes(game) || [];
  check(same(raised, { ok: true }) && golpes(game).length === 1
    && same((row || []).slice(1), ["2026-11", 4, "", 900, "abcdefgh1111"]),
    `L15 the same run twice keeps one row with the higher points (${JSON.stringify((row || []).slice(1))})`);
  const writes = game.sheets.Golpes ? game.sheets.Golpes.writes : -1;
  const lower = hit(game, { grade: "4", points: "400", run: "abcdefgh1111" });
  check(same(lower, { ok: true }) && golpes(game).length === 1 && golpes(game)[0][4] === 900
    && (game.sheets.Golpes || {}).writes === writes,
    "L15 a lower second hit never lowers the stored points and writes nothing");
  const equal = hit(game, { grade: "4", points: "900", run: "abcdefgh1111" });
  check(same(equal, { ok: true }) && (game.sheets.Golpes || {}).writes === writes,
    "L15 a repeated equal hit writes nothing");
  hit(game, { grade: "4", points: "700", run: "zyxwvu9876" });
  check(golpes(game).length === 2 && same(golpes(game).map((entry) => entry[4]), [900, 700]),
    "L15 a different run gets its own row");
}

function runSharedByHitAndAdd() {
  const game = load();
  hit(game, { grade: "5", points: "800", run: "compartido1" });
  const saved = add(game, { grade: "5", points: "1200", run: "compartido1" });
  const [row] = golpes(game) || [];
  check(saved.ok === true && game.rows().length === 1 && golpes(game).length === 1
    && same((row || []).slice(1), ["2026-11", 5, "Tigre Veloz", 1200, "compartido1"]),
    `L15 a hit then an add with the same run leaves one row, now named, with the better points (${JSON.stringify((row || []).slice(1))})`);

  const lower = load();
  hit(lower, { grade: "5", points: "1500", run: "compartido3" });
  const weaker = add(lower, { grade: "5", points: "900", run: "compartido3" });
  check(weaker.ok === true && golpes(lower).length === 1
    && same((golpes(lower)[0] || []).slice(1), ["2026-11", 5, "Tigre Veloz", 1500, "compartido3"]),
    "L15 an add never lowers the points the same run already took");

  const logged = load();
  add(logged, { grade: "5", points: "1200", run: "compartido2" });
  check(golpes(logged).length === 1
    && same((golpes(logged)[0] || []).slice(1), ["2026-11", 5, "Tigre Veloz", 1200, "compartido2"]),
    "L15 an add with a run logs its hit with the run id");
  const after = hit(logged, { grade: "5", points: "900", run: "compartido2" });
  check(same(after, { ok: true }) && golpes(logged).length === 1
    && same((golpes(logged)[0] || []).slice(1), ["2026-11", 5, "Tigre Veloz", 1200, "compartido2"]),
    "L15 an add then a hit with the same run keeps one row and the name");
  const better = hit(logged, { grade: "5", points: "2000", run: "compartido2" });
  check(same(better, { ok: true }) && golpes(logged).length === 1
    && same((golpes(logged)[0] || []).slice(1), ["2026-11", 5, "Tigre Veloz", 2000, "compartido2"]),
    "L15 a later hit still raises the named row and keeps its name");
}

function addRunIsOptional() {
  const game = load();
  add(game, { grade: "5", points: "1200" });
  check(golpes(game).length === 1 && golpes(game)[0].length === 5
    && same((golpes(game)[0] || []).slice(1), ["2026-11", 5, "Tigre Veloz", 1200]),
    `L15 an add without a run appends its hit exactly as before (${JSON.stringify((golpes(game)[0] || []).slice(1))})`);
  for (const run of ["", "short", "MAYUS12345", "guion-12345", "x".repeat(33), "run with space", 12345678, null]) {
    const fresh = load();
    const saved = add(fresh, { grade: "5", points: "1200", run });
    check(saved.ok === true && fresh.rows().length === 1 && golpes(fresh).length === 1 && golpes(fresh)[0].length === 5,
      `L15 a malformed run ${JSON.stringify(run)} never refuses the save and logs a plain hit`);
  }
}

function hitRejections() {
  const cases = [
    [{ grade: "0" }, "bad grade", "grade 0"],
    [{ grade: "7" }, "bad grade", "grade 7"],
    [{ grade: "3a" }, "bad grade", "a grade that is not a whole number"],
    [{ points: "-5" }, "bad points", "negative points"],
    [{ points: "12.5" }, "bad points", "points that are not a whole number"],
    [{ points: "100001" }, "bad points", "impossible points"],
    [{ points: "1234567" }, "bad points", "more than six digits of points"],
    [{ points: "" }, "bad points", "missing points"],
    [{ run: "" }, "bad run", "an empty run"],
    [{ run: "short" }, "bad run", "a run shorter than eight characters"],
    [{ run: "MAYUS12345" }, "bad run", "a run with capitals"],
    [{ run: "guion-12345" }, "bad run", "a run with a dash"],
    [{ run: "x".repeat(33) }, "bad run", "a run longer than 32 characters"],
    [{ run: "run con espacio" }, "bad run", "a run with a space"],
  ];
  for (const [fields, error, label] of cases) {
    const game = load();
    const before = sheetState(game);
    const answer = hit(game, { grade: "3", points: "10", run: "run00000001", ...fields });
    check(same(answer, { ok: false, error }) && sheetState(game) === before,
      `L15 a hit with ${label} is refused as «${error}» without touching a sheet (${JSON.stringify(answer)})`);
  }
  const zero = load();
  check(same(hit(zero, { grade: "3", points: "0", run: "run00000002" }), { ok: true })
    && zero.sheets.Golpes === undefined && zero.sheets.Ranking === undefined,
    "L15 a hit of 0 points answers ok and logs no row");
}

function hitBrake() {
  const game = load();
  let accepted = 0;
  for (let i = 0; i < 121; i++) {
    if (hit(game, { grade: "3", points: "10", run: `run${String(i).padStart(9, "0")}` }).ok) accepted++;
  }
  check(accepted === 120 && golpes(game).length === 120, `L15 at most 120 hits per minute are logged (${accepted})`);
  const refused = hit(game, { grade: "3", points: "10", run: "run999999999" });
  check(same(refused, { ok: false, error: "too many" }) && golpes(game).length === 120,
    `L15 over the hit brake the hit is refused and writes nothing (${JSON.stringify(refused)})`);
  const saved = add(game, { grade: "5", points: "1200" });
  check(saved.ok === true && game.rows().length === 1,
    "L15 exhausting the hit brake does not block a save: the two brakes are separate");

  const saves = load();
  let added = 0;
  for (let i = 0; i < 31; i++) if (add(saves, { grade: "5", points: "100" }).ok) added++;
  const answer = hit(saves, { grade: "5", points: "100", run: "run00000077" });
  check(added === 30 && same(answer, { ok: true }) && golpes(saves).length === 31,
    `L15 exhausting the save brake does not block a hit (${JSON.stringify(answer)})`);
}

function oldGolpesTab() {
  const game = load();
  game.context.SpreadsheetApp.getActiveSpreadsheet().insertSheet("Golpes");
  game.sheets.Golpes.appendRow(["Fecha", "Mes", "Curso", "Nombre", "Puntos"]);
  game.sheets.Golpes.appendRow([new game.context.Date("2026-11-10T10:00:00Z"), "'2026-11", 3, "Lobo Feliz", 900]);
  game.sheets.Golpes.appendRow([new game.context.Date("2026-10-10T10:00:00Z"), "'2026-10", 3, "Fantasma Feliz", 5000]);
  const oldRows = JSON.stringify(game.sheets.Golpes.rows.slice(1));
  const result = hit(game, { grade: "3", points: "100", run: "run00000003" });
  const header = game.sheets.Golpes ? game.sheets.Golpes.rows[0].join("|") : "no tab";
  check(same(result, { ok: true }) && header === "Fecha|Mes|Curso|Nombre|Puntos|Partida",
    `L15 an old five-column «Golpes» tab gains the «Partida» title (${header})`);
  check(JSON.stringify(game.sheets.Golpes.rows.slice(1, 3)) === oldRows, "L15 the old hit rows are left exactly as they were");
  check(golpes(game).length === 3
    && same((golpes(game).at(-1) || []).slice(1), ["2026-11", 3, "", 100, "run00000003"]),
    "L15 a hit still appends its six-column row after the old ones");
  const answer = game.json({ action: "villain" });
  check(same((answer.grades || [])[2], { grade: 3, goal: 100000, taken: 1000, hits: [{ name: "", points: 100 }, { name: "Lobo Feliz", points: 900 }] }),
    `L15 old five-column rows still count in the villain (${JSON.stringify((answer.grades || [])[2])})`);
}

function runOfAnotherMonth() {
  const october = load("2026-10-20T10:00:00Z");
  hit(october, { grade: "3", points: "5000", run: "run00000009" });
  const november = load("2026-11-14T10:00:00Z", october.sheets);
  const answer = hit(november, { grade: "3", points: "100", run: "run00000009" });
  check(same(answer, { ok: true }) && golpes(november).length === 2 && golpes(november)[0][4] === 5000
    && same((golpes(november).at(-1) || []).slice(1), ["2026-11", 3, "", 100, "run00000009"]),
    "L15 last month's row with the same run id is not raised: the hit appends a new row");
  const saved = add(november, { grade: "3", points: "200", run: "run00000009" });
  check(saved.ok === true && golpes(november).length === 2 && golpes(november)[0][4] === 5000
    && same((golpes(november)[1] || []).slice(1), ["2026-11", 3, "Tigre Veloz", 200, "run00000009"]),
    `L15 an add names this month's hit row of its run and never last month's (${JSON.stringify(golpes(november).map((row) => row.slice(1)))})`);
}

function hitCallback() {
  const game = load();
  const wrapped = game.get({ action: "hit", grade: "3", points: "250", run: "run00000010", callback: "capitan_cb3" });
  check(wrapped.mime === "JAVASCRIPT" && wrapped.text === 'capitan_cb3({"ok":true});',
    `L15 a hit wraps its answer for a JSONP callback (${wrapped.text})`);
  check(golpes(game).length === 1 && golpes(game)[0][4] === 250, "L15 the wrapped hit still logs its row");
  const evil = game.get({ action: "hit", grade: "3", points: "250", run: "run00000011", callback: "alert(1)//" });
  check(evil.mime === "JSON" && JSON.parse(evil.text).ok === false && golpes(game).length === 1,
    "L15 an unsafe callback name is refused for a hit and logs nothing");
  const plain = game.get({ action: "hit", grade: "3", points: "250", run: "run00000012" });
  check(plain.mime === "JSON" && same(JSON.parse(plain.text), { ok: true }), "L15 without a callback a hit answers plain JSON");
}

// ranking-justo L16: a run id belongs to one pupil and one grade. A second pupil
// reusing it never renames the first pupil's hit, and another grade never shares it.
function runStaysWithItsPupil() {
  const game = load();
  const first = add(game, { grade: "3", points: "1200", run: "sharedrun01", lock: "0,1,2" });
  const second = add(game, { grade: "3", points: "100", animal: "Panda", run: "sharedrun01", lock: "3,4,5" });
  check(first.ok === true && second.ok === true && game.rows().length === 2 && golpes(game).length === 2
    && same((golpes(game)[0] || []).slice(1), ["2026-11", 3, "Tigre Veloz", 1200, "sharedrun01"])
    && same((golpes(game)[1] || []).slice(1), ["2026-11", 3, "Panda Veloz", 100, "sharedrun01"]),
    `L16 a reused run id never renames or raises the first pupil's hit: the save appends its own row (${JSON.stringify(golpes(game).map((row) => row.slice(1)))})`);

  const repeat = load();
  add(repeat, { grade: "3", points: "1200", run: "samename01", lock: "0,1,2" });
  add(repeat, { grade: "3", points: "1500", run: "samename01", lock: "0,1,2" });
  check(golpes(repeat).length === 1
    && same((golpes(repeat)[0] || []).slice(1), ["2026-11", 3, "Tigre Veloz", 1500, "samename01"]),
    `L16 the same pupil repeating its own run only raises its hit (${JSON.stringify((golpes(repeat)[0] || []).slice(1))})`);
  add(repeat, { grade: "3", points: "900", run: "samename01", lock: "0,1,2" });
  check(golpes(repeat).length === 1 && golpes(repeat)[0][4] === 1500,
    "L16 repeating its own run with fewer points never lowers the hit");

  const anonymous = load();
  hit(anonymous, { grade: "3", points: "800", run: "anonimo001" });
  const named = add(anonymous, { grade: "3", points: "900", run: "anonimo001", lock: "0,1,2" });
  check(named.ok === true && golpes(anonymous).length === 1
    && same((golpes(anonymous)[0] || []).slice(1), ["2026-11", 3, "Tigre Veloz", 900, "anonimo001"]),
    "L16 an anonymous row of the saved run takes the name and the best points");
}

function runBelongsToItsGrade() {
  const game = load();
  hit(game, { grade: "6", points: "500", run: "cruzado001" });
  const other = hit(game, { grade: "3", points: "700", run: "cruzado001" });
  check(same(other, { ok: true }) && golpes(game).length === 2
    && same((golpes(game)[0] || []).slice(1), ["2026-11", 6, "", 500, "cruzado001"])
    && same((golpes(game)[1] || []).slice(1), ["2026-11", 3, "", 700, "cruzado001"]),
    `L16 a hit whose run id belongs to another grade appends its own row and raises nothing (${JSON.stringify(golpes(game).map((row) => row.slice(1)))})`);

  const saved = load();
  hit(saved, { grade: "6", points: "500", run: "cruzado002" });
  const answer = add(saved, { grade: "3", points: "900", run: "cruzado002", lock: "0,1,2" });
  check(answer.ok === true && golpes(saved).length === 2
    && same((golpes(saved)[0] || []).slice(1), ["2026-11", 6, "", 500, "cruzado002"])
    && same((golpes(saved)[1] || []).slice(1), ["2026-11", 3, "Tigre Veloz", 900, "cruzado002"]),
    "L16 a save names only the row of its own grade and never the other grade's");
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
levelThreeEveryGrade();
lockRequiredInPictureGrades();
lockedBest();
lockedScopesAndLegacy();
differentNames();
dateCellsAndForgottenLock();
ownPosition();
ownPositionOutsideTop();
lockRejections();
pictureSheets();
pictureSetKey();
pictureAdds();
pictureLocks();
hitLog();
noHitOnFailure();
villainScreen();
villainGoals();
villainCallback();
hitAppends();
hitKeepsTheBest();
runSharedByHitAndAdd();
addRunIsOptional();
hitRejections();
hitBrake();
oldGolpesTab();
runOfAnotherMonth();
hitCallback();
runStaysWithItsPupil();
runBelongsToItsGrade();
console.log(`TOTAL: ${okCount} ok, ${failCount} FAIL`);
process.exit(failCount ? 1 : 0);
