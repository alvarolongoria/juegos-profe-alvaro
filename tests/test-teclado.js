// Teclado naves: pick a grade, type the text a ship carries to shoot it.
const { openGame, check, finish } = require("./helpers");

// Several non-blocking trophy flights can overlap when a fast player finishes
// consecutive levels, so wait for the whole set rather than a strict locator.
async function pressPlay(page) {
  await page.waitForSelector('.overlay .play-btn');
  await page.click('.overlay .play-btn', { force: true });
  await page.waitForFunction(() => !document.querySelector('.trophy-flight'), null, { polling: 100 });
}

// Count the shared helper's checks too, so the complete run has an exact total.
let okCount = 0, failCount = 0;
const log = console.log, error = console.error;
console.log = (...args) => { if (String(args[0]).startsWith("ok: ")) okCount++; log(...args); };
console.error = (...args) => { if (String(args[0]).startsWith("FAIL: ")) failCount++; error(...args); };

// Playwright's key map lacks ñ and accented vowels, so dispatch the value the
// browser delivers after a Spanish dead key (´ then a gives "á").
const typeChar = (page, key) =>
  page.evaluate((k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })), key);

async function typeText(page, text) {
  for (const ch of text) await typeChar(page, ch);
}

const normalShip = '.ship[data-kind="ship"], .ship[data-kind="mother"], .ship[data-kind="child"]';
const specials = '.ship[data-kind="heart"], .ship[data-kind="ice"], .ship[data-kind="bomb"], .ship[data-kind="meteor"]';
const ships = (page) => page.$$eval(normalShip, (list) => list.map((s) => s.dataset.text));
const score = (page) => page.locator(".progress span.on").count();
let specialChars = 0, specialPoints = 0;
const data = (page, key) => page.evaluate((k) => document.body.dataset[k], key);

// Live stats must not mislead at the start of a level: no "0 %" before the first
// key, and no speed record from a burst in the first seconds.
async function liveStatsStart() {
  const game = await openGame("juegos/teclado.html");
  const { page } = game;
  const stats = () => page.locator("#stats").textContent();
  await chooseGrade(page, 3);
  check((await stats()).includes("Precisión: —"), `3º accuracy shows — before any key (${JSON.stringify(await stats())})`);
  await finish(game);

  const game6 = await openGame("juegos/teclado.html");
  const p6 = game6.page;
  await chooseGrade(p6, 6);
  await typeText(p6, await nextShip(p6)); // a whole word inside the first second
  await p6.waitForTimeout(300);
  const text = await p6.locator("#stats").textContent();
  check(text.includes("Máximo: —"), `6º speed record waits for 10 s of play (${JSON.stringify(text)})`);
  check(!text.includes("Precisión: —"), "accuracy appears after the first key");
  await finish(game6);
}

async function nextShip(page) {
  while (true) {
    const normal = page.locator(normalShip).first();
    if (await normal.count()) {
      page.lastShipKind = await normal.getAttribute("data-kind");
      return normal.getAttribute("data-text");
    }
    const special = page.locator(specials).first();
    if (await special.count()) {
      const text = await special.getAttribute("data-text");
      const kind = await special.getAttribute("data-kind");
      specialChars += text.length;
      specialPoints += text.length * 10 + (kind === "meteor" || (kind === "heart" && await data(page, "hearts") === "3") ? 50 : 0);
      await typeText(page, text);
    } else {
      await page.waitForSelector(".ship");
    }
  }
}

async function chooseGrade(page, grade) {
  await page.waitForSelector(".overlay .grade-btn");
  await page.click(`.overlay .grade-btn[data-grade="${grade}"]`, { force: true });
}

// Destroy `goal` ships, checking each text against the level pool.
async function playLevel(page, goal, pool, label) {
  const seen = [];
  const start = await data(page, "level");
  for (let i = 0; i < goal; i++) {
    const text = await nextShip(page);
    const kind = page.lastShipKind;
    if (kind === "ship") seen.push(text);
    if (pool && kind === "ship") check(pool.includes(text), `${label}: "${text}" belongs to its pool`);
    await typeText(page, text);
    if (i < goal - 1) check(await data(page, "level") === start && await page.locator(".overlay").count() === 0, `${label}: no early completion`);
  }
  if (start === "3") await page.waitForSelector(".overlay");
  else await page.waitForFunction((level) => document.body.dataset.level !== level, start);
  return seen;
}

const overlayText = (page) => page.locator(".overlay .overlay-text").textContent();

// A frame clock keeps the many timing and special-object cases fast. It drives
// real keyboard events and measures the rendered DOM, never game internals.
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

const pools = {
  2: [
    "ca co cu ra re ro na ne no fa fe fo ba be bo da de di ga go ja jo va ñu".split(" "),
    "gato casa nube rana vaca lobo foto dedo rosa gota cama bota hilo jugo nido ropa faro".split(" "),
    "sofá árbol café papá mamá ratón avión limón jamón camión lápiz bebé menú sillón melón".split(" "),
    "gato nube rana lobo sofá árbol ratón avión limón camión lápiz bebé".split(" "),
  ],
  3: [
    "planta camino ventana pelota cereza tortuga zapato bosque cocina dibujo escuela granja".split(" "),
    "niño araña montaña señal otoño mañana sueño pañuelo cariño piñata castaña muñeca".split(" "),
    "Madrid Sevilla Lucía Pablo España Marta Toledo Carmen Daniel Elena Valencia Granada".split(" "),
    "canción música plátano lámpara pirámide cámara océano árboles sábado número".split(" "),
  ],
  5: [
    "perro gatos nubes libro playa mundo flores planeta bosque pelota cocina camino".split(" "),
    "araña niños muñeca guerra llaves zapatos juguete jirafa conejo granja zorro lluvia".split(" "),
    "Pablo Marta Carmen Daniel Elena Samuel Teresa Madrid Sevilla Toledo Granada España".split(" "),
    ["El sol brilla", "Me gusta leer", "Hoy hace frío", "Mi perro corre", "La luna sale", "Vamos al parque", "Tengo un libro", "Juego con mis amigos", "Las flores huelen bien", "Comemos fruta", "Bebo agua fresca", "Nado en la piscina"],
  ],
};
const demand = { 2: [4, 5, 6, 8], 3: [6, 8, 10, 12], 4: [8, 10, 13, 16], 5: [10, 13, 16, 20], 6: [12, 16, 20, 24] };

async function measureLevel(page) {
  return page.evaluate(() => {
    const step = window.advanceFrames;
    step(50);
    const first = document.querySelector(".ship");
    if (!first) return null;
    const initialCount = document.querySelectorAll(".ship").length;
    const start = first.getBoundingClientRect();
    const ground = document.querySelector("#cannon").getBoundingClientRect().top;
    step(1000);
    const speed = first.getBoundingClientRect().top - start.top;
    let elapsed = 1000;
    while (document.querySelectorAll(".ship").length < 2 && elapsed < 60000) {
      step(50);
      elapsed += 50;
    }
    return { interval: initialCount > 1 ? 0 : elapsed / 1000, fall: (ground - start.bottom) / speed, speed, initialCount };
  });
}

async function finishWithClock(page) {
  return page.evaluate(() => {
    const seen = [];
    const level = document.body.dataset.level;
    for (let i = 0; i < 1000 && !document.querySelector(".overlay") && document.body.dataset.level === level; i++) {
      window.randomValue = ((i * 37) % 99 + 0.5) / 100;
      window.advanceFrames(50);
      const target = document.querySelector(".ship");
      if (!target) continue;
      if (!target.dataset.kind || target.dataset.kind === "ship") seen.push(target.dataset.text);
      for (const key of target.dataset.text) window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }
    return { seen, finished: !!document.querySelector(".overlay") || document.body.dataset.level !== level };
  });
}

async function probeSpecial(page, random, grade = 2, hurt = false) {
  await page.reload();
  await chooseGrade(page, grade);
  return page.evaluate(({ random, hurt }) => {
    window.randomValue = random;
    const step = window.advanceFrames;
    const type = (el) => { for (const key of el.dataset.text) window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); };
    step(50);
    const first = document.querySelector(".ship");
    const firstKind = first?.dataset.kind || "ship";
    if (hurt) {
      for (let i = 0; i < 1600 && document.body.dataset.hearts === "3"; i++) step(50);
    }
    for (let i = 0; i < 2000; i++) {
      const special = document.querySelector('.ship[data-kind="heart"], .ship[data-kind="ice"], .ship[data-kind="bomb"], .ship[data-kind="meteor"]');
      if (special) return { kind: special.dataset.kind, text: special.dataset.text, firstKind, hearts: document.body.dataset.hearts };
      const normal = document.querySelector('.ship[data-kind="ship"], .ship[data-kind="mother"], .ship[data-kind="child"]');
      if (normal) type(normal);
      if (document.querySelector(".overlay")) break;
      step(50);
    }
    return { kind: null, firstKind, hearts: document.body.dataset.hearts };
  }, { random, hurt });
}

async function calibrationAndSpecials() {
  const game = await openGame("juegos/teclado.html");
  const { page } = game;
  await page.setViewportSize({ width: 1516, height: 694 });
  await installFrameClock(page);
  await page.reload();
  await chooseGrade(page, 1);
  for (let level = 0; level < 4; level++) {
    const measured = await measureLevel(page);
    if (measured) console.log(`calibration 1º level ${level + 1}: interval 4.00s, fall ${measured.fall.toFixed(2)}s`);
    check(!!measured && Math.abs(measured.interval - 4) < 0.15 && Math.abs(measured.speed - 22 * (1 + 0.12 * level)) < 0.2, `S9 1º level ${level + 1}: original interval and speed unchanged`);
    const result = await finishWithClock(page);
    if (result.finished && await page.locator(".overlay").count()) await pressPlay(page);
  }
  await page.reload();
  await chooseGrade(page, 5);
  const immediate = await page.evaluate(() => {
    window.advanceFrames(50);
    const first = document.querySelector(".ship");
    for (const key of first.dataset.text) window.dispatchEvent(new KeyboardEvent("keydown", { key }));
    window.advanceFrames(50);
    return !!document.querySelector(".ship");
  });
  check(immediate, "S9 empty sky spawns immediately instead of waiting for the interval");
  for (const grade of [2, 3, 4, 5, 6]) {
    await page.reload();
    await chooseGrade(page, grade);
    for (let level = 0; level < 4; level++) {
      const pool = pools[grade === 4 ? 3 : grade === 6 ? 5 : grade][level];
      const expected = pool.reduce((n, word) => n + word.length, 0) / pool.length * 12 / demand[grade][level];
      console.log(`calibration ${grade}º level ${level + 1}: interval ${expected.toFixed(2)}s, fall ${(expected * 2).toFixed(2)}s`);
      const measured = await measureLevel(page);
      check(!!measured && Math.abs(measured.interval - expected) < 0.16, `S9 ${grade}º level ${level + 1}: spawn interval matches ${demand[grade][level]} WPM`);
      check(!!measured && Math.abs(measured.fall - 2 * expected) < 0.25, `S9 ${grade}º level ${level + 1}: fall lasts twice the interval`);
      check(!!measured && measured.initialCount === 1, `S9 ${grade}º level ${level + 1}: no double wave`);
      const result = await finishWithClock(page);
      check(result.finished, `S9 ${grade}º level ${level + 1}: finishes through keyboard`);
      if (grade >= 5 && level < 3) {
        const pattern = level === 0 ? /^[a-zñ]{5,7}$/ : level === 1 ? /^(?=.{5,7}$)(?=.*(?:ñ|j|g|z|ll|rr))[a-zñ]+$/ : /^[A-Z][a-zñ]{4,6}$/;
        check(result.seen.length > 0 && result.seen.every((word) => pattern.test(word)), `S9 ${grade}º level ${level + 1}: short unaccented content`);
      }
      if (result.finished && await page.locator(".overlay").count()) await pressPlay(page);
    }
  }
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.reload();
  await chooseGrade(page, 5);
  const small = await measureLevel(page);
  const expectedSmall = pools[5][0].reduce((n, t) => n + t.length, 0) / pools[5][0].length * 12 / 10;
  check(!!small && Math.abs(small.fall - 2 * expectedSmall) < 0.25, "S9 fall time holds at 1024x600");

  await page.setViewportSize({ width: 1516, height: 694 });
  const found = {};
  for (const random of [0.01, 0.26, 0.51, 0.76]) {
    const probe = await probeSpecial(page, random);
    if (probe.kind) found[probe.kind] = random;
    check(probe.firstKind === "ship", `S10 no special as first ship (${random})`);
  }
  for (const kind of ["heart", "ice", "bomb", "meteor"]) check(kind in found, `S10 ${kind}: appears as a distinguishable object`);

  for (const kind of ["heart", "ice", "bomb", "meteor"]) {
    if (!(kind in found)) continue;
    const probe1 = await probeSpecial(page, found[kind], 1);
    check(probe1.kind === kind && /^[a-z]$/.test(probe1.text), `S10 ${kind}: 1º carries one letter`);
    const probe2 = await probeSpecial(page, found[kind]);
    const expected = { heart: "vida", ice: "hielo", bomb: "bomba" }[kind];
    check(probe2.kind === kind && (kind === "meteor" ? /^[a-z]$/.test(probe2.text) : probe2.text === expected), `S10 ${kind}: 2º uses the expected text`);
    const svg = await page.locator(`.ship[data-kind="${kind}"] svg`).count();
    check(svg > 0, `S10 ${kind}: visible vector artwork`);
    const landed = await page.evaluate((kind) => {
      const el = document.querySelector(`.ship[data-kind="${kind}"]`);
      const before = document.body.dataset.hearts;
      for (let i = 0; i < 800 && el.isConnected; i++) window.advanceFrames(50);
      return !el.isConnected && document.body.dataset.hearts === before;
    }, kind);
    check(landed, `S10 ${kind}: landing never costs a heart`);
  }

  // The PNGs stay in memory: no generated files outside the allowed surfaces.
  // Print a pixel-derived crop so the actual screenshot artwork can be inspected.
  for (const kind of ["heart", "meteor"]) {
    if (!(kind in found)) continue;
    // Pick the middle of the same random bucket to keep the subject away from
    // the screen edge; let the previous shots' particles finish naturally.
    await probeSpecial(page, (Math.floor(found[kind] * 4) + 0.5) / 4, 5);
    await page.waitForTimeout(1100);
    const png = await page.screenshot();
    const preview = await page.evaluate(async ({ base64, kind }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${base64}`;
      await img.decode();
      const box = document.querySelector(`.ship[data-kind="${kind}"]`).getBoundingClientRect();
      const canvas = document.createElement("canvas");
      canvas.width = 36; canvas.height = 36;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, Math.max(0, box.left - 5), Math.max(0, box.top - 5), box.width + 10, box.height + 10, 0, 0, 36, 36);
      const render = (surface) => {
        const pixels = surface.getContext("2d").getImageData(0, 0, surface.width, surface.height).data;
        const rows = [];
        for (let y = 0; y < surface.height; y++) {
          let row = "";
          for (let x = 0; x < surface.width; x++) {
            const i = (y * surface.width + x) * 4, r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
            row += r < 30 && g < 55 ? "#" : r > 215 && g > 205 && b > 180 ? "W"
              : r > 180 && g < 155 ? "R" : r > 200 && g > 120 && b < 140 ? "Y"
              : b > r * 1.2 && b > 130 ? "P" : r > 160 && b > 160 ? "P" : " ";
          }
          rows.push(row);
        }
        return rows;
      };
      const overview = document.createElement("canvas");
      overview.width = 76; overview.height = 35;
      overview.getContext("2d").drawImage(img, 0, 0, 76, 35);
      return { width: img.width, height: img.height, inside: box.left >= 0 && box.right <= img.width && box.top >= 0 && box.bottom <= img.height, rows: render(canvas), overview: render(overview) };
    }, { base64: png.toString("base64"), kind });
    console.log(`screenshot ${kind} at ${preview.width}x${preview.height} (W light, R red, Y yellow, P purple/blue, # outline):\n${preview.overview.join("\n")}\nobject crop:\n${preview.rows.join("\n")}`);
    check(preview.width === 1516 && preview.height === 694 && preview.inside, `S10 ${kind}: 5º screenshot contains the complete object`);
  }

  if ("heart" in found) {
    await probeSpecial(page, found.heart);
    const bonus = await page.evaluate(() => {
      const before = Number(document.querySelector("#stats").textContent.match(/\d+/)[0]);
      const el = document.querySelector('.ship[data-kind="heart"]');
      for (const key of el.dataset.text) window.dispatchEvent(new KeyboardEvent("keydown", { key }));
      return { hearts: document.body.dataset.hearts, delta: Number(document.querySelector("#stats").textContent.match(/\d+/)[0]) - before };
    });
    check(bonus.hearts === "3" && bonus.delta > 40, "S10 heart at full health gives bonus points without exceeding three");
    await probeSpecial(page, found.heart, 2, true);
    const healing = await page.evaluate(() => {
      const before = document.body.dataset.hearts, el = document.querySelector('.ship[data-kind="heart"]');
      if (el) for (const key of el.dataset.text) window.dispatchEvent(new KeyboardEvent("keydown", { key }));
      return [before, document.body.dataset.hearts];
    });
    check(healing[0] === "2" && healing[1] === "3", "S10 heart restores a lost heart");
  } else {
    check(false, "S10 heart restores a lost heart");
  }

  for (const kind of ["ice", "bomb"]) {
    if (!(kind in found)) { check(false, `S10 ${kind}: effect on ordinary ships`); continue; }
    await probeSpecial(page, found[kind]);
    const effect = await page.evaluate((kind) => {
      const step = window.advanceFrames;
      for (let i = 0; i < 400 && !document.querySelector('.ship[data-kind="ship"]'); i++) step(50);
      const special = document.querySelector(`.ship[data-kind="${kind}"]`);
      const normal = document.querySelector('.ship[data-kind="ship"]');
      if (!special || !normal) return null;
      const starts = [...document.querySelectorAll(".ship")].map((el) => el.dataset.text[0].toLowerCase());
      const maxSpecials = document.querySelectorAll('.ship[data-kind]:not([data-kind="ship"])').length;
      const before = document.querySelectorAll(".progress span.on").length;
      for (const key of special.dataset.text) window.dispatchEvent(new KeyboardEvent("keydown", { key }));
      if (kind === "bomb") return { starts, maxSpecials, gone: !normal.isConnected, gained: document.querySelectorAll(".progress span.on").length - before };
      const top = normal.getBoundingClientRect().top;
      const frozenLook = getComputedStyle(normal).filter !== "none" || normal.classList.contains("frozen");
      step(4500);
      const still = normal.getBoundingClientRect().top;
      step(1000);
      return { starts, maxSpecials, frozenLook, still: Math.abs(still - top) < 0.1, resumed: normal.getBoundingClientRect().top > still };
    }, kind);
    check(!!effect && new Set(effect.starts).size === effect.starts.length && effect.maxSpecials === 1, `S10 ${kind}: unique first letters and at most one special`);
    check(!!effect && (kind === "bomb" ? effect.gone && effect.gained === 1 : effect.frozenLook && effect.still && effect.resumed), `S10 ${kind}: effect on ordinary ships`);
  }

  if ("meteor" in found) {
    await probeSpecial(page, found.meteor);
    const meteor = await page.evaluate(() => {
      const el = document.querySelector('.ship[data-kind="meteor"]');
      const start = el.getBoundingClientRect();
      const hearts = document.body.dataset.hearts;
      window.advanceFrames(1000);
      const next = el.getBoundingClientRect();
      for (let i = 0; i < 400 && el.isConnected; i++) window.advanceFrames(50);
      return { dx: next.left - start.left, dy: next.top - start.top, landed: !el.isConnected, hearts, after: document.body.dataset.hearts };
    });
    check(Math.abs(meteor.dx) > 5 && meteor.dy > 50 && meteor.landed && meteor.hearts === meteor.after, "S10 meteor falls fast diagonally and landing costs no heart");
    await probeSpecial(page, found.meteor);
    const bonus = await page.evaluate(() => {
      const before = Number(document.querySelector("#stats").textContent.match(/\d+/)[0]);
      const el = document.querySelector('.ship[data-kind="meteor"]');
      window.dispatchEvent(new KeyboardEvent("keydown", { key: el.dataset.text }));
      return Number(document.querySelector("#stats").textContent.match(/\d+/)[0]) - before;
    });
    check(bonus > 10, "S10 meteor awards extra points");
  } else check(false, "S10 meteor falls fast diagonally and landing costs no heart");
  if (await page.locator(".overlay").count()) await pressPlay(page);
  await finish(game);
}

async function virtualTypists() {
  const game = await openGame('juegos/teclado.html');
  const { page } = game;
  await page.setViewportSize({ width: 1516, height: 694 });
  await installFrameClock(page);
  for (const random of [0.01, 0.13, 0.26, 0.39, 0.51, 0.64, 0.76, 0.89]) {
    await page.reload();
    await chooseGrade(page, 5);
    const result = await page.evaluate((random) => {
      window.randomValue = random;
      let elapsed = 0;
      const trace = [];
      while (elapsed < 85000 && document.body.dataset.hearts === '3' && document.body.dataset.level === '0') {
        let list = [...document.querySelectorAll('.ship')];
        if (!list.length) { window.advanceFrames(50); elapsed += 50; continue; }
        list.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
        const target = list[0], text = target.dataset.text;
        trace.push(`${target.dataset.kind}:${text}`);
        for (const key of text) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key }));
          window.advanceFrames(1200);
          elapsed += 1200;
          if (document.body.dataset.hearts !== '3' || document.body.dataset.level !== '0') break;
        }
      }
      return { hearts: document.body.dataset.hearts, level: document.body.dataset.level, trace };
    }, random);
    check(result.hearts === '3' && result.level === '1', `S9 5º 10 WPM virtual typist seed ${random}${result.hearts !== '3' ? ` (${result.trace.join(', ')})` : ''}`);
  }
  await game.browser.close();
}

async function realTypist() {
  const game = await openGame("juegos/teclado.html");
  const { page } = game;
  await page.setViewportSize({ width: 1516, height: 694 });
  await chooseGrade(page, 5);
  const deadline = Date.now() + 85000;
  while (Date.now() < deadline && await data(page, "hearts") === "3" && await data(page, "level") === "0" && !await page.locator(".overlay").count()) {
    await page.waitForSelector(".ship", { timeout: 3000 });
    const text = await page.$$eval(".ship", (list) => list.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0].dataset.text);
    for (const ch of text) {
      await typeChar(page, ch);
      await page.waitForTimeout(1200); // 50 characters/minute = 10 WPM
      if (await data(page, "hearts") !== "3" || await data(page, "level") !== "0" || await page.locator(".overlay").count()) break;
    }
  }
  check(await data(page, "hearts") === "3" && await data(page, "level") === "1", "S9 5º real-time 10 WPM typist completes level 1 without losing a heart");
  if (await page.locator(".overlay").count()) await pressPlay(page);
  await finish(game);
}

// S12-S14 are exercised through the rendered page and keyboard, including
// an accelerated frame clock for landings and level transitions.
async function arcadeContracts() {
  const game = await openGame("juegos/teclado.html");
  const { page } = game;
  await page.setViewportSize({ width: 1516, height: 694 });
  await installFrameClock(page);
  await chooseGrade(page, 1);
  check(await page.locator('.trophy-slot[data-filled="false"]').count() === 4, "S12 four empty trophy slots from the start");
  check((await page.locator('.trophy-slot').evaluateAll((els) => els.map((el) => el.dataset.award))).join(',') === 'bronze,silver,gold,cup', "S12 bronze, silver, gold and trophy order");
  check(await page.locator('#streak').count() === 1 && /×1/.test(await page.locator('#streak').textContent().catch(() => '')), "S13 visible streak and initial multiplier for 1º");
  check(await page.locator('#stats').isVisible() && /Puntos/.test(await page.locator('#stats').textContent()), "S13 1º live points");
  check(await page.locator('#level-badge').count() === 1 && /1/.test(await page.locator('#level-badge').textContent().catch(() => '')), "S13 visible level badge");
  check(await page.locator('#shield').count() === 1, "S13 shield replaces hearts");
  const first = await finishWithClock(page);
  const level = await data(page, 'level');
  check(first.finished && level === '1' && await page.locator('.overlay').count() === 0, "S13 next level starts without blocking overlay");
  check(await page.locator('#level-banner').count() === 1 && /Nivel 2/.test(await page.locator('#level-banner').textContent().catch(() => '')), "S13 next-level banner appears during play");
  check(await page.locator('.trophy-flight').count() === 1, "S12 award flies without blocking play");
  const playable = await page.evaluate(() => {
    window.advanceFrames(50);
    const el = document.querySelector('.ship');
    if (el) window.dispatchEvent(new KeyboardEvent('keydown', { key: el.dataset.text[0] }));
    return !!document.querySelector('.trophy-flight') && document.querySelectorAll('.progress span.on').length === 1;
  });
  check(playable, 'S12 typing works while the award flies');
  check(await page.locator('.ship[data-kind="mother"]').count() === 0, 'S14 no mother ship in 1º');
  for (let i = 0; i < 2; i++) await finishWithClock(page);
  for (const [width, height] of [[1024, 600], [1366, 657], [1516, 694], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const els = ['.home-btn', '.progress', '.trophies', '#stats', '#level-badge', '#streak'];
      const boxes = els.map((selector) => document.querySelector(selector).getBoundingClientRect());
      const inside = (r) => r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
      const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      return boxes.every(inside) && boxes.every((a, i) => boxes.slice(i + 1).every((b) => apart(a, b)));
    });
    check(layout, `S13 12-star header and panels do not overlap at ${width}x${height}`);
  }
  for (const [width, height] of [[1024, 600], [1366, 657], [1516, 694], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    for (const random of [0.01, 0.99]) {
      await page.reload();
      await chooseGrade(page, 5);
      const clear = await page.evaluate((random) => {
        window.randomValue = random;
        window.advanceFrames(50);
        const ship = document.querySelector('.ship').getBoundingClientRect();
        const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
        return ['.home-btn', '.progress', '.trophies', '#stats', '#level-badge', '#streak'].every((selector) => apart(ship, document.querySelector(selector).getBoundingClientRect()));
      }, random);
      check(clear, `S13 new ship clears HUD at ${width}x${height}, seed ${random}`);
    }
  }
  await page.setViewportSize({ width: 1516, height: 694 });
  if (await page.locator('.overlay').count()) await pressPlay(page);
  await page.reload();
  await chooseGrade(page, 1);
  const impact = await page.evaluate(() => {
    for (let i = 0; i < 1000 && document.body.dataset.hearts === '3'; i++) window.advanceFrames(50);
    const bar = document.querySelector('#shield');
    return { hearts: document.body.dataset.hearts, shield: bar && bar.getAttribute('aria-valuenow'), impact: document.querySelector('#cannon')?.classList.contains('impact') };
  });
  check(impact.hearts === '2' && impact.shield === '2', "S13 shield drops on impact");
  check(impact.impact && await page.locator('.impact-ship').count() > 0, "S13 landing flies into and flashes the cannon");
  check(await page.locator('#shield').getAttribute('data-state') === 'warning' && await page.locator('#shield-fill').evaluate((el) => Math.abs(parseFloat(el.style.width) - 200 / 3) < 0.1), 'S13 two hearts show a two-thirds orange shield');
  const low = await page.evaluate(() => {
    for (let i = 0; i < 1500 && document.body.dataset.hearts === '2'; i++) window.advanceFrames(50);
    return [document.body.dataset.hearts, document.querySelector('#shield').dataset.state, document.querySelector('#shield-fill').style.width];
  });
  check(low[0] === '1' && low[1] === 'danger' && Math.abs(parseFloat(low[2]) - 100 / 3) < 0.1, 'S13 last heart shows a one-third red shield');
  await page.reload();
  await chooseGrade(page, 3);
  const live3 = await page.locator('#stats').textContent();
  check(/Precisión/.test(live3) && /pulsaciones/i.test(live3), "S13 3º live accuracy and keystrokes per minute");
  await page.reload();
  await chooseGrade(page, 5);
  const live5 = await page.locator('#stats').textContent();
  check(/Precisión/.test(live5) && /palabras/i.test(live5) && /máximo/i.test(live5), "S13 5º live accuracy, WPM and peak");
  const streaks = await page.evaluate(() => {
    const values = [];
    for (let n = 0; n < 20; n++) {
      window.advanceFrames(50);
      const el = document.querySelector('.ship');
      const key = el.dataset.text[Number(el.dataset.typed)];
      window.dispatchEvent(new KeyboardEvent('keydown', { key }));
      if (n === 9 || n === 19) values.push(document.querySelector('#streak').textContent);
    }
    window.advanceFrames(50);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
    values.push(document.querySelector('#streak').textContent);
    return values;
  });
  check(/×1\.5/.test(streaks[0]) && /×2/.test(streaks[1]) && /Racha: 0.*×1/.test(streaks[2]), 'S13 multiplier rises at 10 and 20 correct keys and resets on a mistake');

  for (const grade of [2, 3, 4, 5, 6]) {
    await page.reload();
    await chooseGrade(page, grade);
    const mother = await page.evaluate(() => {
      const type = (el) => { for (const key of el.dataset.text) window.dispatchEvent(new KeyboardEvent('keydown', { key })); };
      for (let i = 0; i < 2; i++) { window.advanceFrames(50); const el = document.querySelector('.ship[data-kind="ship"]'); if (el) type(el); }
      window.advanceFrames(50);
      return !!document.querySelector('.ship[data-kind="mother"]');
    });
    check(mother, `S14 mother ship appears in ${grade}º`);
    if (grade !== 5 || !mother) continue;
    const launch = await page.evaluate(() => {
      const mother = document.querySelector('.ship[data-kind="mother"]');
      let elapsed = 0;
      for (; elapsed < 20000 && !document.querySelector('.ship[data-kind="child"]'); elapsed += 50) window.advanceFrames(50);
      const child = document.querySelector('.ship[data-kind="child"]');
      if (!child) return null;
      const motherBox = mother.getBoundingClientRect(), childBox = child.getBoundingClientRect();
      const motherArt = mother.querySelector('svg').getBoundingClientRect(), childArt = child.querySelector('svg').getBoundingClientRect();
      const length = child.dataset.text.length, motherText = mother.dataset.text;
      const initials = [...document.querySelectorAll('.ship')].map((el) => el.dataset.text[0].toLowerCase());
      window.advanceFrames(1000);
      elapsed += 1000;
      const motherDy = mother.getBoundingClientRect().top - motherBox.top;
      const childDy = child.getBoundingClientRect().top - childBox.top;
      for (const key of child.dataset.text) window.dispatchEvent(new KeyboardEvent('keydown', { key }));
      for (; elapsed < 25000 && mother.isConnected && !document.querySelector('.ship[data-kind="child"]'); elapsed += 50) window.advanceFrames(50);
      const next = !!document.querySelector('.ship[data-kind="child"]');
      const before = Number(document.querySelector('#stats').textContent.match(/\d+/)[0]);
      const particles = document.querySelectorAll('.particle').length;
      for (const key of motherText) window.dispatchEvent(new KeyboardEvent('keydown', { key }));
      const after = Number(document.querySelector('#stats').textContent.match(/\d+/)[0]);
      const multiplier = Number(document.querySelector('#streak strong').textContent.slice(1));
      return { length, motherLength: motherText.length, motherWidth: motherArt.width, childWidth: childArt.width, motherDy, childDy, initials, elapsed, next, delta: after - before, multiplier, burst: document.querySelectorAll('.particle').length - particles };
    });
    check(!!launch && launch.motherWidth > launch.childWidth && launch.motherLength > launch.length && launch.childDy > launch.motherDy, 'S14 mother is bigger and slower than its short-word child');
    check(!!launch && new Set(launch.initials).size === launch.initials.length && launch.next && launch.elapsed + 0.15 >= (launch.motherLength + launch.length) * 12 / 10 * 1000, 'S14 launches use unique initials and pay the WPM character budget');
    check(!!launch && launch.delta === launch.motherLength * 20 * launch.multiplier && launch.burst >= 20, 'S14 mother gives double points and a larger explosion');
  }
  await page.reload();
  await chooseGrade(page, 1);
  await page.evaluate(() => {
    document.querySelector('.trophies').remove();
    window.testTrophies = Juegos.trophies(4);
    window.awardDone = false;
    window.testTrophies.award(0, { blocking: false }).then(() => { window.awardDone = true; });
  });
  check(await page.locator('.overlay').count() === 0 && await page.locator('.trophy-flight').count() === 1, 'S12 public non-blocking award shows a flight without an overlay');
  await page.waitForFunction(() => window.awardDone, null, { polling: 100 });
  check(await page.locator('.trophy-slot').first().getAttribute('data-filled') === 'true' && await page.locator('.trophy-flight').count() === 0, 'S12 non-blocking promise resolves after the slot fills');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.testTrophies.award(1, { blocking: false }));
  check(await page.locator('.trophy-slot').nth(1).getAttribute('data-filled') === 'true' && await page.locator('.trophy-flight').count() === 0 && await page.locator('.overlay').count() === 0, 'S12 reduced-motion non-blocking award fills immediately');
  await page.evaluate(() => { window.awardDone = false; window.testTrophies.award(2, { text: 'Resultado' }).then(() => { window.awardDone = true; }); });
  check(await page.locator('.overlay .overlay-text').textContent() === 'Resultado' && !await page.evaluate(() => window.awardDone), 'S12 default trophy API still blocks on the celebration');
  await page.locator('.overlay .play-btn').click({ force: true });
  await page.waitForFunction(() => window.awardDone, null, { polling: 100 });
  check(await page.locator('.trophy-slot').nth(2).getAttribute('data-filled') === 'true', 'S12 default award resolves after dismissal');
  await game.browser.close();
}

(async () => {
  await arcadeContracts();
  // ---------- Start screen: six grades ----------
  let game = await openGame("juegos/teclado.html");
  let { page } = game;
  const grades = await page.$$eval(".overlay .grade-btn", (list) => list.map((b) => [b.dataset.grade, b.textContent, b.getAttribute("aria-label")]));
  check(JSON.stringify(grades.map((g) => g[1])) === JSON.stringify(["1º", "2º", "3º", "4º", "5º", "6º"]), `start screen offers grades 1º-6º (${grades.map((g) => g[1])})`);
  check(grades.every((g) => g[2] === `Curso ${g[1]}`), "every grade button has a spoken name");
  check(await page.locator(".overlay .overlay-text").textContent() === "Elige tu curso", "start screen asks for the grade");

  // ---------- 1º: forgiving input, letters to words ----------
  await pressPlay(page); // the first green button is 1º
  check(await data(page, "grade") === "1", "first green button starts 1º");
  check(await page.locator("#shield").getAttribute("aria-valuenow") === "3" && await data(page, "hearts") === "3", "shield starts with three hearts");
  check(await page.locator("#stats").isVisible() && /Puntos/.test(await page.locator("#stats").textContent()), "1º shows live points");
  const first = await nextShip(page);
  check("aeiou".includes(first), `1º level 1 ship carries a vowel (${first})`);
  await page.keyboard.press("z");
  check(await score(page) === 0, "wrong key never counts");
  check(await page.locator(".ship").first().getAttribute("data-typed") === "0", "wrong key does not advance the ship");
  await page.evaluate((k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, repeat: true })), first);
  check(await score(page) === 0, "auto-repeat does not count");
  for (const k of ["Shift", "Control", "Alt", "Enter"]) await page.keyboard.press(k);
  await typeChar(page, "Dead"); // the ´ of a Spanish keyboard before its vowel
  check(await score(page) === 0, "modifiers and non-character keys do nothing");
  await page.keyboard.press(first.toUpperCase());
  check(await score(page) === 1, "1º accepts capitals for lowercase text (real key press)");

  const pools1 = [
    ["a", "e", "i", "o", "u"],
    ["m", "p", "l", "s", "t"],
    null, // syllables: checked by shape below
    null, // short words
  ];
  const goals = [5, 7, 9, 12];
  for (let level = 0; level < 4; level++) {
    check(await page.locator(".progress span").count() === goals[level], `1º level ${level + 1}: asks for ${goals[level]} ships`);
    const already = level === 0 ? 1 : 0;
    const seen = await playLevel(page, goals[level] - already, pools1[level], `1º level ${level + 1}`);
    if (level === 2) check(seen.every((t) => /^[mplst][aeiou]$/.test(t)), `1º level 3 ships carry simple syllables (${seen.join(" ")})`);
    if (level === 3) check(seen.every((t) => t.length >= 3 && t.length <= 4 && /^[a-z]+$/.test(t)), `1º level 4 ships carry 3-4 letter words (${seen.join(" ")})`);
    await page.waitForFunction((index) => document.querySelectorAll('.trophy-slot')[index]?.dataset.filled === 'true', level);
    check(await page.locator('.trophy-slot').nth(level).getAttribute('data-award') === ['bronze', 'silver', 'gold', 'cup'][level], `1º level ${level + 1}: correct trophy`);
    if (level < 3) {
      check(await data(page, 'level') === String(level + 1) && await page.locator('.overlay').count() === 0, `1º level ${level + 1}: continues immediately`);
      check(await score(page) === 0, 'next level resets progress');
    } else {
      const text = await overlayText(page);
      check(text === '🚀 33 naves', `1º run summary shows all ships (${JSON.stringify(text)})`);
      await typeChar(page, 'a');
      check(await score(page) === goals[level], 'summary ignores typing');
      await pressPlay(page);
      check(await score(page) === 0, 'repeated level resets progress');
    }
  }
  check(await page.locator(".progress span").count() === 12, "last level repeats");
  await finish(game);

  // ---------- 2º: accents are required, score is shown ----------
  game = await openGame("juegos/teclado.html");
  page = game.page;
  await chooseGrade(page, 2);
  check(await page.locator("#stats").isVisible(), "2º shows the score while playing");
  specialPoints = 0;
  let seen = await playLevel(page, 5, null, "2º level 1");
  check(seen.every((t) => /^[a-zñ]{2}$/.test(t)), `2º level 1 ships carry syllables (${seen.join(" ")})`);
  let text = await page.locator('#stats').textContent();
  const points = seen.reduce((sum, t) => sum + t.length * 10, 0);
  check(Number(text.match(/\d+/)[0]) >= points, `2º keeps its earned score after the level (${JSON.stringify(text)})`);
  seen = await playLevel(page, 7, null, "2º level 2");
  check(seen.every((t) => /^[a-zñ]{4,5}$/.test(t)), `2º level 2 ships carry short words (${seen.join(" ")})`);
  const accented = await nextShip(page);
  check(/[áéíóú]/.test(accented), `2º level 3 ships carry accented words (${accented})`);
  const plain = accented.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  await typeText(page, plain);
  check(await score(page) === 0, `typing "${plain}" without the accent does not shoot "${accented}"`);
  await finish(game);

  // ---------- 3º: capitals and ñ, accuracy and keystrokes per minute ----------
  game = await openGame("juegos/teclado.html");
  page = game.page;
  await chooseGrade(page, 3);
  let ship = await nextShip(page);
  check(/^[a-z]{5,7}$/.test(ship), `3º level 1 ships carry 5-7 letter words (${ship})`);
  await typeChar(page, ship[0].toUpperCase());
  check(await page.locator(".ship").first().getAttribute("data-typed") === "0", "3º is case sensitive");
  // One wrong key above; then type five ships perfectly.
  let typedKeys = 0;
  specialChars = 0;
  for (let i = 0; i < 5; i++) {
    const t = await nextShip(page);
    typedKeys += t.length;
    await typeText(page, t);
  }
  text = await page.locator('#stats').textContent();
  typedKeys += specialChars;
  const accuracy = Math.round((typedKeys / (typedKeys + 1)) * 100);
  check(text.includes(`\nPrecisión: ${accuracy} %`), `3º shows accuracy ${accuracy} % (${JSON.stringify(text)})`);
  check(/\nPulsaciones\/min: \d+$/.test(text), "3º shows keystrokes per minute");
  check(!text.includes("Palabras/min"), "3º does not show words per minute");
  seen = await playLevel(page, 7, null, "3º level 2");
  check(seen.every((t) => t.includes("ñ")), `3º level 2 ships carry ñ (${seen.join(" ")})`);
  ship = await nextShip(page);
  check(/^[A-ZÁÉÍÓÚÑ]/.test(ship), `3º level 3 ships start with a capital (${ship})`);
  await typeChar(page, ship[0].toLowerCase());
  check(await page.locator(".ship").first().getAttribute("data-typed") === "0", "a lowercase first letter does not shoot a capitalized word");
  await finish(game);

  // ---------- 6º: speed, streak, record, sentences, hearts ----------
  game = await openGame("juegos/teclado.html");
  page = game.page;
  await chooseGrade(page, 6);
  check(await page.evaluate(() => localStorage.getItem("teclado-record-6")) === null, "no 6º record before playing");
  specialChars = 0;
  seen = await playLevel(page, 5, null, "6º level 1");
  check(seen.every((t) => /^[a-zñ]{5,7}$/.test(t)), `6º level 1 ships carry 5-7 unaccented lowercase letters (${seen.join(" ")})`);
  text = await page.locator('#stats').textContent();
  check(/\nPalabras\/min: \d+/.test(text), `6º live words per minute (${JSON.stringify(text)})`);
  // The speed record only starts after 10 s of play (a first-second burst is not a record).
  const peak = await page.waitForFunction(() => /\nMáximo: \d+/.test(document.querySelector("#stats").textContent), null, { timeout: 15000 }).then(() => true, () => false);
  check(peak, `6º live speed record appears after 10 s (${JSON.stringify(await page.locator("#stats").textContent())})`);
  check(text.includes(`\nPrecisión: 100 %`), "6º live accuracy");
  check(/Racha: [1-9]\d*/.test(await page.locator('#streak').textContent()), '6º live streak');
  await playLevel(page, 7, null, "6º level 2");
  await playLevel(page, 9, null, "6º level 3");
  seen = await playLevel(page, 12, null, "6º level 4");
  check(seen.every((t) => t.includes(" ")), `6º level 4 ships carry short sentences (${seen.join(" | ")})`);
  text = await overlayText(page);
  check(/\nPalabras por minuto: \d+/.test(text) && /\nRacha más larga: \d+/.test(text), '6º final summary shows WPM and best streak');
  check(text.includes('\nPrecisión: 100 %'), '6º final summary shows accuracy');
  check(text.endsWith('\n¡Nuevo récord!'), 'first 6º run is a new record');
  const record = await page.evaluate(() => localStorage.getItem('teclado-record-6'));
  check(record !== null && /^\d+$/.test(record) && text.includes(`Palabras por minuto: ${record}`), `record saved in this browser (${record})`);
  await pressPlay(page);

  // Layout: ships, cannon and stats stay on one screen.
  for (const [width, height] of [[1516, 694], [1366, 657], [1024, 600]]) {
    await page.setViewportSize({ width, height });
    await page.waitForSelector(".ship");
    // Ships settle into the new window within a frame.
    const fits = await page.waitForFunction(() => {
      const inside = (el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; };
      return document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth
        && inside(document.querySelector("#cannon")) && inside(document.querySelector("#stats"))
        && [...document.querySelectorAll(".ship")].every(inside);
    }, null, { timeout: 1000 }).then(() => true, () => false);
    check(fits, `6º fits ${width}x${height} without scrolling`);
  }

  // Hearts: every ship that lands costs one; at zero the level restarts.
  await page.waitForFunction(() => document.body.dataset.hearts === "2", null, { timeout: 30000 });
  check(await page.locator("#shield").getAttribute('data-state') === 'warning' && await page.locator('#shield').getAttribute('aria-valuenow') === '2', "a landed ship reduces the shield to orange");
  await page.waitForFunction(() => document.body.dataset.hearts === "0", null, { timeout: 30000 });
  await page.waitForSelector(".overlay");
  check((await overlayText(page)).startsWith('¡Inténtalo otra vez!\n🚀 ') && (await overlayText(page)).includes('Precisión:'), "no hearts left: try again with full summary");
  check(await page.locator(".ship").count() === 0, "ships clear when the level is lost");
  const levelBefore = await data(page, "level");
  await pressPlay(page);
  check(await data(page, "level") === levelBefore && await data(page, "hearts") === "3" && await score(page) === 0, "lost level restarts with three hearts");

  await page.emulateMedia({ reducedMotion: "reduce" });
  check(await page.locator(".ship").first().evaluate((el) => getComputedStyle(el).animationName) === "none", "reduced motion stops ship animation");
  await finish(game);

  await calibrationAndSpecials();
  await virtualTypists();
  await realTypist();
  await liveStatsStart();
  console.log(`TOTAL: ${okCount} ok, ${failCount} FAIL`);
})().catch((error) => { console.error(error); console.error(`TOTAL before error: ${okCount} ok, ${failCount} FAIL`); process.exit(1); });
