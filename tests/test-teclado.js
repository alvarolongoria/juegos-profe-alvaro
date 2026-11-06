// Teclado naves: pick a grade, type the text a ship carries to shoot it.
const { openGame, pressPlay, check, finish } = require("./helpers");

// Playwright's key map lacks ñ and accented vowels, so dispatch the value the
// browser delivers after a Spanish dead key (´ then a gives "á").
const typeChar = (page, key) =>
  page.evaluate((k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })), key);

async function typeText(page, text) {
  for (const ch of text) await typeChar(page, ch);
}

const ships = (page) => page.$$eval(".ship", (list) => list.map((s) => s.dataset.text));
const score = (page) => page.locator(".progress span.on").count();
const data = (page, key) => page.evaluate((k) => document.body.dataset[k], key);

async function nextShip(page) {
  await page.waitForSelector(".ship");
  return (await ships(page))[0];
}

async function chooseGrade(page, grade) {
  await page.waitForSelector(".overlay .grade-btn");
  await page.click(`.overlay .grade-btn[data-grade="${grade}"]`, { force: true });
}

// Destroy `goal` ships, checking each text against the level pool.
async function playLevel(page, goal, pool, label) {
  const seen = [];
  for (let i = 0; i < goal; i++) {
    const text = await nextShip(page);
    seen.push(text);
    if (pool) check(pool.includes(text), `${label}: "${text}" belongs to its pool`);
    await typeText(page, text);
    if (i < goal - 1) check(await page.locator(".overlay").count() === 0, `${label}: no early completion`);
  }
  await page.waitForSelector(".overlay");
  return seen;
}

const overlayText = (page) => page.locator(".overlay .overlay-text").textContent();

(async () => {
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
  check(await page.locator("#lives span").count() === 3 && await data(page, "hearts") === "3", "three hearts");
  check(await page.locator("#stats").isHidden(), "1º shows no score or speed while playing");
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
    const text = await overlayText(page);
    check(text === `🚀 ${goals[level]} naves`, `1º level ${level + 1}: end shows only ships destroyed (${JSON.stringify(text)})`);
    check(await page.locator(".medals").textContent() === "🏅".repeat(Math.min(level + 1, 3)) + (level === 3 ? "🏆" : ""), `1º level ${level + 1}: medal`);
    await typeChar(page, "a");
    check(await score(page) === goals[level], "celebration ignores typing");
    await pressPlay(page);
    check(await score(page) === 0, "next level resets progress");
  }
  check(await page.locator(".progress span").count() === 12, "last level repeats");
  await finish(game);

  // ---------- 2º: accents are required, score is shown ----------
  game = await openGame("juegos/teclado.html");
  page = game.page;
  await chooseGrade(page, 2);
  check(await page.locator("#stats").isVisible(), "2º shows the score while playing");
  let seen = await playLevel(page, 5, null, "2º level 1");
  check(seen.every((t) => /^[a-zñ]{2}$/.test(t)), `2º level 1 ships carry syllables (${seen.join(" ")})`);
  let text = await overlayText(page);
  const points = seen.reduce((sum, t) => sum + t.length * 10, 0);
  check(text === `🚀 5 naves\nPuntos: ${points}`, `2º end adds the score (${JSON.stringify(text)})`);
  await pressPlay(page);
  seen = await playLevel(page, 7, null, "2º level 2");
  check(seen.every((t) => /^[a-zñ]{4,5}$/.test(t)), `2º level 2 ships carry short words (${seen.join(" ")})`);
  await pressPlay(page);
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
  for (let i = 0; i < 5; i++) {
    const t = await nextShip(page);
    typedKeys += t.length;
    await typeText(page, t);
  }
  await page.waitForSelector(".overlay");
  text = await overlayText(page);
  const accuracy = Math.round((typedKeys / (typedKeys + 1)) * 100);
  check(text.includes(`\nPrecisión: ${accuracy} %`), `3º end shows accuracy ${accuracy} % (${JSON.stringify(text)})`);
  check(/\nPulsaciones por minuto: \d+$/.test(text), "3º end shows keystrokes per minute");
  check(!text.includes("Palabras por minuto"), "3º does not show words per minute");
  await pressPlay(page);
  seen = await playLevel(page, 7, null, "3º level 2");
  check(seen.every((t) => t.includes("ñ")), `3º level 2 ships carry ñ (${seen.join(" ")})`);
  await pressPlay(page);
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
  seen = await playLevel(page, 5, null, "6º level 1");
  check(seen.every((t) => t.length >= 8), `6º level 1 ships carry long words (${seen.join(" ")})`);
  text = await overlayText(page);
  const streak = seen.join("").length;
  check(/\nPalabras por minuto: \d+/.test(text), `6º end shows words per minute (${JSON.stringify(text)})`);
  check(text.includes(`\nPrecisión: 100 %`), "6º end shows accuracy");
  check(text.includes(`\nRacha más larga: ${streak}`), `6º end shows the longest streak ${streak}`);
  check(text.endsWith("\n¡Nuevo récord!"), "first 6º result is a new record");
  const record = await page.evaluate(() => localStorage.getItem("teclado-record-6"));
  check(record !== null && /^\d+$/.test(record) && text.includes(`Palabras por minuto: ${record}`), `record saved in this browser (${record})`);
  await pressPlay(page);
  await playLevel(page, 7, null, "6º level 2");
  await pressPlay(page);
  await playLevel(page, 9, null, "6º level 3");
  await pressPlay(page);
  seen = await playLevel(page, 12, null, "6º level 4");
  check(seen.every((t) => t.includes(" ")), `6º level 4 ships carry short sentences (${seen.join(" | ")})`);
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
  check(await page.locator("#lives span.lost").count() === 1, "a landed ship costs one heart");
  await page.waitForFunction(() => document.body.dataset.hearts === "0", null, { timeout: 30000 });
  await page.waitForSelector(".overlay");
  check(await overlayText(page) === "¡Inténtalo otra vez!", "no hearts left: try again");
  check(await page.locator(".ship").count() === 0, "ships clear when the level is lost");
  const levelBefore = await data(page, "level");
  await pressPlay(page);
  check(await data(page, "level") === levelBefore && await data(page, "hearts") === "3" && await score(page) === 0, "lost level restarts with three hearts");

  await page.emulateMedia({ reducedMotion: "reduce" });
  check(await page.locator(".ship").first().evaluate((el) => getComputedStyle(el).animationName) === "none", "reduced motion stops ship animation");
  await finish(game);
})().catch((error) => { console.error(error); process.exit(1); });
