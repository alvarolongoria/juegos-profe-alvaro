// S1 + S2: Naves del teclado on a tablet, with the tablet's own on-screen
// keyboard instead of a physical one. A tablet is emulated with touch events,
// a coarse pointer and a 768x1024 portrait screen. Every check drives the real
// page: taps, the text the on-screen keyboard sends, and the visual viewport
// shrinking when the keyboard opens.
const path = require("path");
const os = require("os");
const { chromium } = require("playwright-core");
const { check } = require("./helpers");

const ROOT = "file://" + path.resolve(__dirname, "..");
const EXECUTABLE =
  process.env.CHROME_PATH ||
  path.join(os.homedir(), ".cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell");

let okCount = 0, failCount = 0;
const log = console.log, error = console.error;
console.log = (...args) => { if (String(args[0]).startsWith("ok: ")) okCount++; log(...args); };
console.error = (...args) => { if (String(args[0]).startsWith("FAIL: ")) failCount++; error(...args); };

// A frame clock lets the layout checks run many seconds of flight instantly.
function frameClock() {
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
  Math.random = () => 0.01;
}

async function openGame(file, { tablet = true, clock = false } = {}) {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const context = await browser.newContext(tablet
    ? { hasTouch: true, isMobile: true, viewport: { width: 768, height: 1024 } }
    : { viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  if (clock) await page.addInitScript(frameClock);
  await page.goto(`${ROOT}/${file}`);
  return { browser, page, errors };
}

const catcherFocused = (page) => page.evaluate(() => document.activeElement === document.querySelector(".key-catcher"));
const progress = (page) => page.locator(".progress span.on").count();

async function tapGrade(page, grade) {
  await page.waitForSelector(".overlay .grade-btn");
  await page.tap(`.overlay .grade-btn[data-grade="${grade}"]`, { force: true });
}

// A tap on the play area, the way a child touches the screen.
async function tapGame(page) {
  await page.touchscreen.tap(384, 500);
  await page.waitForTimeout(80);
}

async function close({ browser, errors }, label) {
  check(errors.length === 0, `${label}: no page errors (${errors.join(" | ")})`);
  await browser.close();
}

// S2: the tablet keyboard opens on a tap, never on its own.
async function tapToType() {
  const game = await openGame("juegos/teclado.html");
  const { page } = game;
  await tapGrade(page, 1);
  await page.waitForSelector(".ship");
  check(!(await catcherFocused(page)), "tablet: the hidden field is not focused before the child taps");
  check(await page.locator("#keyboard-hint").isVisible(), 'tablet: a "toca aquí para escribir" target invites the child to open the keyboard');
  await tapGame(page);
  check(await catcherFocused(page), "tablet: tapping the game focuses the hidden field, so the tablet keyboard opens");
  check(!(await page.locator("#keyboard-hint").isVisible()), "tablet: the tap target disappears once typing is ready");
  const setup = await page.evaluate(() => {
    const catcher = document.querySelector(".key-catcher");
    return {
      font: parseFloat(getComputedStyle(catcher).fontSize),
      inputmode: catcher.getAttribute("inputmode"),
      enterkeyhint: catcher.getAttribute("enterkeyhint"),
      autocapitalize: catcher.getAttribute("autocapitalize"),
      autocorrect: catcher.getAttribute("autocorrect"),
      spellcheck: catcher.getAttribute("spellcheck"),
      display: getComputedStyle(catcher).display,
      scale: window.visualViewport.scale,
    };
  });
  check(setup.font >= 16, `tablet: the field is big enough to never zoom the page on focus (font-size ${setup.font}px)`);
  check(setup.display !== "none", `tablet: the field stays focusable, not display:none (${setup.display})`);
  check(setup.inputmode === "text" && !!setup.enterkeyhint, `tablet: the field asks for a plain text keyboard (${setup.inputmode}/${setup.enterkeyhint})`);
  check(setup.autocapitalize === "off" && setup.autocorrect === "off" && setup.spellcheck === "false", "tablet: autocorrect and autocapitalisation are off");
  check(setup.scale === 1, `tablet: focusing the field does not zoom the page (scale ${setup.scale})`);
  await close(game, "tablet tap");

  // S2: closing the keyboard must not trap the child in a reopen loop.
  const blur = await openGame("juegos/teclado.html");
  const p = blur.page;
  await tapGrade(p, 1);
  await tapGame(p);
  await p.evaluate(() => document.querySelector(".key-catcher").blur());
  await p.waitForTimeout(900); // longer than the old 500 ms refocus interval
  check(!(await catcherFocused(p)), "tablet: closing the keyboard does not refocus the field by itself");
  check(await p.locator("#keyboard-hint").isVisible(), "tablet: closing the keyboard shows the tap target again");
  check(/toca aquí/i.test(await p.locator("#keyboard-hint").textContent()), `tablet: the tap target is a clear Spanish sentence (${JSON.stringify(await p.locator("#keyboard-hint").textContent())})`);
  const target = await p.locator("#keyboard-hint").boundingBox();
  check(target && target.height >= 48 && target.width >= 160, `tablet: the tap target is big enough for a child's finger (${Math.round(target?.width)}x${Math.round(target?.height)})`);
  await p.tap("#keyboard-hint");
  await p.waitForTimeout(80);
  check(await catcherFocused(p), "tablet: tapping the target opens the keyboard again");
  check(!(await p.locator("#keyboard-hint").isVisible()), "tablet: the target hides once the field has the focus");
  await close(blur, "tablet blur");
}

// S2: iOS sends the typed text as an input event, with no keydown at all.
async function inputWithoutKeydown() {
  const game = await openGame("juegos/teclado.html");
  const { page } = game;
  await tapGrade(page, 1);
  await tapGame(page);
  const text = await page.locator(".ship").first().getAttribute("data-text");
  const before = await progress(page);
  await page.keyboard.insertText(text);
  await page.waitForTimeout(150);
  check(await page.locator(`.ship[data-text="${text}"]`).count() === 0, `tablet: typing "${text}" through the input event destroys its ship`);
  check(await progress(page) === before + 1, `tablet: the ship destroyed by the input event counts exactly once (${before} -> ${await progress(page)})`);
  await close(game, "tablet input event");
}

// S2: a soft keyboard may send the keydown *and* the input event for one
// character. The character must be typed once, never twice.
async function keydownPlusInput() {
  const game = await openGame("juegos/teclado.html");
  const { page } = game;
  await tapGrade(page, 2); // level 1 words are two-letter syllables
  await tapGame(page);
  const ship = page.locator('.ship[data-kind="ship"]').first();
  const text = await ship.getAttribute("data-text");
  const first = text[0];
  await page.evaluate((key) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })), first);
  await page.keyboard.insertText(first); // the same character, now as an input event
  await page.waitForTimeout(150);
  const typed = await ship.getAttribute("data-typed");
  check(typed === "1", `tablet: one character from keydown plus input is typed once ("${text}" typed ${typed})`);
  await page.keyboard.insertText(text.slice(1));
  await page.waitForTimeout(150);
  check(await page.locator(`.ship[data-text="${text}"]`).count() === 0, `tablet: the rest of "${text}" typed through input finishes it`);
  await close(game, "tablet keydown plus input");
}

// S2: accented letters and ñ arrive through the composition/input path.
async function accentedLetters() {
  const game = await openGame("juegos/teclado.html");
  const { page } = game;
  await tapGrade(page, 6); // 6º level 2 carries only accented words
  await tapGame(page);
  let target = null;
  for (let attempt = 0; attempt < 40 && !target; attempt++) {
    const ship = page.locator('.ship[data-kind="ship"], .ship[data-kind="mother"], .ship[data-kind="laser"]').first();
    if (!(await ship.count())) { await page.waitForTimeout(100); continue; }
    const text = await ship.getAttribute("data-text");
    if (/[áéíóúñü]/i.test(text)) { target = text; break; }
    await page.keyboard.insertText(text);
    await page.waitForTimeout(150);
  }
  check(target !== null, `tablet: an accented word shows up to type (${target})`);
  if (target) {
    const before = await progress(page);
    await page.keyboard.insertText(target);
    await page.waitForTimeout(150);
    check(await page.locator(`.ship[data-text="${target}"]`).count() === 0, `tablet: typing "${target}" through the input event destroys it`);
    check(await progress(page) === before + 1, "tablet: the accented word counts exactly once");
  }
  await close(game, "tablet accents");
}

// S2: the on-screen keyboard shrinks the visible viewport. Cannon, shield and
// the ground where ships land must stay above it, and everything returns to
// full size when the keyboard closes.
async function keyboardShrinksPlayArea() {
  const game = await openGame("juegos/teclado.html", { clock: true });
  const { page } = game;
  await tapGrade(page, 1);
  await page.evaluate(() => window.advanceFrames(1000));
  await tapGame(page);

  const full = await page.evaluate(() => document.querySelector("#cannon").getBoundingClientRect().bottom);
  check(full > 1000, `tablet: with no keyboard the cannon sits at the bottom of the screen (${Math.round(full)}px)`);

  // A 600px tall visual viewport is the screen left above the tablet keyboard.
  await page.evaluate(() => {
    const view = window.visualViewport;
    Object.defineProperty(view, "height", { configurable: true, get: () => 600 });
    Object.defineProperty(view, "offsetTop", { configurable: true, get: () => 0 });
    view.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(120);
  const shrunk = await page.evaluate(() => {
    const box = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    };
    return { cannon: box("#cannon"), shield: box("#shield") };
  });
  check(shrunk.cannon.bottom <= 601, `tablet: the cannon moves above the keyboard (bottom ${shrunk.cannon.bottom}px of 600)`);
  check(shrunk.shield.bottom <= 601, `tablet: the shield moves above the keyboard (bottom ${shrunk.shield.bottom}px of 600)`);
  check(shrunk.cannon.top <= 601, `tablet: the ground where ships land is above the keyboard (${shrunk.cannon.top}px)`);

  const flight = await page.evaluate(() => {
    let lowest = 0;
    for (let frame = 0; frame < 900 && document.body.dataset.hearts === "3"; frame++) {
      window.advanceFrames(50);
      for (const el of document.querySelectorAll(".ship")) lowest = Math.max(lowest, el.getBoundingClientRect().bottom);
    }
    return { lowest: Math.round(lowest), hearts: document.body.dataset.hearts };
  });
  check(flight.hearts !== "3", `tablet: a ship still reaches the ground and costs a heart (${flight.hearts})`);
  check(flight.lowest <= 601, `tablet: no ship ever flies behind the keyboard (lowest ${flight.lowest}px of 600)`);

  await page.evaluate(() => {
    const view = window.visualViewport;
    delete view.height;
    delete view.offsetTop;
    view.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(120);
  const restored = await page.evaluate(() => Math.round(document.querySelector("#cannon").getBoundingClientRect().bottom));
  check(Math.abs(restored - full) <= 1, `tablet: closing the keyboard gives the full play area back (${restored}px)`);
  await close(game, "tablet layout");
}

// S2: on a computer or a Chromebook nothing changes: a physical keyboard keeps
// the hidden field focused all the time and no tap target ever appears.
async function desktopUnchanged() {
  const game = await openGame("juegos/teclado.html", { tablet: false });
  const { page } = game;
  await page.click('.overlay .grade-btn[data-grade="1"]', { force: true });
  await page.waitForSelector(".ship");
  check(await catcherFocused(page), "desktop: the physical keyboard keeps the hidden field focused");
  check(!(await page.locator("#keyboard-hint").isVisible()), "desktop: no tablet tap target appears");
  await page.evaluate(() => document.querySelector(".key-catcher").blur());
  await page.waitForTimeout(700);
  check(await catcherFocused(page), "desktop: a lost focus is taken back by itself, as before");
  await close(game, "desktop");
}

(async () => {
  await tapToType();
  await inputWithoutKeydown();
  await keydownPlusInput();
  await accentedLetters();
  await keyboardShrinksPlayArea();
  await desktopUnchanged();
  console.log(`TOTAL: ${okCount} ok, ${failCount} FAIL`);
})().catch((e) => { console.error(e); console.error(`TOTAL before error: ${okCount} ok, ${failCount} FAIL`); process.exit(1); });
