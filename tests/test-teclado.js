// Teclado naves: pick a grade, type the text a ship carries to shoot it.
const { openGame: openBrowser, check, finish } = require("./helpers");

// Frame-clock checks run inside one page task, where synthetic keydown events
// have no browser default action. Model that default by delivering their text
// to the focused field unless the game cancels the keydown.
function installSyntheticKeyboard() {
  window.testKey = (key) => {
    const field = document.querySelector(".key-catcher");
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    const target = document.activeElement === field ? field : window;
    target.dispatchEvent(event);
    if (!event.defaultPrevented && target === field && key.length === 1) {
      field.value += key;
      field.dispatchEvent(new InputEvent("input", { bubbles: true, data: key, inputType: "insertText" }));
    }
  };
}
async function openGame(file) {
  const game = await openBrowser(file);
  await game.page.addInitScript(installSyntheticKeyboard);
  await game.page.evaluate(installSyntheticKeyboard);
  return game;
}

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

// Playwright's key map lacks ñ and accented vowels; the frame-clock keyboard
// supplies the value a focused field receives after the browser composes it.
const typeChar = (page, key) => page.evaluate((k) => window.testKey(k), key);

async function typeText(page, text) {
  for (const ch of text) await typeChar(page, ch);
}

const normalShip = '.ship[data-kind="ship"], .ship[data-kind="mother"], .ship[data-kind="child"], .ship[data-kind="laser"]';
const specials = '.ship[data-kind="heart"], .ship[data-kind="ice"], .ship[data-kind="bomb"], .ship[data-kind="star"]';
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
      specialPoints += text.length * 10 + (kind === "star" || (kind === "heart" && await data(page, "hearts") === "3") ? 50 : 0);
      await typeText(page, text);
    } else {
      await page.waitForSelector(".ship");
    }
  }
}

// A Chromebook composes ´ + vowel in its input method: the vowel's keydown
// carries no character and "á" only reaches a focused text field.
async function typeChromebook(page, cdp, text) {
  for (const ch of text) {
    if (!/[áéíóú]/i.test(ch)) { await typeChar(page, ch); continue; }
    await typeChar(page, "Dead");
    await cdp.send("Input.imeSetComposition", { text: "´", selectionStart: 1, selectionEnd: 1 });
    await typeChar(page, "Process");
    await cdp.send("Input.insertText", { text: ch });
  }
}

async function chromebookAccents() {
  const game = await openGame("juegos/teclado.html");
  const { page } = game;
  const cdp = await page.context().newCDPSession(page);
  await chooseGrade(page, 2);
  await playLevel(page, 5, null, "Chromebook 2º level 1");
  await playLevel(page, 7, null, "Chromebook 2º level 2");
  let word = await nextShip(page);
  while (!/[áéíóú]/.test(word)) { await typeText(page, word); word = await nextShip(page); }
  const before = await score(page);
  await typeChromebook(page, cdp, word);
  check(await score(page) === before + 1, `Chromebook accents shoot "${word}" once (´ composed by the input method)`);
  check(await page.locator(`.ship[data-text="${word}"]`).count() === 0, `Chromebook accented ship "${word}" is destroyed`);
  await finish(game);
}

// S10 (tablet task): exercise a focused desktop field with real browser input,
// including the ChromeOS sequences that cannot be assumed from one keydown.
async function chromebookDesktopS10() {
  const game = await openGame("juegos/teclado.html?debug=1");
  const { page } = game;
  const cdp = await page.context().newCDPSession(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await installFrameClock(page);

  async function start(index = null, stage = 1) {
    await page.reload();
    await chooseGrade(page, 6);
    if (index === null || stage > 0) await page.evaluate(() => window.advanceFrames(50));
    if (index !== null) {
      for (let level = 0; level < stage; level++) {
        const result = await finishWithClock(page);
        if (!result.finished) throw new Error(`S10 could not finish 6º level ${level + 1}`);
      }
      await page.evaluate((seed) => { window.randomValue = seed; window.advanceFrames(50); }, (index + 0.1) / pools[6][stage].length);
    }
    await page.waitForFunction(() => document.activeElement === document.querySelector(".key-catcher"));
    const target = await page.locator(normalShip).first().elementHandle();
    if (!target) throw new Error("S10 could not find the target ship");
    return { target, text: await target.getAttribute("data-text"), before: await score(page), stats: await vitals() };
  }
  async function vitals() {
    const text = await page.locator("#stats").textContent();
    return { hearts: await data(page, "hearts"), fallos: text.match(/Fallos: \d\/3/)?.[0], accuracy: text.match(/Precisión: .*?(?=\n|$)/)?.[0] };
  }
  async function finished(run, label) {
    const after = await vitals();
    check(!await run.target.evaluate((el) => el.isConnected) && await score(page) === run.before + 1, `Chromebook S10 ${label}: "${run.text}" is destroyed and counts once`);
    check(after.hearts === run.stats.hearts && after.fallos === run.stats.fallos && after.accuracy === "Precisión: 100 %", `Chromebook S10 ${label}: no wrong key or lost heart (${JSON.stringify(run.stats)} -> ${JSON.stringify(after)})`);
  }
  // The key events are dispatched on the focused field; the IME and committed
  // text come from Chromium itself. The vowel deliberately reports false for
  // isComposing, as some ChromeOS keyboards do.
  async function deadVowel(mark, vowel, committed) {
    await page.evaluate((key) => document.querySelector(".key-catcher").dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })), "Dead");
    await cdp.send("Input.imeSetComposition", { text: mark, selectionStart: 1, selectionEnd: 1 });
    const raw = await page.evaluate((key) => {
      const field = document.querySelector(".key-catcher");
      const event = new KeyboardEvent("keydown", { key, code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0), isComposing: false, bubbles: true, cancelable: true });
      field.dispatchEvent(event);
      return { prevented: event.defaultPrevented, typed: document.querySelector('.ship.locked')?.dataset.typed, stats: document.querySelector("#stats").textContent };
    }, vowel);
    await cdp.send("Input.insertText", { text: committed });
    return raw;
  }
  async function typeRest(text) {
    const vowels = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u" };
    for (const ch of text) {
      if (vowels[ch]) await deadVowel(ch === "ü" ? "¨" : "´", vowels[ch], ch);
      else await page.keyboard.type(ch);
    }
  }

  const mode = await page.evaluate(() => ({ touch: matchMedia("(pointer: coarse)").matches }));
  // A level is started below; the initial page is intentionally unfocused.
  check(!mode.touch, "Chromebook S10 runs as a non-touch desktop");

  let run = await start(3); // matemáticas
  check(run.text === "matemáticas", `Chromebook S10 selected the accented word (${run.text})`);
  const pos = run.text.indexOf("á");
  await page.keyboard.type(run.text.slice(0, pos));
  const raw = await deadVowel("´", "a", "á");
  check(!raw.prevented && raw.typed === String(pos) && raw.stats.includes("Fallos: 0/3"), `Chromebook S10 dead + uncomposed a: the keydown is neither consumed nor typed (${JSON.stringify(raw)})`);
  await page.keyboard.type(run.text.slice(pos + 1));
  await finished(run, "dead + uncomposed a");

  run = await start(3);
  await page.keyboard.type(run.text.slice(0, pos));
  await page.evaluate(() => {
    window.s10Direct = null;
    window.addEventListener("keydown", (event) => { if (event.key === "á") window.s10Direct = event.defaultPrevented; }, { once: true });
  });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "á", code: "KeyA", windowsVirtualKeyCode: 65, text: "á", unmodifiedText: "á" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "á", code: "KeyA", windowsVirtualKeyCode: 65 });
  check(await page.evaluate(() => window.s10Direct) === false, "Chromebook S10 direct á keydown is left to the field");
  await page.keyboard.type(run.text.slice(pos + 1));
  await finished(run, "direct á");

  run = await start(3);
  await typeChromebook(page, cdp, run.text);
  await finished(run, "existing Dead/Process IME sequence");

  // Exercise all five accented vowels, including ú in a level-4 sentence.
  for (const [stage, index, word, accent] of [[1, 0, "murciélago", "é"], [1, 2, "bolígrafo", "í"], [1, 4, "helicóptero", "ó"], [3, 11, "Me encanta la música.", "ú"]]) {
    run = await start(index, stage);
    check(run.text === word, `Chromebook S10 selected ${word} for ${accent} (${run.text})`);
    await typeRest(run.text);
    await finished(run, `dead key + ${accent}`);
  }

  run = await start(); // pingüino
  check(run.text === "pingüino", `Chromebook S10 selected the diaeresis word (${run.text})`);
  await typeRest(run.text);
  await finished(run, "¨ + u gives ü");

  run = await start();
  await page.evaluate(() => {
    window.s10Repeats = [];
    window.addEventListener("keydown", (event) => { if (event.repeat) window.s10Repeats.push({ key: event.key, prevented: event.defaultPrevented }); });
  });
  await page.keyboard.down("p");
  await page.keyboard.down("p");
  await page.keyboard.up("p");
  const repeats = await page.evaluate(() => window.s10Repeats);
  check(await run.target.getAttribute("data-typed") === "1" && repeats.length === 1 && repeats[0].prevented, `Chromebook S10 held key advances once and blocks repeat (${JSON.stringify(repeats)})`);
  await typeRest(run.text.slice(1));
  await finished(run, "held key");

  for (const mark of ["´", "`", "¨", "^"]) {
    run = await start();
    const result = await page.evaluate((key) => {
      const field = document.querySelector(".key-catcher");
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Dead", bubbles: true, cancelable: true }));
      field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      field.value = key;
      field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: key }));
      field.value = key;
      field.dispatchEvent(new InputEvent("input", { bubbles: true, data: key, inputType: "insertText" }));
      return { typed: document.querySelector(".ship")?.dataset.typed, hearts: document.body.dataset.hearts, stats: document.querySelector("#stats").textContent };
    }, mark);
    check(result.typed === "0" && result.hearts === run.stats.hearts && result.stats.includes("Fallos: 0/3"), `Chromebook S10 dead mark ${JSON.stringify(mark)} alone never types or costs a heart (${JSON.stringify(result)})`);
    await typeRest(run.text);
    await finished(run, `dead mark ${JSON.stringify(mark)} then word`);
  }

  run = await start(3);
  const fallback = await page.evaluate((text) => {
    const field = document.querySelector(".key-catcher");
    field.blur();
    const prevented = [...text.slice(0, 3)].map((key) => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    for (const modifier of ["ctrlKey", "metaKey"]) window.dispatchEvent(new KeyboardEvent("keydown", { key: "#", [modifier]: true, bubbles: true, cancelable: true }));
    for (const key of ["´", "`", "¨", "^"]) window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    const typed = document.querySelector('.ship.locked')?.dataset.typed;
    const stats = document.querySelector("#stats").textContent;
    field.focus();
    return { prevented, typed, stats };
  }, run.text);
  check(fallback.prevented.every(Boolean) && fallback.typed === "3" && fallback.stats.includes("Fallos: 0/3"), `Chromebook S10 blurred field uses keydown fallback and ignores Ctrl/Meta (${JSON.stringify(fallback)})`);
  await typeRest(run.text.slice(3));
  await finished(run, "blurred fallback");

  run = await start(8, 0); // llave: the same letter across a focus change
  check(run.text === "llave", `Chromebook S10 selected the repeated-letter word (${run.text})`);
  await page.evaluate(() => {
    const field = document.querySelector(".key-catcher");
    field.blur();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true, cancelable: true }));
    field.focus();
  });
  await page.keyboard.type("lave");
  await finished(run, "same letter after focus returns");

  await start();
  await page.evaluate(() => {
    const field = document.querySelector(".key-catcher");
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", code: "ShiftLeft", keyCode: 16, bubbles: true }));
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    field.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "´" }));
    field.dispatchEvent(new InputEvent("input", { bubbles: true, data: "´", inputType: "insertCompositionText", isComposing: true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", keyCode: 65, bubbles: true, cancelable: true }));
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "á" }));
    field.dispatchEvent(new InputEvent("input", { bubbles: true, data: "á", inputType: "insertText" }));
  });
  await page.waitForTimeout(300);
  const debug = (await page.locator("#debug-readout").textContent()).split("\n").filter((line) => line.startsWith("event "));
  check(debug.length === 6 && !debug.some((line) => line.includes("Shift")) && debug[0].includes("compositionstart") && debug[5].includes("input"), `Chromebook S10 debug keeps the six latest events in order (${JSON.stringify(debug)})`);
  check(debug.some((line) => /keydown/.test(line) && /key="a"/.test(line) && /code="KeyA"/.test(line) && /keyCode=65/.test(line) && /isComposing=false/.test(line))
    && debug.some((line) => /input/.test(line) && /data="´"/.test(line) && /inputType="insertCompositionText"/.test(line) && /isComposing=true/.test(line)),
    `Chromebook S10 debug shows key, code, keyCode, composing, data and inputType (${JSON.stringify(debug)})`);
  await finish(game);
}

// S2: in 6º every third wrong key costs a heart; 5º keeps only the broken streak.
async function errorHearts() {
  for (const grade of [6, 5]) {
    const game = await openGame("juegos/teclado.html");
    const { page } = game;
    await chooseGrade(page, grade);
    await nextShip(page);
    const stats = () => page.locator("#stats").textContent();
    // "#" starts no text, so each press is a wrong key with no ship locked.
    await typeChar(page, "#");
    await typeChar(page, "#");
    if (grade === 6) {
      check(await data(page, "hearts") === "3" && /\nFallos: 2\/3/.test(await stats()), `S2 6º two wrong keys keep the hearts and show "Fallos: 2/3" (${JSON.stringify(await stats())})`);
      await typeChar(page, "#");
      check(await data(page, "hearts") === "2", "S2 6º third wrong key costs one heart");
      check(/\nFallos: 0\/3/.test(await stats()), `S2 6º the error count starts again after the lost heart (${JSON.stringify(await stats())})`);
      for (let i = 0; i < 6; i++) await typeChar(page, "#");
      check(await data(page, "hearts") === "0" && /Inténtalo otra vez/.test(await overlayText(page)), "S2 6º losing the last heart to errors shows the try-again screen");
      await pressPlay(page);
      check(await data(page, "hearts") === "3", "S2 6º the retried level starts with full hearts");
    } else {
      await typeChar(page, "#");
      check(await data(page, "hearts") === "3" && !/Fallos/.test(await stats()), "S2 5º wrong keys never cost hearts");
    }
    await finish(game);
  }
}

// S4: the red trap ships are gone. Levels 2-4 in 5º and 6º only send ships
// that are meant to be typed, and no banner warns about red ships any more.
async function noTrapShips() {
  for (const grade of [5, 6]) {
    const game = await openGame("juegos/teclado.html");
    const { page } = game;
    await page.setViewportSize({ width: 1516, height: 694 });
    await installFrameClock(page);
    await chooseGrade(page, grade);
    for (let index = 0; index < 4; index++) {
      // Play the whole level on the frame clock, remembering every kind of
      // object that showed up and what the level banner announced.
      const seen = await page.evaluate(() => {
        const banner = document.querySelector("#level-banner");
        const start = document.body.dataset.level;
        const announced = { text: banner.textContent, warned: banner.classList.contains("warn") };
        const kinds = new Set();
        let frame = 0;
        for (; frame < 4000 && !document.querySelector(".overlay") && document.body.dataset.level === start; frame++) {
          window.randomValue = ((frame * 37) % 99 + 0.5) / 100;
          window.advanceFrames(50);
          for (const el of document.querySelectorAll(".ship")) kinds.add(el.dataset.kind);
          const target = document.querySelector(".ship");
          if (target) for (const key of target.dataset.text) window.testKey(key);
        }
        const over = !!document.querySelector(".overlay") || document.body.dataset.level !== start;
        return { level: start, announced, kinds: [...kinds], over };
      });
      check(seen.level === String(index) && seen.over && !seen.kinds.includes("trap"), `S4 ${grade}º level ${index + 1} sends only ships meant to be typed (${seen.kinds.join(" ") || "none"})`);
      if (index > 0) check(!/roja/i.test(seen.announced.text) && (index === 2 || !seen.announced.warned), `S4 ${grade}º level ${index + 1} banner never warns about red ships (${JSON.stringify(seen.announced.text)})`);
      if (await page.locator(".overlay").count()) await pressPlay(page);
    }
    await finish(game);
  }
}

// S5 (D3) + S7 (D5): level 3 of 5º and 6º sends staggered waves of three short
// accented words and announces them. S5 (D4): a bigger, glowing laser ship
// punishes a wrong key.
async function swarmsAndLaser() {
  // S9: the laser phrases are tricky (accent, ü or ñ plus signs) and 6º carries
  // longer ones than 5º, so both keep the pace of their own level.
  const average = (list) => list.reduce((n, t) => n + t.length, 0) / list.length;
  for (const grade of [5, 6]) {
    const lines = [...laserLines[grade].short, ...laserLines[grade].long];
    check(lines.every((t) => /[áéíóúüñ]/i.test(t)) && lines.some((t) => /[¿?¡!.,]/.test(t)), `S9 ${grade}º laser phrases carry accents, ü, ñ and signs (${lines.join(" | ")})`);
    if (grade === 6) check(["short", "long"].every((size) => average(laserLines[6][size]) > average(laserLines[5][size])), `S9 6º laser phrases are longer than 5º (${average(laserLines[6].short).toFixed(1)}/${average(laserLines[6].long).toFixed(1)} vs ${average(laserLines[5].short).toFixed(1)}/${average(laserLines[5].long).toFixed(1)})`);
  }
  for (const grade of [5, 6, 4]) {
    const game = await openGame("juegos/teclado.html");
    const { page } = game;
    await page.setViewportSize({ width: 1516, height: 694 });
    await installFrameClock(page);
    await chooseGrade(page, grade);
    // Levels 1 and 2 keep the old pace: no swarm words and no laser ship.
    for (let level = 0; level < 2; level++) {
      const done = await finishWithClock(page);
      check(done.finished && done.seen.length > 0 && done.seen.every((t) => !swarmWords[5].includes(t) && !swarmWords[6].includes(t)), `S5 ${grade}º level ${level + 1} sends no swarm words`);
    }
    // Play level 3 on the frame clock, typing a ship only when it is about to
    // land: the hearts stay full and the level does not end early.
    const seen = await page.evaluate(() => {
      const step = window.advanceFrames;
      const banner = document.querySelector("#level-banner");
      const out = { announced: banner.textContent, warned: banner.classList.contains("warn"), waves: [], kinds: [], laser: null, maxLasers: 0, shipArt: document.querySelector('.ship[data-kind="ship"] svg')?.innerHTML || "" };
      const known = new WeakSet(), kinds = new Set();
      for (let i = 0; i < 4000 && !out.laser && !document.querySelector(".overlay") && document.body.dataset.level === "2"; i++) {
        window.randomValue = ((i * 37) % 99 + 0.5) / 100;
        step(50);
        const ships = [...document.querySelectorAll(".ship")];
        const fresh = ships.filter((el) => !known.has(el));
        fresh.forEach((el) => known.add(el));
        ships.forEach((el) => kinds.add(el.dataset.kind));
        out.maxLasers = Math.max(out.maxLasers, document.querySelectorAll('.ship[data-kind="laser"]').length);
        if (fresh.length > 2) out.waves.push(fresh.map((el) => ({ text: el.dataset.text, top: el.getBoundingClientRect().top })));
        const laser = document.querySelector('.ship[data-kind="laser"]');
        if (laser) {
          const warning = document.querySelector("#laser-warning");
          out.laser = {
            text: laser.dataset.text,
            label: laser.getAttribute("aria-label"),
            width: laser.querySelector("svg").getBoundingClientRect().width,
            art: laser.querySelector("svg").innerHTML,
            warning: warning?.classList.contains("show") ? warning.textContent : "",
          };
          break;
        }
        const low = ships.filter((el) => el.dataset.kind !== "laser").sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
        if (low && low.getBoundingClientRect().bottom > innerHeight - 170) for (const key of low.dataset.text) window.testKey(key);
      }
      out.kinds = [...kinds];
      return out;
    });
    if (grade === 4) {
      check(!/enjambres/i.test(seen.announced) && !seen.warned, `S5 4º level 3 announces only the level (${JSON.stringify(seen.announced)})`);
      check(seen.waves.length === 0 && !seen.kinds.includes("laser"), `S5 4º level 3 has no swarms and no laser ship (${seen.kinds.join(" ")})`);
      await finish(game);
      continue;
    }
    check(/enjambres/i.test(seen.announced) && seen.warned, `S5 ${grade}º level 3 warns about the swarms (${JSON.stringify(seen.announced)})`);
    const wave = seen.waves[0] || [];
    check(wave.length === 3 && wave.every((w) => w.text.length <= 6 && /[áéíóúü]/i.test(w.text) && swarmWords[grade].includes(w.text)), `S5 ${grade}º level 3 sends waves of three short accented words (${wave.map((w) => w.text).join(" ")})`);
    check(wave.length === 3 && wave.every((w, i) => i === 0 || wave[i - 1].top - w.top >= 30), `S7 ${grade}º the wave enters staggered, each ship higher than the last (${wave.map((w) => Math.round(w.top)).join(" > ")})`);
    const big = !!seen.laser && /láser/i.test(seen.laser.label || "") && seen.laser.width >= 140 && seen.laser.art !== seen.shipArt;
    check(big && seen.maxLasers === 1, `S5 ${grade}º level 3 sends one laser ship with its own bigger drawing (${seen.laser?.text}, ${seen.laser?.width}px, ${seen.laser?.label})`);
    check(!!seen.laser && laserLines[grade].short.includes(seen.laser.text), `S9 ${grade}º the laser ship carries one of its own tricky phrases (${seen.laser?.text})`);
    check(/Nave láser/i.test(seen.laser?.warning || ""), `S9 ${grade}º the laser ship warns when it arrives (${JSON.stringify(seen.laser?.warning)})`);
    // A wrong key inside a started laser word fires its laser and costs a heart.
    const probe = await page.evaluate(() => {
      const laser = document.querySelector('.ship[data-kind="laser"]');
      if (!laser) return null;
      const text = laser.dataset.text;
      const press = (key) => window.testKey(key);
      const fallos = () => (document.querySelector("#stats").textContent.match(/Fallos: (\d)\/3/) || [])[1] ?? null;
      const hearts = () => document.body.dataset.hearts;
      const before = { hearts: hearts(), fallos: fallos() };
      press("#"); // no word started yet: the mistake is still a plain wrong key
      const untouched = { hearts: hearts(), fallos: fallos() };
      press(text[0]);
      const started = laser.dataset.typed;
      press(text[1] === "z" ? "q" : "z"); // a wrong key inside the started word
      const fired = { hearts: hearts(), fallos: fallos(), beams: document.querySelectorAll(".laser.enemy").length };
      for (const key of text.slice(1)) press(key); // finish the word, one heart lighter
      return { before, untouched, started, fired };
    });
    if (!probe) check(false, `S5 ${grade}º a wrong key inside the laser word costs exactly one heart`);
    else {
      check(probe.untouched.hearts === probe.before.hearts && (grade === 5 ? probe.untouched.fallos === null : Number(probe.untouched.fallos) === Number(probe.before.fallos) + 1), `S5 ${grade}º a wrong key with no started laser word behaves as before`);
      check(probe.started === "1" && Number(probe.before.hearts) - Number(probe.fired.hearts) === 1, `S5 ${grade}º a wrong key inside the laser word costs exactly one heart`);
      check(probe.fired.beams > 0, `S5 ${grade}º the laser ship answers with a visible laser`);
      if (grade === 6) check(probe.fired.fallos === probe.untouched.fallos, `S5 6º the laser mistake does not count towards "Fallos: n/3"`);
    }
    // Level 4 keeps the laser ship, still one at a time.
    await finishWithClock(page);
    const late = await page.evaluate(() => {
      const step = window.advanceFrames;
      const out = { found: false, max: 0, level: document.body.dataset.level, text: null, art: "" };
      for (let i = 0; i < 3000 && !out.found && !document.querySelector(".overlay") && document.body.dataset.level === "3"; i++) {
        window.randomValue = ((i * 37) % 99 + 0.5) / 100;
        step(50);
        const lasers = document.querySelectorAll('.ship[data-kind="laser"]');
        out.max = Math.max(out.max, lasers.length);
        out.found ||= lasers.length > 0;
        if (lasers.length) { out.text = lasers[0].dataset.text; out.art = lasers[0].querySelector("svg").innerHTML; }
        const low = [...document.querySelectorAll(".ship")].filter((el) => el.dataset.kind !== "laser").sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
        if (low && low.getBoundingClientRect().bottom > innerHeight - 170) for (const key of low.dataset.text) window.testKey(key);
      }
      return out;
    });
    check(late.level === "3" && late.found && late.max === 1 && laserLines[grade].long.includes(late.text) && late.art === seen.laser?.art, `S9 ${grade}º level 4 sends the laser ship with its longer tricky phrase and the same drawing (${late.text})`);
    if (await page.locator(".overlay").count()) await pressPlay(page);
    await finish(game);
  }
}

// S8 (D6): an object whose effect acts on other ships (bomb, ice) only appears
// once a ship is on screen, and always above it.
async function effectObjects() {
  const enemies = '.ship[data-kind="ship"], .ship[data-kind="mother"], .ship[data-kind="child"], .ship[data-kind="laser"]';
  const effects = '.ship[data-kind="bomb"], .ship[data-kind="ice"]';
  // 0.51 picks the bomb and 0.26 the ice, both of which act on other ships.
  for (const [grade, seed] of [[1, 0.51], [3, 0.51], [6, 0.51], [6, 0.26]]) {
    const game = await openGame("juegos/teclado.html");
    const { page } = game;
    await page.setViewportSize({ width: 1516, height: 694 });
    await installFrameClock(page);
    await chooseGrade(page, grade);
    const seen = await page.evaluate(({ enemies, effects, seed }) => {
      const step = window.advanceFrames;
      window.randomValue = seed;
      const known = new WeakSet(), spawns = [];
      for (let i = 0; i < 900 && !document.querySelector(".overlay"); i++) {
        step(50);
        const fresh = [...document.querySelectorAll(".ship")].filter((el) => !known.has(el));
        fresh.forEach((el) => known.add(el));
        // Read the screen before typing anything this frame.
        const tops = [...document.querySelectorAll(enemies)].map((el) => el.getBoundingClientRect().top);
        for (const el of fresh.filter((e) => e.matches(effects))) {
          spawns.push({ kind: el.dataset.kind, enemies: tops.length, above: tops.length > 0 && el.getBoundingClientRect().top < Math.min(...tops) });
        }
        // Empty the sky for the first frames, as a fast player would, then stop
        // so some ships are on screen when the next special objects arrive.
        const target = i < 8 && document.querySelector(enemies);
        if (target) for (const key of target.dataset.text) window.testKey(key);
      }
      return spawns;
    }, { enemies, effects, seed });
    const alone = seen.filter((s) => s.enemies === 0);
    check(alone.length === 0, `S8 ${grade}º no ${alone.map((s) => s.kind).join("/") || "bomb or ice"} appears on an empty screen`);
    check(seen.length > 0 && seen.every((s) => s.enemies >= 2 && s.above), `S8 ${grade}º every bomb or ice appears above two ships already on screen (${seen.map((s) => `${s.kind} above ${s.enemies}`).join(", ") || "none"})`);
    if (await page.locator(".overlay").count()) await pressPlay(page);
    await finish(game);
  }
}

// S10 (D9): halfway through level 4 every grade gets one announced burst of
// single-letter meteors, one after another from three directions. No new ship
// arrives meanwhile, every hit scores, and the whole burst costs one heart at most.
async function meteorShower() {
  const plan = { 1: 5, 3: 6, 5: 8 };
  const alphabet = { 1: /^[aeioumplst]$/, 3: /^[a-z]$/, 5: /^[a-zñ]$/ };
  for (const [grade, count] of Object.entries(plan)) {
    for (const shoot of [false, true]) {
      const game = await openGame("juegos/teclado.html");
      const { page } = game;
      await page.setViewportSize({ width: 1516, height: 694 });
      await installFrameClock(page);
      await chooseGrade(page, Number(grade));
      // Levels 1 to 3 send no meteors.
      await page.evaluate(() => {
        window.meteorsSeen = 0;
        new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => { if (n.dataset?.kind === "meteor") window.meteorsSeen++; })))
          .observe(document.querySelector("#sky"), { childList: true });
      });
      for (let level = 0; level < 3; level++) {
        await finishWithClock(page);
        if (await page.locator(".overlay").count()) await pressPlay(page);
      }
      const early = await page.evaluate(() => window.meteorsSeen);
      check(early === 0, `S10 ${grade}º levels 1-3 send no meteors (${early})`);
      const run = await page.evaluate(({ shoot, count }) => {
        const press = (key) => window.testKey(key);
        const notice = document.querySelector("#shower-warning");
        const score = () => Number(document.querySelector("#stats").textContent.match(/\d+/)?.[0] || 0);
        const out = { level: document.body.dataset.level, announced: "", meteors: [], shipsDuring: 0, heartsBefore: null, heartsAfter: null, scoreBefore: 0, scoreAfter: 0, resumed: false };
        const known = new WeakSet();
        let phase = "before", frame = 0;
        for (; frame < 6000 && document.body.dataset.level === "3" && !document.querySelector(".overlay"); frame++) {
          window.randomValue = ((frame * 37) % 99 + 0.5) / 100;
          window.advanceFrames(50);
          const fresh = [...document.querySelectorAll(".ship")].filter((el) => !known.has(el));
          fresh.forEach((el) => known.add(el));
          const meteors = fresh.filter((el) => el.dataset.kind === "meteor");
          if (phase === "before" && meteors.length) {
            phase = "during";
            out.announced = notice?.classList.contains("show") ? notice.textContent : "";
            out.heartsBefore = document.body.dataset.hearts;
            out.scoreBefore = score();
          }
          // The burst is over once all its meteors have come and gone.
          if (phase === "during" && out.meteors.length >= count && !document.querySelector('.ship[data-kind="meteor"]')) {
            out.heartsAfter = document.body.dataset.hearts;
            out.scoreAfter = score();
            phase = "after";
          }
          if (phase === "during") {
            out.shipsDuring += fresh.filter((el) => el.dataset.kind !== "meteor").length;
            for (const el of meteors) {
              const box = el.getBoundingClientRect();
              out.meteors.push({ text: el.dataset.text, frame, x: box.left + box.width / 2, el });
            }
            for (const m of out.meteors) {
              if (m.dx === undefined && m.el.isConnected && frame > m.frame) m.dx = m.el.getBoundingClientRect().left + m.el.getBoundingClientRect().width / 2 - m.x;
            }
            // Ships already on screen are cleared so they cost no heart here.
            for (const el of document.querySelectorAll('.ship:not([data-kind="meteor"])')) for (const key of el.dataset.text) press(key);
            // Shoot a meteor one frame after it appears, once its direction is known.
            if (shoot) for (const m of out.meteors) if (m.dx !== undefined && m.el.isConnected) press(m.text);
            continue;
          }
          if (phase === "after" && fresh.some((el) => el.dataset.kind !== "meteor")) { out.resumed = true; break; }
          // Before the burst, play the level as a fast player would.
          const target = document.querySelector('.ship:not([data-kind="meteor"])');
          if (target) for (const key of target.dataset.text) press(key);
        }
        out.meteors = out.meteors.map(({ el, ...m }) => m);
        return out;
      }, { shoot, count });
      const label = `S10 ${grade}º${shoot ? " (shooting)" : ""}`;
      check(run.level === "3" && run.meteors.length === count, `${label} level 4 sends one burst of ${count} meteors (${run.meteors.length})`);
      check(run.announced === "¡Lluvia de meteoritos!", `${label} the burst is announced (${JSON.stringify(run.announced)})`);
      check(run.meteors.every((m) => alphabet[grade].test(m.text)), `${label} every meteor is one lowercase letter of the grade (${run.meteors.map((m) => m.text).join("")})`);
      check(new Set(run.meteors.map((m) => m.frame)).size === run.meteors.length, `${label} meteors arrive one after another, never together`);
      const sides = new Set(run.meteors.map((m) => (m.dx > 2 ? "right" : m.dx < -2 ? "left" : "down")));
      check(sides.size === 3, `${label} meteors come from three directions (${[...sides].join(" ")})`);
      check(run.shipsDuring === 0, `${label} no new ship arrives during the burst (${run.shipsDuring})`);
      check(run.resumed, `${label} ships come back after the burst`);
      if (shoot) {
        check(run.heartsAfter === run.heartsBefore && run.scoreAfter > run.scoreBefore, `${label} each hit meteor scores and costs nothing (${run.scoreBefore}->${run.scoreAfter})`);
      } else {
        check(Number(run.heartsBefore) - Number(run.heartsAfter) === 1, `${label} the whole burst landing costs exactly one heart (${run.heartsBefore}->${run.heartsAfter})`);
      }
      if (await page.locator(".overlay").count()) await pressPlay(page);
      await finish(game);
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
  // 6º has its own harder content: rare letters, long accented words,
  // accented capitals and punctuated sentences.
  6: [
    "pingüino cigüeña kiwi koala wifi taxi examen boxeo llave lluvia yogur zigzag".split(" "),
    "murciélago teléfono bolígrafo matemáticas helicóptero kilómetro frigorífico miércoles extraordinario electrodoméstico informática geografía".split(" "),
    "Málaga Cádiz Córdoba Jaén León Ávila Lucía Martín Sofía Andrés Atlántico Almería".split(" "),
    ["¿Qué hora es?", "¡Qué frío hace!", "El océano Atlántico es enorme.", "Mañana iré a Málaga.", "¿Dónde está mi lápiz?", "¡Bien hecho, Lucía!", "El pingüino nada rápido.", "Hoy, después de clase, jugamos.", "¿Cómo te llamas?", "¡Cuidado con el murciélago!", "La cigüeña vuela alto.", "Me encanta la música."],
  ],
};
const demand = { 2: [4, 6, 8, 10], 3: [6, 8, 11, 14], 4: [8, 11, 14, 18], 5: [10, 14, 18, 24], 6: [12, 17, 23, 30] };
// S5 swarms: the short accented words level 3 mixes with its normal content.
const swarmWords = {
  5: "mamá papá sofá café ratón avión limón jamón camión lápiz bebé menú melón árbol".split(" "),
  6: "música lápiz cámara página física médico rápido débil fácil hélice".split(" "),
};
// S9: the tricky phrases the laser ship carries, short for level 3 and long for
// level 4, so each keeps the length of that level's normal phrases.
const laserLines = {
  5: {
    short: ["¿Piñata?", "Canción", "Cigüeña", "¡Pingüino!", "Música"],
    long: ["¿Qué pingüino ganó?", "La cigüeña bailó.", "¿Añil o canción?", "Mañana, ¡piñata!", "Hoy toco la música."],
  },
  6: {
    short: ["¿Pingüino?", "¡Cigüeña!", "Murciélago", "¿Añil?", "Kilómetro"],
    long: ["¿Quién diseñó el pingüino?", "El murciélago huyó, Lucía.", "¿Frigorífico o lavavajillas?", "Extraordinario, ¡cigüeña!", "Hoy, ¿kilómetros o millas?"],
  },
};
// How much longer a ship takes to land than typing it needs at the target:
// it shrinks level by level and stays generous for the youngest grades.
const slack = { 2: [2, 1.9, 1.75, 1.6], 3: [2, 1.8, 1.6, 1.45], 4: [2, 1.75, 1.55, 1.4], 5: [2, 1.7, 1.45, 1.35], 6: [2, 1.7, 1.45, 1.3] };

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
    for (let i = 0; i < 3000 && !document.querySelector(".overlay") && document.body.dataset.level === level; i++) {
      window.randomValue = ((i * 37) % 99 + 0.5) / 100;
      window.advanceFrames(50);
      const target = document.querySelector(".ship");
      if (!target) continue;
      if (!target.dataset.kind || target.dataset.kind === "ship") seen.push(target.dataset.text);
      for (const key of target.dataset.text) window.testKey(key);
    }
    return { seen, finished: !!document.querySelector(".overlay") || document.body.dataset.level !== level };
  });
}

async function probeSpecial(page, random, grade = 2, hurt = false, want = null) {
  await page.reload();
  await chooseGrade(page, grade);
  return page.evaluate(({ random, hurt, want }) => {
    window.randomValue = random;
    const step = window.advanceFrames;
    const type = (el) => { for (const key of el.dataset.text) window.testKey(key); };
    step(50);
    const first = document.querySelector(".ship");
    const firstKind = first?.dataset.kind || "ship";
    if (hurt) {
      for (let i = 0; i < 1600 && document.body.dataset.hearts === "3"; i++) step(50);
    }
    for (let i = 0; i < 2000; i++) {
      const special = document.querySelector(want ? `.ship[data-kind="${want}"]` : '.ship[data-kind="heart"], .ship[data-kind="ice"], .ship[data-kind="bomb"], .ship[data-kind="star"]');
      if (special) return { kind: special.dataset.kind, text: special.dataset.text, firstKind, hearts: document.body.dataset.hearts };
      // Type a ship only when it is about to land: two ships must be able to
      // share the sky, or the bomb and the ice never arrive (S8).
      const normal = [...document.querySelectorAll('.ship[data-kind="ship"], .ship[data-kind="mother"], .ship[data-kind="child"]')]
        .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
      if (normal && normal.getBoundingClientRect().bottom > innerHeight - 170) type(normal);
      if (document.querySelector(".overlay")) break;
      step(50);
    }
    return { kind: null, firstKind, hearts: document.body.dataset.hearts };
  }, { random, hurt, want });
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
    for (const key of first.dataset.text) window.testKey(key);
    window.advanceFrames(50);
    return !!document.querySelector(".ship");
  });
  check(immediate, "S9 empty sky spawns immediately instead of waiting for the interval");
  for (const grade of [2, 3, 4, 5, 6]) {
    await page.reload();
    await chooseGrade(page, grade);
    for (let level = 0; level < 4; level++) {
      const pool = pools[grade === 4 ? 3 : grade][level];
      const expected = pool.reduce((n, word) => n + word.length, 0) / pool.length * 12 / demand[grade][level];
      console.log(`calibration ${grade}º level ${level + 1}: interval ${expected.toFixed(2)}s, fall ${(expected * slack[grade][level]).toFixed(2)}s`);
      const measured = await measureLevel(page);
      check(!!measured && Math.abs(measured.interval - expected) < 0.16, `S15 ${grade}º level ${level + 1}: spawn interval matches ${demand[grade][level]} WPM`);
      check(!!measured && Math.abs(measured.fall - slack[grade][level] * expected) < 0.25, `S16 ${grade}º level ${level + 1}: fall lasts ${slack[grade][level]}x the interval`);
      check(!!measured && measured.initialCount === 1, `S9 ${grade}º level ${level + 1}: no double wave`);
      const result = await finishWithClock(page);
      check(result.finished, `S9 ${grade}º level ${level + 1}: finishes through keyboard`);
      if (grade === 5 && level < 3) {
        const pattern = level === 0 ? /^[a-zñ]{5,7}$/ : level === 1 ? /^(?=.{5,7}$)(?=.*(?:ñ|j|g|z|ll|rr))[a-zñ]+$/ : /^[A-Z][a-zñ]{4,6}$/;
        const regular = result.seen.filter((word) => !swarmWords[5].includes(word));
        check(regular.length > 0 && regular.every((word) => pattern.test(word)), `S9 ${grade}º level ${level + 1}: short unaccented content (${regular.join(" ")})`);
      }
      if (grade === 6) check(result.seen.length > 0 && result.seen.every((t) => pools[6][level].includes(t) || swarmWords[6].includes(t)), `S1 6º level ${level + 1}: own harder content (${result.seen.join(" | ")})`);
      if (result.finished && await page.locator(".overlay").count()) await pressPlay(page);
    }
  }
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.reload();
  await chooseGrade(page, 5);
  const small = await measureLevel(page);
  const expectedSmall = pools[5][0].reduce((n, t) => n + t.length, 0) / pools[5][0].length * 12 / 10;
  check(!!small && Math.abs(small.fall - slack[5][0] * expectedSmall) < 0.25, "S16 fall time holds at 1024x600");

  await page.setViewportSize({ width: 1516, height: 694 });
  const found = {};
  // Each seed drives one object: the heart and the star from the normal slot,
  // the bomb and the ice from the two-ship rule (S8), which has its own pick.
  for (const [want, random] of [["heart", 0.01], ["bomb", 0.26], ["ice", 0.51], ["star", 0.76]]) {
    const probe = await probeSpecial(page, random, 2, false, want);
    if (probe.kind) found[probe.kind] = random;
    check(probe.firstKind === "ship", `S10 no special as first ship (${random})`);
  }
  for (const kind of ["heart", "ice", "bomb", "star"]) check(kind in found, `S10 ${kind}: appears as a distinguishable object`);

  for (const kind of ["heart", "ice", "bomb", "star"]) {
    if (!(kind in found)) continue;
    const probe1 = await probeSpecial(page, found[kind], 1, false, kind);
    check(probe1.kind === kind && /^[a-z]$/.test(probe1.text), `S10 ${kind}: 1º carries one letter`);
    const probe2 = await probeSpecial(page, found[kind], 2, false, kind);
    const expected = { heart: "vida", ice: "hielo", bomb: "bomba" }[kind];
    check(probe2.kind === kind && (kind === "star" ? /^[a-z]$/.test(probe2.text) : probe2.text === expected), `S10 ${kind}: 2º uses the expected text`);
    const svg = await page.locator(`.ship[data-kind="${kind}"] svg`).count();
    check(svg > 0, `S10 ${kind}: visible vector artwork`);
    const landed = await page.evaluate((kind) => {
      const el = document.querySelector(`.ship[data-kind="${kind}"]`);
      const before = document.body.dataset.hearts;
      // Clear the enemy ships first, so only the object itself can cost a heart.
      for (const threat of [...document.querySelectorAll('.ship[data-kind="ship"], .ship[data-kind="mother"], .ship[data-kind="child"]')]) {
        for (const key of threat.dataset.text) window.testKey(key);
      }
      for (let i = 0; i < 800 && el.isConnected; i++) window.advanceFrames(50);
      return !el.isConnected && document.body.dataset.hearts === before;
    }, kind);
    check(landed, `S10 ${kind}: landing never costs a heart`);
  }

  // The PNGs stay in memory: no generated files outside the allowed surfaces.
  // Print a pixel-derived crop so the actual screenshot artwork can be inspected.
  for (const kind of ["heart", "star"]) {
    if (!(kind in found)) continue;
    // Pick the middle of the same random bucket to keep the subject away from
    // the screen edge; let the previous shots' particles finish naturally.
    await probeSpecial(page, (Math.floor(found[kind] * 4) + 0.5) / 4, 5, false, kind);
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
    await probeSpecial(page, found.heart, 2, false, "heart");
    const bonus = await page.evaluate(() => {
      const before = Number(document.querySelector("#stats").textContent.match(/\d+/)[0]);
      const el = document.querySelector('.ship[data-kind="heart"]');
      for (const key of el.dataset.text) window.testKey(key);
      return { hearts: document.body.dataset.hearts, delta: Number(document.querySelector("#stats").textContent.match(/\d+/)[0]) - before };
    });
    check(bonus.hearts === "3" && bonus.delta > 40, "S10 heart at full health gives bonus points without exceeding three");
    await probeSpecial(page, found.heart, 2, true, "heart");
    const healing = await page.evaluate(() => {
      const before = document.body.dataset.hearts, el = document.querySelector('.ship[data-kind="heart"]');
      if (el) for (const key of el.dataset.text) window.testKey(key);
      return [before, document.body.dataset.hearts];
    });
    check(healing[0] === "2" && healing[1] === "3", "S10 heart restores a lost heart");
  } else {
    check(false, "S10 heart restores a lost heart");
  }

  for (const kind of ["ice", "bomb"]) {
    if (!(kind in found)) { check(false, `S10 ${kind}: effect on ordinary ships`); continue; }
    await probeSpecial(page, found[kind], 2, false, kind);
    const effect = await page.evaluate((kind) => {
      const step = window.advanceFrames;
      for (let i = 0; i < 400 && !document.querySelector('.ship[data-kind="ship"]'); i++) step(50);
      const special = document.querySelector(`.ship[data-kind="${kind}"]`);
      const normal = document.querySelector('.ship[data-kind="ship"]');
      if (!special || !normal) return null;
      const starts = [...document.querySelectorAll(".ship")].map((el) => el.dataset.text[0].toLowerCase());
      const maxSpecials = document.querySelectorAll('.ship[data-kind="heart"], .ship[data-kind="ice"], .ship[data-kind="bomb"], .ship[data-kind="star"]').length;
      const threats = [...document.querySelectorAll('.ship[data-kind="ship"], .ship[data-kind="mother"], .ship[data-kind="child"]')].length;
      const before = document.querySelectorAll(".progress span.on").length;
      for (const key of special.dataset.text) window.testKey(key);
      if (kind === "bomb") return { starts, maxSpecials, threats, gone: threats > 0 && !document.querySelector('.ship[data-kind="ship"], .ship[data-kind="mother"], .ship[data-kind="child"]'), gained: document.querySelectorAll(".progress span.on").length - before };
      const top = normal.getBoundingClientRect().top;
      const frozenLook = getComputedStyle(normal).filter !== "none" || normal.classList.contains("frozen");
      step(4500);
      const still = normal.getBoundingClientRect().top;
      step(1000);
      return { starts, maxSpecials, frozenLook, still: Math.abs(still - top) < 0.1, resumed: normal.getBoundingClientRect().top > still };
    }, kind);
    check(!!effect && new Set(effect.starts).size === effect.starts.length && effect.maxSpecials === 1, `S10 ${kind}: unique first letters and at most one special`);
    check(!!effect && (kind === "bomb" ? effect.gone && effect.gained === effect.threats : effect.frozenLook && effect.still && effect.resumed), `S10 ${kind}: effect on ordinary ships`);
  }

  if ("star" in found) {
    await probeSpecial(page, found.star, 2, false, "star");
    const star = await page.evaluate(() => {
      const el = document.querySelector('.ship[data-kind="star"]');
      const start = el.getBoundingClientRect();
      const hearts = document.body.dataset.hearts;
      window.advanceFrames(1000);
      const next = el.getBoundingClientRect();
      for (let i = 0; i < 400 && el.isConnected; i++) window.advanceFrames(50);
      return { dx: next.left - start.left, dy: next.top - start.top, landed: !el.isConnected, hearts, after: document.body.dataset.hearts };
    });
    check(Math.abs(star.dx) > 5 && star.dy > 50 && star.landed && star.hearts === star.after, "S10 star falls fast diagonally and landing costs no heart");
    await probeSpecial(page, found.star, 2, false, "star");
    const bonus = await page.evaluate(() => {
      const before = Number(document.querySelector("#stats").textContent.match(/\d+/)[0]);
      const el = document.querySelector('.ship[data-kind="star"]');
      window.testKey(el.dataset.text);
      return Number(document.querySelector("#stats").textContent.match(/\d+/)[0]) - before;
    });
    check(bonus > 10, "S10 star awards extra points");
    // S10b: the harmless bonus is a shooting star, not a meteor, so it is
    // never confused with the meteor shower of level 4.
    await probeSpecial(page, found.star, 2, false, "star");
    const starLabel = await page.locator('.ship[data-kind="star"]').getAttribute("aria-label");
    check(/^Estrella fugaz: [a-z]$/.test(starLabel || ""), "S10b bonus is named a shooting star");
  } else check(false, "S10 star falls fast diagonally and landing costs no heart");
  if (await page.locator(".overlay").count()) await pressPlay(page);
  await finish(game);
}

async function virtualTypists() {
  const game = await openGame('juegos/teclado.html');
  const { page } = game;
  const threat = '.ship[data-kind="ship"], .ship[data-kind="mother"], .ship[data-kind="child"]';
  await page.setViewportSize({ width: 1516, height: 694 });
  await installFrameClock(page);
  for (const random of [0.01, 0.13, 0.26, 0.39, 0.51, 0.64, 0.76, 0.89]) {
    await page.reload();
    await chooseGrade(page, 5);
    const result = await page.evaluate(({ random, threat }) => {
      window.randomValue = random;
      let elapsed = 0;
      const trace = [];
      while (elapsed < 85000 && document.body.dataset.hearts === '3' && document.body.dataset.level === '0') {
        // A careful typist types the ships that can hurt, never the bonus objects.
        let list = [...document.querySelectorAll(threat)];
        if (!list.length) { window.advanceFrames(50); elapsed += 50; continue; }
        list.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
        const target = list[0], text = target.dataset.text;
        trace.push(`${target.dataset.kind}:${text}`);
        for (const key of text) {
          window.testKey(key);
          window.advanceFrames(1200);
          elapsed += 1200;
          if (document.body.dataset.hearts !== '3' || document.body.dataset.level !== '0') break;
        }
      }
      return { hearts: document.body.dataset.hearts, level: document.body.dataset.level, trace };
    }, { random, threat });
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
    await page.waitForSelector(normalShip, { timeout: 3000 });
    const text = await page.$$eval(normalShip, (list) => list.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0].dataset.text);
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
    if (el) window.testKey(el.dataset.text[0]);
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
      window.testKey(key);
      if (n === 9 || n === 19) values.push(document.querySelector('#streak').textContent);
    }
    window.advanceFrames(50);
    window.testKey('?');
    values.push(document.querySelector('#streak').textContent);
    return values;
  });
  check(/×1\.5/.test(streaks[0]) && /×2/.test(streaks[1]) && /Racha: 0.*×1/.test(streaks[2]), 'S13 multiplier rises at 10 and 20 correct keys and resets on a mistake');

  for (const grade of [2, 3, 4, 5, 6]) {
    await page.reload();
    await chooseGrade(page, grade);
    const mother = await page.evaluate(() => {
      const type = (el) => { for (const key of el.dataset.text) window.testKey(key); };
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
      for (const key of child.dataset.text) window.testKey(key);
      for (; elapsed < 25000 && mother.isConnected && !document.querySelector('.ship[data-kind="child"]'); elapsed += 50) window.advanceFrames(50);
      const next = !!document.querySelector('.ship[data-kind="child"]');
      const before = Number(document.querySelector('#stats').textContent.match(/\d+/)[0]);
      const particles = document.querySelectorAll('.particle').length;
      for (const key of motherText) window.testKey(key);
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
  await chromebookDesktopS10();
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
  seen = await playLevel(page, 5, pools[6][0], "6º level 1");
  check(seen.every((t) => /ü|k|w|x|ll|y|z/.test(t)), `S1 6º level 1 ships carry rare letters (${seen.join(" ")})`);
  text = await page.locator('#stats').textContent();
  check(/\nPalabras\/min: \d+/.test(text), `6º live words per minute (${JSON.stringify(text)})`);
  // The speed record only starts after 10 s of play (a first-second burst is not a record).
  const peak = await page.waitForFunction(() => /\nMáximo: \d+/.test(document.querySelector("#stats").textContent), null, { timeout: 15000 }).then(() => true, () => false);
  check(peak, `6º live speed record appears after 10 s (${JSON.stringify(await page.locator("#stats").textContent())})`);
  check(text.includes(`\nPrecisión: 100 %`), "6º live accuracy");
  check(/Racha: [1-9]\d*/.test(await page.locator('#streak').textContent()), '6º live streak');
  seen = await playLevel(page, 7, pools[6][1], "6º level 2");
  check(seen.every((t) => t.length >= 8), `S1 6º level 2 ships carry long words (${seen.join(" ")})`);
  // Checked before playing so the whole list counts, not just the words drawn:
  // every 6º level-3 entry must be an accented capital.
  const bareCapitals = pools[6][2].filter((t) => !/^[A-ZÁÉÍÓÚ]/.test(t) || !/[áéíóúÁÉÍÓÚ]/.test(t));
  check(bareCapitals.length === 0, `S1 6º level 3 list is made of accented capitals (missing accent: ${bareCapitals.join(" ") || "none"})`);
  seen = await playLevel(page, 9, [...pools[6][2], ...swarmWords[6]], "6º level 3");
  const capitals = seen.filter((t) => !swarmWords[6].includes(t));
  check(capitals.length > 0 && capitals.every((t) => /^[A-ZÁÉÍÓÚ]/.test(t) && /[áéíóúÁÉÍÓÚ]/.test(t)), `S1 6º level 3 ships carry accented capitals (${capitals.join(" ")})`);
  seen = await playLevel(page, 12, pools[6][3], "6º level 4");
  check(seen.every((t) => t.includes(" ") && /[¿?¡!.,]/.test(t)), `S1 6º level 4 ships carry punctuated sentences (${seen.join(" | ")})`);
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
  await chromebookAccents();
  await errorHearts();
  await noTrapShips();
  await swarmsAndLaser();
  await effectObjects();
  await meteorShower();
  console.log(`TOTAL: ${okCount} ok, ${failCount} FAIL`);
})().catch((error) => { console.error(error); console.error(`TOTAL before error: ${okCount} ok, ${failCount} FAIL`); process.exit(1); });
