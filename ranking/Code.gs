// Monthly ranking for "Naves del teclado" (S11).
//
// Paste this file into the Apps Script editor of a Google Sheet owned by the
// school account (Extensions > Apps Script) and deploy it as a web app.
// It stores only an invented name built from two closed lists, the grade, the
// points and the date: never a real name, an email or anything that identifies
// a child. The teacher can delete any row by hand at any time.
//
// Class keys (tab «Claves»): 1º-2º use a picture, and 3º-6º a secret word;
// the teacher puts the key on the board. Pictures are stored as "🦁 león"
// and may be sent as the emoji, its word or both. A key tells the child's
// real grade: it may enter its own grade or an older one, never a younger one.
// The six keys change on the first request of each month; the teacher may also
// edit the tab by hand.
//
// «Golpes» (hits): the Ranking tab only keeps each pupil's best, so every saved
// run also appends one row here. The monthly villain screen adds up those rows.
// Each run of the game carries a random id («Partida»): the game may send an
// anonymous hit when a run ends, also a lost one, and repeat it safely, and the
// later save of that same run only names the row instead of counting it twice.
// «Metas» (goals): the points each grade must reach this month. The teacher may
// edit a goal by hand; a blank or impossible goal falls back to the default.
//
// Public requests (GET, so a <script> tag can call it too):
//   ?action=top&grade=5                         -> top 10 of the current month
//   ?action=villain                             -> monthly villain: goal and hits of the six grades
//   ?action=hit&grade=5&points=1200&run=abc12345 -> one anonymous run of the villain, no name and no key
//   ?action=add&animal=Tigre&adjective=Veloz&grade=1&points=1200&key=león&lock=3,0
//   ?action=add&animal=Tigre&adjective=Veloz&grade=5&points=1200&key=sol&lock=3,0,7
//     lock is two ordered palette indices for form grades 1º-2º, three for
//     3º-6º; an absent lock is an old page in 3º-6º and is refused in 1º-2º.
//   &callback=name (optional)                   -> answer wrapped as name({...});
//
// Protected requests for the Telegram bot (form POST only, never GET):
//   action=keys&secret=...                      -> { month, keys: { "1": "🦁 león", ... } }
//   action=setkey&grade=1&key=león&secret=...  -> changes a picture key
//   action=setkey&grade=6&key=cometa&secret=... -> changes a word key
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
// The six drawings on the board; the first two grades always use different ones.
var PICTURE_KEYS = ["🦁 león", "🐸 rana", "🌻 girasol", "🚂 tren", "🐢 tortuga", "🍓 fresa"];
var PICTURE_GRADES = [1, 2];
// A word key is a word of 3 to 20 letters, optionally followed by one or two digits.
var KEY_SHAPE = /^[a-z]{3,20}( [0-9]{1,2})?$/;
// Words a class should never see on the board, by hand or generated.
var BLOCKED_KEYS = ["caca", "culo", "pedo", "pene", "pito", "popo", "puta", "puto", "teta", "nazi", "cono", "mear", "mierda"];

var SHEET = "Ranking";
var HEADER = ["Fecha", "Mes", "Curso", "Nombre", "Puntos", "Curso alumno", "Nivel", "Candado"];
// Grades that may also enter the ranking after level 3 (a level-4 finish always ranks above).
var LEVEL_THREE_GRADES = [1, 2, 3, 4, 5, 6];
var KEYS_SHEET = "Claves";
var KEYS_HEADER = ["Curso", "Clave", "Mes"];
var GRADES = [1, 2, 3, 4, 5, 6];
// Every saved run is a hit for the monthly villain (the Ranking tab keeps only the best).
var GOLPES_SHEET = "Golpes";
var GOLPES_HEADER = ["Fecha", "Mes", "Curso", "Nombre", "Puntos", "Partida"];
// The points each grade must reach this month, editable by the teacher.
var METAS_SHEET = "Metas";
var METAS_HEADER = ["Curso", "Meta"];
var DEFAULT_GOALS = { 1: 30000, 2: 60000, 3: 100000, 4: 120000, 5: 150000, 6: 200000 };
var HITS_SHOWN = 3;
var TIME_ZONE = "Europe/Madrid";
var TOP_SIZE = 10;
var MAX_POINTS = 100000;
var MAX_ADDS_PER_MINUTE = 30;
// Anonymous hits are much cheaper than a save, so they get a wider brake of their
// own: it never uses up the save brake, and a save never uses up this one.
var HITS_PER_MINUTE = 120;
// The id of one run of the game, new on every start or restart.
var RUN_SHAPE = /^[a-z0-9]{8,32}$/;

function doGet(e) {
  var params = (e && e.parameter) || {};
  var callback = params.callback;
  if (callback !== undefined && !/^[A-Za-z_$][\w$]{0,40}$/.test(callback)) {
    return reply({ ok: false, error: "bad callback" });
  }
  var result;
  try {
    if (params.action === "top") result = top(params);
    else if (params.action === "villain") result = villain();
    else if (params.action === "hit") result = hit(params);
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

function golpesSheet() {
  return sheetNamed(GOLPES_SHEET, GOLPES_HEADER);
}

// The child types the key: spaces (even a missing one before the number), capitals and accents do not matter.
function normalizeKey(value) {
  return String(value === undefined || value === null ? "" : value).trim().toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i")
    .replace(/[óòö]/g, "o").replace(/[úùü]/g, "u").replace(/ñ/g, "n")
    .replace(/([a-z])(\d)/g, "$1 $2");
}

// Match an emoji, its word, or both; always return the canonical board label.
function pictureKey(value) {
  var key = normalizeKey(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s/g, "");
  if (!key) return null;
  for (var i = 0; i < PICTURE_KEYS.length; i++) {
    var parts = PICTURE_KEYS[i].split(" ");
    var word = normalizeKey(parts[1]);
    if (key === parts[0] || key === word || key === parts[0] + word) return PICTURE_KEYS[i];
  }
  return null;
}

// A picture's word must not also identify a different grade's word key.
function keyIdentity(value) {
  return pictureKey(value) || normalizeKey(value);
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

// Pick from the available pictures, preferably not ones already in the tab.
// If every picture is mentioned, first avoid the picture grades' previous keys;
// only occupied current keys are mandatory when old or extra rows fill the tab.
function newPictureKey(occupied, avoid, previous) {
  previous = previous || [];
  var free = PICTURE_KEYS.filter(function (picture) { return occupied.indexOf(picture) < 0; });
  var fresh = free.filter(function (picture) { return avoid.indexOf(picture) < 0; });
  var changed = free.filter(function (picture) { return previous.indexOf(picture) < 0; });
  var choices = fresh.length ? fresh : changed.length ? changed : free;
  if (!choices.length) throw new Error("no free picture");
  return choices[Math.floor(Math.random() * choices.length)];
}

// The six keys of the current month. The tab may have been edited by hand:
// a grade keeps its key only when it has one valid row of this month and no
// other row of the tab has the same key (including picture aliases). Any other
// grade gets a new key. An optional picture override reserves a bot's requested
// key before minting the other grade. Call only while holding the script lock.
function currentKeys(overrideGrade, overrideKey) {
  var month = currentMonth();
  var tab = sheetNamed(KEYS_SHEET, KEYS_HEADER);
  var rows = tab.getDataRange().getValues().slice(1);
  var found = {}, seen = {}, avoid = [], avoidWords = [], uses = {}, avoidPictures = [], previousPictures = [];
  for (var i = 0; i < rows.length; i++) {
    var grade = readGrade(rows[i][0]);
    var key = normalizeKey(rows[i][1]);
    var picture = pictureKey(rows[i][1]);
    // Count every row, so a repeated grade cannot hide a key shared with another.
    if (key) {
      avoid.push(key);
      var identity = keyIdentity(rows[i][1]);
      uses[identity] = (uses[identity] || 0) + 1;
      var word = key.split(" ")[0];
      if (avoidWords.indexOf(word) < 0) avoidWords.push(word);
      if (picture && avoidPictures.indexOf(picture) < 0) avoidPictures.push(picture);
      if (picture && PICTURE_GRADES.indexOf(grade) >= 0 && previousPictures.indexOf(picture) < 0) previousPictures.push(picture);
    }
    if (grade === null) continue;
    seen[grade] = (seen[grade] || 0) + 1;
    if (monthOf(rows[i][2]) !== month) continue;
    if (PICTURE_GRADES.indexOf(grade) >= 0) {
      if (picture) found[grade] = picture;
    } else if (keyShapeOk(key)) {
      // Word keys are kept exactly as the teacher wrote them ("Tiburón 47").
      found[grade] = String(rows[i][1]).trim();
    }
  }
  var keys = {};
  var tidy = rows.length === GRADES.length;
  for (var n = 0; n < GRADES.length; n++) {
    var each = GRADES[n], kept = found[each];
    if (seen[each] === 1 && kept && uses[keyIdentity(kept)] === 1) keys[each] = kept;
    var row = rows[n] || [];
    if (!keys[each] || Number(row[0]) !== each || row[1] !== kept) tidy = false;
  }
  if (overrideGrade) {
    keys[overrideGrade] = overrideKey;
    tidy = false;
  }
  if (tidy) return keys;
  var occupiedPictures = [];
  for (var g in keys) {
    var occupied = pictureKey(keys[g]);
    if (occupied) occupiedPictures.push(occupied);
  }
  var values = [];
  for (var m = 0; m < GRADES.length; m++) {
    var level = GRADES[m];
    if (!keys[level]) {
      if (PICTURE_GRADES.indexOf(level) >= 0) {
        keys[level] = newPictureKey(occupiedPictures, avoidPictures, previousPictures);
        occupiedPictures.push(keys[level]);
      } else {
        keys[level] = newKey(avoid, avoidWords);
        avoid.push(normalizeKey(keys[level]));
        avoidWords.push(normalizeKey(keys[level]).split(" ")[0]);
      }
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
  var isPicture = PICTURE_GRADES.indexOf(grade) >= 0;
  var key = isPicture ? pictureKey(params.key) : normalizeKey(params.key);
  if (isPicture ? !key : !keyShapeOk(key)) return { ok: false, error: "bad key" };
  return withLock(function () {
    var keys;
    if (isPicture) {
      // Check current rows without tidying: a refused change must not write the sheet.
      var tab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(KEYS_SHEET);
      var rows = tab ? tab.getDataRange().getValues().slice(1) : [];
      for (var i = 0; i < rows.length; i++) {
        var other = readGrade(rows[i][0]);
        if (other === null || other === grade || monthOf(rows[i][2]) !== currentMonth()) continue;
        var valid = PICTURE_GRADES.indexOf(other) >= 0 ? pictureKey(rows[i][1]) : keyShapeOk(normalizeKey(rows[i][1]));
        if (valid && keyIdentity(rows[i][1]) === key) return { ok: false, error: "key in use" };
      }
      keys = currentKeys(grade, key);
    } else {
      keys = currentKeys();
      for (var g in keys) if (Number(g) !== grade && keyIdentity(keys[g]) === keyIdentity(key)) return { ok: false, error: "key in use" };
      keys[grade] = key;
      sheetNamed(KEYS_SHEET, KEYS_HEADER).getRange(grade + 1, 1, 1, 3).setValues([[grade, key, "'" + currentMonth()]]);
    }
    return { ok: true, month: currentMonth(), keys: keys };
  });
}

// Fresh keys for the current month on demand: the teacher may want new ones
// before day 1, for example after a key has gone round the playground.
function rotateKeys() {
  return withLock(function () {
    var month = currentMonth();
    // If this is the first request of a month, currentKeys() rotates once before
    // this explicit rotation. Do not accidentally bring back last month's pictures.
    var priorTab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(KEYS_SHEET);
    var priorRows = priorTab ? priorTab.getDataRange().getValues().slice(1) : [];
    var previousPictures = [], previousGrades = [];
    for (var i = 0; i < priorRows.length; i++) {
      var priorGrade = readGrade(priorRows[i][0]), priorPicture = pictureKey(priorRows[i][1]);
      if (PICTURE_GRADES.indexOf(priorGrade) >= 0 && priorPicture && previousGrades.indexOf(priorGrade) < 0) {
        previousGrades.push(priorGrade);
        if (previousPictures.indexOf(priorPicture) < 0) previousPictures.push(priorPicture);
      }
    }
    var old = currentKeys();
    var avoid = [], avoidWords = [], keys = {}, values = [], avoidPictures = [], occupiedPictures = previousPictures.slice();
    for (var g in old) {
      avoid.push(normalizeKey(old[g]));
      avoidWords.push(normalizeKey(old[g]).split(" ")[0]);
      var picture = pictureKey(old[g]);
      if (picture) {
        avoidPictures.push(picture);
        if (PICTURE_GRADES.indexOf(Number(g)) >= 0 && occupiedPictures.indexOf(picture) < 0) occupiedPictures.push(picture);
      }
    }
    for (var n = 0; n < GRADES.length; n++) {
      var level = GRADES[n];
      if (PICTURE_GRADES.indexOf(level) >= 0) {
        keys[level] = newPictureKey(occupiedPictures, avoidPictures);
        occupiedPictures.push(keys[level]);
      } else {
        keys[level] = newKey(avoid, avoidWords);
        avoid.push(normalizeKey(keys[level]));
        avoidWords.push(normalizeKey(keys[level]).split(" ")[0]);
      }
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
  var key = normalizeKey(value), picture = pictureKey(value);
  if (!key) return null;
  for (var g in keys) {
    if (PICTURE_GRADES.indexOf(Number(g)) >= 0) {
      if (picture && picture === keys[g]) return Number(g);
    } else if (normalizeKey(keys[g]) === key) return Number(g);
  }
  return null;
}

// Sheets may have turned an older "2026-11" cell into a date: read both forms.
function monthOf(value) {
  return value instanceof Date ? Utilities.formatDate(value, TIME_ZONE, "yyyy-MM") : String(value);
}

function topOf(grade, targetRow, month) {
  month = month || currentMonth();
  var rows = sheet().getDataRange().getValues().slice(1);
  var entries = [], target = null;
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
    if (i + 2 === targetRow) target = entry;
  }
  // Finishing level 4 always counts more than stopping at level 3, then points decide.
  entries.sort(function (a, b) { return (b.level === 3 ? 0 : 1) - (a.level === 3 ? 0 : 1) || b.points - a.points; });
  var result = { month: month, top: entries.slice(0, TOP_SIZE) };
  if (target) {
    // Identify the actual row, not its name: older unlocked rows may have the same name and score.
    result.me = { name: target.name, points: target.points, position: entries.indexOf(target) + 1, total: entries.length };
    if (target.level === 3) result.me.level = 3;
  }
  return result;
}

function top(params) {
  var grade = readGrade(params.grade);
  if (grade === null) return { ok: false, error: "bad grade" };
  var found = topOf(grade);
  return { ok: true, grade: grade, month: found.month, top: found.top };
}

// A goal the teacher typed. A blank, non-numeric or non-positive cell means
// "use the default for this grade"; a number typed as text still counts.
function goalValue(value, grade) {
  var text = String(value === undefined || value === null ? "" : value).trim();
  var number = text === "" ? NaN : Number(text);
  return isFinite(number) && number > 0 ? number : DEFAULT_GOALS[grade];
}

// The six goals of the month, creating the «Metas» tab with the default goals
// the first time. Only a missing row gains a default: an invalid cell keeps the
// teacher's text untouched and is simply read as the default.
// Call only while holding the script lock.
function readGoals() {
  var tab = sheetNamed(METAS_SHEET, METAS_HEADER);
  var rows = tab.getDataRange().getValues().slice(1);
  var goals = {}, seen = {}, missing = [];
  for (var i = 0; i < rows.length; i++) {
    var grade = readGrade(rows[i][0]);
    if (grade === null || seen[grade]) continue;
    seen[grade] = true;
    goals[grade] = goalValue(rows[i][1], grade);
  }
  for (var n = 0; n < GRADES.length; n++) {
    if (seen[GRADES[n]]) continue;
    goals[GRADES[n]] = DEFAULT_GOALS[GRADES[n]];
    missing.push([GRADES[n], DEFAULT_GOALS[GRADES[n]]]);
  }
  if (missing.length) tab.getRange(tab.getLastRow() + 1, 1, missing.length, 2).setValues(missing);
  return goals;
}

// A hit's moment. Sheets gives a date cell back as a Date; a hand-typed text
// cell is parsed, and anything unreadable sinks to the oldest.
function hitTime(value) {
  if (value instanceof Date) return value.getTime();
  var parsed = new Date(value).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

// What the whiteboard screen needs: for each grade, its goal, the energy taken
// this month and the three newest hits. Rows of other months never count.
// Read-only: it only creates the two tabs with their header (and the default
// goals) when they do not exist yet.
function villain() {
  return withLock(function () {
    var month = currentMonth();
    var goals = readGoals();
    var rows = golpesSheet().getDataRange().getValues().slice(1);
    var grades = [];
    for (var n = 0; n < GRADES.length; n++) {
      var grade = GRADES[n], taken = 0, runs = [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (monthOf(row[1]) !== month || Number(row[2]) !== grade) continue;
        var points = Number(row[4]);
        if (!isFinite(points)) points = 0;
        taken += points;
        runs.push({ name: String(row[3] || ""), points: points, time: hitTime(row[0]), order: i });
      }
      // Newest first, even after someone sorts the tab by hand.
      runs.sort(function (a, b) { return b.time - a.time || b.order - a.order; });
      grades.push({
        grade: grade, goal: goals[grade], taken: taken,
        hits: runs.slice(0, HITS_SHOWN).map(function (run) { return { name: run.name, points: run.points }; }),
      });
    }
    return { ok: true, month: month, grades: grades };
  });
}

// The «Golpes» row of this month with this run id, or null. Rows written before
// runs existed have no value in that column and never match.
function hitRowOf(rows, month, run) {
  if (!run) return null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][5] === undefined ? "" : rows[i][5]) !== run) continue;
    if (monthOf(rows[i][1]) !== month) continue;
    return { index: i + 2, row: rows[i] };
  }
  return null;
}

// A hit is worth the best moment of its run: the game sends it again at every
// checkpoint, so the row is raised, never doubled and never lowered. The name is
// written only when someone registers that run, so a hit stays anonymous until then.
// Nothing is written when the stored row already holds the name and enough points.
function raiseHit(tab, found, name, points) {
  var row = found.row;
  if (name && String(row[3] === undefined ? "" : row[3]) !== name) tab.getRange(found.index, 4).setValue(name);
  var stored = Number(row[4]);
  if (!isFinite(stored)) stored = 0;
  if (points > stored) tab.getRange(found.index, 5).setValue(points);
}

// One run of the game, counted for the monthly villain only: it needs no name and
// no class key, so a run lost at level 1-2 still helps the class. It never writes
// a ranking row. The same run may arrive several times; the best points survive.
function hit(params) {
  var grade = readGrade(params.grade);
  if (grade === null) return { ok: false, error: "bad grade" };
  if (!/^\d{1,6}$/.test(String(params.points)) || Number(params.points) > MAX_POINTS) return { ok: false, error: "bad points" };
  var run = typeof params.run === "string" && RUN_SHAPE.test(params.run) ? params.run : null;
  if (!run) return { ok: false, error: "bad run" };
  return withLock(function () {
    // Its own slot: 120 hits never use up the 30 saves, and the other way round.
    var cache = CacheService.getScriptCache();
    var slot = "hits-" + Math.floor(Date.now() / 60000);
    var count = Number(cache.get(slot) || 0);
    if (count >= HITS_PER_MINUTE) return { ok: false, error: "too many" };
    cache.put(slot, String(count + 1), 120);
    // A run that ended with no points tells the villain nothing, so it is not logged.
    var points = Number(params.points);
    if (points === 0) return { ok: true };
    var month = currentMonth(), tab = golpesSheet();
    var found = hitRowOf(tab.getDataRange().getValues().slice(1), month, run);
    if (found) raiseHit(tab, found, "", points);
    else tab.appendRow([new Date(), "'" + month, grade, "", points, run]);
    return { ok: true };
  });
}

// The salt is unique to a row; neither the emoji indices nor the emojis are stored.
function lockHash(salt, lock) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ":" + lock);
  return bytes.map(function (byte) { return ("0" + (byte & 255).toString(16)).slice(-2); }).join("");
}

function add(params) {
  var grade = readGrade(params.grade);
  if (grade === null) return { ok: false, error: "bad grade" };
  if (ANIMALS.indexOf(params.animal) < 0 || ADJECTIVES.indexOf(params.adjective) < 0) return { ok: false, error: "bad name" };
  // No level means the old page: a level-4 finish.
  var level = params.level === undefined ? 4 : Number(params.level);
  if (level !== 4 && !(level === 3 && LEVEL_THREE_GRADES.indexOf(grade) >= 0)) return { ok: false, error: "bad level" };
  if (!/^\d{1,6}$/.test(String(params.points)) || Number(params.points) > MAX_POINTS) return { ok: false, error: "bad points" };
  var emojiLock = null;
  // 1º and 2º began with picture keys and a two-emoji lock: no old page can save there, so the lock is required.
  if (params.lock === undefined && PICTURE_GRADES.indexOf(grade) >= 0) return { ok: false, error: "bad lock" };
  if (params.lock !== undefined) {
    // The form grade chooses two or three palette indices 0-11, without leading zeros.
    var lockShape = PICTURE_GRADES.indexOf(grade) >= 0
      ? /^(?:\d|1[01]),(?:\d|1[01])$/ : /^(?:\d|1[01]),(?:\d|1[01]),(?:\d|1[01])$/;
    if (typeof params.lock !== "string" || !lockShape.test(params.lock)) return { ok: false, error: "bad lock" };
    emojiLock = params.lock;
  }
  // A malformed run id is ignored on purpose: it must never refuse a save.
  var run = typeof params.run === "string" && RUN_SHAPE.test(params.run) ? params.run : null;
  return withLock(function () {
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
    var tab = sheet(), month = currentMonth(), name = params.animal + " " + params.adjective;
    var stored = "", rowIndex = -1, oldRow;
    if (emojiLock !== null) {
      var rows = tab.getDataRange().getValues().slice(1);
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        // Legacy rows have no owner and must not hide a later locked row.
        if (monthOf(row[1]) !== month || Number(row[2]) !== grade || row[3] !== name || !row[7]) continue;
        stored = String(row[7]);
        var pieces = stored.split(":");
        if (pieces.length !== 2 || lockHash(pieces[0], emojiLock) !== pieces[1]) return { ok: false, error: "name taken" };
        rowIndex = i + 2;
        oldRow = row;
        break;
      }
      if (rowIndex < 0) {
        var salt = Utilities.getUuid();
        stored = salt + ":" + lockHash(salt, emojiLock);
      }
    }
    // The apostrophe keeps the month as text, so Sheets never turns it into a date.
    var values = [new Date(), "'" + month, grade, name, Number(params.points), real, level, stored];
    if (rowIndex < 0) {
      tab.appendRow(values);
      rowIndex = tab.getLastRow();
    } else {
      var oldLevel = oldRow[6] === "" || oldRow[6] === undefined ? 4 : Number(oldRow[6]);
      if (level > oldLevel || (level === oldLevel && Number(params.points) > Number(oldRow[4]))) {
        tab.getRange(rowIndex, 1, 1, HEADER.length).setValues([values]);
      }
    }
    // The Ranking tab keeps only each pupil's best; the villain screen needs
    // every saved run, so a lower run is logged too. Nothing is logged on refusal.
    // The same run may have already logged an anonymous hit: that row then gets
    // the name and the best points, so the villain counts each run only once.
    var hits = golpesSheet();
    if (run) {
      var logged = hitRowOf(hits.getDataRange().getValues().slice(1), month, run);
      if (logged) raiseHit(hits, logged, name, Number(params.points));
      else hits.appendRow([values[0], "'" + month, grade, name, Number(params.points), run]);
    } else {
      hits.appendRow([values[0], "'" + month, grade, name, Number(params.points)]);
    }
    // Read the written row and ranking together before another add can change either.
    SpreadsheetApp.flush();
    var found = topOf(grade, rowIndex, month);
    return { ok: true, grade: grade, month: found.month, top: found.top, me: found.me };
  });
}
