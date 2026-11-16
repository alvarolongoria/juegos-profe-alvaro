// Monthly ranking for "Naves del teclado" (S11).
//
// Paste this file into the Apps Script editor of a Google Sheet owned by the
// school account (Extensions > Apps Script) and deploy it as a web app.
// It stores only an invented name built from two closed lists, the grade, the
// points and the date: never a real name, an email or anything that identifies
// a child. The teacher can delete any row by hand at any time.
//
// Class keys: each grade has a secret word (tab «Claves») that the teacher
// writes on the board. A score is saved only with a key, and the key tells
// the child's real grade: a key may enter its own grade or an older one, so a
// 6º child cannot fill 1º's ranking. On the first request of each month the
// six keys change by themselves. The teacher may also edit the tab by hand.
//
// Public requests (GET, so a <script> tag can call it too):
//   ?action=top&grade=5                         -> top 10 of the current month
//   ?action=add&animal=Tigre&adjective=Veloz&grade=5&points=1200&key=sol
//   &callback=name (optional)                   -> answer wrapped as name({...});
//
// Protected requests for the Telegram bot (form POST only, never GET):
//   action=keys&secret=...                      -> { month, keys: { "1": "sol", ... } }
//   action=setkey&grade=6&key=cometa&secret=... -> changes one grade's key
// The secret is the Script Property BOT_SECRET (Project Settings > Script
// Properties). Never write it in this file: this file is public. Without that
// property the protected requests are switched off.

// The game shows exactly these words; anything else is refused.
var ANIMALS = ["Tigre", "León", "Delfín", "Águila", "Lince", "Búho", "Zorro", "Koala",
  "Panda", "Halcón", "Lobo", "Pingüino", "Tortuga", "Jaguar", "Colibrí", "Ballena"];
// Adjectives that fit both "el Tigre" and "la Tortuga", so every pair is correct.
var ADJECTIVES = ["Veloz", "Valiente", "Feliz", "Audaz", "Genial", "Brillante", "Gigante",
  "Ágil", "Fuerte", "Alegre", "Leal", "Tenaz", "Imparable", "Increíble", "Elegante", "Sonriente"];

// Short words without accents or ñ, easy to type for the youngest grades.
var KEY_WORDS = ["sol", "luna", "mar", "nube", "pez", "gato", "flor", "rayo", "faro", "lago",
  "pino", "oso", "rana", "coco", "kiwi", "mono", "loro", "vaca", "pato", "foca",
  "tren", "barco", "globo", "copa", "lapiz", "mesa", "rosa", "trigo", "uva", "pera",
  "limon", "nieve", "playa", "monte", "isla", "cielo", "fuego", "hoja", "roca", "selva"];

var SHEET = "Ranking";
var HEADER = ["Fecha", "Mes", "Curso", "Nombre", "Puntos", "Curso alumno"];
var KEYS_SHEET = "Claves";
var KEYS_HEADER = ["Curso", "Clave", "Mes"];
var GRADES = [1, 2, 3, 4, 5, 6];
var TIME_ZONE = "Europe/Madrid";
var TOP_SIZE = 10;
var MAX_POINTS = 100000;
var MAX_ADDS_PER_MINUTE = 30;

function doGet(e) {
  var params = (e && e.parameter) || {};
  var callback = params.callback;
  if (callback !== undefined && !/^[A-Za-z_$][\w$]{0,40}$/.test(callback)) {
    return reply({ ok: false, error: "bad callback" });
  }
  var result;
  try {
    if (params.action === "top") result = top(params);
    else if (params.action === "add") result = add(params);
    else result = { ok: false, error: "unknown action" };
  } catch (error) {
    result = { ok: false, error: "server error" };
  }
  return reply(result, callback);
}

// Only the bot's protected actions arrive by POST.
function doPost(e) {
  var params = (e && e.parameter) || {};
  var result;
  try {
    if (!isBot(params.secret)) result = { ok: false, error: "forbidden" };
    else if (params.action === "keys") result = readKeys();
    else if (params.action === "setkey") result = setKey(params);
    else result = { ok: false, error: "unknown action" };
  } catch (error) {
    result = { ok: false, error: "server error" };
  }
  return reply(result);
}

function isBot(secret) {
  var expected = PropertiesService.getScriptProperties().getProperty("BOT_SECRET");
  if (!expected || typeof secret !== "string" || secret.length !== expected.length) return false;
  // Compare every character, so the answer time does not hint how much matched.
  var difference = 0;
  for (var i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ secret.charCodeAt(i);
  return difference === 0;
}

function reply(result, callback) {
  var text = JSON.stringify(result);
  if (callback) {
    return ContentService.createTextOutput(callback + "(" + text + ");").setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

function currentMonth() {
  return Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM");
}

function readGrade(value) {
  if (!/^[1-6]$/.test(String(value))) return null;
  return Number(value);
}

function sheetNamed(name, header) {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var found = book.getSheetByName(name);
  if (!found) {
    found = book.insertSheet(name);
    found.appendRow(header);
  } else if (found.getRange(1, header.length).getValue() !== header[header.length - 1]) {
    // A sheet from an older version gains the new column titles.
    found.getRange(1, 1, 1, header.length).setValues([header]);
  }
  return found;
}

function sheet() {
  return sheetNamed(SHEET, HEADER);
}

// The child types the key: spaces, capitals and accents do not matter.
function normalizeKey(value) {
  return String(value === undefined || value === null ? "" : value).trim().toLowerCase()
    .replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i")
    .replace(/[óòö]/g, "o").replace(/[úùü]/g, "u").replace(/ñ/g, "n");
}

// The six keys of the current month; on the first use of a month they change.
// Call only while holding the script lock.
function currentKeys() {
  var month = currentMonth();
  var tab = sheetNamed(KEYS_SHEET, KEYS_HEADER);
  var rows = tab.getDataRange().getValues().slice(1);
  var keys = {}, stale = rows.length < GRADES.length, previous = [];
  for (var i = 0; i < GRADES.length; i++) {
    var row = rows[i] || [];
    var key = normalizeKey(row[1]);
    previous.push(key);
    if (Number(row[0]) !== GRADES[i] || !key || monthOf(row[2]) !== month) stale = true;
    keys[GRADES[i]] = key;
  }
  if (!stale) return keys;
  var pool = KEY_WORDS.filter(function (word) { return previous.indexOf(word) < 0; });
  var values = [];
  for (var g = 0; g < GRADES.length; g++) {
    var word = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    keys[GRADES[g]] = word;
    // The apostrophe keeps the month as text, so Sheets never turns it into a date.
    values.push([GRADES[g], word, "'" + month]);
  }
  tab.getRange(2, 1, GRADES.length, 3).setValues(values);
  return keys;
}

function withLock(work) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return work();
  } finally {
    lock.releaseLock();
  }
}

function readKeys() {
  return withLock(function () {
    return { ok: true, month: currentMonth(), keys: currentKeys() };
  });
}

function setKey(params) {
  var grade = readGrade(params.grade);
  if (grade === null) return { ok: false, error: "bad grade" };
  var key = normalizeKey(params.key);
  if (!/^[a-z]{3,12}$/.test(key)) return { ok: false, error: "bad key" };
  return withLock(function () {
    var keys = currentKeys();
    for (var g in keys) if (Number(g) !== grade && keys[g] === key) return { ok: false, error: "key in use" };
    keys[grade] = key;
    sheetNamed(KEYS_SHEET, KEYS_HEADER).getRange(grade + 1, 1, 1, 3).setValues([[grade, key, "'" + currentMonth()]]);
    return { ok: true, month: currentMonth(), keys: keys };
  });
}

// The grade whose key this is, or null.
function gradeOfKey(keys, value) {
  var key = normalizeKey(value);
  if (!key) return null;
  for (var g in keys) if (keys[g] === key) return Number(g);
  return null;
}

// Sheets may have turned an older "2026-11" cell into a date: read both forms.
function monthOf(value) {
  return value instanceof Date ? Utilities.formatDate(value, TIME_ZONE, "yyyy-MM") : String(value);
}

function topOf(grade) {
  var month = currentMonth();
  var rows = sheet().getDataRange().getValues().slice(1);
  var entries = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (monthOf(row[1]) !== month || Number(row[2]) !== grade) continue;
    var entry = { name: String(row[3]), points: Number(row[4]) };
    // Mark only a child from a younger grade; older rows have no real grade.
    var real = readGrade(row[5]);
    if (real !== null && real !== grade) entry.from = real;
    entries.push(entry);
  }
  entries.sort(function (a, b) { return b.points - a.points; });
  return { month: month, top: entries.slice(0, TOP_SIZE) };
}

function top(params) {
  var grade = readGrade(params.grade);
  if (grade === null) return { ok: false, error: "bad grade" };
  var found = topOf(grade);
  return { ok: true, grade: grade, month: found.month, top: found.top };
}

function add(params) {
  var grade = readGrade(params.grade);
  if (grade === null) return { ok: false, error: "bad grade" };
  if (ANIMALS.indexOf(params.animal) < 0 || ADJECTIVES.indexOf(params.adjective) < 0) return { ok: false, error: "bad name" };
  if (!/^\d{1,6}$/.test(String(params.points)) || Number(params.points) > MAX_POINTS) return { ok: false, error: "bad points" };
  var refused = withLock(function () {
    // A simple brake against someone flooding the sheet or guessing keys.
    var cache = CacheService.getScriptCache();
    var slot = "adds-" + Math.floor(Date.now() / 60000);
    var count = Number(cache.get(slot) || 0);
    if (count >= MAX_ADDS_PER_MINUTE) return { ok: false, error: "too many" };
    cache.put(slot, String(count + 1), 120);
    var real = gradeOfKey(currentKeys(), params.key);
    if (real === null) return { ok: false, error: "bad key" };
    // A key enters its own grade or an older one, never a younger one.
    if (real > grade) return { ok: false, error: "wrong grade", keyGrade: real };
    // The apostrophe keeps the month as text, so Sheets never turns it into a date.
    sheet().appendRow([new Date(), "'" + currentMonth(), grade, params.animal + " " + params.adjective, Number(params.points), real]);
    return null;
  });
  if (refused) return refused;
  var found = topOf(grade);
  return { ok: true, grade: grade, month: found.month, top: found.top };
}
