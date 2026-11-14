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
}

async function finishWithClock(page) {
  return page.evaluate(() => {
    const level = document.body.dataset.level;
    for (let i = 0; i < 3000 && !document.querySelector(".overlay") && document.body.dataset.level === level; i++) {
      window.randomValue = ((i * 37) % 99 + 0.5) / 100;
      window.advanceFrames(50);
      const target = document.querySelector(".ship");
      if (target) for (const key of target.dataset.text) window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }
    return { level, finished: !!document.querySelector(".overlay") || document.body.dataset.level !== level };
  });
}

async function gameWithClock(handler) {
  const game = await openGame("juegos/teclado.html");
  const { page } = game;
  game.pageErrors = [];
  page.on("pageerror", (e) => game.pageErrors.push(e.message));
  page.setDefaultTimeout(5000);
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (handler) {
    await page.addInitScript(() => { window.RANKING_URL = "https://ranking.test/exec"; });
    await page.route("https://ranking.test/**", handler);
  } else {
    // The real school URL lives in assets/ranking-config.js; an empty one turns the ranking off.
    await page.addInitScript(() => { window.RANKING_URL = ""; });
  }
  await installFrameClock(page);
  return game;
}

async function win(page, grade, checkEarly = false) {
  await chooseGrade(page, grade);
  if (checkEarly) check(await page.locator("#ranking").count() === 0, "S11 no ranking at the start of the game");
  for (let level = 0; level < 4; level++) {
    const result = await finishWithClock(page);
    if (checkEarly && level < 3) {
      check(result.level === String(level) && result.finished && await page.locator("#ranking").count() === 0 && await page.locator(".overlay").count() === 0,
        `S11 no ranking after level ${level + 1}`);
    }
    if (!result.finished) throw new Error(`Could not finish level ${level + 1}`);
  }
  // The trophy flight of the last win moves the overlay; click only once it lands.
  await page.waitForFunction(() => !document.querySelector(".trophy-flight"), null, { polling: 100 });
}

const response = (top = [], grade = 5) => ({ ok: true, grade, month: "2026-11", top });
const reply = (route, body) => route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
const noExceptions = (game, label) => check(game.pageErrors.length === 0, `${label}: no page exceptions (${game.pageErrors.join(" | ")})`);
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
    await finish(game);
  } finally {
    await game.browser.close();
  }
}

async function saveAndSafety() {
  const requests = [];
  const game = await gameWithClock(async (route) => {
    const url = new URL(route.request().url());
    requests.push({ method: route.request().method(), url });
    if (url.searchParams.get("action") === "add") {
      // Keep the request in flight briefly so rapid duplicate submissions are exercised.
      await new Promise((resolve) => setTimeout(resolve, 300));
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
    check(await ranking.locator("input, textarea, [contenteditable=true]").count() === 0,
      "S11 no free-text field can collect a real name");
    check(requests.length === 0 && game.external.length === 0, "S11 configuring the URL does not contact the server before a button is used");
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
    check(await save.evaluate((el) => document.activeElement === el), "S11 Tab reaches Guardar without the key-catcher stealing focus");
    const request = page.waitForRequest((r) => r.url().startsWith("https://ranking.test/") && new URL(r.url()).searchParams.get("action") === "add");
    await page.keyboard.press("Enter");
    await request;
    check(await save.isDisabled(), "S11 Guardar is disabled while the save is in flight");
    await ranking.locator("form").evaluate((form) => {
      for (let i = 0; i < 3; i++) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => document.querySelectorAll("#ranking ol li").length === 3, null, { polling: 100 });
    await ranking.locator("form").evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await page.waitForTimeout(100);
    const adds = requests.filter((r) => r.url.searchParams.get("action") === "add");
    const params = adds[0]?.url.searchParams;
    check(adds.length === 1 && adds[0].method === "GET" && params.get("animal") === animal && params.get("adjective") === selectedAdjective
      && params.get("grade") === "5" && params.get("points") === String(score) && [...params.keys()].sort().join(",") === "action,adjective,animal,grade,points",
      `S11 at most one add sends the selected invented name, fixed grade and final score (${adds.length} requests)`);
    const rows = ranking.locator("ol li");
    check(await rows.count() === 3 && await rows.nth(0).textContent() === `Lince Feliz — ${score + 100}`
      && await rows.nth(1).textContent() === `${animal} ${selectedAdjective} — ${score}`,
      "S11 the returned top is rendered in order with names and points");
    check(await rows.nth(1).evaluate((el) => el.classList.contains("ranking-saved")) && await ranking.locator(".ranking-saved").count() === 1,
      "S11 the saved entry is highlighted when it is in the top");
    check((await rows.nth(2).textContent()).includes('<img src=x onerror="window.rankingXss=1">')
      && await rows.nth(2).locator("img").count() === 0 && !await page.evaluate(() => window.rankingXss),
      "S11 a hostile returned name is displayed as text, never interpreted as HTML");
    noExceptions(game, "S11 successful save");
  } finally {
    await game.browser.close();
  }
}

async function failedSave(kind) {
  const requests = [];
  const game = await gameWithClock(async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (url.searchParams.get("action") === "add") {
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
    await ranking.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#ranking")?.textContent.includes("No se pudo guardar ahora. Inténtalo más tarde."), null, { polling: 100 });
    check((await ranking.innerText()).includes("No se pudo guardar ahora. Inténtalo más tarde."), `S11 ${kind} error shows the gentle save message`);
    check(await ranking.getByRole("button", { name: "Guardar", exact: true }).isDisabled(), `S11 ${kind} error does not allow a second submission`);
    await ranking.locator("form").evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await ranking.getByRole("button", { name: "Ver ranking", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#ranking")?.textContent.includes("Todavía no hay nadie este mes"), null, { polling: 100 });
    check(requests.filter((url) => url.searchParams.get("action") === "add").length === 1 && requests.some((url) => url.searchParams.get("action") === "top"),
      `S11 ${kind} error still permits viewing the ranking without a duplicate save`);
    noExceptions(game, `S11 ${kind} error`);
    await page.locator(".overlay .play-btn").click({ force: true });
    const resumed = await page.evaluate(() => {
      window.advanceFrames(50);
      const ship = document.querySelector(".ship");
      if (!ship) return false;
      window.dispatchEvent(new KeyboardEvent("keydown", { key: ship.dataset.text[0], bubbles: true, cancelable: true }));
      return document.body.dataset.level === "3" && (ship.dataset.typed === "1" || !ship.isConnected);
    });
    check(resumed, `S11 ${kind} error leaves the repeated level playable`);
  } finally {
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
    await reply(route, response(++views === 1 ? top : [], 6));
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
    const expected = Array.from({ length: 10 }, (_, i) => `${animals[i]} ${adjectives[i]} — ${1200 - i * 100}`);
    check(JSON.stringify(await ranking.locator("ol li").allTextContents()) === JSON.stringify(expected),
      "S11 Ver ranking shows all ten returned entries in order without saving");
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
  const game = await gameWithClock(async (route) => {
    const url = new URL(route.request().url());
    adds.push(url);
    await reply(route, response([{ name: "Panda Feliz", points: 9999 }], 1));
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
    await ranking.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("#ranking ol li").length === 1, null, { polling: 100 });
    check(adds.length === 1 && adds[0].searchParams.get("grade") === "1" && adds[0].searchParams.get("points") === String(firstScore)
      && await ranking.locator(".ranking-saved").count() === 0, "S11 a score outside the top is saved without highlighting another entry");
    await page.locator(".overlay .play-btn").click({ force: true });
    const replay = await finishWithClock(page);
    ranking = page.locator("#ranking");
    check(replay.level === "3" && replay.finished && await ranking.count() === 1
      && !await ranking.getByRole("button", { name: "Guardar", exact: true }).isDisabled(), "S11 replaying level 4 creates a fresh chance to save");
    const secondScore = await pointsOnScreen(page);
    await ranking.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll("#ranking ol li").length === 1, null, { polling: 100 });
    check(adds.length === 2 && adds[1].searchParams.get("grade") === "1" && adds[1].searchParams.get("points") === String(secondScore),
      "S11 each separate win can be submitted once with its own score");
    noExceptions(game, "S11 repeating the final level");
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
    return reply(route, { ok: false, error: "server error" });
  });
  try {
    const { page } = game;
    await win(page, 4);
    const ranking = page.locator("#ranking");
    const present = await ranking.count() === 1;
    check(present, "S11 viewing errors scenario has a ranking form");
    if (!present) return;
    const view = ranking.getByRole("button", { name: "Ver ranking", exact: true });
    for (const kind of ["network", "server"]) {
      await view.click();
      await page.waitForFunction(() => document.querySelector("#ranking")?.textContent.includes("No se pudo cargar el ranking ahora. Inténtalo más tarde."), null, { polling: 100 });
      check(await view.isEnabled() && await ranking.getByRole("button", { name: "Guardar", exact: true }).isEnabled(),
        `S11 ${kind} viewing error is gentle and leaves both actions usable`);
    }
    await ranking.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#ranking")?.textContent.includes("Todavía no hay nadie este mes"), null, { polling: 100 });
    check(topCalls === 2, "S11 a failed view can be retried and does not prevent saving");
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

(async () => {
  for (const [label, run] of [["empty URL", withoutUrl], ["save and safety", saveAndSafety], ["server error", () => failedSave("server")],
    ["network error", () => failedSave("network")], ["view without saving", viewWithoutSaving], ["grade 1 and replay", gradeOneAndRepeat],
    ["view errors", failedView], ["overlapping requests", overlappingRequests]]) {
    try { await run(); } catch (e) { check(false, `${label}: ${e.stack || e}`); }
  }
  console.log(`TOTAL: ${okCount} ok, ${failCount} FAIL`);
  // npm test stops at the first suite that exits with an error.
  if (failCount) process.exitCode = 1;
})().catch((e) => { error(e); process.exitCode = 1; });
