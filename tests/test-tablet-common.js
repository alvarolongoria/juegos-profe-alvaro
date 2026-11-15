// Tablet behaviors shared by every game (S4):
// - no accidental double-tap zoom while playing (touch-action);
// - a finger drag over the stars neither scrolls nor zooms and still catches;
// - the hamburguesería plate stays fully inside a 768x1024 tablet screen;
// - the right-click guard still blocks the menu on a touch long-press but
//   keeps the mouse hint for a real mouse.
const path = require("path");
const os = require("os");
const { chromium } = require("playwright-core");
const { check } = require("./helpers");

const ROOT = "file://" + path.resolve(__dirname, "..");
const EXECUTABLE =
  process.env.CHROME_PATH ||
  path.join(os.homedir(), ".cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell");

// Local copy of helpers.openGame with a custom viewport and optional touch,
// because the shared helper is fixed to 1366x768 without touch.
async function open(file, { viewport = { width: 1366, height: 768 }, touch = false, init = null } = {}) {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const page = await browser.newPage({ viewport, hasTouch: touch });
  if (init) await page.addInitScript(init);
  const errors = [];
  const external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("request", (r) => !r.url().startsWith("file://") && external.push(r.url()));
  await page.goto(`${ROOT}/${file}`);
  return { browser, page, errors, external };
}

async function touchPoint(client, type, x, y) {
  await client.send(
    "Input.dispatchTouchEvent",
    type === "touchEnd" ? { type, touchPoints: [] } : { type, touchPoints: [{ x, y }] }
  );
}

function inside(box, viewport) {
  return box.left >= 0 && box.top >= 0 && box.right <= viewport.width && box.bottom <= viewport.height;
}

function box(b) {
  return `left:${b.left} top:${b.top} right:${b.right} bottom:${b.bottom}`;
}

(async () => {
  let game;
  try {
    // ---------- Shared rule: a double tap must not zoom ----------
    // The portal uses common.css without overriding touch-action itself.
    game = await open("index.html");
    let page = game.page;
    const pageRules = await page.evaluate(() => ({
      html: getComputedStyle(document.documentElement).touchAction,
      body: getComputedStyle(document.body).touchAction,
    }));
    check(pageRules.html.includes("manipulation"), `html disables double-tap zoom (touch-action: ${pageRules.html})`);
    check(pageRules.body.includes("manipulation"), `body disables double-tap zoom (touch-action: ${pageRules.body})`);    check(game.external.length === 0, `no external requests (${game.external.join(", ")})`);
    check(game.errors.length === 0, `no page errors (${game.errors.join(" | ")})`);
    await game.browser.close();

    // A game that already owns the whole touch gesture keeps its own rule.
    game = await open("juegos/monstruos.html");
    page = game.page;
    const monsters = await page.evaluate(() => getComputedStyle(document.body).touchAction);
    check(monsters === "none", `a game can still block every gesture on the body (touch-action: ${monsters})`);
    await game.browser.close();

    game = await open("juegos/hamburgueseria.html");
    page = game.page;
    const ingredient = await page.locator(".ingredient").first().evaluate((el) => getComputedStyle(el).touchAction);
    check(ingredient === "none", `hamburguesería ingredients keep touch-action: none (${ingredient})`);
    await game.browser.close();

    // ---------- Estrellas: a finger drag catches and never scrolls ----------
    game = await open("juegos/estrellas.html", { viewport: { width: 800, height: 700 }, touch: true });
    page = game.page;
    const skyTouch = await page.evaluate(() => getComputedStyle(document.body).touchAction);
    check(skyTouch === "none", `estrellas play area blocks scrolling and zooming (touch-action: ${skyTouch})`);
    await page.click(".overlay .play-btn", { force: true });
    await page.waitForSelector(".star-target");
    await page.evaluate(() => {
      window.__cancels = 0;
      window.addEventListener("pointercancel", () => window.__cancels++);
    });
    const client = await page.context().newCDPSession(page);
    const center = await page.evaluate(() => {
      const b = document.querySelector(".star-target").getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await touchPoint(client, "touchStart", Math.max(10, center.x - 200), center.y);
    for (let step = 1; step <= 8; step++) {
      const from = Math.max(10, center.x - 200);
      const x = from + ((center.x - from) * step) / 8;
      await touchPoint(client, "touchMove", x, center.y);
      await page.waitForTimeout(30);
    }
    // Keep the finger on the star until the ring fills (the hold is 0.9s).
    const deadline = Date.now() + 5000;
    let caughtByFinger = 0;
    while (caughtByFinger === 0 && Date.now() < deadline) {
      await touchPoint(client, "touchMove", center.x, center.y);
      await page.waitForTimeout(80);
      caughtByFinger = await page.locator(".progress span.on").count();
    }
    const scrolled = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, cancels: window.__cancels }));
    await touchPoint(client, "touchEnd", center.x, center.y);
    check(caughtByFinger >= 1, `dragging a finger over the star collects it (${caughtByFinger})`);
    check(scrolled.cancels === 0, `the drag is not cancelled by a scroll or zoom gesture (${scrolled.cancels})`);
    check(scrolled.x === 0 && scrolled.y === 0, `the page never scrolls (${scrolled.x}, ${scrolled.y})`);
    await game.browser.close();

    // ---------- Hamburguesería: the plate fits a 768x1024 tablet ----------
    for (const size of [
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1100, height: 900 },
    ]) {
      game = await open("juegos/hamburgueseria.html", { viewport: size });
      page = game.page;
      const plateBox = await page.locator(".plate").boundingBox();
      const rect = { left: plateBox.x, top: plateBox.y, right: plateBox.x + plateBox.width, bottom: plateBox.y + plateBox.height };
      check(inside(rect, size), `${size.width}x${size.height}: the plate is fully visible (${box(rect)})`);
      // Wide tablets keep the layout the desktop rule gives: 65% of the width.
      if (size.width >= 1024) {
        const shift = Math.abs(rect.left - size.width * 0.65);
        check(shift < 1, `${size.width}x${size.height}: the plate stays at 65% of the width (${rect.left})`);
      }
      await game.browser.close();
    }
    game = await open("juegos/hamburgueseria.html", { viewport: { width: 1366, height: 768 } });
    page = game.page;
    const desktop = await page.locator(".plate").boundingBox();
    check(Math.abs(desktop.x - 1366 * 0.62) < 1, `1366x768: desktop plate layout is unchanged (left ${desktop.x})`);
    check(desktop.width === 300 && desktop.height === 330, `1366x768: desktop plate size is unchanged (${desktop.width}x${desktop.height})`);
    await game.browser.close();

    // ---------- Right-click guard: silent on touch, hint on a mouse ----------
    game = await open("juegos/estrellas.html");
    page = game.page;
    // A contextmenu created by a touch long-press carries this capability flag.
    const touchLongPress = await page.evaluate(() => {
      const caps = new InputDeviceCapabilities({ firesTouchEvents: true });
      const event = new MouseEvent("contextmenu", {
        sourceCapabilities: caps,
        clientX: 400,
        clientY: 300,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    check(touchLongPress, "a touch long-press still blocks the browser menu");
    check((await page.locator(".wrong-button-hint").count()) === 0, "a touch long-press shows no mouse hint");
    // Any hint still fading out must be gone before the mouse check.
    await page.waitForFunction(() => document.querySelectorAll(".wrong-button-hint").length === 0);
    await page.mouse.click(500, 300, { button: "right" });
    check((await page.locator(".wrong-button-hint").count()) === 1, "a mouse right-click still shows the hint");
    await page.waitForFunction(() => document.querySelectorAll(".wrong-button-hint").length === 0);
    check((await page.locator(".wrong-button-hint").count()) === 0, "the mouse hint fades away on its own");
    check(game.errors.length === 0, `no page errors (${game.errors.join(" | ")})`);
    await game.browser.close();

    // ---------- iPadOS Safari: sourceCapabilities does not exist ----------
    game = await open("juegos/estrellas.html", {
      init: () => {
        // iPadOS Safari has no UIEvent.sourceCapabilities at all.
        Object.defineProperty(UIEvent.prototype, "sourceCapabilities", { get: () => null, configurable: true });
      },
    });
    page = game.page;
    check(
      await page.evaluate(() => new MouseEvent("contextmenu").sourceCapabilities === null),
      "the tablet page really runs without sourceCapabilities"
    );
    // Press (capture phase) then long-press menu, as Safari does with a finger.
    const pressThenMenu = (pointerType) =>
      page.evaluate((type) => {
        window.dispatchEvent(
          new PointerEvent("pointerdown", { pointerType: type, clientX: 400, clientY: 300, bubbles: true, cancelable: true })
        );
        const event = new MouseEvent("contextmenu", { clientX: 400, clientY: 300, bubbles: true, cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }, pointerType);
    const hints = () => page.locator(".wrong-button-hint").count();
    const clearHints = () => page.waitForFunction(() => document.querySelectorAll(".wrong-button-hint").length === 0);

    check(await pressThenMenu("touch"), "no sourceCapabilities: a finger long-press still blocks the menu");
    check((await hints()) === 0, "no sourceCapabilities: a finger long-press shows no mouse hint");
    check(await pressThenMenu("pen"), "no sourceCapabilities: a pen long-press still blocks the menu");
    check((await hints()) === 0, "no sourceCapabilities: a pen long-press shows no mouse hint");
    await clearHints();
    check(await pressThenMenu("mouse"), "no sourceCapabilities: a mouse right-click blocks the menu too");
    check((await hints()) === 1, "no sourceCapabilities: a mouse right-click still shows the hint");
    await clearHints();
    // An old finger press must not swallow a later, real mouse right-click.
    await page.evaluate(() =>
      window.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true, cancelable: true }))
    );
    await page.waitForTimeout(1600);
    await page.evaluate(() => {
      window.dispatchEvent(new MouseEvent("contextmenu", { clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
    });
    check((await hints()) === 1, "no sourceCapabilities: a menu long after the last finger press behaves like a mouse");
    check(game.errors.length === 0, `no page errors (${game.errors.join(" | ")})`);
    await game.browser.close();
  } catch (error) {
    check(false, error.message);
    if (game) await game.browser.close();
  }
})();
