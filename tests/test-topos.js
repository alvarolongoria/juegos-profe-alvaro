// Aplasta Topos: left click whacks a visible mole. Grass, empty holes and
// right clicks never count; moles that hide are no penalty.
const { openGame, pressPlay, check, finish } = require("./helpers");

async function upMole(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".mole[data-up='1']:not(.hit)");
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
}

async function hits(page) {
  return page.locator(".progress span.on").count();
}

async function whackNext(page) {
  const before = await hits(page);
  const deadline = Date.now() + 10000;
  while ((await hits(page)) === before && Date.now() < deadline) {
    if (await page.locator(".overlay").count()) break;
    const m = await upMole(page);
    if (m) await page.mouse.click(m.x, m.y);
    else await page.waitForTimeout(50);
  }
}

(async () => {
  let game;
  try {
    game = await openGame("juegos/topos.html");
    const { page } = game;
    check((await page.locator(".overlay svg").count()) >= 1, "start screen shows an SVG mole");
    check(await page.locator(".start-mole .face-ok").isVisible(), "start mole shows friendly eyes");
    check(await page.locator(".start-mole .face-hit").isHidden(), "start mole hides the hit face and stars");
    check((await page.locator(".hole").count()) === 6, "six holes");
    await pressPlay(page);

    // Grass and right clicks do nothing.
    await page.mouse.click(683, 740);
    await page.waitForFunction(() => document.querySelector(".mole[data-up='1']"));
    const m = await upMole(page);
    await page.mouse.click(m.x, m.y, { button: "right" });
    check((await hits(page)) === 0, "grass and right clicks do not count");

    // A mole that hides on its own is no penalty.
    const show1 = Number(await page.locator("body").getAttribute("data-show"));
    await page.waitForTimeout(show1 + 300);
    check((await hits(page)) === 0, "a mole that hides on its own changes nothing");

    for (let level = 1; level <= 2; level++) {
      for (let n = 1; n <= 10; n++) {
        await whackNext(page);
        if (n < 10) check((await hits(page)) === n, `level ${level}: hit ${n} counts once`);
        if (level === 1 && n === 1) {
          check((await page.locator(".mole.hit").count()) >= 1, "a whacked mole shows a dizzy face");
          check(await page.locator(".mole.hit .face-hit").first().isVisible(), "gameplay hit face is visible");
          check(await page.locator(".mole.hit .face-ok").first().isHidden(), "gameplay hit hides friendly eyes");
          check((await page.locator(".particle").count()) >= 1, "a hit bursts into sparkles");
        }
      }
      await page.waitForSelector(".overlay");
      check((await page.locator(".medals").textContent()) === "🏅".repeat(level), `level ${level}: medal awarded`);
      await pressPlay(page);
    }
    const show3 = Number(await page.locator("body").getAttribute("data-show"));
    check(show3 < show1, `moles stay up for less time each level (${show1} -> ${show3} ms)`);
    check(Number(await page.locator("body").getAttribute("data-max")) === 2, "level 3: up to two moles at once");

    await page.emulateMedia({ reducedMotion: "reduce" });
    check(
      await page.locator(".cloud").first().evaluate((el) => getComputedStyle(el).animationName === "none"),
      "reduced motion stops the drifting clouds"
    );
    await finish(game);
  } catch (error) {
    check(false, error.message);
    if (game) await game.browser.close();
  }
})();
