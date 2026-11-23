// S4 (ranking-justo T8): the live whiteboard page of Capitán Silencio reads the
// monthly villain and paints one grade at a time on a 1920x1080 stage.
// The suite serves a fake web app and drives the 30 s poll itself.
const os = require("os");
const path = require("path");
const { chromium } = require("playwright-core");
const { check, finish } = require("./helpers");

let okCount = 0, failCount = 0;
const log = console.log, error = console.error;
console.log = (...args) => { if (String(args[0]).startsWith("ok: ")) okCount++; log(...args); };
console.error = (...args) => { if (String(args[0]).startsWith("FAIL: ")) failCount++; error(...args); };

const ROOT = "file://" + path.resolve(__dirname, "..");
const EXECUTABLE =
  process.env.CHROME_PATH ||
  path.join(os.homedir(), ".cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell");
const RANKING = "https://ranking.test/exec";

// The monthly answer of the server: the six grades, with the agreed default goals.
const DEFAULT_GOALS = { 1: 30000, 2: 60000, 3: 100000, 4: 120000, 5: 150000, 6: 200000 };
function all(overrides = {}) {
  return {
    ok: true,
    month: "2026-03",
    grades: [1, 2, 3, 4, 5, 6].map((grade) => ({ grade, goal: DEFAULT_GOALS[grade], taken: 0, hits: [], ...(overrides[grade] || {}) })),
  };
}
const HITS = [
  { name: "Panda Elegante", points: 1450 },
  { name: "Tigre Veloz", points: 2180 },
  { name: "Ballena Leal", points: 1120 },
  { name: "Cuarto Golpe", points: 900 },
];
const reply = (route, body) => route.fulfill({
  status: 200,
  contentType: "application/json",
  headers: { "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify(body),
});
const number = (page, value) => page.evaluate((n) => new Intl.NumberFormat("es-ES").format(n), value);
const noExceptions = (game, label) => check(game.errors.length === 0, `${label}: no page errors (${game.errors.join(" | ")})`);
const waitReady = (page) => page.waitForFunction(
  () => ["batalla", "victoria"].includes(document.body.dataset.state), null, { polling: 50 });
const waitState = (page, state) => page.waitForFunction((wanted) => document.body.dataset.state === wanted, state, { polling: 50 });

// A browser with the fake web app already in place, so no request ever leaves the machine.
async function open({ query = "", handler }) {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [], external = [], requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // The fake server is aborted on purpose: the browser reports that failed request
    // itself, and the page handles it without any exception.
    const source = (m.location() && m.location().url) || "";
    if (source.includes("ranking.test") || m.text().includes("ranking.test")) return;
    errors.push(m.text());
  });
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("file://") || url.startsWith(RANKING)) return;
    external.push(url);
  });
  await page.addInitScript(() => {
    window.RANKING_URL = "https://ranking.test/exec";
    // The screen asks for new points every 30 s. The suite records that timer
    // instead of waiting half a minute, and fires it when it wants a poll.
    window.__polls = [];
    const realSetInterval = window.setInterval.bind(window);
    window.setInterval = (fn, ms, ...rest) => { window.__polls.push({ fn, ms }); return realSetInterval(fn, ms, ...rest); };
    window.__poll = () => window.__polls.filter((timer) => timer.ms === 30000).forEach((timer) => timer.fn());
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
  await page.route("https://ranking.test/**", async (route) => {
    requests.push(new URL(route.request().url()));
    await handler(route, requests.length);
  });
  await page.goto(`${ROOT}/juegos/capitan.html${query}`);
  return { browser, page, errors, external, requests };
}

// The teacher picks the grade; the screen shows that grade only.
async function gradePicker() {
  const game = await open({ handler: (route) => reply(route, all()) });
  const { page } = game;
  try {
    await waitReady(page);
    const pressed = () => page.evaluate(() => document.querySelector('.chip[aria-pressed="true"]')?.textContent);
    check(await pressed() === "1º", "S4 the whiteboard opens with one grade picked and pressed");
    check(await page.locator("#who").textContent() === "1º de Primaria", "S4 the first grade is 1º when nothing is remembered");
    check(await page.locator("#faltan-num").textContent() === await number(page, 30000), "S4 it opens with the points the 1º pupils must reach");
    check(await page.locator("#ship .piece.gone").count() === 0, "S4 with no points the ship is whole");
    await page.click('.chip[data-grade="5"]');
    check(await page.locator("#who").textContent() === "5º de Primaria", "S4 the grade picker switches the grade shown");
    check(await pressed() === "5º", "S4 the pressed chip follows the chosen grade");
    check(await page.locator("#faltan-num").textContent() === await number(page, 150000), "S4 the points left belong to the chosen grade");
    check(await page.locator("#status").textContent() === "Viendo la batalla de 5º.", "S4 the status line names the grade on screen");
    check(new URL(page.url()).searchParams.get("curso") === "5", "S4 the chosen grade goes into the address as ?curso=5");
    await page.reload();
    await waitReady(page);
    check(await page.locator("#who").textContent() === "5º de Primaria", "S4 a reload keeps the grade the teacher chose");
    check(new URL(page.url()).searchParams.get("curso") === "5", "S4 the address keeps the grade after a reload");
    noExceptions(game, "S4 grade picker");
    check(game.external.length === 0, `S4 the whiteboard asks nothing outside the school ranking (${game.external.join(", ")})`);
  } finally {
    await game.browser.close();
  }
}

// «Faltan N puntos» and the filling bar are the same number read two ways.
async function faltanAndBar() {
  const game = await open({ query: "?curso=3", handler: (route) => reply(route, all({ 3: { goal: 100000, taken: 30000 } })) });
  const { page } = game;
  try {
    await waitReady(page);
    const missing = await page.locator("#faltan-num").textContent();
    check(missing === await number(page, 70000), `S4 «Faltan» counts the points left (${missing})`);
    check(/\./.test(missing), "S4 big points are written with the Spanish thousands dot (70.000)");
    const width = await page.locator("#bar-fill").evaluate((fill) => parseFloat(fill.style.width));
    check(Math.abs(width - 30) < 0.05, `S4 the bar is filled to taken/goal (${width}% for 30.000 of 100.000)`);
    check(await page.locator("#taken-num").textContent() === await number(page, 30000), "S4 the bar labels show the points already taken");
    check(await page.locator("#goal-num").textContent() === await number(page, 100000), "S4 the bar labels show the monthly goal");
    check(await page.locator("#percent").textContent() === "30%", "S4 the bar labels show the percentage");
    check((await page.locator("#bar").getAttribute("aria-label")).includes("30 por ciento"), "S4 the bar describes itself for a screen reader");
    check(await page.locator("#battle-block").isVisible() && !(await page.locator("#victory-block").isVisible()),
      "S4 during the battle only the «Faltan» counter is read out");
    check((await page.locator("#bar-fill").evaluate((fill) => getComputedStyle(fill).transitionDuration)) === "0s",
      "S4 reduced motion removes the bar animation");
    noExceptions(game, "S4 faltan and bar");
  } finally {
    await game.browser.close();
  }
}

// The three latest hits, newest first, exactly as the server sends them.
async function latestHits() {
  const withHits = await open({ query: "?curso=3", handler: (route) => reply(route, all({ 3: { taken: 30000, hits: HITS } })) });
  try {
    const { page } = withHits;
    await waitReady(page);
    const names = await page.locator("#hits li b").allTextContents();
    check(JSON.stringify(names) === JSON.stringify(["Panda Elegante", "Tigre Veloz", "Ballena Leal"]),
      `S4 the three newest hits keep their order (${names.join(" · ")})`);
    check(await page.locator("#hits li").count() === 3, "S4 at most three hits are shown");
    const points = await page.locator("#hits li .minus").allTextContents();
    check(points[0] === `−${await number(page, 1450)}`, `S4 each hit shows the points it took (${points[0]})`);
    check(!(await page.locator("#hits-empty").isVisible()), "S4 the empty message stays hidden when there are hits");
    noExceptions(withHits, "S4 latest hits");
  } finally {
    await withHits.browser.close();
  }
  const withoutHits = await open({ query: "?curso=3", handler: (route) => reply(route, all()) });
  try {
    const { page } = withoutHits;
    await waitReady(page);
    check(await page.locator("#hits li").count() === 0 && await page.locator("#hits-empty").isVisible(),
      "S4 a month without hits says so instead of showing an empty box");
    noExceptions(withoutHits, "S4 no hits");
  } finally {
    await withoutHits.browser.close();
  }
}

// ranking-justo L15: a run that never saved a name still counts, and the screen says so.
async function anonymousHits() {
  const mixed = [
    { name: "", points: 480 },
    { name: "Panda Elegante", points: 1450 },
    { name: null, points: 70 },
  ];
  const game = await open({ query: "?curso=3", handler: (route) => reply(route, all({ 3: { taken: 1930, hits: mixed } })) });
  const { page } = game;
  try {
    await waitReady(page);
    const names = await page.locator("#hits li b").allTextContents();
    check(names.length === 2 && names[0] === "Un piloto de 3º" && names[1] === "Panda Elegante",
      `L15 an anonymous hit reads «Un piloto de 3º» and a named hit keeps its name (${names.join(" · ")})`);
    const points = await page.locator("#hits li .minus").allTextContents();
    check(points[0] === `−${await number(page, 480)}` && points[1] === `−${await number(page, 1450)}`,
      `L15 the anonymous pilot carries the points it took (${points.join(" · ")})`);
    check(!(await page.locator("#hits-empty").isVisible()), "L15 the empty message stays hidden while an anonymous hit is listed");
    noExceptions(game, "L15 anonymous hits");
  } finally {
    await game.browser.close();
  }
}

// Reaching the goal wins the month: full bar and the words rain again.
async function victoryState() {
  const game = await open({ query: "?curso=3", handler: (route) => reply(route, all({ 3: { goal: 100000, taken: 105000, hits: HITS } })) });
  const { page } = game;
  try {
    await waitState(page, "victoria");
    check((await page.locator("#victory-block").innerText()).includes("¡Las palabras vuelven a llover sobre el cole!"),
      "S4 taken >= goal shows the victory message");
    check(await page.locator("#victory-block").isVisible() && !(await page.locator("#battle-block").isVisible()),
      "S4 the victory state replaces the «Faltan» counter");
    check(await page.locator("#bar-fill").evaluate((fill) => fill.style.width) === "100%",
      "S4 the bar is full once the goal is reached");
    check(await page.locator("#percent").textContent() === "100%", "S4 the bar labels read 100%");
    check(await page.locator("#win-chip").isVisible() && (await page.locator("#win-chip-text").textContent()).startsWith("Barra llena hasta el "),
      "S4 the bar stays full until the month ends");
    check((await page.locator("#caption-victory").textContent()).startsWith("¡Nave vencida hasta el "),
      "S4 the ship shows its beaten drawing with the day it stays beaten");
    check(await page.locator("#caption-victory").isVisible() && !(await page.locator("#caption-battle").isVisible()),
      "S4 only one caption of the scene is visible at a time");
    check((await page.locator("#status").textContent()).includes("ha vencido al Capitán Silencio"), "S4 the status line announces the victory");
    noExceptions(game, "S4 victory");
  } finally {
    await game.browser.close();
  }
}

// Every 30 s the screen asks again; the ship breaks as the bar fills.
async function polling() {
  let answer = all({ 3: { goal: 100000, taken: 30000 } });
  const game = await open({ query: "?curso=3", handler: (route) => reply(route, answer) });
  const { page, requests } = game;
  try {
    await waitReady(page);
    check(await page.evaluate(() => window.__polls.some((timer) => timer.ms === 30000)), "S4 the screen asks for new points every 30 seconds");
    check(requests.length === 1 && requests[0].searchParams.get("action") === "villain",
      `S4 the screen reads action=villain (${requests.map(String).join(", ")})`);
    check(await page.locator("#ship .piece.gone").count() === 1, "S4 the ship has already lost the piece the bar broke");
    answer = all({ 3: { goal: 100000, taken: 87000 } });
    const missing = await number(page, 13000);
    await page.evaluate(() => window.__poll());
    await page.waitForFunction((left) => document.querySelector("#faltan-num").textContent === left, missing, { polling: 50 });
    check(requests.length === 2, "S4 the poll asks the server again");
    const width = await page.locator("#bar-fill").evaluate((fill) => parseFloat(fill.style.width));
    check(Math.abs(width - 87) < 0.05, `S4 the poll moves the bar (${width}% for 87.000 of 100.000)`);
    check(await page.locator("#ship .piece.gone").count() === 3, "S4 the ship loses one more piece with every stretch of the bar");
    noExceptions(game, "S4 polling");
  } finally {
    await game.browser.close();
  }
}

// A failed poll keeps the last points on screen and warns in a small print.
async function offlineNotice() {
  let healthy = true;
  const game = await open({ query: "?curso=3", handler: (route) => healthy ? reply(route, all({ 3: { taken: 30000 } })) : route.abort() });
  const { page } = game;
  try {
    await waitReady(page);
    const before = await page.locator("#faltan-num").textContent();
    healthy = false;
    await page.evaluate(() => window.__poll());
    await page.waitForFunction(() => !document.querySelector("#notice").hidden, null, { polling: 50 });
    check((await page.locator("#notice").textContent()).trim() === "Sin conexión, reintentando…",
      "S4 a failed poll shows the small «Sin conexión, reintentando…» notice");
    check(await page.locator("#faltan-num").textContent() === before && await page.locator("#battle-block").isVisible(),
      "S4 a failed poll keeps the last points on the whiteboard");
    healthy = true;
    await page.evaluate(() => window.__poll());
    await page.waitForFunction(() => document.querySelector("#notice").hidden, null, { polling: 50 });
    check(true, "S4 the notice goes away when the server answers again");
    noExceptions(game, "S4 offline notice");
  } finally {
    await game.browser.close();
  }
}

// The very first load fails: the pupils get a friendly line, not a broken screen.
async function firstLoadFailure() {
  let healthy = false;
  const game = await open({ query: "?curso=3", handler: (route) => healthy ? reply(route, all({ 3: { taken: 30000 } })) : route.abort() });
  const { page } = game;
  try {
    await waitState(page, "sin-datos");
    const message = await page.locator("#placeholder").textContent();
    check(await page.locator("#placeholder").isVisible() && message.includes("Volvemos a intentarlo en un momento"),
      `S4 a first load failure shows a friendly message (${message})`);
    check(await page.locator("#bar").isHidden() && await page.locator("#hits").isHidden(),
      "S4 the first failure hides the numbers instead of showing zeros");
    check(await page.locator("#notice").isHidden(), "S4 the first failure does not pile a second notice on top");
    healthy = true;
    await page.evaluate(() => window.__poll());
    await waitReady(page);
    check(await page.locator("#faltan-num").textContent() === await number(page, 70000), "S4 the next good poll paints the battle");
    noExceptions(game, "S4 first load failure");
  } finally {
    await game.browser.close();
  }
}

// A shared link opens on its grade; an impossible one falls back to the first.
async function preselect() {
  const game = await open({ query: "?curso=6", handler: (route) => reply(route, all()) });
  const { page } = game;
  try {
    await waitReady(page);
    check(await page.locator("#who").textContent() === "6º de Primaria", "S4 ?curso=6 opens the whiteboard on 6º");
    check(await page.evaluate(() => document.querySelector('.chip[data-grade="6"]').getAttribute("aria-pressed")) === "true",
      "S4 the linked grade is the pressed chip");
    await finish(game);
  } finally {
    await game.browser.close();
  }
  const broken = await open({ query: "?curso=9", handler: (route) => reply(route, all()) });
  try {
    const { page } = broken;
    await waitReady(page);
    check(await page.locator("#who").textContent() === "1º de Primaria", "S4 an impossible ?curso= falls back to the first grade");
    noExceptions(broken, "S4 impossible grade");
  } finally {
    await broken.browser.close();
  }
}

(async () => {
  for (const [label, run] of [
    ["grade picker", gradePicker],
    ["faltan and bar", faltanAndBar],
    ["latest hits", latestHits],
    ["anonymous hits", anonymousHits],
    ["victory state", victoryState],
    ["polling", polling],
    ["offline notice", offlineNotice],
    ["first load failure", firstLoadFailure],
    ["preselected grade", preselect],
  ]) {
    try { await run(); } catch (e) { check(false, `${label}: ${e.stack || e}`); }
  }
  console.log(`TOTAL: ${okCount} ok, ${failCount} FAIL`);
  // npm test stops at the first suite that exits with an error.
  if (failCount) process.exitCode = 1;
})().catch((e) => { error(e); process.exitCode = 1; });
