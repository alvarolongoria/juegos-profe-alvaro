// Real keyboard input; DOM geometry only helps time a hop, never collects stars.
const { openGame, pressPlay, check, finish } = require("./helpers");

(async () => {
  let game;
  try {
    game = await openGame("juegos/cohete.html");
    const { page } = game;
    await pressPlay(page);
    await page.keyboard.press("Space");
    check(await page.locator("#world").getAttribute("data-state") === "ready", "SPACE before ENTER does not launch");
    await page.keyboard.press("a");
    check(await page.locator("#enter-key").evaluate(el => el.classList.contains("hint")), "wrong key hints ENTER");
    check(await page.locator(".progress span.on").count() === 0, "wrong key does not count");

    const heights = [];
    for (let level = 1; level <= 2; level++) {
      check(await page.locator("#world").getAttribute("data-state") === "ready", `level ${level}: launch pad reset`);
      check(await page.locator("#enter-key").evaluate(el => getComputedStyle(el).animationName) === "pulse", `level ${level}: ENTER keycap pulses on the pad`);
      await page.keyboard.press("Enter");
      await page.waitForSelector(".star");
      heights.push(await page.locator(".star").getAttribute("data-height"));
      await page.keyboard.press("x");
      check(await page.locator("#space-key").evaluate(el => el.classList.contains("hint")), "wrong flying key hints SPACE");
      check(await page.locator(".progress span.on").count() === 0, "wrong flying key does not count");
      // Without hopping even a low star must pass harmlessly, never count.
      await page.waitForFunction(() => Number(document.querySelector("#world").dataset.missed) > 0);
      check(await page.locator(".progress span.on").count() === 0, "ground flight cannot collect elevated stars");
      for (let success = 1; success <= 10; success++) {
        await page.waitForFunction(() => {
          const star = document.querySelector(".star");
          const rocket = document.querySelector("#rocket");
          if (!star) return false;
          const s = star.getBoundingClientRect(), r = rocket.getBoundingClientRect();
          const gap = s.x + s.width / 2 - r.x - r.width / 2;
          return gap > 90 && gap < 115 && Number(rocket.dataset.height) === 0;
        }, null, { timeout: 15000 });
        await page.keyboard.press("Space");
        check(await page.locator("#space-key").evaluate(el => el.classList.contains("lit")), "SPACE lights the long keycap");
        await page.waitForFunction(n => document.querySelectorAll(".progress span.on").length === n, success);
      }
      await page.waitForSelector(".overlay");
      check(await page.locator(".progress span.on").count() === 10, `level ${level}: ten collected stars`);
      check((await page.locator(".medals").textContent()).split("🏅").length - 1 === level, `level ${level}: medal awarded`);
      check(await page.evaluate(() => window.scrollY === 0 && document.documentElement.scrollTop === 0), "SPACE never scrolls the page");
      await pressPlay(page);
    }
    check(Number(heights[1]) > Number(heights[0]), "level two stars are higher");
    // Playwright's second down is a real repeat keydown.
    await page.keyboard.press("Enter");
    await page.keyboard.down("Space");
    const hops = await page.locator("#rocket").getAttribute("data-hops");
    await page.keyboard.down("Space");
    check(await page.locator("#rocket").getAttribute("data-hops") === hops, "held SPACE ignores auto-repeat");
    await page.keyboard.up("Space");
    await finish(game);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    if (game) await game.browser.close();
  }
})();
