// Phone portrait layout (S7): on a narrow phone screen (Samsung S26 Ultra,
// ~412x915 CSS px, and a small 360x780 phone) every game and the portal must
// look tidy: the HUD pieces never overlap, nothing is cut off at a screen edge
// and the tap targets stay reachable. Desktop (1366x768) and tablet
// (768x1024, 1024x768) layouts must keep their current measurements.
const path = require("path");
const os = require("os");
const { chromium } = require("playwright-core");
const { check } = require("./helpers");

const ROOT = "file://" + path.resolve(__dirname, "..");
const EXECUTABLE =
  process.env.CHROME_PATH ||
  path.join(os.homedir(), ".cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell");

const PHONES = [
  [412, 915], // Samsung S26 Ultra portrait
  [360, 780], // a small Android phone in portrait
];
const PRESERVE = [
  [1366, 768], // classroom laptop / desktop
  [768, 1024], // tablet portrait
  [1024, 768], // tablet landscape
];
// panuelo.html is left out on purpose: it is a standalone Tailwind page that
// loads its CSS from a CDN, uses no shared HUD and is already phone-shaped
// (max-w-md), so this file cannot judge it offline.
const GAMES = ["estrellas", "burbujas", "monstruos", "cohete", "piano", "carrera", "hamburgueseria", "topos", "pinta", "teclado"];

async function open(browser, file, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  const external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("request", (r) => !r.url().startsWith("file://") && external.push(r.url()));
  await page.addInitScript(() => { window.RANKING_URL = ""; }); // the school ranking is not part of these checks
  await page.goto(`${ROOT}/${file}`);
  return { context, page, errors, external };
}

// Dismiss the start screen so the HUD and the play area exist.
async function start(page) {
  await page.waitForSelector(".overlay .play-btn");
  await page.click(".overlay .play-btn", { force: true });
  await page.waitForSelector(".progress");
}

// One box in viewport coordinates, or null when the element is missing.
function box(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
  }, selector);
}

function boxes(page, selector) {
  return page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)].map((el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
    });
  }, selector);
}

// A 1px tolerance absorbs sub-pixel rounding on scaled screens.
function inside(r, width, height) {
  return r.left >= -1 && r.top >= -1 && r.right <= width + 1 && r.bottom <= height + 1;
}

function apart(a, b) {
  return a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
}

function show(r) {
  return `left:${Math.round(r.left)} top:${Math.round(r.top)} right:${Math.round(r.right)} bottom:${Math.round(r.bottom)}`;
}

function tapTarget(r) {
  return r.width >= 44 && r.height >= 44;
}

// The shared header: home button, star pill and the prize case must all sit
// inside the screen and never cover each other. The stars themselves must stay
// inside their pill too, because they used to spill out over the prize case.
async function hudIsTidy(page, width, height, label) {
  const home = await box(page, ".home-btn");
  const stars = await box(page, ".progress");
  const case_ = (await box(page, ".trophies")) || (await box(page, ".medals"));
  check(Boolean(home && stars && case_), `${label}: the HUD is on screen (home ${!!home}, stars ${!!stars}, case ${!!case_})`);
  if (!home || !stars || !case_) return;
  check(inside(home, width, height), `${label}: home button inside the screen (${show(home)})`);
  check(inside(stars, width, height), `${label}: star pill inside the screen (${show(stars)})`);
  check(inside(case_, width, height), `${label}: prize case inside the screen (${show(case_)})`);
  check(apart(stars, case_), `${label}: star pill and prize case do not overlap (stars ${show(stars)} / case ${show(case_)})`);
  check(apart(home, stars), `${label}: home button and star pill do not overlap (${show(home)} / ${show(stars)})`);
  check(apart(home, case_), `${label}: home button and prize case do not overlap (${show(home)} / ${show(case_)})`);
  const pill = await page.evaluate(() => {
    const bar = document.querySelector(".progress");
    const spans = [...bar.querySelectorAll("span")];
    const last = spans[spans.length - 1];
    const b = bar.getBoundingClientRect();
    return {
      inside: bar.scrollWidth <= bar.clientWidth + 1,
      overflow: bar.scrollWidth - bar.clientWidth,
      lastRight: last ? last.getBoundingClientRect().right : b.right,
      right: b.right,
    };
  });
  check(pill.inside, `${label}: the stars fit inside their pill (${pill.overflow}px spill)`);
  check(
    pill.lastRight <= case_.left + 1 || pill.lastRight <= pill.right + 1,
    `${label}: no star spills over the prize case (last star right ${Math.round(pill.lastRight)}, case left ${Math.round(case_.left)})`
  );
}

// Only used where the page has no decoration drifting outside the screen:
// a cloud that flies in from 110vw is not "cut off" content.
async function noSideOverflow(page, width, label) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  check(scrollWidth <= width + 1, `${label}: nothing overflows the sides (${scrollWidth} <= ${width})`);
}

// S7 (T10): a 5º/6º long phrase ("¿Frigorífico o lavavajillas?", "Hoy, después de
// clase, jugamos.") is wider than a phone screen. The text must shrink and wrap so
// the child can read the whole word, and a ship must never be pushed off the right
// edge by its own width. The phrase is spawned by the game itself, so the check is
// about the layout and not about waiting for a lucky word.
async function tecladoLongPhrases(browser) {
  for (const [width, height] of PHONES) {
    const label = `teclado phrases ${width}x${height}`;
    const game = await open(browser, "juegos/teclado.html", width, height);
    const { page } = game;
    await page.waitForSelector(".overlay .grade-btn");
    await page.click('.overlay .grade-btn[data-grade="6"]', { force: true });
    await page.waitForSelector(".progress");
    const phrase = await page.evaluate(() => {
      const pool = [...LASER_LINES[6].long, ...GRADES[6].levels[3]];
      return pool.reduce((longest, text) => (text.length > longest.length ? text : longest));
    });
    const spawned = await page.evaluate((text) => {
      const ship = spawnOne({ kind: "laser", text });
      return Boolean(ship);
    }, phrase);
    check(spawned, `${label}: the longest phrase is on screen to measure (${phrase})`);
    await page.waitForTimeout(200);
    const measure = await page.evaluate(() => [...document.querySelectorAll(".ship")].map((el) => {
      const ship = el.getBoundingClientRect();
      const text = el.querySelector(".label");
      const box = text.getBoundingClientRect();
      const style = getComputedStyle(text);
      return {
        word: el.dataset.text,
        box: { left: ship.left, top: ship.top, right: ship.right, bottom: ship.bottom },
        text: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
        fontSize: parseFloat(style.fontSize),
        lines: Math.round(box.height / parseFloat(style.lineHeight || style.fontSize)),
      };
    }));
    check(measure.length >= 1, `${label}: ships are on screen (${measure.length})`);
    const off = measure.filter((ship) => !inside(ship.box, width, height));
    check(off.length === 0, `${label}: every ship stays inside the screen (${off.map((ship) => `${ship.word} ${show(ship.box)}`).join(" | ")})`);
    const cut = measure.filter((ship) => !inside(ship.text, width, height));
    check(cut.length === 0, `${label}: every word is fully readable, nothing cut at a side (${cut.map((ship) => `${ship.word} ${show(ship.text)}`).join(" | ")})`);
    const longest = measure.find((ship) => ship.word === phrase);
    check(Boolean(longest), `${label}: the long phrase is the ship being measured`);
    if (longest) {
      check(longest.fontSize < 34, `${label}: a long phrase uses a smaller phone font (${longest.fontSize}px)`);
      check(longest.text.left >= 0 && longest.text.right <= width + 1, `${label}: the long phrase starts and ends on screen (${show(longest.text)})`);
    }
    check(game.errors.length === 0, `${label}: no page errors (${game.errors.join(" | ")})`);
    await game.context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  try {
    // ---------- Phone portrait ----------
    for (const [width, height] of PHONES) {
      for (const id of GAMES) {
        const label = `${id} ${width}x${height}`;
        const game = await open(browser, `juegos/${id}.html`, width, height);
        const { page } = game;
        await start(page);

        await hudIsTidy(page, width, height, label);

        // Game-specific pieces the child has to reach.
        if (id === "cohete") {
          const enter = await box(page, "#enter-key");
          const space = await box(page, "#space-key");
          const lives = await box(page, "#lives");
          check(inside(enter, width, height), `${label}: ENTER key fully on screen (${show(enter)})`);
          check(inside(space, width, height), `${label}: SPACE key fully on screen (${show(space)})`);
          check(apart(enter, space), `${label}: the two keys do not overlap (${show(enter)} / ${show(space)})`);
          check(tapTarget(enter) && tapTarget(space), `${label}: both keys are big enough to tap`);
          const stars = await box(page, ".progress");
          const case_ = await box(page, ".trophies");
          const home = await box(page, ".home-btn");
          check(
            [stars, case_, home].every((hud) => apart(lives, hud)),
            `${label}: the hearts bar never covers the HUD (${show(lives)})`
          );
        }

        if (id === "monstruos") {
          const slots = await boxes(page, ".slot");
          const stars = await box(page, ".progress");
          const case_ = await box(page, ".trophies");
          check(slots.length === 3, `${label}: first monster has three drop slots (${slots.length})`);
          check(slots.every((s) => inside(s, width, height)), `${label}: every drop slot is on screen (${slots.map(show).join(" ")})`);
          check(
            slots.every((s) => apart(s, stars) && apart(s, case_)),
            `${label}: no drop slot is hidden under the HUD (${slots.map(show).join(" ")})`
          );
          const parts = await boxes(page, ".part");
          check(parts.every((p) => inside(p, width, height) && tapTarget(p)), `${label}: every tray piece is on screen and big enough`);
        }

        if (id === "topos") {
          const holes = await boxes(page, ".hole");
          check(holes.length === 6, `${label}: six holes (${holes.length})`);
          check(holes.every((h) => inside(h, width, height)), `${label}: every hole is on screen (${holes.map(show).join(" ")})`);
          let overlap = "";
          for (let a = 0; a < holes.length; a++) {
            for (let b = a + 1; b < holes.length; b++) {
              if (!apart(holes[a], holes[b])) overlap = `${a}-${b}`;
            }
          }
          check(overlap === "", `${label}: no two holes overlap (${overlap})`);
          const moles = await boxes(page, ".mole");
          check(moles.length === 6 && moles.every(tapTarget), `${label}: every mole is still a big tap target`);
        }

        if (id === "carrera") {
          await page.waitForSelector(".question[data-ready='1']");
          const question = await box(page, ".question");
          const answers = await boxes(page, ".answer");
          const mascot = await box(page, ".mascot-box");
          check(inside(question, width, height), `${label}: the question panel is fully on screen (${show(question)})`);
          check(answers.length === 3, `${label}: three answers (${answers.length})`);
          check(answers.every((a) => inside(a, width, height)), `${label}: every answer button is on screen (${answers.map(show).join(" ")})`);
          check(answers.every(tapTarget), `${label}: every answer button is big enough to tap`);
          let overlap = "";
          for (let a = 0; a < answers.length; a++) {
            for (let b = a + 1; b < answers.length; b++) {
              if (!apart(answers[a], answers[b])) overlap = `${a}-${b}`;
            }
          }
          check(overlap === "", `${label}: the answer buttons do not overlap (${overlap})`);
          check(inside(mascot, width, height), `${label}: the mascot is on screen (${show(mascot)})`);
          const stars = await box(page, ".progress");
          const scene = await box(page, ".scene");
          check(apart(stars, scene), `${label}: the race scene starts below the star pill (${show(stars)} / ${show(scene)})`);
        }

        if (id === "hamburgueseria") {
          const tray = await box(page, ".tray");
          const plate = await box(page, ".plate");
          const order = await box(page, ".order");
          const customer = await box(page, ".customer");
          const ingredients = await boxes(page, ".ingredient");
          check(inside(tray, width, height), `${label}: the ingredient tray is fully on screen (${show(tray)})`);
          check(ingredients.length === 6, `${label}: six ingredients (${ingredients.length})`);
          check(ingredients.every(tapTarget), `${label}: every ingredient is big enough to tap`);
          check(inside(plate, width, height), `${label}: the plate is fully on screen (${show(plate)})`);
          check(inside(order, width, height), `${label}: the order bubble is fully on screen (${show(order)})`);
          check(inside(customer, width, height), `${label}: the customer is fully on screen (${show(customer)})`);
          check(apart(order, customer), `${label}: the order bubble does not cover the customer`);
          check(apart(plate, tray), `${label}: the plate does not cover the tray (${show(plate)} / ${show(tray)})`);
        }

        if (id === "pinta") {
          const drawing = await box(page, ".drawing");
          check(inside(drawing, width, height), `${label}: the drawing is fully on screen (${show(drawing)})`);
          const stars = await box(page, ".progress");
          check(apart(drawing, stars), `${label}: the drawing starts below the star pill (${show(drawing)} / ${show(stars)})`);
        }

        if (id === "piano") {
          const keyboard = await box(page, "#keyboard");
          const keys = await boxes(page, ".key");
          check(inside(keyboard, width, height), `${label}: the keyboard is fully on screen (${show(keyboard)})`);
          check(keys.length === 37, `${label}: every letter key is drawn (${keys.length})`);
          check(keys.every((k) => inside(k, width, height)), `${label}: no key is cut off at a screen edge`);
          check(keys.every((k) => k.width >= 20 && k.height >= 40), `${label}: the keys stay usable with a finger`);
        }

        if (id === "estrellas") {
          await page.waitForSelector(".star-target");
          const star = await box(page, ".star-target");
          check(inside(star, width, height), `${label}: the star to catch is fully on screen (${show(star)})`);
        }

        if (id === "piano") {
          const target = await box(page, "#target");
          const stars = await box(page, ".progress");
          check(apart(target, stars), `${label}: the big letter starts below the star pill (${show(target)} / ${show(stars)})`);
        }

        if (id === "teclado") {
          // Naves del teclado draws its own score boxes on top of the shared HUD.
          await page.waitForFunction(() => document.querySelector("#stats").textContent.trim().length > 0, null, { timeout: 8000 });
          const stars = await box(page, ".progress");
          const home = await box(page, ".home-btn");
          const case_ = await box(page, ".trophies");
          const pieces = [
            ["#streak", await box(page, "#streak")],
            ["#stats", await box(page, "#stats")],
            ["#level-badge", await box(page, "#level-badge")],
          ];
          for (const [name, piece] of pieces) {
            check(inside(piece, width, height), `${label}: ${name} is fully on screen (${show(piece)})`);
            check(
              apart(piece, stars) && apart(piece, home) && apart(piece, case_),
              `${label}: ${name} never covers the shared HUD (${show(piece)} / stars ${show(stars)})`
            );
          }
          let overlap = "";
          for (let a = 0; a < pieces.length; a++) {
            for (let b = a + 1; b < pieces.length; b++) {
              if (!apart(pieces[a][1], pieces[b][1])) overlap = `${pieces[a][0]}/${pieces[b][0]}`;
            }
          }
          check(overlap === "", `${label}: the score boxes do not overlap each other (${overlap})`);
          // The game is to read the ship and type it, so a ship must never start
          // hidden behind the header.
          await page.waitForSelector(".ship", { timeout: 15000 });
          const ship = await box(page, ".ship");
          const headerBottom = Math.max(stars.bottom, ...pieces.map(([, piece]) => piece.bottom));
          check(ship.top >= headerBottom - 1, `${label}: ships start below the header (ship top ${Math.round(ship.top)}, header bottom ${Math.round(headerBottom)})`);
          check(ship.left >= -1 && ship.right <= width + 1, `${label}: the ship stays on screen (${show(ship)})`);
          const cannon = await box(page, "#cannon");
          const shield = await box(page, "#shield");
          check(inside(cannon, width, height), `${label}: the cannon is on screen above the keyboard (${show(cannon)})`);
          check(inside(shield, width, height), `${label}: the shield is on screen above the keyboard (${show(shield)})`);
          check(apart(ship, cannon), `${label}: the ship starts above the cannon (${show(ship)} / ${show(cannon)})`);
        }

        if (id === "burbujas") {
          // Bubbles float in from below the screen on purpose; what matters is
          // that a small bubble is still big enough to hit with a finger.
          const bubbles = await boxes(page, ".bubble");
          check(bubbles.every(tapTarget), `${label}: every bubble is big enough to tap`);
        }

        check(game.errors.length === 0, `${label}: no page errors (${game.errors.join(" | ")})`);
        check(game.external.length === 0, `${label}: no external requests (${game.external.join(", ")})`);
        await game.context.close();
      }

      // ---------- Phone portrait: the portal ----------
      const portal = await open(browser, "index.html", width, height);
      const { page } = portal;
      const label = `portal ${width}x${height}`;
      await page.waitForSelector("main a.card");
      await noSideOverflow(page, width, label);
      const school = await box(page, ".school");
      check(inside(school, width, height), `${label}: the school circle is fully on screen (${show(school)})`);
      check(school.width <= 130, `${label}: the school circle is not oversized on a phone (${Math.round(school.width)}px)`);
      const logoInsideCircle = await page.evaluate(() => {
        const circle = document.querySelector(".school");
        const logo = circle.querySelector("img");
        const c = circle.getBoundingClientRect();
        const l = logo.getBoundingClientRect();
        const cx = c.left + c.width / 2;
        const cy = c.top + c.height / 2;
        const r = c.width / 2;
        return [[l.left, l.top], [l.right, l.top], [l.left, l.bottom], [l.right, l.bottom]].every(
          ([x, y]) => Math.hypot(x - cx, y - cy) <= r
        );
      });
      check(logoInsideCircle, `${label}: the logo still fits inside its circle`);
      const cards = await page.evaluate(() => {
        return [...document.querySelectorAll("main a.card")].map((card) => {
          const c = card.getBoundingClientRect();
          const label = card.querySelector(".label");
          const l = label.getBoundingClientRect();
          return {
            card: { left: c.left, top: c.top, right: c.right, bottom: c.bottom },
            label: { left: l.left, top: l.top, right: l.right, bottom: l.bottom, text: label.textContent.trim() },
          };
        });
      });
      check(cards.length === 10, `${label}: ten game cards (${cards.length})`);
      const cutTitles = cards.filter((c) => c.label.right > c.card.right + 1 || c.label.left < c.card.left - 1);
      check(cutTitles.length === 0, `${label}: every title stays inside its card (${cutTitles.map((c) => c.label.text).join(", ")})`);
      // The portal itself scrolls on a phone, so only the sides must be safe.
      const offScreen = cards.filter((c) => c.card.left < -1 || c.card.right > width + 1);
      check(offScreen.length === 0, `${label}: no card is cut off at a side`);
      check(portal.errors.length === 0, `${label}: no page errors (${portal.errors.join(" | ")})`);
      await portal.context.close();
    }

    // ---------- Phone portrait: the long words of 5º-6º ----------
    await tecladoLongPhrases(browser);

    // ---------- Desktop and tablet: the current layout must not move ----------
    for (const [width, height] of PRESERVE) {
      const label = `${width}x${height}`;
      for (const id of ["estrellas", "cohete", "monstruos"]) {
        const game = await open(browser, `juegos/${id}.html`, width, height);
        const { page } = game;
        await start(page);
        const home = await box(page, ".home-btn");
        const stars = await box(page, ".progress");
        const case_ = await box(page, ".trophies");
        check(
          Math.round(home.left) === 16 && Math.round(home.top) === 16 && home.width === 80 && home.height === 80,
          `${id} ${label}: desktop/tablet home button unchanged (${show(home)})`
        );
        check(Math.round(stars.top) === 20, `${id} ${label}: star pill keeps its 20px top (${Math.round(stars.top)})`);
        check(
          Math.round(case_.top) === 20 && Math.round(width - case_.right) === 20,
          `${id} ${label}: prize case keeps its top-right corner (${show(case_)})`
        );
        if (id === "cohete") {
          const enter = await box(page, "#enter-key");
          const space = await box(page, "#space-key");
          check(
            Math.round(enter.left) === Math.round(width / 2 - 250) && enter.width === 180 && enter.height === 85,
            `${id} ${label}: ENTER key keeps its base position (${show(enter)})`
          );
          check(
            Math.round(space.left) === Math.round(width / 2 - 35) && space.width === 300 && space.height === 85,
            `${id} ${label}: SPACE key keeps its base position (${show(space)})`
          );
        }
        await game.context.close();
      }

      const topos = await open(browser, "juegos/topos.html", width, height);
      const holes = await boxes(topos.page, ".hole");
      check(holes.length === 6, `topos ${label}: six holes`);
      check(
        holes.every((h) => h.width === 210 && h.height === 210),
        `topos ${label}: holes keep their 210px size`
      );
      const columns = [22, 50, 78].map((pct) => (pct / 100) * width - 105);
      const rows = [210, 450];
      const expected = rows.flatMap((top) => columns.map((left) => [left, top]));
      check(
        holes.every((h, i) => Math.abs(h.left - expected[i][0]) < 1 && Math.abs(h.top - expected[i][1]) < 1),
        `topos ${label}: holes keep their base grid positions`
      );
      await topos.context.close();

      const race = await open(browser, "juegos/carrera.html", width, height);
      await race.page.click(".overlay .play-btn", { force: true });
      await race.page.waitForSelector(".question[data-ready='1']");
      const scene = await box(race.page, ".scene");
      const sceneTop = width <= 1100 ? 80 : 104;
      const sceneHeight = width <= 1100 ? 338 : 372;
      check(
        Math.round(scene.top) === sceneTop && Math.round(scene.height) === sceneHeight,
        `carrera ${label}: the race scene keeps its base size (${show(scene)})`
      );
      const answers = await race.page.locator(".answer").first().boundingBox();
      const answerSize = width <= 1100 ? 100 : 120;
      check(
        Math.round(answers.width) === answerSize && Math.round(answers.height) === answerSize,
        `carrera ${label}: answer buttons keep their base size (${Math.round(answers.width)})`
      );
      await race.context.close();

      const burger = await open(browser, "juegos/hamburgueseria.html", width, height);
      const plate = await box(burger.page, ".plate");
      if (width === 1366) {
        check(Math.abs(plate.left - width * 0.62) < 1 && plate.width === 300 && plate.height === 330, `hamburgueseria ${label}: desktop plate unchanged (${show(plate)})`);
      } else {
        check(Math.abs(plate.left - Math.min(width * 0.65, width - 292)) < 1 && plate.width === 280, `hamburgueseria ${label}: tablet plate unchanged (${show(plate)})`);
      }
      await burger.context.close();

      const navy = await open(browser, "juegos/teclado.html", width, height);
      await navy.page.click(".overlay .play-btn", { force: true });
      await navy.page.waitForSelector(".progress");
      await navy.page.waitForSelector(".ship", { timeout: 15000 });
      const streak = await box(navy.page, "#streak");
      const stats = await box(navy.page, "#stats");
      const badge = await box(navy.page, "#level-badge");
      const cannon = await box(navy.page, "#cannon");
      check(
        Math.round(streak.top) === 112 && Math.round(streak.left) === 16,
        `teclado ${label}: the streak box keeps its base corner (${show(streak)})`
      );
      check(Math.round(stats.top) === 95 && Math.round(width - stats.right) === 16, `teclado ${label}: the score box keeps its base corner (${show(stats)})`);
      check(Math.round(badge.top) === 91 && Math.abs(badge.left + badge.width / 2 - width / 2) < 1, `teclado ${label}: the level badge keeps its base spot (${show(badge)})`);
      check(cannon.width === 120 && cannon.height === 96 && Math.round(height - cannon.bottom) === 0, `teclado ${label}: the cannon keeps its base size and spot (${show(cannon)})`);
      const shipText = await navy.page.evaluate(() => {
        const text = document.querySelector(".ship .label");
        const style = getComputedStyle(text);
        return { fontSize: parseFloat(style.fontSize), whiteSpace: style.whiteSpace, maxWidth: style.maxWidth, width: text.getBoundingClientRect().width };
      });
      check(
        shipText.fontSize === 48 && shipText.whiteSpace === "pre" && shipText.maxWidth === "none",
        `teclado ${label}: the ship text keeps its base size and one-line layout (${shipText.fontSize}px ${shipText.whiteSpace} max-width ${shipText.maxWidth})`
      );
      await navy.context.close();

      const portal = await open(browser, "index.html", width, height);
      const p = portal.page;
      const school = await box(p, ".school");
      check(school.width === 170, `portal ${label}: the school circle keeps its 170px size (${school.width})`);
      const card = await box(p, "main a.card");
      check(card.height >= 100, `portal ${label}: game cards keep their 100px height (${Math.round(card.height)})`);
      const columnsCount = await p.evaluate(() => {
        return getComputedStyle(document.querySelector(".games")).gridTemplateColumns.split(" ").filter((track) => track !== "").length;
      });
      const baseColumns = width > 980 ? 3 : 2;
      check(columnsCount === baseColumns, `portal ${label}: the portal keeps its ${baseColumns}-column layout (${columnsCount} columns)`);
      await portal.context.close();
    }
  } catch (error) {
    check(false, error.message);
  } finally {
    await browser.close();
  }
})();
