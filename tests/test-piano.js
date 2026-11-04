// Piano: physical keys only, Spanish letters, forgiving input and four levels.
const { openGame, pressPlay, check, finish } = require("./helpers");

(async () => {
  const game = await openGame("juegos/piano.html");
  const { page } = game;
  const target = () => page.locator("#target").textContent();
  const score = () => page.locator(".progress span.on").count();
  await pressPlay(page);
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
    check(await page.locator(".medals").textContent() === "🏅".repeat(Math.min(level + 1, 3)) + (level === 3 ? "🏆" : ""), `level ${level + 1}: medal awarded`);
    if (level === 0) check([...seen].sort().join("") === "AEIOU", "level 1 shows every vowel");
    if (level === 1) check([...seen].sort().join("") === "LMPST", "level 2 shows exactly M P L S T");
    if (level === 2) check([...seen].sort().join("") === "123456789", "level 3 shows every number from 1 to 9");
    await pressKey(await target());
    check(await score() === goal, "celebration ignores keyboard input");
    await pressPlay(page);
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
  await finish(game);
})().catch(error => { console.error(error); process.exit(1); });
