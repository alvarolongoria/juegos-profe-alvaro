// Enciende las estrellas: hold the pointer on the star until its ring fills.
// Quick passes and clicks never catch it; from level 2 the star drifts.
const path = require("path");
const os = require("os");
const { chromium } = require("playwright-core");
const { openGame, pressPlay, check, finish } = require("./helpers");

const ROOT = "file://" + path.resolve(__dirname, "..");
const EXECUTABLE =
  process.env.CHROME_PATH ||
  path.join(os.homedir(), ".cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell");

// The shared helper is a desktop mouse at 1366x768; an iPad is a finger at
// 768x1024. Local copy with touch on, like tests/test-tablet-common.js.
async function openTablet(file) {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 768, height: 1024 }, hasTouch: true });
  const errors = [];
  const external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("request", (r) => !r.url().startsWith("file://") && external.push(r.url()));
  await page.goto(`${ROOT}/${file}`);
  return { browser, page, errors, external };
}

async function touch(client, type, point) {
  await client.send(
    "Input.dispatchTouchEvent",
    type === "touchEnd" ? { type, touchPoints: [] } : { type, touchPoints: [{ x: point.x, y: point.y }] }
  );
}

// Wait until the ring on screen fills enough to be read as "filling".
async function fillAfter(page, ms) {
  await page.waitForTimeout(ms);
  return fill(page);
}

async function center(page) {
  // One atomic read: the star may vanish between two separate queries.
  return page.evaluate(() => {
    const el = document.querySelector(".star-target");
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
}

async function caught(page) {
  return page.locator(".progress span.on").count();
}

async function fill(page) {
  return Number(await page.locator(".star-target").getAttribute("data-fill"));
}

// Follow the star with the pointer until one more catch is counted.
async function hold(page) {
  const before = await caught(page);
  const deadline = Date.now() + 8000;
  while ((await caught(page)) === before && Date.now() < deadline) {
    if (await page.locator(".overlay").count()) break;
    const c = await center(page);
    if (c) await page.mouse.move(c.x, c.y, { steps: 2 });
    await page.waitForTimeout(40);
  }
}

(async () => {
  let game;
  try {
    game = await openGame("juegos/estrellas.html");
    const { page } = game;
    check((await page.locator(".overlay svg").count()) >= 1, "start screen shows the SVG star");
    await pressPlay(page);
    await page.waitForSelector(".star-target");

    // Clicking far away and a quick pass do not catch the star.
    await page.mouse.click(20, 700);
    const c = await center(page);
    await page.mouse.move(c.x - 300, c.y);
    await page.mouse.move(c.x + 300, c.y, { steps: 4 });
    await page.mouse.move(20, 700);
    check((await caught(page)) === 0, "a quick pass or a click does not catch the star");

    // Holding fills the ring; leaving empties it slowly. A mouse click is not
    // a lift: the hover keeps filling after it, exactly as it did before.
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(450);
    const half = await fill(page);
    check(half > 0.2 && half < 1, `holding fills the ring (${half})`);
    check((await caught(page)) === 0, "clicking on the star does not speed it up");
    await page.mouse.move(20, 700);
    await page.waitForTimeout(300);
    const after = await fill(page);
    check(after < half && after > 0, `leaving empties the ring slowly (${half} -> ${after})`);

    // Each level asks for more catches: 5, 7, 9 and then 12.
    const goals = [5, 7, 9, 12];
    const sizes = [];
    for (let level = 1; level <= 3; level++) {
      const goal = goals[level - 1];
      check((await page.locator(".progress span").count()) === goal, `level ${level}: asks for ${goal} catches (${await page.locator(".progress span").count()})`);
      sizes.push(await page.locator(".star-target").evaluate((el) => el.offsetWidth));
      if (level === 2) {
        await page.mouse.move(20, 700);
        const a = await center(page);
        await page.waitForTimeout(600);
        const b = await center(page);
        check(Math.hypot(a.x - b.x, a.y - b.y) > 10, "level 2: the star drifts on its own");
      } else if (level === 1) {
        const a = await center(page);
        await page.waitForTimeout(400);
        const b = await center(page);
        check(a.x === b.x && a.y === b.y, "level 1: the star stays still");
      }
      for (let n = 1; n <= goal; n++) {
        await hold(page);
        if (n < goal) check((await caught(page)) === n, `level ${level}: catch ${n} counts once`);
        if (level === 1 && n === 1) check((await page.locator(".particle").count()) >= 1, "a catch bursts into sparkles");
      }
      await page.waitForSelector(".overlay");
      check(await page.locator('.overlay .big-emoji svg').count() === 1, `level ${level}: award shown large`);
      await pressPlay(page);
      check(await page.locator('.trophy-slot[data-filled="true"]').count() === level, `level ${level}: award fills its slot`);
      await page.waitForSelector(".star-target");
    }
    check((await page.locator(".progress span").count()) === 12, `level 4: asks for 12 catches (${await page.locator(".progress span").count()})`);
    sizes.push(await page.locator(".star-target").evaluate((el) => el.offsetWidth));
    check(sizes.every((size, i) => i === 0 || size < sizes[i - 1]), `the star gets smaller every level (${sizes})`);

    await page.emulateMedia({ reducedMotion: "reduce" });
    check(
      await page.locator(".sky-dot").first().evaluate((el) => getComputedStyle(el).animationName === "none"),
      "reduced motion stops the twinkling sky"
    );

    // ---------- iPad: a finger that lands on a star and rests on it ----------
    // iOS Safari fires pointerdown for a finger but no pointermove while the
    // finger rests, so touching a star and holding it must fill the ring;
    // lifting the finger must stop filling again. The mouse keeps hovering.
    const tablet = await openTablet("juegos/estrellas.html");
    const finger = tablet.page;
    try {
      await finger.click(".overlay .play-btn", { force: true });
      await finger.waitForSelector(".star-target");
      const client = await finger.context().newCDPSession(finger);
      await finger.evaluate(() => {
        window.__presses = 0;
        window.__cancels = 0;
        window.addEventListener("pointerdown", (e) => e.pointerType === "touch" && window.__presses++);
        window.addEventListener("pointercancel", () => window.__cancels++);
      });

      const first = await center(finger);
      // Park the mouse far away, so only the finger can fill this star.
      await finger.mouse.move(760, 1010);
      // touchStart only: no touchMove follows while the finger rests.
      await touch(client, "touchStart", first);
      const resting = await fillAfter(finger, 450);
      check((await finger.evaluate(() => window.__presses)) >= 1, "the touch harness delivers a real touch pointerdown");
      check(resting > 0.2 && resting < 1, `resting a finger on the star fills the ring (${resting})`);
      check((await finger.evaluate(() => window.__cancels)) === 0, "no pointercancel interrupts the finger hold");

      const deadline = Date.now() + 5000;
      let collected = await caught(finger);
      while (collected === 0 && Date.now() < deadline) {
        await finger.waitForTimeout(100);
        collected = await caught(finger);
      }
      check(collected >= 1, `a finger holding still on the star collects it (${collected})`);

      // The next star: a finger fills it, lifting the finger empties it.
      await finger.waitForSelector(".star-target");
      const next = await center(finger);
      await touch(client, "touchStart", next);
      const held = await fillAfter(finger, 400);
      check(held > 0.2 && held < 1, `the next star fills under a resting finger (${held})`);
      await touch(client, "touchEnd", next);
      const lifted = await fillAfter(finger, 350);
      check(lifted < held && lifted > 0, `lifting the finger empties the ring (${held} -> ${lifted})`);
      check((await finger.evaluate(() => window.__cancels)) === 0, "no pointercancel fires when the finger lifts");

      // A mouse on the same tablet page still only hovers (the parked mouse
      // was far from the star, so this is a genuine hover).
      const hover = await center(finger);
      await finger.mouse.move(hover.x, hover.y);
      const hovered = await fillAfter(finger, 450);
      check(hovered > 0.2 && hovered < 1, `a mouse on the tablet page still fills by hovering (${hovered})`);
      check(tablet.errors.length === 0, `no page errors on the tablet page (${tablet.errors.join(" | ")})`);
      check(tablet.external.length === 0, `no external requests on the tablet page (${tablet.external.join(", ")})`);
    } finally {
      await tablet.browser.close();
    }

    await finish(game);
  } catch (error) {
    check(false, error.message);
    if (game) await game.browser.close();
  }
})();
