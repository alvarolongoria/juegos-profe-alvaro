// S11: the monthly ranking is available only after winning the final level.
// Exercise the real page and keyboard with a frame clock and a fake web app.
const fs = require("fs");
const path = require("path");
const { openGame, check, finish } = require("./helpers");

let okCount = 0, failCount = 0;
const log = console.log, error = console.error;
console.log = (...args) => { if (String(args[0]).startsWith("ok: ")) okCount++; log(...args); };
console.error = (...args) => { if (String(args[0]).startsWith("FAIL: ")) failCount++; error(...args); };

// Read the actual server's lists, so the test catches any drift on either side.
const server = fs.readFileSync(path.join(__dirname, "..", "ranking", "Code.gs"), "utf8");
function serverList(name) {
  const match = server.match(new RegExp(`var ${name}\\s*=\\s*(\\[[\\s\\S]*?\\])\\s*;`));
  if (!match) throw new Error(`Missing ${name} in ranking/Code.gs`);
  return JSON.parse(match[1]);
}
const animals = serverList("ANIMALS"), adjectives = serverList("ADJECTIVES");

async function installFrameClock(page) {
  await page.addInitScript(() => {
    let now = 1000, pending = [];
    Object.defineProperty(performance, "now", { value: () => now });
    window.requestAnimationFrame = (fn) => { pending.push(fn); return pending.length; };
    window.advanceFrames = (ms) => {
      while (ms > 0) {
        const step = Math.min(ms, 50);
        now += step;
        const callbacks = pending;
        pending = [];
        callbacks.forEach((fn) => fn(now));
        ms -= step;
      }
    };
    window.randomValue = 0.01;
    Math.random = () => window.randomValue;
  });
  await page.reload();
}

async function chooseGrade(page, grade) {
  await page.waitForSelector(".overlay .grade-btn");
  await page.click(`.overlay .grade-btn[data-grade="${grade}"]`, { force: true });
  // With a ranking URL the grade is followed by the ranking preview; play on from it.
  if (await page.evaluate(() => !!window.RANKING_URL)) {
    await page.waitForSelector("#ranking-preview");
    await page.waitForFunction(() => document.querySelector("#ranking-preview p")?.textContent !== "Cargando ranking…", null, { polling: 50 });
    await page.click(".overlay .play-btn", { force: true });
    await page.waitForFunction(() => !document.querySelector(".overlay"), null, { polling: 50 });
  }
}

async function finishWithClock(page) {
  const level = await page.evaluate(() => document.body.dataset.level);
  for (let i = 0; i < 3000; i++) {
    const next = await page.evaluate(({ i, level }) => {
      if (document.querySelector(".overlay") || document.body.dataset.level !== level) return { finished: true };
      window.randomValue = ((i * 37) % 99 + 0.5) / 100;
      window.advanceFrames(50);
      return { text: document.querySelector(".ship")?.dataset.text };
    }, { i, level });
    if (next.finished) return { level, finished: true };
    // Chromium inserts the text into the focused catcher and fires input.
    if (next.text) await page.keyboard.insertText(next.text);
  }
  return { level, finished: await page.evaluate((level) => !!document.querySelector(".overlay") || document.body.dataset.level !== level, level) };
}

// The ranking preview after choosing the grade asks for the top once. Unless a test is about
// that screen, an empty answer is given here so the test's own handler only sees its own traffic.
async function gameWithClock(handler, { previewHandled = false, touch = false } = {}) {
  const game = await openGame("juegos/teclado.html");
  let { page } = game;
  if (touch) {
    const url = page.url();
    const context = await game.browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 768, height: 1024 } });
    await page.close();
    game.page = page = await context.newPage();
    game.external = [];
    page.on("request", (request) => { if (!request.url().startsWith("file://")) game.external.push(request.url()); });
    await page.addInitScript(() => { window.RANKING_URL = ""; });
    await page.goto(url);
  }
  game.pageErrors = [];
  page.on("pageerror", (e) => game.pageErrors.push(e.message));
  page.setDefaultTimeout(5000);
  if (!touch) await page.setViewportSize({ width: 1024, height: 600 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (handler) {
    await page.addInitScript(() => { window.RANKING_URL = "https://ranking.test/exec"; });
    let previewed = previewHandled;
    await page.route("https://ranking.test/**", (route) => {
      if (!previewed) {
        previewed = true;
        return route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ ok: true, grade: 1, month: "2026-11", top: [] }) });
      }
      return handler(route);
    });
  } else {
    // The real school URL lives in assets/ranking-config.js; an empty one turns the ranking off.
    await page.addInitScript(() => { window.RANKING_URL = ""; });
  }
  await installFrameClock(page);
  return game;
}

// Every grade may save after level 3 (ranking-justo S2): play on to level 4 without saving.
async function skipLevelThreeRanking(page) {
  if (!await page.locator("#ranking").count()) return;
  await page.locator(".overlay .play-btn").click({ force: true });
  const warning = page.getByRole("dialog", { name: "¡Todavía no has guardado tu puntuación!" });
  if (await warning.count()) await warning.getByRole("button", { name: "Jugar sin guardar" }).click();
}

async function win(page, grade, checkEarly = false) {
  await chooseGrade(page, grade);
  if (checkEarly) check(await page.locator("#ranking").count() === 0, "S11 no ranking at the start of the game");
  for (let level = 0; level < 4; level++) {
    const result = await finishWithClock(page);
    if (checkEarly && level < 2) {
      check(result.level === String(level) && result.finished && await page.locator("#ranking").count() === 0 && await page.locator(".overlay").count() === 0,
        `S11 no ranking after level ${level + 1}`);
    }
    if (checkEarly && level === 2 && await page.evaluate(() => !!window.RANKING_URL)) {
      check(result.finished && await page.locator("#ranking").count() === 1 && (await page.locator("#ranking").innerText()).includes("Nivel 3 superado"),
        `ranking-justo S2 ${grade}º is offered the ranking after level 3`);
    }
    if (!result.finished) throw new Error(`Could not finish level ${level + 1}`);
    // Every grade may save after level 3 (ranking-justo S2): these tests play on to level 4.
    if (level === 2) await skipLevelThreeRanking(page);
  }
  // The trophy flight of the last win moves the overlay; click only once it lands.
  await page.waitForFunction(() => !document.querySelector(".trophy-flight"), null, { polling: 100 });
}

const response = (top = [], grade = 5) => ({ ok: true, grade, month: "2026-11", top });
const reply = (route, body) => route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
const noExceptions = (game, label) => check(game.pageErrors.length === 0, `${label}: no page exceptions (${game.pageErrors.join(" | ")})`);
// S2: every save needs the class key the teacher wrote on the board.
const palette = ["🍎", "⭐", "🐶", "🚀", "⚽", "🌈", "🍕", "🐱", "🎈", "🌙", "🍦", "🦋"];
async function fillLock(ranking, indices = [0, 1, 2]) {
  for (const index of indices) await ranking.locator(".ranking-emoji").nth(index).click();
}
async function fillKey(ranking, key = "sol") {
  await ranking.getByLabel("Clave de clase").fill(key);
  await fillLock(ranking);
}
const pointsOnScreen = async (page) => Number((await page.locator("#stats").textContent()).match(/Puntos: (\d+)/)[1]);

async function withoutUrl() {
  const game = await gameWithClock();
  try {
    const { page } = game;
    await win(page, 2, true);
    const visible = await page.locator("body").innerText();
    check(await page.locator(".overlay").count() === 1 && !/ranking/i.test(visible) && await page.locator("#ranking").count() === 0,
      "S11 an empty URL leaves the final overlay without any ranking UI");
    check(game.external.length === 0, `S11 an empty URL makes no external requests (${game.external.join(", ")})`);
    await page.locator(".overlay .play-btn").click({ force: true });
    check(await page.locator("dialog[open]").count() === 0 && await page.evaluate(() => document.body.dataset.level === "0"),
      "S6 an absent ranking never warns and replay starts level 1");
    await finish(game);
  } finally {
    await game.browser.close();
  }
}

async function saveAndSafety() {
  const requests = [];
  let releaseSave;
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  const game = await gameWithClock(async (route) => {
    const url = new URL(route.request().url());
    requests.push({ method: route.request().method(), url });
    if (url.searchParams.get("action") === "add") {
      // Keep the request in flight while testing duplicate submits and replay.
      await saveGate;
      const name = `${url.searchParams.get("animal")} ${url.searchParams.get("adjective")}`;
      const points = Number(url.searchParams.get("points"));
      await reply(route, response([
        { name: "Lince Feliz", points: points + 100 },
        { name, points },
        { name: '<img src=x onerror="window.rankingXss=1">', points: 1 },
      ]));
    } else await reply(route, response());
  });
  try {
    const { page } = game;
    await win(page, 5, true);
    const ranking = page.locator("#ranking");
    const present = await ranking.count() === 1;
    check(present && await ranking.isVisible() && (await ranking.innerText()).includes("¡Entra en el ranking del mes!"),
      "S11 the final win displays the ranking invitation");
    if (!present) return;
    check(JSON.stringify(await ranking.locator('select[name="animal"] option').allTextContents()) === JSON.stringify(animals),
      "S11 animal options equal the server ANIMALS list, in order");
    check(JSON.stringify(await ranking.locator('select[name="adjective"] option').allTextContents()) === JSON.stringify(adjectives),
      "S11 adjective options equal the server ADJECTIVES list, in order");
    const score = await pointsOnScreen(page);
    check(/5º/.test(await ranking.innerText()) && (await ranking.innerText()).includes(String(score)) && await ranking.locator("select").count() === 2,
      "S11 the fixed grade and final score are shown with exactly two selects");
    const keyField = ranking.getByLabel("Clave de clase");
    check(await ranking.locator("input, textarea, [contenteditable=true]").count() === 1 && await keyField.count() === 1
      && await keyField.getAttribute("name") === "key" && await keyField.getAttribute("autocomplete") === "off",
      "S2 the only free-text field is the class key (the name still comes from the two lists)");
    check(requests.length === 0 && game.external.length === 1 && game.external[0].includes("action=top") && !game.external[0].includes("key=")
      && !(await ranking.innerText()).includes("Tu mejor marca:"),
      "S11 before a button is used the win screen asks nothing more than the start preview's read-only top or shows a personal result");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(700);
    check(await ranking.locator('select[name="animal"]').evaluate((el) => document.activeElement === el),
      "S11 Tab reaches the animal select from the game's hidden key-catcher");
    await page.keyboard.press("ArrowDown");
    check(await ranking.locator('select[name="animal"]').inputValue() === "León", "S11 the animal select works with the keyboard");
    const adjective = ranking.locator('select[name="adjective"]');
    await adjective.selectOption("Ágil");
    await adjective.focus();
    await page.waitForTimeout(700); // holdFocus runs every 500 ms during play
    const focused = await adjective.evaluate((el) => document.activeElement === el);
    await page.keyboard.press("ArrowDown");
    check(focused && await adjective.inputValue() === "Fuerte", "S11 a select keeps focus and responds to the keyboard in the win overlay");
    const animal = await ranking.locator('select[name="animal"]').inputValue();
    const selectedAdjective = await adjective.inputValue();
    const save = ranking.getByRole("button", { name: "Guardar", exact: true });
    await page.keyboard.press("Tab");
    await page.waitForTimeout(700);
    check(await keyField.evaluate((el) => document.activeElement === el), "S2 Tab reaches the key field after the adjective");
    await page.keyboard.type("sol");
    check(await keyField.inputValue() === "sol" && await page.locator(".ship").count() === 0, "S2 typing the key fills the field and shoots nothing");
    check(await save.isDisabled(), "S5 Guardar starts disabled until three emojis are chosen");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(700);
    const emojis = ranking.locator(".ranking-emoji");
    check(await emojis.first().evaluate((el) => document.activeElement === el), "S5 Tab reaches the emoji picker without the key-catcher stealing focus");
    await page.keyboard.press("Enter");
    check(await save.isDisabled() && (await ranking.locator(".ranking-lock-selection").innerText()).includes("🍎"),
      "S5 Enter selects the first emoji and one selection cannot be sent");
    await emojis.nth(7).click();
    check(await save.isDisabled(), "S5 two emojis cannot be sent");
    await emojis.nth(3).click();
    check(await save.isEnabled() && (await ranking.locator(".ranking-lock-selection").innerText()).includes("🍎 🐱 🚀"),
      "S5 three ordered emojis are visible and enable Guardar");
    await ranking.getByRole("button", { name: "Borrar emojis", exact: true }).focus();
    await page.keyboard.press("Tab");
    check(await save.evaluate((el) => document.activeElement === el), "S5 Tab reaches Guardar after the picker");
    const request = page.waitForRequest((r) => r.url().startsWith("https://ranking.test/") && new URL(r.url()).searchParams.get("action") === "add");
    await page.keyboard.press("Enter");
    await request;
    check(await save.isDisabled(), "S11 Guardar is disabled while the save is in flight");
    await ranking.locator("form").evaluate((form) => {
      for (let i = 0; i < 3; i++) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await page.locator(".overlay .play-btn").click({ force: true });
    const warning = page.getByRole("dialog", { name: "¡Todavía no has guardado tu puntuación!" });
    const warned = await warning.count() === 1;
    check(warned && requests.length === 1, "S6 a save in flight is not yet successful and warns without another request");
    if (!warned) return;
    releaseSave();
    await page.waitForFunction(() => document.querySelectorAll("#ranking ol li").length === 3, null, { polling: 100 });
    const warningClosed = await warning.count() === 0;
    check(warningClosed && await page.evaluate(() => document.querySelector("#ranking form").contains(document.activeElement)),
      "S6 a save that succeeds while the warning is open closes it and returns focus to the form");
    if (!warningClosed) await warning.getByRole("button", { name: "Guardar primero" }).click();
    await ranking.locator("form").evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await page.waitForTimeout(100);
    const adds = requests.filter((r) => r.url.searchParams.get("action") === "add");
    const params = adds[0]?.url.searchParams;
    check(adds.length === 1 && adds[0].method === "GET" && params.get("animal") === animal && params.get("adjective") === selectedAdjective
      && params.get("grade") === "5" && params.get("points") === String(score) && params.get("key") === "sol" && params.get("lock") === "0,7,3"
      && [...params.keys()].sort().join(",") === "action,adjective,animal,grade,key,lock,points",
      `S11/S5 at most one add sends the selected name, score, key and ordered emoji indices (${adds.length} requests)`);
    const rows = ranking.locator("ol li");
    check(await rows.count() === 3 && await rows.nth(0).textContent() === `🏆 Lince Feliz — ${score + 100}`
      && await rows.nth(1).textContent() === `🏆 ${animal} ${selectedAdjective} — ${score}`,
      "S11 the returned top is rendered in order with names and points");
    check(await rows.nth(1).evaluate((el) => el.classList.contains("ranking-saved")) && await ranking.locator(".ranking-saved").count() === 1
      && !(await ranking.innerText()).includes("Tu mejor marca:"),
      "S11 an old server without me still highlights the saved entry and shows no personal message");
    check((await rows.nth(2).textContent()).includes('<img src=x onerror="window.rankingXss=1">')
      && await rows.nth(2).locator("img").count() === 0 && !await page.evaluate(() => window.rankingXss),
      "S11 a hostile returned name is displayed as text, never interpreted as HTML");
    await page.locator(".overlay .play-btn").click({ force: true });
    check(await page.locator("dialog[open]").count() === 0 && await page.evaluate(() => document.body.dataset.level === "0"),
      "S6 a successful final save plays immediately without a warning");
    noExceptions(game, "S11 successful save");
  } finally {
    releaseSave();
    await game.browser.close();
  }
}

async function failedSave(kind) {
  const requests = [];
  let releaseSave;
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  const game = await gameWithClock(async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (url.searchParams.get("action") === "add") {
      await saveGate;
      if (kind === "network") await route.abort();
      else await reply(route, { ok: false, error: "server error" });
    } else await reply(route, response([], 3));
  });
  try {
    const { page } = game;
    await win(page, 3);
    const ranking = page.locator("#ranking");
    const present = await ranking.count() === 1;
    check(present, `S11 ${kind} error scenario has a ranking form`);
    if (!present) return;
    await fillKey(ranking);
    await ranking.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.locator(".overlay .play-btn").click({ force: true });
    const warning = page.getByRole("dialog", { name: "¡Todavía no has guardado tu puntuación!" });
    const warned = await warning.count() === 1;
    check(warned, `S6 a ${kind} save pending response still warns`);
    if (!warned) return;
    releaseSave();
    await page.waitForFunction(() => document.querySelector("#ranking")?.textContent.includes("No se pudo guardar ahora. Inténtalo más tarde."), null, { polling: 100 });
    const warningClosed = await warning.count() === 0;
    check(warningClosed, `S6 a ${kind} save failure closes the pending warning`);
    if (!warningClosed) await warning.getByRole("button", { name: "Guardar primero" }).click();
    check((await ranking.innerText()).includes("No se pudo guardar ahora. Inténtalo más tarde."), `S11 ${kind} error shows the gentle save message`);
    check(await ranking.getByRole("button", { name: "Guardar", exact: true }).isDisabled(), `S11 ${kind} error does not allow a second submission`);
    await ranking.locator("form").evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await ranking.getByRole("button", { name: "Ver ranking", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#ranking")?.textContent.includes("Todavía no hay nadie este mes"), null, { polling: 100 });
    check(requests.filter((url) => url.searchParams.get("action") === "add").length === 1 && requests.some((url) => url.searchParams.get("action") === "top"),
      `S11 ${kind} error still permits viewing the ranking without a duplicate save`);
    noExceptions(game, `S11 ${kind} error`);
    await page.locator(".overlay .play-btn").click({ force: true });
    await page.evaluate(() => window.advanceFrames(50));
    const ship = await page.locator(".ship").first().elementHandle();
    if (ship) await page.keyboard.insertText((await ship.getAttribute("data-text"))[0]);
    const resumed = !!ship && await page.evaluate((el) => document.body.dataset.level === "0" && (el.dataset.typed === "1" || !el.isConnected), ship);
    check(resumed, `S11 ${kind} error leaves the new level 1 playable`);
    check(await page.locator("dialog[open]").count() === 0, `S6 a ${kind} save failure never blocks replay with a warning`);
  } finally {
    releaseSave();
    await game.browser.close();
  }
}

async function viewWithoutSaving() {
  const requests = [];
  let views = 0;
  const game = await gameWithClock(async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const top = Array.from({ length: 10 }, (_, i) => ({ name: `${animals[i]} ${adjectives[i]}`, points: 1200 - i * 100 }));
    await reply(route, { ...response(++views === 1 ? top : [], 6), me: { name: "Tigre Veloz", points: 99, position: 11, total: 11 } });
  });
  try {
    const { page } = game;
    await win(page, 6);
    const ranking = page.locator("#ranking");
    const present = await ranking.count() === 1;
    check(present, "S11 the final win offers a way to view the ranking without saving");
    if (!present) return;
    const view = ranking.getByRole("button", { name: "Ver ranking", exact: true });
    await view.click();
    await page.waitForFunction(() => document.querySelectorAll("#ranking ol li").length === 10, null, { polling: 100 });
    const expected = Array.from({ length: 10 }, (_, i) => `🏆 ${animals[i]} ${adjectives[i]} — ${1200 - i * 100}`);
    check(JSON.stringify(await ranking.locator("ol li").allTextContents()) === JSON.stringify(expected)
      && !(await ranking.innerText()).includes("Tu mejor marca:"),
      "S11 Ver ranking shows all ten entries without saving or displaying an unsolicited personal result");
    check(await ranking.locator("ol").evaluate((el) => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === "auto"
      && getComputedStyle(el).listStyleType === "decimal"), "S11 the numbered top ten scrolls inside the panel on a short screen");
    const replay = page.locator(".overlay .play-btn");
    await replay.scrollIntoViewIfNeeded();
    const box = await replay.boundingBox();
    // Chromium can round the final scroll position by a fraction of a pixel.
    check(!!box && box.y >= -1 && box.y + box.height <= 601 && box.height >= 44, `S11 the replay button remains reachable with ten results on a short screen (${JSON.stringify(box)})`);
    await view.click();
    await page.waitForFunction(() => document.querySelector("#ranking")?.textContent.includes("Todavía no hay nadie este mes"), null, { polling: 100 });
    check(await ranking.locator("ol li").count() === 0 && (await ranking.innerText()).includes("Todavía no hay nadie este mes"),
      "S11 Ver ranking explains when this month has no entries");
    check(requests.length === 2 && requests.every((url) => url.searchParams.get("action") === "top" && url.searchParams.get("grade") === "6"
      && [...url.searchParams.keys()].sort().join(",") === "action,grade"), "S11 Ver ranking requests only the current grade and never saves");
    noExceptions(game, "S11 viewing the ranking");
  } finally {
    await game.browser.close();
  }
}

async function gradeOneAndRepeat() {
  const adds = [];
  const top = Array.from({ length: 10 }, (_, i) => ({ name: `${animals[i]} ${adjectives[i]}`, points: 100000 - i }));
  const game = await gameWithClock(async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("action") === "top") return reply(route, response([{ name: "Panda Feliz", points: 9999 }], 1));
    adds.push(url);
    const me = { name: `${url.searchParams.get("animal")} ${url.searchParams.get("adjective")}`,
      points: Number(url.searchParams.get("points")) + 1450, position: 17, total: 17 };
    await reply(route, adds.length === 1 ? { ...response(top, 1), me } : response([{ name: "Panda Feliz", points: 9999 }], 1));
  });
  try {
    const { page } = game;
    await win(page, 1);
    let ranking = page.locator("#ranking");
    const present = await ranking.count() === 1;
    check(present, "S11 the youngest grade can enter the ranking after winning");
    if (!present) return;
    const firstScore = await pointsOnScreen(page);
    check(firstScore > 0 && (await ranking.innerText()).includes(`Curso: 1º · Puntos: ${firstScore}`),
      "S11 1º sees the actual final score even though its ordinary summary omits points");
    await fillKey(ranking);
    await ranking.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("#ranking ol li").length === 10, null, { polling: 100 });
    const personal = `Tu mejor marca: ${firstScore + 1450} · Estás en el puesto 17 de 1º`;
    check(adds.length === 1 && adds[0].searchParams.get("grade") === "1" && adds[0].searchParams.get("points") === String(firstScore)
      && await ranking.locator(".ranking-saved").count() === 0 && await ranking.getByText(personal, { exact: true }).isVisible()
      && JSON.stringify(await ranking.locator("ol li").allTextContents()) === JSON.stringify(top.map((entry) => `🏆 ${entry.name} — ${entry.points}`)),
      "S1 the stored best and 17th position are visible with the top ten even when the pupil is outside it");
    await ranking.getByRole("button", { name: "Ver ranking", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("#ranking ol li").length === 1, null, { polling: 100 });
    check(await ranking.getByText(personal, { exact: true }).isVisible() && await ranking.locator("ol li").textContent() === "🏆 Panda Feliz — 9999",
      "S1 viewing the top after a save keeps the personal result visible with the refreshed list");
    await page.locator(".overlay .play-btn").click({ force: true });
    const replay = await finishWithClock(page);
    check(replay.level === "0" && replay.finished, "S11 a replay after saving starts at level 1");
    if (replay.level === "0" && replay.finished) {
      for (let level = 1; level < 4; level++) {
        const result = await finishWithClock(page);
        check(result.level === String(level) && result.finished, `S11 replay continues through level ${level + 1}`);
        if (level === 2) await skipLevelThreeRanking(page);
      }
    }
    ranking = page.locator("#ranking");
    check(await ranking.count() === 1 && await ranking.getByRole("button", { name: "Guardar", exact: true }).isDisabled(),
      "S11/S5 a new run creates a fresh form requiring a new lock");
    const secondScore = await pointsOnScreen(page);
    await fillKey(ranking);
    await ranking.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("#ranking ol li").length === 1, null, { polling: 100 });
    check(adds.length === 2 && adds[1].searchParams.get("grade") === "1" && adds[1].searchParams.get("points") === String(secondScore)
      && !(await ranking.innerText()).includes("Tu mejor marca:"),
      "S11 each separate win can be submitted once and an old-server response does not reuse the previous personal result");
    noExceptions(game, "S11 replaying a complete run");
  } finally {
    await game.browser.close();
  }
}

// S4: every grade starts a new run after the final summary, while a loss
// retries the same level instead of returning to the beginning.
async function replayEveryGrade() {
  const game = await gameWithClock();
  try {
    const { page } = game;
    for (const grade of [1, 2, 3, 4, 5, 6]) {
      if (grade > 1) await page.reload();
      await win(page, grade);
      await page.locator(".overlay .play-btn").click({ force: true });
      const state = await page.evaluate(() => ({
        level: document.body.dataset.level,
        hearts: document.body.dataset.hearts,
        progress: document.querySelectorAll(".progress span").length,
        filled: document.querySelectorAll('.trophy-slot[data-filled="true"]').length,
        stats: document.querySelector("#stats").textContent,
      }));
      check(state.level === "0" && state.hearts === "3" && state.progress === 5 && state.filled === 4 && /Puntos: 0(?:\n|$)/.test(state.stats),
        `S4 ${grade}º winning the last level starts a fresh level 1 and keeps earned trophies (${JSON.stringify(state)})`);
    }
    noExceptions(game, "S4 replay for every grade");
  } finally {
    await game.browser.close();
  }
}

async function retryLostLevel() {
  const game = await gameWithClock();
  try {
    const { page } = game;
    for (const targetLevel of [2, 3]) {
      if (targetLevel > 2) await page.reload();
      await chooseGrade(page, 6);
      for (let level = 0; level < targetLevel; level++) {
        const result = await finishWithClock(page);
        if (!result.finished) throw new Error(`Could not reach level ${targetLevel + 1}`);
      }
      await page.evaluate(() => window.advanceFrames(50));
      await page.keyboard.insertText("#########");
      const lost = await page.locator(".overlay .overlay-text").textContent();
      await page.locator(".overlay .play-btn").click({ force: true });
      const state = await page.evaluate(() => ({
        level: document.body.dataset.level,
        hearts: document.body.dataset.hearts,
        progress: document.querySelectorAll(".progress span").length,
        score: document.querySelectorAll(".progress span.on").length,
      }));
      check(lost.includes("Inténtalo otra vez") && state.level === String(targetLevel) && state.hearts === "3"
        && state.progress === [5, 7, 9, 12][targetLevel] && state.score === 0,
        `S4 losing level ${targetLevel + 1} retries that same level (${JSON.stringify(state)})`);
    }
    noExceptions(game, "S4 retry after losing");
  } finally {
    await game.browser.close();
  }
}

async function failedView() {
  let topCalls = 0;
  const game = await gameWithClock(async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("action") === "add") return reply(route, response([], 4));
    topCalls++;
    if (topCalls === 1) return route.abort();
    if (topCalls === 2) return reply(route, { ok: false, error: "server error" });
    return reply(route, response([], 4));
  });
  try {
    const { page } = game;
    await win(page, 4);
    const ranking = page.locator("#ranking");
    const present = await ranking.count() === 1;
    check(present, "S11 viewing errors scenario has a ranking form");
    if (!present) return;
    const view = ranking.getByRole("button", { name: "Ver ranking", exact: true });
    await fillLock(ranking);
    for (const kind of ["network", "server"]) {
      await view.click();
      await page.waitForFunction(() => document.querySelector("#ranking")?.textContent.includes("No se pudo cargar el ranking ahora. Inténtalo más tarde."), null, { polling: 100 });
      check(await view.isEnabled() && await ranking.getByRole("button", { name: "Guardar", exact: true }).isEnabled(),
        `S11 ${kind} viewing error is gentle and leaves both actions usable`);
    }
    await view.click();
    await page.waitForFunction(() => document.querySelector("#ranking")?.textContent.includes("Todavía no hay nadie este mes"), null, { polling: 100 });
    await page.locator(".overlay .play-btn").click({ force: true });
    const warning = page.getByRole("dialog", { name: "¡Todavía no has guardado tu puntuación!" });
    const warned = await warning.count() === 1;
    check(warned, "S6 a recovered server warns again when the score is still unsaved");
    if (!warned) return;
    await warning.getByRole("button", { name: "Guardar primero" }).click();
    await fillKey(ranking);
    await ranking.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#ranking")?.textContent.includes("Todavía no hay nadie este mes"), null, { polling: 100 });
    check(topCalls === 3, "S11 a failed view can be retried and does not prevent saving");
    noExceptions(game, "S11 viewing errors");
  } finally {
    await game.browser.close();
  }
}

async function overlappingRequests() {
  const game = await gameWithClock(async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("action") === "top") {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await reply(route, response([{ name: "Panda Feliz", points: 42 }]));
    } else {
      await reply(route, response([{ name: `${url.searchParams.get("animal")} ${url.searchParams.get("adjective")}`, points: Number(url.searchParams.get("points")) }]));
    }
  });
  try {
    const { page } = game;
    await win(page, 5);
    const ranking = page.locator("#ranking");
    const present = await ranking.count() === 1;
    check(present, "S11 overlapping view/save scenario has a ranking form");
    if (!present) return;
    await fillKey(ranking);
    await ranking.getByRole("button", { name: "Ver ranking", exact: true }).click();
    await ranking.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#ranking .ranking-saved"), null, { polling: 100 });
    await page.waitForTimeout(600);
    check(await ranking.locator(".ranking-saved").count() === 1 && !(await ranking.innerText()).includes("Panda Feliz"),
      "S11 an older top response cannot replace the newly saved result");
    noExceptions(game, "S11 overlapping requests");
  } finally {
    await game.browser.close();
  }
}

// S1-S2: wrong or missing keys save nothing and let the child try again.
async function keyErrors() {
  const adds = [];
  const game = await gameWithClock(async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("action") !== "add") return reply(route, response([], 1));
    adds.push(url);
    const key = url.searchParams.get("key");
    if (key === "rayo") return reply(route, { ok: false, error: "wrong grade", keyGrade: 6 });
    if (key !== "sol") return reply(route, { ok: false, error: "bad key" });
    return reply(route, response([{ name: "Panda Feliz", points: 900, from: 1 }, { name: "Lobo Leal", points: 800 }], 1));
  });
  try {
    const { page } = game;
    await win(page, 1);
    const ranking = page.locator("#ranking");
    const present = await ranking.count() === 1;
    check(present, "S2 key errors scenario has a ranking form");
    if (!present) return;
    const save = ranking.getByRole("button", { name: "Guardar", exact: true });
    const key = ranking.getByLabel("Clave de clase");
    const status = ranking.locator('[role="status"]');
    await fillLock(ranking);
    await key.fill("   ");
    await save.click();
    check(await status.textContent() === "Escribe la clave de tu clase." && adds.length === 0 && await save.isEnabled(),
      "S2 an empty key asks for it and contacts nobody");
    for (const [typed, message, label] of [
      ["patata", "Esa clave no es correcta. Pregúntasela a tu profe.", "a wrong key"],
      ["rayo", "Con la clave de 6º no puedes entrar en el ranking de 1º.", "an older grade's key"],
    ]) {
      await key.fill(typed);
      const before = adds.length;
      await save.click();
      await page.waitForFunction((text) => document.querySelector('#ranking [role="status"]')?.textContent === text, message, { polling: 100 });
      check(adds.length === before + 1 && await save.isEnabled() && await ranking.locator("ol li").count() === 0
        && !(await ranking.innerText()).includes("Tu mejor marca:"),
        `S2 ${label} shows «${message}», no personal result, and lets the child try again`);
    }
    await key.fill("sol");
    await save.click();
    await page.waitForFunction(() => document.querySelectorAll("#ranking ol li").length === 2, null, { polling: 100 });
    check(JSON.stringify(await ranking.locator("ol li").allTextContents()) === JSON.stringify(["🏆 Panda Feliz (de 1º) — 900", "🏆 Lobo Leal — 800"]),
      "S1 an entry from a younger grade shows «(de Nº)» after the name");
    check(adds.length === 3 && await save.isDisabled(), "S2 after the right key the score is saved once and Guardar stays off");
    noExceptions(game, "S2 key errors");
  } finally {
    await game.browser.close();
  }
}

// S2/S3/S5: the lock picker is ordered, retryable and usable on small screens.
async function lockPickerAndRetry() {
  const adds = [];
  const game = await gameWithClock(async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("action") !== "add") return reply(route, response([], 2));
    adds.push(Object.fromEntries(url.searchParams));
    if (adds.length < 3) return reply(route, { ok: false, error: "name taken" });
    return reply(route, response([{ name: "Panda Veloz", points: Number(url.searchParams.get("points")) }], 2));
  });
  try {
    const { page } = game;
    await win(page, 2);
    const ranking = page.locator("#ranking");
    const emojis = ranking.locator(".ranking-emoji");
    const selection = ranking.locator(".ranking-lock-selection");
    const clear = ranking.getByRole("button", { name: "Borrar emojis", exact: true });
    const save = ranking.getByRole("button", { name: "Guardar", exact: true });
    const status = ranking.locator('[role="status"]');
    check(JSON.stringify(await emojis.allTextContents()) === JSON.stringify(palette)
      && (await ranking.innerText()).includes("Elige 3 emojis secretos y recuérdalos: la próxima vez que uses este nombre te los pediré."),
      "S5 the picker displays the exact twelve emojis in order and the exact hint");
    if (await emojis.count() !== 12) return;
    for (const size of [{ width: 320, height: 568 }, { width: 768, height: 600 }]) {
      await page.setViewportSize(size);
      await emojis.last().scrollIntoViewIfNeeded();
      const boxes = await emojis.evaluateAll((buttons) => buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      }));
      check(boxes.every((box) => box.width >= 44 && box.height >= 44 && box.left >= 0 && box.right <= size.width)
        && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `S5 all twelve emoji tap targets fit and are at least 44px on ${size.width}px screens`);
    }
    await page.setViewportSize({ width: 1024, height: 600 });
    await ranking.getByLabel("Clave de clase").fill("sol");
    await ranking.locator("form").evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    check(await save.isDisabled() && adds.length === 0, "S5 even a forced form submit cannot send zero emojis");
    await fillLock(ranking, [3, 0]);
    await ranking.locator("form").evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    check(await save.isDisabled() && adds.length === 0 && (await selection.innerText()).includes("🚀 🍎"),
      "S5 two chosen emojis stay ordered and a forced submit sends nothing");
    await emojis.nth(7).click();
    await emojis.nth(2).click();
    check(await save.isEnabled() && (await selection.innerText()).includes("🚀 🍎 🐱") && !(await selection.innerText()).includes("🐶"),
      "S5 a fourth tap cannot change a complete lock");
    await clear.click();
    check(await save.isDisabled() && !(await selection.innerText()).includes("🚀") && !(await selection.innerText()).includes("🍎"),
      "S5 clearing removes the chosen emojis and disables Guardar");
    await fillLock(ranking, [0, 0, 11]);
    check(await save.isEnabled() && (await selection.innerText()).includes("🍎 🍎 🦋"), "S5 repeated emojis are allowed and shown in order");
    await clear.click();
    await fillLock(ranking, [3, 0, 7]);
    await save.click();
    const refusal = "Ese nombre ya es de un compañero con otros emojis. Elige otro nombre o revisa tus emojis.";
    await page.waitForFunction((text) => document.querySelector('#ranking [role="status"]')?.textContent === text, refusal, { polling: 100 });
    check(adds.length === 1 && adds[0].animal === "Tigre" && adds[0].lock === "3,0,7" && await save.isEnabled()
      && await ranking.getByLabel("Clave de clase").inputValue() === "sol" && (await selection.innerText()).includes("🚀 🍎 🐱")
      && await status.textContent() === refusal, "S5 name taken shows the exact message and preserves the form for retry");
    await page.locator(".overlay .play-btn").click({ force: true });
    const warning = page.getByRole("dialog", { name: "¡Todavía no has guardado tu puntuación!" });
    const warned = await warning.count() === 1;
    check(warned && adds.length === 1, "S6 a retryable refusal is still unsaved and warns without sending a request");
    if (!warned) return;
    await warning.getByRole("button", { name: "Guardar primero" }).click();
    await ranking.locator('select[name="animal"]').selectOption("Panda");
    await save.click();
    await page.waitForFunction(() => document.querySelector('#ranking [role="status"]')?.textContent.startsWith("Ese nombre ya es"), null, { polling: 100 });
    check(adds.length === 2 && adds[1].animal === "Panda" && adds[1].lock === "3,0,7" && await save.isEnabled(),
      "S5 a child can retry with another name and the same emojis");
    await clear.click();
    await fillLock(ranking, [3, 0, 3]);
    await save.click();
    await page.waitForFunction(() => document.querySelectorAll("#ranking ol li").length === 1, null, { polling: 100 });
    check(adds.length === 3 && adds[2].animal === "Panda" && adds[2].lock === "3,0,3" && await save.isDisabled()
      && (await ranking.locator("ol li").textContent()).startsWith("🏆 Panda Veloz"), "S5 a child can retry with corrected emojis and save once");
    await page.locator(".overlay .play-btn").click({ force: true });
    check(await page.locator("dialog[open]").count() === 0 && await page.evaluate(() => document.body.dataset.level === "0"),
      "S6 saving after Guardar primero removes the warning on replay");
    noExceptions(game, "S5 lock picker and retry");
  } finally {
    await game.browser.close();
  }
}

// S6 + ranking-justo S2: in every grade the ranking also opens after level 3, and level 4 is still offered.
async function levelThree(grade = 3) {
  const adds = [];
  const game = await gameWithClock(async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("action") === "add") {
      adds.push(Object.fromEntries(url.searchParams));
      const result = response([
        { name: "Lobo Leal", points: 300 },
        { name: "Panda Feliz", points: 900, level: 3 },
      ], grade);
      if (url.searchParams.get("level") === "3") result.me = { name: "Panda Feliz", points: 900, position: 2, total: 2, level: 3 };
      await reply(route, result);
    } else await reply(route, response([], grade));
  });
  try {
    const { page } = game;
    await chooseGrade(page, grade);
    for (let level = 0; level < 2; level++) {
      const result = await finishWithClock(page);
      check(result.finished && await page.locator("#ranking").count() === 0, `S6 no ranking after level ${level + 1} in ${grade}º`);
    }
    const third = await finishWithClock(page);
    const ranking = page.locator("#ranking");
    check(third.finished && await ranking.count() === 1 && (await ranking.innerText()).includes("Nivel 3 superado"),
      `S6 ${grade}º is offered the ranking after level 3`);
    await ranking.locator('select[name="animal"]').selectOption("Panda");
    await ranking.locator('select[name="adjective"]').selectOption("Feliz");
    await fillKey(ranking, "sol");
    await ranking.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("#ranking ol li").length === 2, null, { polling: 100 });
    check(adds.length === 1 && adds[0].level === "3" && adds[0].grade === String(grade) && adds[0].key === "sol" && adds[0].lock === "0,1,2",
      `S6 the level-3 save tells the server the level (${JSON.stringify(adds[0])})`);
    check(JSON.stringify(await ranking.locator("ol li").allTextContents()) === JSON.stringify(["🏆 Lobo Leal — 300", "🥇 Panda Feliz — 900"])
      && await ranking.getByText(`Tu mejor marca: 900 · Estás en el puesto 2 de ${grade}º`, { exact: true }).isVisible()
      && await ranking.locator("ol li").nth(1).evaluate((item) => item.classList.contains("ranking-saved")),
      `S1/S6 the level-3 personal result uses the exact ${grade}º wording while the list retains its medals and highlight`);
    await page.locator(".overlay .play-btn").click({ force: true });
    await page.waitForFunction(() => document.body.dataset.level === "3" && !document.querySelector(".overlay"), null, { polling: 100 });
    check(await page.locator("#ranking").count() === 0 && await page.locator("dialog[open]").count() === 0,
      "S6 after saving, the play button goes on to level 4 without a warning");
    const fourth = await finishWithClock(page);
    await page.waitForFunction(() => !document.querySelector(".trophy-flight"), null, { polling: 100 });
    check(fourth.finished && await ranking.count() === 1 && !(await ranking.innerText()).includes("Nivel 3 superado"),
      "S6 finishing level 4 still offers the normal ranking");
    await fillKey(ranking, "sol");
    await ranking.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.waitForFunction((n) => document.querySelectorAll("#ranking ol li").length === n, 2, { polling: 100 });
    check(adds.length === 2 && !("level" in adds[1]), `S6 the level-4 save sends no level, as before (${JSON.stringify(adds[1])})`);
    await page.locator(".overlay .play-btn").click({ force: true });
    check(await page.evaluate(() => document.body.dataset.level === "0"), `S4 ${grade}º starts level 1 after its final ranking, not after the level-3 ranking`);
    noExceptions(game, `S6 level three in ${grade}º`);
  } finally {
    await game.browser.close();
  }
}

// S6 (unsaved score): keep the actual form alive, including a retryable error.
async function unsavedFinalWarning() {
  const requests = [];
  const game = await gameWithClock(async (route) => {
    requests.push(new URL(route.request().url()));
    await reply(route, { ok: false, error: "name taken" });
  });
  try {
    const { page } = game;
    await win(page, 5);
    const ranking = page.locator("#ranking");
    const animal = ranking.locator('select[name="animal"]');
    const adjective = ranking.locator('select[name="adjective"]');
    const key = ranking.getByLabel("Clave de clase");
    await animal.selectOption("Panda");
    await adjective.selectOption("Elegante");
    await key.fill("luz");
    await fillLock(ranking, [3, 0, 7]);
    await ranking.getByRole("button", { name: "Guardar", exact: true }).click();
    const refusal = "Ese nombre ya es de un compañero con otros emojis. Elige otro nombre o revisa tus emojis.";
    await page.waitForFunction((text) => document.querySelector('#ranking [role="status"]')?.textContent === text, refusal, { polling: 100 });
    const score = await pointsOnScreen(page);
    const originalRequests = requests.length;
    await page.evaluate(() => { window.s6OriginalForm = document.querySelector("#ranking form"); });
    const formState = () => ranking.evaluate((section) => ({
      animal: section.querySelector('[name="animal"]').value,
      adjective: section.querySelector('[name="adjective"]').value,
      key: section.querySelector('[name="key"]').value,
      emojis: section.querySelector(".ranking-lock-selection").textContent,
      message: section.querySelector('[role="status"]').textContent,
      sameForm: section.querySelector("form") === window.s6OriginalForm,
    }));
    const before = await formState();
    const play = page.locator(".overlay .play-btn");
    await key.focus();
    await play.click({ force: true });
    const warning = page.getByRole("dialog", { name: "¡Todavía no has guardado tu puntuación!" });
    const present = await warning.count() === 1;
    check(present && await page.evaluate(() => document.body.dataset.level === "3"),
      "S6 mouse play with an unsaved final score opens a warning instead of starting");
    if (!present) return;
    check(await warning.getByText("¡Todavía no has guardado tu puntuación!", { exact: true }).count() === 1
      && await warning.getByText(`Si juegas otra vez, estos ${score} puntos no entrarán en el ranking.`, { exact: true }).count() === 1
      && await warning.getByRole("button", { name: "Guardar primero", exact: true }).count() === 1
      && await warning.getByRole("button", { name: "Jugar sin guardar", exact: true }).count() === 1,
      `S6 warning uses the exact text and this run's real score (${score})`);
    check(await warning.evaluate((dialog) => dialog.contains(document.activeElement)), "S6 focus moves into the warning");
    check(JSON.stringify(await formState()) === JSON.stringify(before) && requests.length === originalRequests,
      "S6 opening the warning preserves every form value and error, and sends no request");
    for (const size of [{ width: 320, height: 568 }, { width: 360, height: 780 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(size);
      const layout = await warning.evaluate((dialog) => {
        const rect = dialog.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
          buttons: [...dialog.querySelectorAll("button")].map((button) => {
            const b = button.getBoundingClientRect();
            return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
          }), scrollWidth: document.documentElement.scrollWidth };
      });
      check(layout.left >= 0 && layout.top >= 0 && layout.right <= size.width && layout.bottom <= size.height
        && layout.scrollWidth <= size.width && layout.buttons.length === 2
        && layout.buttons.every((b) => b.left >= 0 && b.top >= 0 && b.right <= size.width && b.bottom <= size.height && b.width >= 44 && b.height >= 44),
        `S6 warning and both 44px touch targets fit ${size.width}x${size.height} (${JSON.stringify(layout)})`);
    }
    await warning.getByRole("button", { name: "Guardar primero" }).click();
    await page.waitForTimeout(600);
    check(await warning.count() === 0 && await key.evaluate((el) => document.activeElement === el)
      && JSON.stringify(await formState()) === JSON.stringify(before) && requests.length === originalRequests,
      "S6 Guardar primero returns focus to the unchanged form without a request");
    for (const keyName of ["Enter", "Space"]) {
      await play.focus();
      await page.keyboard.press(keyName);
      const opened = await warning.count() === 1;
      check(opened && await page.evaluate(() => document.body.dataset.level === "3"),
        `S6 ${keyName} on play cannot bypass the warning`);
      if (!opened) return;
      await warning.getByRole("button", { name: "Guardar primero" }).focus();
      await page.keyboard.press("Shift+Tab");
      check(await warning.evaluate((dialog) => dialog.contains(document.activeElement)), `S6 ${keyName} warning keeps keyboard focus inside`);
      await warning.getByRole("button", { name: "Guardar primero" }).click();
    }
    await play.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    check(await warning.count() === 0 && await key.evaluate((el) => document.activeElement === el)
      && JSON.stringify(await formState()) === JSON.stringify(before), "S6 Escape returns to the unchanged form");
    await play.focus();
    await page.keyboard.press("Enter");
    await warning.getByRole("button", { name: "Jugar sin guardar" }).focus();
    await page.keyboard.press("Space");
    check(await page.locator(".overlay").count() === 0 && await page.evaluate(() => document.body.dataset.level === "0")
      && await page.locator("dialog[open]").count() === 0 && requests.length === originalRequests,
      "S6 keyboard Jugar sin guardar starts level 1 and the warning sends no request");
    noExceptions(game, "S6 final unsaved warning");
  } finally {
    await game.browser.close();
  }
}

async function unsavedCheckpointTouch() {
  const requests = [];
  const game = await gameWithClock(async (route) => {
    requests.push(new URL(route.request().url()));
    await reply(route, response([], 3));
  }, { touch: true });
  try {
    const { page } = game;
    await chooseGrade(page, 3);
    check(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "S6 checkpoint runs in tablet touch mode");
    await page.locator(".key-catcher").focus();
    for (let level = 0; level < 3; level++) {
      const result = await finishWithClock(page);
      if (!result.finished) throw new Error(`Could not finish checkpoint level ${level + 1}`);
    }
    const ranking = page.locator("#ranking");
    const score = await pointsOnScreen(page);
    await ranking.locator('select[name="animal"]').selectOption("Panda");
    await ranking.locator('select[name="adjective"]').selectOption("Feliz");
    await ranking.getByLabel("Clave de clase").fill("sol");
    await fillLock(ranking, [2, 1, 0]);
    const beforeRequests = requests.length;
    await page.evaluate(() => {
      window.s6TouchPointers = [];
      document.addEventListener("pointerdown", (event) => window.s6TouchPointers.push(event.pointerType), true);
    });
    async function tap(locator) {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    }
    const play = page.locator(".overlay .play-btn");
    await tap(play);
    const warning = page.getByRole("dialog", { name: "¡Todavía no has guardado tu puntuación!" });
    const present = await warning.count() === 1;
    check(present && await page.evaluate(() => document.body.dataset.level === "2" && window.s6TouchPointers.includes("touch")),
      "S6 a real touch at the 3º checkpoint opens the warning without starting level 4");
    if (!present) return;
    check(await warning.getByText(`Si juegas otra vez, estos ${score} puntos no entrarán en el ranking.`, { exact: true }).count() === 1,
      `S6 the 3º checkpoint warning contains its real level-3 score (${score})`);
    await tap(warning.getByRole("button", { name: "Guardar primero" }));
    check(await warning.count() === 0 && await ranking.locator('select[name="animal"]').inputValue() === "Panda"
      && await ranking.locator('select[name="adjective"]').inputValue() === "Feliz" && await ranking.getByLabel("Clave de clase").inputValue() === "sol"
      && (await ranking.locator(".ranking-lock-selection").innerText()).includes("🐶 ⭐ 🍎") && requests.length === beforeRequests,
      "S6 touch Guardar primero preserves the checkpoint form without a request");
    await tap(play);
    await tap(warning.getByRole("button", { name: "Jugar sin guardar" }));
    check(await page.locator(".overlay").count() === 0 && await page.evaluate(() => document.body.dataset.level === "3")
      && await page.locator("dialog[open]").count() === 0 && requests.length === beforeRequests,
      "S6 touch Jugar sin guardar continues to level 4 without a request");
    noExceptions(game, "S6 checkpoint touch");
  } finally {
    await game.browser.close();
  }
}

async function unavailableAndOrdinaryPlay() {
  // The preview already exposed a network failure before the locally built form appears.
  const previewFailed = await gameWithClock((route) => route.abort(), { previewHandled: true });
  try {
    const { page } = previewFailed;
    await win(page, 2);
    check(await page.locator("#ranking").count() === 1, "S6 preview failure scenario reaches the final form");
    await page.locator(".overlay .play-btn").click({ force: true });
    check(await page.locator("dialog[open]").count() === 0 && await page.evaluate(() => document.body.dataset.level === "0"),
      "S6 a failed ranking preview never blocks replay with a warning");
    noExceptions(previewFailed, "S6 preview failure");
  } finally {
    await previewFailed.browser.close();
  }
  const viewFailed = await gameWithClock((route) => reply(route, { ok: false, error: "server error" }));
  try {
    const { page } = viewFailed;
    await win(page, 2);
    await page.locator("#ranking").getByRole("button", { name: "Ver ranking" }).click();
    await page.waitForFunction(() => document.querySelector("#ranking")?.textContent.includes("No se pudo cargar el ranking ahora."), null, { polling: 100 });
    await page.locator(".overlay .play-btn").click({ force: true });
    check(await page.locator("dialog[open]").count() === 0 && await page.evaluate(() => document.body.dataset.level === "0"),
      "S6 a failed ranking view never blocks replay with a warning");
    noExceptions(viewFailed, "S6 viewing failure");
  } finally {
    await viewFailed.browser.close();
  }
  const missingForm = await gameWithClock((route) => reply(route, response()));
  try {
    const { page } = missingForm;
    await win(page, 2);
    await page.locator("#ranking").evaluate((section) => section.remove());
    await page.locator(".overlay .play-btn").click({ force: true });
    check(await page.locator("dialog[open]").count() === 0 && await page.evaluate(() => document.body.dataset.level === "0"),
      "S6 replay is never blocked if the ranking form is absent");
    noExceptions(missingForm, "S6 missing form");
  } finally {
    await missingForm.browser.close();
  }
  const ordinary = await gameWithClock((route) => reply(route, response()));
  try {
    const { page } = ordinary;
    await chooseGrade(page, 6);
    await page.evaluate(() => window.advanceFrames(50));
    await page.keyboard.insertText("#########");
    check((await page.locator(".overlay .overlay-text").textContent()).includes("Inténtalo otra vez"), "S6 ordinary loss shows its normal summary");
    await page.locator(".overlay .play-btn").click({ force: true });
    check(await page.locator("dialog[open]").count() === 0 && await page.evaluate(() => document.body.dataset.level === "0"),
      "S6 an ordinary loss retries without a ranking warning even when the ranking URL is set");
    noExceptions(ordinary, "S6 ordinary replay");
  } finally {
    await ordinary.browser.close();
  }
}

// S7: after choosing the grade the child sees this month's top, then plays; a slow or broken server never blocks the game.
async function startPreview() {
  const seen = [];
  const game = await gameWithClock(async (route) => {
    seen.push(new URL(route.request().url()));
    await reply(route, response([
      { name: "Lobo Leal", points: 300 },
      { name: "Panda Feliz", points: 900, level: 3 },
      { name: "Tigre Veloz", points: 200, from: 2 },
    ], 3));
  }, { previewHandled: true });
  try {
    const { page } = game;
    await page.waitForSelector(".overlay .grade-btn");
    await page.click('.overlay .grade-btn[data-grade="3"]', { force: true });
    await page.waitForSelector("#ranking-preview li");
    const preview = page.locator("#ranking-preview");
    check(JSON.stringify(await preview.locator("li").allTextContents()) === JSON.stringify(["🏆 Lobo Leal — 300", "🥇 Panda Feliz — 900", "🏆 Tigre Veloz (de 2º) — 200"]),
      "S7 the preview lists the grade's top with the same medals as the ranking");
    check(seen.length === 1 && seen[0].searchParams.get("action") === "top" && seen[0].searchParams.get("grade") === "3" && !seen[0].searchParams.has("key"),
      `S7 the preview only reads the chosen grade's top, with no key (${seen.map(String).join(" ")})`);
    check(await page.locator("#ranking").count() === 0 && await page.locator("body").evaluate((b) => b.dataset.level === undefined || b.dataset.level === ""),
      "S7 the game has not started while the preview is shown");
    await page.click(".overlay .play-btn", { force: true });
    await page.waitForFunction(() => document.body.dataset.level === "0" && !document.querySelector(".overlay"), null, { polling: 100 });
    check(await page.locator("dialog[open]").count() === 0, "S7/S6 the preview play button starts level 1 without a warning");
    noExceptions(game, "S7 preview");
  } finally {
    await game.browser.close();
  }
  // A server that fails still lets the child play.
  const broken = await gameWithClock((route) => route.fulfill({ status: 500, body: "no" }), { previewHandled: true });
  try {
    const { page } = broken;
    await page.waitForSelector(".overlay .grade-btn");
    await page.click('.overlay .grade-btn[data-grade="2"]', { force: true });
    await page.waitForFunction(() => document.querySelector("#ranking-preview p")?.textContent.includes("No se pudo cargar"), null, { polling: 100 });
    await page.click(".overlay .play-btn", { force: true });
    await page.waitForFunction(() => document.body.dataset.level === "0" && !document.querySelector(".overlay"), null, { polling: 100 });
    check(true, "S7 a failing ranking server does not block the game");
  } finally {
    await broken.browser.close();
  }
}

(async () => {
  for (const [label, run] of [["lock picker and retry", lockPickerAndRetry], ["key errors", keyErrors], ["empty URL", withoutUrl], ["save and safety", saveAndSafety], ["server error", () => failedSave("server")],
    ["network error", () => failedSave("network")], ["view without saving", viewWithoutSaving], ["grade 1 and replay", gradeOneAndRepeat],
    ["replay every grade", replayEveryGrade], ["retry lost level", retryLostLevel], ["view errors", failedView], ["overlapping requests", overlappingRequests], ["level three in 3º", levelThree], ["level three in 1º", () => levelThree(1)], ["level three in 6º", () => levelThree(6)],
    ["S6 unsaved final warning", unsavedFinalWarning], ["S6 unsaved checkpoint touch", unsavedCheckpointTouch], ["S6 unavailable and ordinary play", unavailableAndOrdinaryPlay], ["start preview", startPreview]]) {
    try { await run(); } catch (e) { check(false, `${label}: ${e.stack || e}`); }
  }
  console.log(`TOTAL: ${okCount} ok, ${failCount} FAIL`);
  // npm test stops at the first suite that exits with an error.
  if (failCount) process.exitCode = 1;
})().catch((e) => { error(e); process.exitCode = 1; });
