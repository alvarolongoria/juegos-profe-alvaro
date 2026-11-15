// Piano: physical keys only, Spanish letters, forgiving input and four levels.
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
// the lit key pulses, so Playwright would wait forever for a stable element.
async function tapOn(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

// S1 + S3: a tablet has no physical keyboard, so the drawn keys must be tappable.
async function touchChecks() {
  const game = await touchGame("juegos/piano.html");
  const { page } = game;
  try {
    await pressPlay(page);
    const target = () => page.locator("#target").textContent();
    const score = () => page.locator(".progress span.on").count();
    const first = await target();

    // Fingers are wider than a mouse pointer: every key must be easy to hit.
    const sizes = await page.$$eval(".key", (keys) => keys.map((key) => {
      const box = key.getBoundingClientRect();
      return { width: Math.round(box.width), height: Math.round(box.height) };
    }));
    check(sizes.every((size) => size.width >= 44), `touch: every drawn key is at least 44px wide (min ${Math.min(...sizes.map((s) => s.width))})`);
    check(sizes.every((size) => size.height >= 44), `touch: every drawn key is at least 44px tall (min ${Math.min(...sizes.map((s) => s.height))})`);

    // Tapping a wrong key is the same mistake as pressing it.
    await tapOn(page, '[data-key="B"]');
    check((await score()) === 0, "touch: a wrong key never scores");
    check(await page.locator('[data-key="B"]').evaluate((el) => el.classList.contains("wrong")), "touch: the tapped wrong key flashes");
    check((await page.locator("#feedback").textContent()) === "↺", "touch: a wrong tap shows the retry signal");
    check(!(await page.locator("#keyboard-hint").isVisible()), "touch: no physical-keyboard hint on a tap");

    // Tapping the lit key counts exactly like the physical key.
    await tapOn(page, `[data-key="${first}"]`);
    check((await score()) === 1, "touch: tapping the lit key counts");
    check((await page.locator("#feedback").textContent()) === "✓", "touch: a correct tap shows the success signal");
    check(!(await page.locator("#keyboard-hint").isVisible()), "touch: a correct tap keeps the hint away");
    check((await target()) !== first, "touch: the target moves after a correct tap");

    // A mouse is unchanged: the drawn keyboard is only a guide there.
    const second = await target();
    await page.locator(`[data-key="${second}"]`).click({ force: true });
    check((await score()) === 1, "mouse: clicking the lit key still never scores");
    check(await page.locator("#keyboard-hint").isVisible(), "mouse: clicking still shows the physical-keyboard hint");
    check((await target()) === second, "mouse: the click hint preserves the target");

    // A pen stylus counts as touch too (a real pen cannot be emulated, so the
    // pointer event is dispatched with the same shape the browser sends).
    const third = await target();
    await page.evaluate((key) => {
      const cap = document.querySelector(`[data-key="${key}"]`);
      cap.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "pen", bubbles: true, cancelable: true }));
    }, third);
    check((await score()) === 2, "pen: tapping the lit key counts");
    check(!(await page.locator("#keyboard-hint").isVisible()), "pen: no physical-keyboard hint on a pen tap");

    const keyStyle = await page.locator(`[data-key="${second}"]`).evaluate((el) => {
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
  const game = await openGame("juegos/piano.html");
  const { page } = game;
  const target = () => page.locator("#target").textContent();
  const score = () => page.locator(".progress span.on").count();
  await pressPlay(page);
  check(await page.locator('.trophy-slot').count() === 4 && await page.locator('.trophy-slot[data-filled="true"]').count() === 0, 'four trophy slots start empty');
  check(await page.locator('[data-key="Ñ"]').count() === 1, "Spanish keyboard includes Ñ");
  const first = await target();
  // Playwright's key map lacks ñ; dispatch the browser's Spanish key value instead.
  const pressKey = async (key) => key === "Ñ"
    ? page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ñ", bubbles: true })))
    : page.keyboard.press(key);
  await page.keyboard.press("b");
  check(await score() === 0 && await target() === first, "wrong key never counts or changes target");
  check(await page.locator('[data-key="B"]').evaluate(el => el.classList.contains("wrong")), "wrong pressed key flashes");
  check(await page.locator(`[data-key="${first}"]`).evaluate(el => el.classList.contains("target")), "target keeps glowing");
  check(await page.locator('#feedback').count() === 1 && await page.locator('#feedback').textContent() === '↺', "wrong input has a visible retry signal without speakers");
  await page.keyboard.press("Shift");
  await page.keyboard.press("Control");
  await page.keyboard.press("Alt");
  await page.keyboard.press("Meta");
  check(await score() === 0 && await target() === first, "modifiers alone do nothing");
  await page.evaluate(key => window.dispatchEvent(new KeyboardEvent("keydown", { key, repeat: true })), first);
  check(await score() === 0, "auto-repeat does not count");
  await page.locator(`[data-key="${first}"]`).click({ force: true });
  check(await score() === 0, "screen keyboard is a guide, not a substitute for physical keys");
  check(await page.locator('#keyboard-hint').isVisible(), "click shows a physical-keyboard picture hint");
  check(await target() === first, "click hint preserves the target");
  await page.keyboard.press(first.toLowerCase());
  check(await score() === 1, "lowercase physical input counts");
  check(await page.locator('#feedback').count() === 1 && await page.locator('#feedback').textContent() === '✓', "correct physical key has visible success feedback");
  check(!await page.locator('#keyboard-hint').isVisible(), "physical success dismisses the click hint");

  // Easiest first: vowels, five consonants, numbers, then the whole alphabet at random.
  // Each level asks for more keys: 5, 7, 9 and then 12.
  const pools = ["AEIOU", "MPLST", "123456789", "ABCDEFGHIJKLMNOPQRSTUVWXYZÑ"];
  const goals = [5, 7, 9, 12];
  let sawEnye = false;
  for (let level = 0; level < 4; level++) {
    const goal = goals[level];
    check(await page.locator(".progress span").count() === goal, `level ${level + 1}: asks for ${goal} keys (${await page.locator(".progress span").count()})`);
    // Level 1 already counted the first vowel above.
    const seen = new Set(level === 0 ? [first] : []);
    for (let success = level === 0 ? 1 : 0; success < goal; success++) {
      const key = await target();
      seen.add(key);
      check(pools[level].includes(key), `level ${level + 1}: target ${key} belongs to its pool`);
      if (level === 3 && key === "Ñ") sawEnye = true;
      await pressKey(key);
      check(await score() === success + 1, `level ${level + 1}: correct physical key counts`);
      if (success < goal - 1) check(await page.locator(".overlay").count() === 0, "no early level completion");
    }
    check(await page.locator(".overlay").count() === 1, `level ${level + 1}: ${goal} successes celebrate`);
    check(await page.locator('.overlay .big-emoji svg').count() === 1, `level ${level + 1}: award shown large`);
    if (level === 0) check([...seen].sort().join("") === "AEIOU", "level 1 shows every vowel");
    if (level === 1) check([...seen].sort().join("") === "LMPST", "level 2 shows exactly M P L S T");
    if (level === 2) check([...seen].sort().join("") === "123456789", "level 3 shows every number from 1 to 9");
    await pressKey(await target());
    check(await score() === goal, "celebration ignores keyboard input");
    await pressPlay(page);
    check(await page.locator('.trophy-slot[data-filled="true"]').count() === level + 1, `level ${level + 1}: award fills its slot`);
    check(await page.locator('.trophy-slot').nth(level).getAttribute('data-award') === ['bronze', 'silver', 'gold', 'cup'][level], `level ${level + 1}: correct award`);
    check(await score() === 0, "next round resets progress");
  }
  // Level 4 begins with Ñ so its physical-key coverage is deterministic.
  check(sawEnye, "lowercase ñ accepted in level 4");
  check("ABCDEFGHIJKLMNOPQRSTUVWXYZÑ".includes(await target()), "last level repeats forever");
  await page.emulateMedia({ reducedMotion: "reduce" });
  check(await page.locator(".key.target").evaluate(el => getComputedStyle(el).animationName) === "none", "reduced motion disables target animation");
  await page.keyboard.press('Escape');
  check(await page.locator('#feedback').textContent() === '↺' && await score() === 0, 'unpictured wrong key still gives visible feedback under reduced motion');
  await page.locator('.key.target').click();
  check(await page.locator('#keyboard-hint').isVisible() && await score() === 0, 'reduced-motion click hint stays visible and never scores');
  await pressKey(await target());
  check(await page.locator('#feedback').isVisible() && await page.locator('#feedback').textContent() === '✓', 'success feedback remains visible under reduced motion');
  for (let i = 1; i < 12; i++) await pressKey(await target());
  await pressPlay(page);
  check(await page.locator('.trophy-slot').count() === 4 && await page.locator('.trophy-slot').last().getAttribute('data-count') === '2', 'repeating the last level counts another trophy without adding slots');
  await finish(game);
})().catch(error => { console.error(error); process.exit(1); });
