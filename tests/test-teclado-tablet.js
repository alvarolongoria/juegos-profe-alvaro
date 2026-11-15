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
  // A suspended phone (another app, the screen off) delivers one long frame.
  window.jumpFrames = (ms) => {
    now += ms;
    const callbacks = pending;
    pending = [];
    callbacks.forEach((fn) => fn(now));
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
const level = (page) => page.evaluate(() => document.body.dataset.level);

// Wait for an element that was on screen to leave, without a fixed sleep.
const gone = (handle) => handle.waitForElementState("hidden", { timeout: 3000 }).then(() => true, () => false);

// A destroyed ship is counted once: the progress bar grows by exactly one, or
// the level ends (which also means the kill counted). No fixed sleeps.
const countsOnce = (page, before) => page.waitForFunction(({ count, from }) => {
  if (document.body.dataset.level !== from) return true;
  return document.querySelectorAll(".progress span.on").length === count;
}, { count: before.count + 1, from: before.level }, { polling: 50, timeout: 3000 }).then(() => true, () => false);

const countedNow = async (page) => ({ count: await progress(page), level: await level(page) });

// Every object the child is meant to type, small or big.
const normalShips = '.ship[data-kind="ship"], .ship[data-kind="mother"], .ship[data-kind="laser"], .ship[data-kind="child"]';

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
  const ship = await page.locator(".ship").first().elementHandle();
  const text = await ship.getAttribute("data-text");
  const before = await countedNow(page);
  await page.keyboard.insertText(text);
  check(await gone(ship), `tablet: typing "${text}" through the input event destroys its ship`);
  check(await countsOnce(page, before), `tablet: the ship destroyed by the input event counts exactly once (from ${before.count})`);
  await close(game, "tablet input event");
}

// S2: a soft keyboard may send the keydown *and* the input event for one
// character. The character must be typed once, never twice.
async function keydownPlusInput() {
  const game = await openGame("juegos/teclado.html");
  const { page } = game;
  await tapGrade(page, 2); // level 1 words are two-letter syllables
  await tapGame(page);
  const ship = await page.locator(normalShips).first().elementHandle();
  const text = await ship.getAttribute("data-text");
  const first = text[0];
  await page.evaluate((key) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })), first);
  await page.keyboard.insertText(first); // the same character, now as an input event
  await page.waitForTimeout(150);
  const typed = await ship.getAttribute("data-typed");
  check(typed === "1", `tablet: one character from keydown plus input is typed once ("${text}" typed ${typed})`);
  await page.keyboard.insertText(text.slice(1));
  check(await gone(ship), `tablet: the rest of "${text}" typed through input finishes it`);
  await close(game, "tablet keydown plus input");
}

// T6 (S5): an Android keyboard with predictions (Samsung Keyboard, Gboard) sends
// every letter as a composition that only ends when something else ends it, and
// the child's next tap is what ended it ("si escribo la letra ... tengo después
// que tocar en cualquier parte de la pantalla"). Each letter must reach the game
// as soon as it is written, with no double typing when the composition ends.
async function androidCompositionLetters() {
  const game = await openGame("juegos/teclado.html");
  const { page } = game;
  await tapGrade(page, 5); // the level with the long words and the laser ship
  await tapGame(page); // the tablet keyboard is open
  const ship = await page.locator(normalShips).first();
  await ship.waitFor();
  const text = await ship.getAttribute("data-text");
  const handle = await ship.elementHandle();
  const before = await countedNow(page);

  // Samsung Keyboard: compositionstart, then the field's value grows letter by
  // letter while isComposing stays true. No compositionend arrives.
  await page.evaluate(() => {
    document.querySelector(".key-catcher").dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
  });
  for (let letter = 1; letter <= text.length; letter++) {
    const value = text.slice(0, letter);
    await page.evaluate((value) => {
      const catcher = document.querySelector(".key-catcher");
      catcher.value = value;
      catcher.dispatchEvent(new InputEvent("input", {
        bubbles: true, data: value.slice(-1), inputType: "insertCompositionText", isComposing: true,
      }));
    }, value);
    await page.waitForTimeout(60);
    const typed = letter < text.length ? await handle.getAttribute("data-typed")
      : (await gone(handle) ? "destroyed" : "still flying");
    check(typed === String(letter) || (letter === text.length && typed === "destroyed"),
      `tablet T6 Android: letter ${letter} of "${text}" is typed without tapping the screen (typed ${typed})`);
  }
  check(await gone(handle), `tablet T6 Android: typing "${text}" through the composition destroys its ship`);
  check(await countsOnce(page, before), `tablet T6 Android: the ship destroyed while composing counts exactly once (from ${before.count})`);

  // The composition ends when the child finally taps: nothing is typed again.
  await page.evaluate(() => {
    const catcher = document.querySelector(".key-catcher");
    catcher.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: catcher.value }));
    catcher.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", isComposing: false }));
  });
  await page.waitForTimeout(200);
  const after = await countedNow(page);
  check(after.level === before.level && after.count === before.count + 1,
    `tablet T6 Android: ending the composition types nothing a second time (${before.count} -> ${after.count})`);
  await close(game, "tablet android composition");
}

// S2: accented letters and ñ arrive through the composition/input path.
// The target is one specific ship element, so a second ship carrying the same
// word (or a word spawn of the same pool) can never make the check pass or fail.
async function accentedLetters() {
  const game = await openGame("juegos/teclado.html");
  const { page } = game;
  await tapGrade(page, 6); // 6º level 2 carries only accented words
  await tapGame(page);
  let target = null;
  for (let attempt = 0; attempt < 40 && !target; attempt++) {
    const ship = page.locator(normalShips).first();
    if (!(await ship.count())) { await page.waitForTimeout(100); continue; }
    const handle = await ship.elementHandle();
    const text = await handle.getAttribute("data-text");
    if (/[áéíóúñü]/i.test(text)) { target = { handle, text }; break; }
    // Clear the way with an ordinary word so the accented one can arrive.
    await page.keyboard.insertText(text);
    await gone(handle);
  }
  check(target !== null, `tablet: an accented word shows up to type (${target?.text})`);
  if (target) {
    const before = await countedNow(page);
    await page.keyboard.insertText(target.text);
    check(await gone(target.handle), `tablet: typing "${target.text}" through the input event destroys that ship`);
    check(await countsOnce(page, before), "tablet: the accented word counts exactly once");
  }
  await close(game, "tablet accents");
}

// S2/R3: Android's Back button hides the soft keyboard while the hidden field
// keeps the focus. The child must see the tap target again, and a tap must ask
// for a fresh focus, which is what makes the keyboard come back.
async function keyboardDismissal() {
  const game = await openGame("juegos/teclado.html");
  const { page } = game;
  await tapGrade(page, 1);
  await tapGame(page);
  check(await catcherFocused(page), "tablet R3: the tap leaves the hidden field focused, ready to type");
  await page.evaluate(() => {
    window.__focusCount = 0;
    document.querySelector(".key-catcher").addEventListener("focus", () => { window.__focusCount++; });
  });
  const viewportHeight = (height) => page.evaluate((h) => {
    const view = window.visualViewport;
    Object.defineProperty(view, "height", { configurable: true, get: () => h });
    Object.defineProperty(view, "offsetTop", { configurable: true, get: () => 0 });
    view.dispatchEvent(new Event("resize"));
  }, height);
  await viewportHeight(600); // the soft keyboard opens
  await page.waitForTimeout(120);
  check(!(await page.locator("#keyboard-hint").isVisible()), "tablet R3: no tap target while the keyboard is open");
  await viewportHeight(1024); // Android Back: the keyboard closes, the focus stays
  await page.waitForTimeout(120);
  check(await catcherFocused(page), "tablet R3: the hidden field keeps the focus after the keyboard is hidden");
  check(await page.locator("#keyboard-hint").isVisible(), "tablet R3: hiding the keyboard while focused shows the tap target again");
  const before = await page.evaluate(() => window.__focusCount);
  await tapGame(page);
  const after = await page.evaluate(() => window.__focusCount);
  check(await catcherFocused(page), "tablet R3: a tap on the play area asks for the keyboard again");
  check(after > before, `tablet R3: the tap focuses the field again, it does not just keep it (${before} -> ${after} focus events)`);
  check(!(await page.locator("#keyboard-hint").isVisible()), "tablet R3: the tap target hides once the keyboard is asked for");
  await page.evaluate(() => {
    const view = window.visualViewport;
    delete view.height;
    delete view.offsetTop;
    view.dispatchEvent(new Event("resize"));
  });
  await close(game, "tablet keyboard dismissal");
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

// S5 (T6): the ground is the cannon's top edge, and every ship starts on the
// same line (y = 90) before flying down to that ground.
const SPAWN_TOP = 90;

const playState = (page) => page.evaluate(() => {
  const ground = document.querySelector("#cannon").getBoundingClientRect().top;
  return {
    ground,
    hearts: document.body.dataset.hearts,
    level: document.body.dataset.level,
    over: !!document.querySelector(".overlay"),
    hint: !!document.querySelector("#keyboard-hint.show"),
    ships: [...document.querySelectorAll(".ship")].map((el) => {
      const box = el.getBoundingClientRect();
      return { text: el.dataset.text, top: box.top, bottom: box.bottom, height: box.height };
    }),
  };
});

// How far down its own travel a ship is: 0 on the spawn line, 1 at the ground.
const travelFraction = (state, ship) =>
  (ship.top - SPAWN_TOP) / Math.max(1, state.ground - SPAWN_TOP - ship.height);

// The largest change of the fraction of the play height a ship keeps, matched by
// its word so the order of the sky never matters. A ship that vanished, or a new
// one that arrived, is a full change: the sky must not change at all here.
function fractionDrift(from, to) {
  if (from.ships.length !== to.ships.length) return 1;
  let worst = 0;
  for (const ship of from.ships) {
    const twin = to.ships.find((other) => other.text === ship.text);
    if (!twin) return 1;
    worst = Math.max(worst, Math.abs(travelFraction(to, twin) - travelFraction(from, ship)));
  }
  return worst;
}

const round = (n) => Math.round(n);
const list = (ships) => ships.map((ship) => round(ship.top)).join(", ");

// iOS slides the software keyboard in: it fires resize and scroll on the visual
// viewport several times while the visible height shrinks, and it can also
// scroll the page, which turns visualViewport.offsetTop into a number above 0.
const openKeyboardLikeIos = (page, { height, offsetTop = 0, steps = 4 }) => page.evaluate(({ height, offsetTop, steps }) => {
  const view = window.visualViewport;
  const full = window.innerHeight;
  for (let step = 1; step <= steps; step++) {
    const shrunk = Math.round(full - (full - height) * (step / steps));
    const top = Math.round(offsetTop * (step / steps));
    Object.defineProperty(view, "height", { configurable: true, get: () => shrunk });
    Object.defineProperty(view, "offsetTop", { configurable: true, get: () => top });
    view.dispatchEvent(new Event("resize"));
    view.dispatchEvent(new Event("scroll"));
  }
}, { height, offsetTop, steps });

const closeKeyboardLikeIos = (page) => page.evaluate(() => {
  const view = window.visualViewport;
  delete view.height;
  delete view.offsetTop;
  view.dispatchEvent(new Event("resize"));
  view.dispatchEvent(new Event("scroll"));
});

// S5 (L5/T6): on a real iPad tapping "abrir teclado" ended the game at once. The
// ground moves up with the keyboard, so every ship already below it landed in
// the same frame and each landing cost a heart. Opening or closing the keyboard
// must never cost a life: the ships keep their place in the smaller sky.
async function keyboardCostsNoLives() {
  const game = await openGame("juegos/teclado.html", { clock: true });
  const { page } = game;
  await tapGrade(page, 1);
  await page.evaluate(() => window.advanceFrames(600)); // the first ship is on screen
  await tapGame(page); // the child taps the play area: the tablet keyboard opens
  await page.evaluate(() => window.advanceFrames(20000)); // the ships fly down
  const before = await playState(page);
  check(before.hearts === "3", `tablet S5: all three hearts are still there before the keyboard opens (${before.hearts})`);
  check(before.ships.length === 2, `tablet S5: two ships are in the sky before the keyboard opens (${before.ships.length})`);
  check(before.ships.every((ship) => ship.top > 300), `tablet S5: the ships are already in the lower part of the screen (${list(before.ships)})`);

  await openKeyboardLikeIos(page, { height: 600 });
  await page.waitForTimeout(120);
  const open = await playState(page);
  check(open.ground < before.ground - 100, `tablet S5: the ground moves up with the keyboard (${round(before.ground)} -> ${round(open.ground)})`);
  check(open.hearts === "3", `tablet S5: opening the keyboard costs no hearts (${open.hearts} of 3)`);
  check(!open.over, "tablet S5: opening the keyboard does not end the level");
  check(open.level === before.level, `tablet S5: the same level keeps playing (${before.level} -> ${open.level})`);
  check(open.ships.length === before.ships.length, `tablet S5: no ship is swallowed by the keyboard (${before.ships.length} -> ${open.ships.length})`);
  check(open.ships.every((ship) => ship.bottom <= open.ground), `tablet S5: every ship stays above the new ground (${open.ships.map((ship) => `${round(ship.bottom)} of ${round(open.ground)}`).join(", ")})`);
  const opened = fractionDrift(before, open);
  check(opened <= 0.05, `tablet S5: each ship keeps the same fraction of the play height (largest change ${opened.toFixed(3)})`);

  await page.evaluate(() => window.advanceFrames(300)); // the frames that follow the tap
  const settled = await playState(page);
  check(settled.hearts === "3", `tablet S5: the hearts survive the frames right after the keyboard opens (${settled.hearts} of 3)`);

  await closeKeyboardLikeIos(page);
  await page.waitForTimeout(120);
  const closed = await playState(page);
  check(Math.abs(closed.ground - before.ground) <= 1, `tablet S5: closing the keyboard gives the full play area back (${round(closed.ground)})`);
  check(closed.hearts === "3", `tablet S5: closing the keyboard costs no hearts either (${closed.hearts} of 3)`);
  const closedDrift = fractionDrift(before, closed);
  check(closedDrift <= 0.05, `tablet S5: the ships come back to the same fraction of the full play area (largest change ${closedDrift.toFixed(3)})`);

  // iOS can also scroll the page while the field takes the focus.
  await openKeyboardLikeIos(page, { height: 600, offsetTop: 120 });
  await page.waitForTimeout(120);
  const scrolled = await playState(page);
  check(scrolled.hearts === "3", `tablet S5: a keyboard that also scrolls the page costs no hearts (${scrolled.hearts} of 3)`);
  check(!scrolled.over, "tablet S5: a keyboard that also scrolls the page does not end the level");
  check(scrolled.ships.every((ship) => ship.bottom <= scrolled.ground), `tablet S5: every ship stays above the ground under a scrolled keyboard (${scrolled.ships.map((ship) => `${round(ship.bottom)} of ${round(scrolled.ground)}`).join(", ")})`);
  const scrolledDrift = fractionDrift(closed, scrolled);
  check(scrolledDrift <= 0.05, `tablet S5: a scrolled keyboard keeps every ship in place too (largest change ${scrolledDrift.toFixed(3)})`);
  await closeKeyboardLikeIos(page);
  await close(game, "tablet keyboard and lives");
}

// S5 (T6, D5): on a tablet the child can type only with the on-screen keyboard
// open, so the ships hold still while the tap target is showing. That pause must
// not skew the level timers nor the words per minute.
async function shipsWaitForTyping() {
  const game = await openGame("juegos/teclado.html", { clock: true });
  const { page } = game;
  const wpm = () => page.evaluate(() => {
    const found = document.querySelector("#stats").textContent.match(/Palabras\/min: (\d+)/);
    return found ? Number(found[1]) : null;
  });
  await tapGrade(page, 5);
  await page.evaluate(() => window.advanceFrames(1000));
  const waiting = await playState(page);
  check(waiting.hint, "tablet S5: the tap target is showing, so the child cannot type yet");
  check(waiting.ships.length === 1, `tablet S5: one ship waits on screen for the child (${waiting.ships.length})`);
  await page.evaluate(() => window.advanceFrames(6000)); // longer than the level's spawn interval
  const still = await playState(page);
  const frozen = fractionDrift(waiting, still);
  check(frozen <= 0.02, `tablet S5: the ships do not descend while the tap target is showing (largest move ${frozen.toFixed(3)} of the play height)`);
  check(still.ships.length === waiting.ships.length, `tablet S5: no new ship arrives while the child cannot type (${waiting.ships.length} -> ${still.ships.length})`);
  check(still.hearts === "3", `tablet S5: waiting for the keyboard costs no hearts (${still.hearts} of 3)`);

  await tapGame(page); // the child opens the keyboard
  check(!(await page.locator("#keyboard-hint").isVisible()), "tablet S5: the tap target hides once the keyboard is open");
  await page.evaluate(() => window.advanceFrames(1000));
  const moving = await playState(page);
  check(moving.ships.length && moving.ships[0].top > still.ships[0].top + 2, `tablet S5: the ships descend again once the keyboard is open (${round(still.ships[0]?.top)} -> ${round(moving.ships[0]?.top)})`);

  // A clean typing measurement: the ship on screen is killed by typing its word,
  // and the next one arrives while the keyboard is still open.
  const word = await page.locator(".ship").first().getAttribute("data-text");
  await page.keyboard.insertText(word);
  await page.evaluate(() => window.advanceFrames(1000));
  const typed = await playState(page);
  check(typed.ships.length === 1 && typed.ships[0].text !== word, `tablet S5: a new ship arrives while the child types (${typed.ships[0]?.text})`);
  const measured = await wpm();
  check(typeof measured === "number" && measured > 0, `tablet S5: the words per minute are measured while typing (${measured})`);

  await page.evaluate(() => document.querySelector(".key-catcher").blur()); // the child closes the keyboard
  await page.waitForTimeout(120);
  check(await page.locator("#keyboard-hint").isVisible(), "tablet S5: closing the keyboard shows the tap target again");
  await page.evaluate(() => window.advanceFrames(60000)); // a whole minute with the keyboard closed
  const paused = await playState(page);
  check(paused.hearts === "3", `tablet S5: a minute with the keyboard closed costs no hearts (${paused.hearts} of 3)`);
  check(paused.ships.length === typed.ships.length, `tablet S5: a minute with the keyboard closed sends no new ship (${typed.ships.length} -> ${paused.ships.length})`);
  const pausedDrift = fractionDrift(typed, paused);
  check(pausedDrift <= 0.02, `tablet S5: the ships do not descend for a minute without the keyboard (largest move ${pausedDrift.toFixed(3)} of the play height)`);
  const afterMinute = await wpm();
  check(measured !== null && afterMinute === measured, `tablet S5: the minute without the keyboard does not skew the words per minute (${measured} -> ${afterMinute})`);

  await tapGame(page); // the child opens the keyboard again
  await page.evaluate(() => window.advanceFrames(1000));
  const resumed = await playState(page);
  const waitingShip = paused.ships[0];
  const sameShip = waitingShip && resumed.ships.find((ship) => ship.text === waitingShip.text);
  check(!!sameShip && sameShip.top > waitingShip.top + 2, `tablet S5: the ships descend again after the child taps to type (${round(waitingShip?.top)} -> ${round(sameShip?.top)})`);
  await close(game, "tablet typing pause");
}

// One input event from an Android keyboard: the field shows what the input method
// has so far, and isComposing stays true until something else ends it.
const imeField = (page, value, { composing = true } = {}) => page.evaluate(({ value, composing }) => {
  const catcher = document.querySelector(".key-catcher");
  catcher.value = value;
  catcher.dispatchEvent(new InputEvent("input", {
    bubbles: true, data: value.slice(-1), inputType: composing ? "insertCompositionText" : "insertText", isComposing: composing,
  }));
}, { value, composing });

// The composition ends: the confirming input that follows carries the field as the
// game left it, which is empty.
const imeEnd = (page) => page.evaluate(() => {
  const catcher = document.querySelector(".key-catcher");
  catcher.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: catcher.value }));
  catcher.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", isComposing: false }));
});

// What the child sees while typing: hearts, the 6º wrong-key count and accuracy.
// `typed` belongs to the ship carrying `word`, so a new ship arriving after that
// word is destroyed can never answer for it.
const typingState = (page, word) => page.evaluate((word) => {
  const text = document.querySelector("#stats").textContent;
  const match = (re) => (text.match(re) || [])[1] ?? null;
  const ship = [...document.querySelectorAll(".ship")].find((el) => !word || el.dataset.text === word);
  return {
    hearts: document.body.dataset.hearts,
    fallos: match(/Fallos: (\d+)\/3/),
    precision: match(/Precisión: (\d+) %/),
    typed: ship ? Number(ship.dataset.typed) : null,
  };
}, word);

const show = (state) => JSON.stringify(state);

// A known word on screen: the game's own spawner with every other ship removed, so
// a second word with the same first letter can never steal a keystroke.
const onlyShip = (page, text) => page.evaluate((text) => {
  alive.forEach(removeShip);
  return Boolean(spawnOne({ kind: "ship", text }));
}, text);

// S5 (T6/T10): the field's value does not only grow. An Android keyboard shrinks it
// (backspace), replaces a letter ("n" -> "ñ") or swaps in a suggestion, and the
// first version re-sent the whole text whenever the value no longer started with
// what it had already handed over: letters that were already typed counted again as
// wrong keys, so the child got extra fallos, a wrecked accuracy and lost hearts
// without pressing anything wrong. A shrink must type nothing, and a replacement
// only what lies beyond the longest common prefix with the text already handed over.
async function androidCompositionEdits() {
  const scenario = async (title, { word, prefix, prefixTyped = prefix.length, edit, expect }) => {
    const game = await openGame("juegos/teclado.html");
    const { page } = game;
    await tapGrade(page, 6); // 6º answers every third wrong key with a lost heart
    await tapGame(page);
    check(await onlyShip(page, word), `tablet T10 ${title}: the known word "${word}" is on screen to type`);
    for (let letter = 1; letter <= prefix.length; letter++) await imeField(page, prefix.slice(0, letter));
    await page.waitForTimeout(80);
    const typed = await typingState(page, word);
    check(typed.typed === prefixTyped, `tablet T10 ${title}: "${prefix}" is typed while composing (${show(typed)})`);
    await edit(page);
    await page.waitForTimeout(100);
    const after = await typingState(page, word);
    check(after.typed === expect.typed, `tablet T10 ${title}: the ship has ${expect.typed} letters typed (${show(after)})`);
    check(after.fallos === expect.fallos, `tablet T10 ${title}: ${expect.fallos} wrong keys are counted (${show(after)})`);
    check(after.hearts === expect.hearts, `tablet T10 ${title}: the shield keeps ${expect.hearts} hearts (${show(after)})`);
    check(after.precision === expect.precision, `tablet T10 ${title}: the accuracy reads ${expect.precision} % (${show(after)})`);
    await close(game, `tablet composition ${title}`);
  };

  // A backspace inside the composition types nothing at all.
  await scenario("shrink", {
    word: "cigüeña", prefix: "cigüe",
    edit: (page) => imeField(page, "cigü"),
    expect: { typed: 5, fallos: "0", hearts: "3", precision: "100" },
  });

  // "n" replaced by "ñ": only the letter the input method now shows is typed, so
  // the transient n is the one honest wrong key and the rest is untouched.
  await scenario("replacement", {
    word: "cigüeña", prefix: "cigüe",
    edit: async (page) => {
      await imeField(page, "cigüen");
      await imeField(page, "cigüeñ");
    },
    expect: { typed: 6, fallos: "1", hearts: "3", precision: "86" },
  });

  // A suggestion that swaps the mistyped tail for the right one types only that
  // tail: the wrong l was the child's own keystroke, it is not counted twice.
  await scenario("suggestion", {
    word: "lluvia", prefix: "lluvl", prefixTyped: 4,
    edit: (page) => imeField(page, "lluvia"),
    expect: { typed: null, fallos: "1", hearts: "3", precision: "86" },
  });

  // Ending the composition after the letters were handed over types nothing again.
  {
    const game = await openGame("juegos/teclado.html");
    const { page } = game;
    await tapGrade(page, 6);
    await tapGame(page);
    check(await onlyShip(page, "cigüeña"), "tablet T10 compositionend: the known word is on screen to type");
    const before = await countedNow(page);
    for (let letter = 1; letter <= "cigüeña".length; letter++) await imeField(page, "cigüeña".slice(0, letter));
    await imeEnd(page);
    await page.waitForTimeout(150);
    const after = await typingState(page, "cigüeña");
    check(after.fallos === "0" && after.hearts === "3", `tablet T10 compositionend: ending the composition types no wrong key (${show(after)})`);
    check(after.precision === "100", `tablet T10 compositionend: the accuracy stays at 100 % after the composition ends (${show(after)})`);
    check(await countsOnce(page, before), "tablet T10 compositionend: the word destroys its ship exactly once");
    await close(game, "tablet composition end");
  }
}

// S5 (T6/T10): a suspended phone delivers one long frame (another app, the screen
// off). While the keyboard is closed that whole frame belongs to the pause: the
// first version credited only the capped 0.1 s of the gameplay clock, so the words
// per minute fell although the child had not typed. Movement must stay capped.
async function pauseTimingAfterLongFrame() {
  const game = await openGame("juegos/teclado.html", { clock: true });
  const { page } = game;
  // Recompute the score boxes now: a manual frame clock never publishes on its own.
  const wpm = () => page.evaluate(() => {
    publish();
    const found = document.querySelector("#stats").textContent.match(/Palabras\/min: (\d+)/);
    return found ? Number(found[1]) : null;
  });
  await tapGrade(page, 5);
  await page.evaluate(() => window.advanceFrames(500));
  await tapGame(page); // the keyboard is open and the game runs
  await page.evaluate(() => window.advanceFrames(500));
  const word = await page.locator(".ship").first().getAttribute("data-text");
  await page.keyboard.insertText(word); // one destroyed ship: a clean typing measurement
  await page.evaluate(() => window.advanceFrames(500));
  const measured = await wpm();
  check(typeof measured === "number" && measured > 0, `tablet S5: the words per minute are measured before the pause (${measured})`);

  await page.evaluate(() => document.querySelector(".key-catcher").blur()); // the phone keyboard closes
  await page.waitForTimeout(120);
  const paused = await playState(page);
  check(paused.hint && paused.hearts === "3", `tablet S5: closing the keyboard pauses the game and shows the tap target (${paused.hearts} hearts, hint ${paused.hint})`);
  await page.evaluate(() => window.jumpFrames(1500)); // one frame after 1.5 s in the background
  const still = await wpm();
  check(still === measured, `tablet S5: a 1.5 s suspended frame during the pause does not skew the words per minute (${measured} -> ${still})`);
  check((await playState(page)).hearts === "3", "tablet S5: the suspended frame costs no hearts");

  // Movement stays capped: five suspended seconds while playing move a ship as far
  // as one tenth of a second, never five seconds.
  await tapGame(page); // the keyboard is open again
  await page.waitForTimeout(120);
  const flying = await playState(page);
  const ship = flying.ships[0];
  check(Boolean(ship), "tablet S5: a ship is flying before the long playing frame");
  await page.evaluate(() => window.jumpFrames(5000));
  const jumped = await playState(page);
  const twin = ship && jumped.ships.find((other) => other.text === ship.text);
  check(Boolean(twin) && twin.top > ship.top && twin.top - ship.top < 20,
    `tablet S5: one five-second frame only moves a ship one tenth of a second (${ship ? round(ship.top) : "?"} -> ${twin ? round(twin.top) : "gone"})`);
  await close(game, "tablet pause timing");
}

(async () => {
  await tapToType();
  await inputWithoutKeydown();
  await keydownPlusInput();
  await androidCompositionLetters();
  await androidCompositionEdits();
  await accentedLetters();
  await keyboardDismissal();
  await keyboardShrinksPlayArea();
  await keyboardCostsNoLives();
  await shipsWaitForTyping();
  await pauseTimingAfterLongFrame();
  await desktopUnchanged();
  console.log(`TOTAL: ${okCount} ok, ${failCount} FAIL`);
})().catch((e) => { console.error(e); console.error(`TOTAL before error: ${okCount} ok, ${failCount} FAIL`); process.exit(1); });
