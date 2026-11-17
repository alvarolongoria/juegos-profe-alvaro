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
// Properties) or, without it, PRIVATE_BOT_SECRET from the private file that
// ranking/deploy.sh adds. Never write it in this file: this file is public.
// Without either one the protected requests are switched off.

// The game shows exactly these words; anything else is refused.
var ANIMALS = ["Tigre", "León", "Delfín", "Águila", "Lince", "Búho", "Zorro", "Koala",
  "Panda", "Halcón", "Lobo", "Pingüino", "Tortuga", "Jaguar", "Colibrí", "Ballena"];
// Adjectives that fit both "el Tigre" and "la Tortuga", so every pair is correct.
var ADJECTIVES = ["Veloz", "Valiente", "Feliz", "Audaz", "Genial", "Brillante", "Gigante",
  "Ágil", "Fuerte", "Alegre", "Leal", "Tenaz", "Imparable", "Increíble", "Elegante", "Sonriente"];

// Generated keys are a familiar word plus a two-digit number ("tiburón 47",
// "luna 12"): easy for a child to remember and to write on the board, and
// 400+ words x 90 numbers is far too many to guess by trying.
var KEY_WORDS = [
  "abanico", "abeja", "abrigo", "acantilado", "águila", "aguja", "ajedrez", "albóndiga",
  "alfombra", "alicate", "almendra", "almohada", "anillo", "antena", "araña", "arándano",
  "árbol", "arco", "arcoiris", "ardilla", "arena", "armario", "arpa", "arroyo",
  "arroz", "astronauta", "atletismo", "avellana", "avenida", "avestruz", "avión", "azúcar",
  "bahía", "baile", "ballena", "balón", "baloncesto", "banco", "bandeja", "baraja",
  "barandilla", "barco", "béisbol", "bici", "bidon", "bocadillo", "bolsa", "bombero",
  "bosque", "botón", "brocha", "bruja", "brujula", "bufanda", "burro", "caballero",
  "caballo", "cabaña", "cabra", "calabacín", "calabaza", "calcetín", "camaleón", "camello",
  "camino", "camisa", "campana", "canasta", "canción", "cangrejo", "canguro", "canica",
  "canicas", "caracol", "caramelo", "carrito", "carta", "cartero", "cascada", "castillo",
  "castor", "cebolla", "cebra", "cepillo", "cerdo", "cereza", "charca", "chimenea",
  "chocolate", "ciclismo", "ciervo", "cinta", "circo", "clavo", "coche", "cocinero",
  "cocodrilo", "cohete", "colina", "columpio", "cometa", "conejo", "cordón", "corona",
  "cortina", "cuaderno", "cuadro", "cubo", "cuchara", "cuchillo", "cuento", "cuerda",
  "cuervo", "cueva", "cumbre", "dado", "delantal", "delfín", "desierto", "diario",
  "disfraz", "dragón", "duende", "duna", "elefante", "embalse", "embudo", "ensalada",
  "erizo", "escalera", "escarabajo", "escoba", "escudo", "espada", "espejo", "espinaca",
  "esquí", "estanque", "estrella", "fantasma", "faro", "farol", "fiesta", "flauta",
  "flecha", "flor", "flotador", "foca", "frambuesa", "fresa", "fuego", "fuente",
  "futbol", "gacela", "gafas", "galaxia", "galleta", "gallina", "garbanzo", "gigante",
  "gimnasia", "glaciar", "globo", "gorra", "gorrión", "granada", "granja", "grillo",
  "guante", "guisante", "guitarra", "hada", "harina", "hebilla", "helado", "hielo",
  "higo", "hipopótamo", "hockey", "hoja", "horizonte", "hormiga", "hucha", "huerto",
  "huevo", "hurón", "iguana", "imán", "isla", "jabalí", "jabón", "jardín",
  "jardinero", "jarra", "jersey", "jirafa", "joya", "judo", "koala", "lagarto",
  "lago", "laguna", "lámpara", "langosta", "lápiz", "lechuga", "lentejas", "león",
  "libélula", "libro", "limón", "limonada", "lince", "linterna", "llama", "llave",
  "lluvia", "loro", "luciérnaga", "luna", "lupa", "maceta", "maestra", "magia",
  "mago", "maíz", "maleta", "manantial", "mandarina", "manta", "mantequilla", "manzana",
  "mapa", "marea", "mariposa", "mariquita", "martillo", "medalla", "médico", "medusa",
  "melocotón", "melón", "mercado", "meseta", "meteorito", "miel", "mochila", "mofeta",
  "molino", "moneda", "montaña", "mosaico", "mosquito", "muelle", "muralla", "murcielago",
  "músico", "naipe", "naranja", "natacion", "nevera", "niebla", "nieve", "nube",
  "nutria", "oasis", "ola", "orca", "oveja", "paloma", "palomitas", "panaderia",
  "panda", "pantalla", "pantalón", "pantera", "paquete", "paraguas", "parchís", "parque",
  "pastel", "patata", "patinaje", "patinete", "payaso", "pegamento", "peine", "pelícano",
  "pelota", "pendiente", "pepino", "pera", "percha", "piano", "piedra", "pimiento",
  "pinar", "pingüino", "pintor", "pinza", "pirata", "pizarra", "planeta", "plátano",
  "plato", "playa", "pluma", "pompa", "pradera", "puente", "puerro", "puerta",
  "pulpo", "pulsera", "puma", "pupitre", "queso", "rabano", "radio", "rama",
  "rampa", "raqueta", "ratón", "rayo", "regla", "reloj", "remo", "repollo",
  "retrato", "riachuelo", "rinoceronte", "río", "robot", "rocío", "rodillo", "rueda",
  "sabana", "saco", "salamandra", "salchicha", "salina", "saltamontes", "sandalia", "sandía",
  "sartén", "selva", "semáforo", "semilla", "sendero", "serpiente", "silla", "sirena",
  "sobre", "sombrero", "sonajero", "sopa", "taladro", "tambor", "tapon", "tarro",
  "tarta", "taza", "teatro", "teclado", "tejado", "telescopio", "tenedor", "tenis",
  "terraza", "tetera", "tiburón", "tienda", "tigre", "tijeras", "toalla", "tobogán",
  "tomate", "tormenta", "tornillo", "torre", "tortilla", "tortuga", "tren", "trenza",
  "trofeo", "trompeta", "trompo", "trucha", "tucán", "tundra", "túnel", "unicornio",
  "vaca", "valle", "vasija", "vaso", "vela", "velero", "vendaje", "ventana",
  "vidrio", "viento", "vinagre", "violín", "volante", "volcán", "voleibol", "yegua",
  "yogur", "zanahoria", "zapato", "zorro", "zueco",
];
// A key is a word of 3 to 20 letters, optionally followed by one or two digits.
var KEY_SHAPE = /^[a-z]{3,20}( [0-9]{1,2})?$/;
// Words a class should never see on the board, by hand or generated.
var BLOCKED_KEYS = ["caca", "culo", "pedo", "pene", "pito", "popo", "puta", "puto", "teta", "nazi", "cono", "mear", "mierda"];

var SHEET = "Ranking";
var HEADER = ["Fecha", "Mes", "Curso", "Nombre", "Puntos", "Curso alumno", "Nivel"];
// Grades that may also enter the ranking after level 3 (a level-4 finish always ranks above).
var LEVEL_THREE_GRADES = [3];
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
    else if (params.action === "rotate") result = rotateKeys();
    else result = { ok: false, error: "unknown action" };
  } catch (error) {
    result = { ok: false, error: "server error" };
  }
  return reply(result);
}

function isBot(secret) {
  var expected = PropertiesService.getScriptProperties().getProperty("BOT_SECRET");
  // ranking/deploy.sh may add a private file (Secreto.js) defining PRIVATE_BOT_SECRET:
  // it exists only in the Apps Script project, never in this public repository.
  if (!expected && typeof PRIVATE_BOT_SECRET === "string" && PRIVATE_BOT_SECRET.length >= 16) expected = PRIVATE_BOT_SECRET;
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

// The child types the key: spaces (even a missing one before the number), capitals and accents do not matter.
function normalizeKey(value) {
  return String(value === undefined || value === null ? "" : value).trim().toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i")
    .replace(/[óòö]/g, "o").replace(/[úùü]/g, "u").replace(/ñ/g, "n")
    .replace(/([a-z])(\d)/g, "$1 $2");
}

// A key only counts when it looks like a key and is not a blocked word.
function keyShapeOk(key) {
  if (!KEY_SHAPE.test(key)) return false;
  return BLOCKED_KEYS.indexOf(key.split(" ")[0]) < 0;
}

// One candidate: a word of the pool plus a two-digit number.
function mintCandidate() {
  return KEY_WORDS[Math.floor(Math.random() * KEY_WORDS.length)] + " "
    + (10 + Math.floor(Math.random() * 90));
}

// A new key: a word no other row uses plus a two-digit number, never a key
// already in the tab. Always answers: a tab full of hand edits cannot hang it.
function newKey(avoid, avoidWords) {
  for (var attempt = 0; attempt < 200; attempt++) {
    var key = mintCandidate();
    var normalized = normalizeKey(key);
    if (avoid.indexOf(normalized) < 0 && avoidWords.indexOf(normalized.split(" ")[0]) < 0) return key;
  }
  // Chance gave no fresh word: walk the pool in order and take the first free one.
  for (var i = 0; i < KEY_WORDS.length; i++) {
    if (avoidWords.indexOf(normalizeKey(KEY_WORDS[i])) >= 0) continue;
    for (var number = 10; number <= 99; number++) {
      var candidate = KEY_WORDS[i] + " " + number;
      if (avoid.indexOf(normalizeKey(candidate)) < 0) return candidate;
    }
  }
  // Every word of the pool is already on the board, so no honest key is left.
  throw new Error("no free key");
}

// The six keys of the current month. The tab may have been edited by hand:
// a grade keeps its key only when it has one valid row of this month and no
// other row of the tab has the same key. Any other grade gets a new key, so on the first
// use of a new month all six change. Call only while holding the script lock.
function currentKeys() {
  var month = currentMonth();
  var tab = sheetNamed(KEYS_SHEET, KEYS_HEADER);
  var rows = tab.getDataRange().getValues().slice(1);
  var found = {}, seen = {}, avoid = [], avoidWords = [], uses = {};
  for (var i = 0; i < rows.length; i++) {
    var grade = readGrade(rows[i][0]);
    var key = normalizeKey(rows[i][1]);
    // Count every row, so a repeated grade cannot hide a key shared with another.
    if (key) {
      avoid.push(key);
      uses[key] = (uses[key] || 0) + 1;
      var word = key.split(" ")[0];
      if (avoidWords.indexOf(word) < 0) avoidWords.push(word);
    }
    if (grade === null) continue;
    seen[grade] = (seen[grade] || 0) + 1;
    // A key is kept exactly as the teacher wrote it ("Tiburón 47").
    if (monthOf(rows[i][2]) === month && keyShapeOk(key)) found[grade] = String(rows[i][1]).trim();
  }
  var keys = {};
  var tidy = rows.length === GRADES.length;
  for (var n = 0; n < GRADES.length; n++) {
    var each = GRADES[n], kept = found[each];
    if (seen[each] === 1 && kept && uses[normalizeKey(kept)] === 1) keys[each] = kept;
    var row = rows[n] || [];
    if (!keys[each] || Number(row[0]) !== each || row[1] !== kept) tidy = false;
  }
  if (tidy) return keys;
  var values = [];
  for (var m = 0; m < GRADES.length; m++) {
    var level = GRADES[m];
    if (!keys[level]) {
      keys[level] = newKey(avoid, avoidWords);
      avoid.push(normalizeKey(keys[level]));
      avoidWords.push(normalizeKey(keys[level]).split(" ")[0]);
    }
    // The apostrophe keeps the month as text, so Sheets never turns it into a date.
    values.push([level, keys[level], "'" + month]);
  }
  tab.getRange(2, 1, GRADES.length, 3).setValues(values);
  // Extra rows (notes, a 7th grade, repeated grades) are removed, never trusted.
  if (rows.length > GRADES.length) tab.deleteRows(GRADES.length + 2, rows.length - GRADES.length);
  return keys;
}

function withLock(work) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return work();
  } finally {
    // Write everything to the sheet before another request may read it.
    SpreadsheetApp.flush();
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
  if (!keyShapeOk(key)) return { ok: false, error: "bad key" };
  return withLock(function () {
    var keys = currentKeys();
    for (var g in keys) if (Number(g) !== grade && normalizeKey(keys[g]) === key) return { ok: false, error: "key in use" };
    keys[grade] = key;
    sheetNamed(KEYS_SHEET, KEYS_HEADER).getRange(grade + 1, 1, 1, 3).setValues([[grade, key, "'" + currentMonth()]]);
    return { ok: true, month: currentMonth(), keys: keys };
  });
}

// Fresh keys for the current month on demand: the teacher may want new ones
// before day 1, for example after a key has gone round the playground.
function rotateKeys() {
  return withLock(function () {
    var month = currentMonth();
    var old = currentKeys();
    var avoid = [], avoidWords = [], keys = {}, values = [];
    for (var g in old) {
      avoid.push(normalizeKey(old[g]));
      avoidWords.push(normalizeKey(old[g]).split(" ")[0]);
    }
    for (var n = 0; n < GRADES.length; n++) {
      var level = GRADES[n];
      keys[level] = newKey(avoid, avoidWords);
      avoid.push(normalizeKey(keys[level]));
      avoidWords.push(normalizeKey(keys[level]).split(" ")[0]);
      values.push([level, keys[level], "'" + month]);
    }
    var tab = sheetNamed(KEYS_SHEET, KEYS_HEADER);
    var extra = tab.getDataRange().getValues().length - 1 - GRADES.length;
    tab.getRange(2, 1, GRADES.length, 3).setValues(values);
    if (extra > 0) tab.deleteRows(GRADES.length + 2, extra);
    return { ok: true, month: month, keys: keys };
  });
}

// The grade whose key this is, or null.
function gradeOfKey(keys, value) {
  var key = normalizeKey(value);
  if (!key) return null;
  for (var g in keys) if (normalizeKey(keys[g]) === key) return Number(g);
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
    var level = row[6] === "" || row[6] === undefined ? 4 : Number(row[6]);
    var entry = { name: String(row[3]), points: Number(row[4]) };
    // Only the lower level is marked: a row without a level is a level-4 finish.
    if (level === 3) entry.level = 3;
    // Mark only a child from a younger grade; older rows have no real grade.
    var real = readGrade(row[5]);
    if (real !== null && real !== grade) entry.from = real;
    entries.push(entry);
  }
  // Finishing level 4 always counts more than stopping at level 3, then points decide.
  entries.sort(function (a, b) { return (b.level === 3 ? 0 : 1) - (a.level === 3 ? 0 : 1) || b.points - a.points; });
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
  // No level means the old page: a level-4 finish.
  var level = params.level === undefined ? 4 : Number(params.level);
  if (level !== 4 && !(level === 3 && LEVEL_THREE_GRADES.indexOf(grade) >= 0)) return { ok: false, error: "bad level" };
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
    sheet().appendRow([new Date(), "'" + currentMonth(), grade, params.animal + " " + params.adjective, Number(params.points), real, level]);
    return null;
  });
  if (refused) return refused;
  var found = topOf(grade);
  return { ok: true, grade: grade, month: found.month, top: found.top };
}
