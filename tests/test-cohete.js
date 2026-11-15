// Real keyboard input; the public state only helps time a hop, never collects anything.
const path = require("path");
const os = require("os");
const { chromium } = require("playwright-core");
const { openGame, pressPlay, check, finish } = require("./helpers");

const ROOT = "file://" + path.resolve(__dirname, "..");
const EXECUTABLE =
  process.env.CHROME_PATH ||
  path.join(os.homedir(), ".cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell");

// helpers.js is read only, so a tablet page (touch enabled) is opened here.
async function touchGame(file) {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const context = await browser.newContext({ viewport: { width: 768, height: 1024 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  const external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("request", (r) => !r.url().startsWith("file://") && external.push(r.url()));
  await page.goto(`${ROOT}/${file}`);
  return { browser, page, errors, external };
}

// A real finger tap in the middle of the element. Coordinates are used because
// the game keys pulse, so Playwright would wait forever for a stable element.
async function tapOn(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

// Reads only what the page already publishes: where the rocket is, where the
// flying things are, and the speed of the level.
function readState(page) {
  return page.evaluate(() => {
    const rocket = document.querySelector("#rocket");
    const world = document.querySelector("#world");
    const rx = Number(rocket.dataset.x);
    return {
      height: Number(rocket.dataset.height),
      hops: Number(rocket.dataset.hops),
      state: world.dataset.state,
      lives: Number(world.dataset.lives),
      missed: Number(world.dataset.missed),
      speed: Number(world.dataset.speed) || 250,
      stars: document.querySelectorAll(".progress span.on").length,
      overlay: document.querySelector(".overlay")
        ? {
            emoji: document.querySelector(".overlay .big-emoji").textContent,
            hasAward: !!document.querySelector(".overlay .big-emoji svg"),
            text: document.querySelector(".overlay .overlay-text")?.textContent || "",
          }
        : null,
      items: [...document.querySelectorAll(".star, .hazard")].map((el) => ({
        kind: el.classList.contains("star") ? "star" : el.dataset.kind,
        lead: Number(el.dataset.x) - rx,
      })),
    };
  });
}

// Plays like a child: hop when something is about to arrive, stay on the ground
// while a UFO passes over. A child's timing is a hop ahead of the contact.
async function flyLevel(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let restarts = 0;
  while (Date.now() < deadline) {
    const now = await readState(page);
    if (now.overlay) {
      if (now.overlay.emoji.includes("💥")) {
        restarts++;
        await page.click(".overlay .play-btn", { force: true });
        continue;
      }
      return { ...now, restarts };
    }
    if (now.state === "ready") {
      await page.keyboard.press("Enter");
      continue;
    }
    const secondsToArrive = (item) => item.lead / now.speed;
    const ufoPassing = now.items.some(
      (item) => item.kind === "ufo" && secondsToArrive(item) > 0.2 && secondsToArrive(item) < 1.3
    );
    const next = now.items
      .filter((item) => item.kind !== "ufo" && item.lead > 100 && item.lead < 180)
      .sort((a, b) => a.lead - b.lead)[0];
    if (now.height === 0 && !ufoPassing && next) await page.keyboard.press("Space");
  }
  return null;
}

// S1 + S3: on a tablet there is no physical keyboard, so the drawn ENTER and
// SPACE keys must be tappable and act exactly like the physical key.
async function touchChecks() {
  const game = await touchGame("juegos/cohete.html");
  const { page } = game;
  try {
    await pressPlay(page);
    const state = () => page.locator("#world").getAttribute("data-state");
    const hops = async () => Number(await page.locator("#rocket").getAttribute("data-hops"));
    const height = async () => Number(await page.locator("#rocket").getAttribute("data-height"));
    check((await state()) === "ready", "touch: the rocket waits on the pad");

    // A mouse stays keyboard only: clicking the drawn keys never presses them.
    await page.locator("#enter-key").click({ force: true });
    check((await state()) === "ready", "mouse: clicking the drawn ENTER key never launches");
    await page.locator("#space-key").click({ force: true });
    check((await state()) === "ready", "mouse: clicking the drawn SPACE key changes nothing");
    check(!(await page.locator("#space-key").evaluate((el) => el.classList.contains("hint"))), "mouse: clicking never flashes the key hint");
    check(!(await page.locator("#enter-key").evaluate((el) => el.classList.contains("hint"))), "mouse: clicking ENTER never flashes a hint");

    // Tapping SPACE before ENTER is the same mistake as pressing it.
    await tapOn(page, "#space-key");
    check((await state()) === "ready", "touch: tapping SPACE before ENTER does not launch");
    check(await page.locator("#enter-key").evaluate((el) => el.classList.contains("hint")), "touch: tapping SPACE early hints the key to press");

    await tapOn(page, "#enter-key");
    check((await state()) === "flying", "touch: tapping ENTER starts the flight");
    check(await page.locator("#pad").evaluate((el) => el.hidden), "touch: tapping ENTER hides the launch pad");

    const beforeTap = await hops();
    await tapOn(page, "#space-key");
    check((await hops()) === beforeTap + 1, "touch: tapping SPACE counts one hop");
    await page.waitForTimeout(150);
    check((await height()) > 0, "touch: tapping SPACE lifts the rocket");

    // While flying, a mouse click on the drawn key still does nothing.
    const heldHops = await hops();
    await page.locator("#space-key").click({ force: true });
    check((await hops()) === heldHops, "mouse: clicking the drawn SPACE key never hops while flying");

    // A pen stylus counts as touch too (a real pen cannot be emulated, so the
    // pointer event is dispatched with the same shape the browser sends).
    await page.evaluate(() => {
      const keyEl = document.querySelector("#space-key");
      keyEl.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "pen", bubbles: true, cancelable: true }));
    });
    check((await hops()) === heldHops + 1, "pen: tapping SPACE counts one hop");

    const keyStyle = await page.locator("#space-key").evaluate((el) => {
      const style = getComputedStyle(el);
      return { touch: style.touchAction, select: style.userSelect };
    });
    check(keyStyle.touch !== "auto", `touch: the drawn keys never double-tap zoom (${keyStyle.touch})`);
    check(keyStyle.select === "none", `touch: the drawn keys cannot select text (${keyStyle.select})`);
    check(game.errors.length === 0, `touch: no page errors (${game.errors.join(" | ")})`);
    check(game.external.length === 0, `touch: no external requests (${game.external.join(", ")})`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await game.browser.close();
  }
}

(async () => {
  await touchChecks();
  let game;
  try {
    game = await openGame("juegos/cohete.html");
    const { page } = game;

    await pressPlay(page);
    check((await page.locator("#world").getAttribute("data-state")) === "ready", "the start screen leaves the rocket on the pad");
    check((await page.locator("#lives span").count()) === 3, "three hearts before the flight");
    // S11: each level asks for more stars, flies faster and brings more hazards.
    const goal = () => page.locator(".progress span").count();
    const speed = async () => Number(await page.locator("#world").getAttribute("data-speed"));
    check((await goal()) === 5, `level one asks for five stars (${await goal()})`);
    const speeds = [await speed()];
    await page.keyboard.press("Space");
    check((await page.locator("#world").getAttribute("data-state")) === "ready", "SPACE before ENTER does not launch");
    await page.keyboard.press("a");
    check(await page.locator("#enter-key").evaluate((el) => el.classList.contains("hint")), "wrong key hints ENTER");

    // S1 + S4: the rocket leaves the pad and flies forward, and it never flies backwards.
    await page.keyboard.press("Enter");
    check((await page.locator("#world").getAttribute("data-state")) === "flying", "ENTER starts the flight");
    const padX = Number(await page.locator("#rocket").getAttribute("data-x"));
    // S9: the scenery itself scrolls past, not only the thin ground strip.
    const sceneryX = () => page.$$eval("[data-layer]", (layers) => layers.map((l) => Math.round(l.getBoundingClientRect().x)));
    const sceneBefore = await sceneryX();
    await page.waitForTimeout(600);
    const sceneAfter = await sceneryX();
    check(sceneBefore.length >= 3, `the scenery is drawn in layers (${sceneBefore.length})`);
    check(sceneBefore.length > 0 && sceneBefore.every((x, i) => sceneAfter[i] < x), `every scenery layer scrolls left (${sceneBefore} -> ${sceneAfter})`);
    const track = [];
    for (let i = 0; i < 32; i++) {
      track.push(Number(await page.locator("#rocket").getAttribute("data-x")));
      await page.waitForTimeout(250);
    }
    const backwards = track.some((x, i) => i > 0 && x < track[i - 1]);
    const width = await page.locator("#world").evaluate((el) => el.clientWidth);
    check(track.at(-1) > padX + 60, `rocket flies forward off the pad (${padX} -> ${track.at(-1)})`);
    check(!backwards, `rocket never flies backwards (${track.join(",")})`);
    check(track.at(-1) < width * 0.45, `rocket cruises in the left part of the screen (${track.at(-1)} of ${width})`);
    await page.keyboard.press("x");
    check(await page.locator("#space-key").evaluate((el) => el.classList.contains("hint")), "wrong flying key hints SPACE");
    await page.keyboard.press("x");
    check(await page.locator("#space-key").evaluate((el) => el.classList.contains("hint")), "wrong flying key hints SPACE");

    // S3: hazards arrive; grounded flight also cannot collect a star.
    await page.waitForSelector(".hazard", { timeout: 20000 });
    check(true, "hazards fly in");
    await page.waitForFunction(() => Number(document.querySelector("#world").dataset.missed) >= 1, null, { timeout: 25000 });
    check((await page.locator(".progress span.on").count()) === 0, "grounded flight cannot collect elevated stars");

    // S5 + S8: three bumps empty the hearts, restart the level and report the metres.
    await page.waitForSelector(".overlay", { timeout: 40000 });
    const failEmoji = await page.locator(".overlay .big-emoji").textContent();
    const failText = await page.locator(".overlay .overlay-text").textContent();
    check(failEmoji === "💥", "the third bump ends the level");
    check((await page.locator("#world").getAttribute("data-lives")) === "0", "the third bump empties the hearts");
    check(/Has volado \d+ metros · Récord: \d+ metros/.test(failText), `losing shows the distance flown (${failText})`);
    check(await page.locator('.trophy-slot[data-filled="true"]').count() === 0, "losing awards no medal");
    await pressPlay(page);
    check((await page.locator("#world").getAttribute("data-state")) === "ready", "losing restarts the level on the pad");
    check((await page.locator("#world").getAttribute("data-lives")) === "3", "the restarted level gives three hearts again");
    check((await page.locator(".progress span.on").count()) === 0, "the restarted level starts from zero stars");

    // S7: a full level reports the metres flown and the record of the session.
    await page.keyboard.press("Enter");
    const won = await flyLevel(page, 180000);
    check(won !== null, "the level can be finished");
    check(won && won.stars === 5, `five caught stars finish level one (${won && won.stars})`);
    check(won && won.overlay.hasAward, "finishing the level celebrates with a large award");
    check(won && /Has volado \d+ metros · Récord: \d+ metros/.test(won.overlay.text), `the level end reports metres and the record (${won && won.overlay.text})`);
    const shownMetres = Number((won && won.overlay.text.match(/Has volado (\d+) metros/) || [])[1]);
    check(shownMetres > 0 && shownMetres === Number((won && won.overlay.text.match(/Récord: (\d+) metros/) || [])[1]), "the first distance sets the record");
    check(await page.evaluate(() => window.scrollY === 0 && document.documentElement.scrollTop === 0), "the game never scrolls the page");

    // S2 + S6: the next level flies higher and adds UFOs.
    await pressPlay(page);
    check(await page.locator('.trophy-slot[data-filled="true"]').count() === 1 && await page.locator('.trophy-slot').first().getAttribute('data-award') === 'bronze', 'a bronze medal is awarded');
    check((await page.locator("#world").getAttribute("data-state")) === "ready", "level two waits on the pad");
    check((await goal()) === 7, `level two asks for seven stars (${await goal()})`);
    speeds.push(await speed());
    await page.keyboard.press("Enter");
    await page.waitForSelector(".star", { timeout: 15000 });
    const firstHeight = Number(await page.locator(".star").first().getAttribute("data-height"));
    check(firstHeight > 120, `level two stars fly higher (${firstHeight})`);
    // S10: each new SPACE press gives more thrust, so tapping climbs higher than one hop.
    const peak = async () => {
      let top = 0;
      const until = Date.now() + 1600;
      while (Date.now() < until) top = Math.max(top, Number(await page.locator("#rocket").getAttribute("data-height")));
      return top;
    };
    await page.waitForFunction(() => document.querySelector("#rocket").dataset.height === "0");
    const hopsBefore = Number(await page.locator("#rocket").getAttribute("data-hops"));
    await page.keyboard.press("Space");
    check(Number(await page.locator("#rocket").getAttribute("data-hops")) === hopsBefore + 1, "SPACE hops once");
    const singlePeak = await peak();
    await page.waitForFunction(() => document.querySelector("#rocket").dataset.height === "0", null, { timeout: 5000 });
    await page.keyboard.press("Space");
    await page.waitForTimeout(250);
    await page.keyboard.press("Space");
    await page.waitForTimeout(250);
    await page.keyboard.press("Space");
    const boostedPeak = await peak();
    check(Number(await page.locator("#rocket").getAttribute("data-hops")) === hopsBefore + 4, "every SPACE press in the air counts as thrust");
    check(boostedPeak > singlePeak + 60, `tapping SPACE climbs higher than one hop (${singlePeak} -> ${boostedPeak})`);
    check(await page.evaluate(() => { const r = document.querySelector("#rocket").getBoundingClientRect(), w = document.querySelector("#world").getBoundingClientRect(); return r.top >= w.top; }), "the rocket never leaves the sky");
    const hopsHeld = Number(await page.locator("#rocket").getAttribute("data-hops"));
    await page.keyboard.down("Space");
    await page.keyboard.down("Space");
    check(Number(await page.locator("#rocket").getAttribute("data-hops")) === hopsHeld + 1, "holding SPACE gives one push, not a hover");
    await page.keyboard.up("Space");
    await page.waitForSelector('.hazard[data-kind="ufo"]', { timeout: 30000 });
    check(true, "level two adds UFOs");
    check(await page.evaluate(() => window.scrollY === 0), "holding SPACE never scrolls the page");

    // S11: play on through levels two and three to see the progression grow.
    const level2 = await flyLevel(page, 240000);
    check(level2 && level2.stars === 7 && level2.overlay.hasAward, `seven caught stars finish level two (${level2 && level2.stars})`);
    await pressPlay(page);
    check((await goal()) === 9, `level three asks for nine stars (${await goal()})`);
    speeds.push(await speed());
    await page.keyboard.press("Enter");
    await page.waitForSelector('.hazard[data-kind="ship"]', { timeout: 30000 });
    check(true, "level three adds ships");
    const level3 = await flyLevel(page, 300000);
    check(level3 && level3.stars === 9 && level3.overlay.hasAward, `nine caught stars finish level three (${level3 && level3.stars})`);
    await pressPlay(page);
    check((await goal()) === 12, `level four asks for twelve stars (${await goal()})`);
    speeds.push(await speed());
    check(speeds.every((v, i) => i === 0 || v > speeds[i - 1]), `every level flies faster (${speeds.join(" < ")})`);

    if (await page.locator(".overlay").count()) await pressPlay(page);
    await finish(game);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    if (game) await game.browser.close();
  }
})();
