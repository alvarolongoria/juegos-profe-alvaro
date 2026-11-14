// Monthly ranking for "Naves del teclado" (S11).
//
// Paste this file into the Apps Script editor of a Google Sheet owned by the
// school account (Extensions > Apps Script) and deploy it as a web app.
// It stores only an invented name built from two closed lists, the grade, the
// points and the date: never a real name, an email or anything that identifies
// a child. The teacher can delete any row by hand at any time.
//
// Requests (GET, so a <script> tag can call it too):
//   ?action=top&grade=5                         -> top 10 of the current month
//   ?action=add&animal=Tigre&adjective=Veloz&grade=5&points=1200
//   &callback=name (optional)                   -> answer wrapped as name({...});

// The game shows exactly these words; anything else is refused.
var ANIMALS = ["Tigre", "León", "Delfín", "Águila", "Lince", "Búho", "Zorro", "Koala",
  "Panda", "Halcón", "Lobo", "Pingüino", "Tortuga", "Jaguar", "Colibrí", "Ballena"];
// Adjectives that fit both "el Tigre" and "la Tortuga", so every pair is correct.
var ADJECTIVES = ["Veloz", "Valiente", "Feliz", "Audaz", "Genial", "Brillante", "Gigante",
  "Ágil", "Fuerte", "Alegre", "Leal", "Tenaz", "Imparable", "Increíble", "Elegante", "Sonriente"];

var SHEET = "Ranking";
var HEADER = ["Fecha", "Mes", "Curso", "Nombre", "Puntos"];
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

function sheet() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var found = book.getSheetByName(SHEET);
  if (found) return found;
  var created = book.insertSheet(SHEET);
  created.appendRow(HEADER);
  return created;
}

function topOf(grade) {
  var month = currentMonth();
  var rows = sheet().getDataRange().getValues().slice(1);
  var entries = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (String(row[1]) === month && Number(row[2]) === grade) entries.push({ name: String(row[3]), points: Number(row[4]) });
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
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // A simple brake against someone flooding the sheet.
    var cache = CacheService.getScriptCache();
    var key = "adds-" + Math.floor(Date.now() / 60000);
    var count = Number(cache.get(key) || 0);
    if (count >= MAX_ADDS_PER_MINUTE) return { ok: false, error: "too many" };
    cache.put(key, String(count + 1), 120);
    sheet().appendRow([new Date(), currentMonth(), grade, params.animal + " " + params.adjective, Number(params.points)]);
  } finally {
    lock.releaseLock();
  }
  var found = topOf(grade);
  return { ok: true, grade: grade, month: found.month, top: found.top };
}
