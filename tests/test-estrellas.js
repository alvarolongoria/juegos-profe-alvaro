// Enciende las estrellas: hold the pointer on the star until its ring fills.
// Quick passes and clicks never catch it; from level 2 the star drifts.
const { openGame, pressPlay, check, finish } = require("./helpers");

async function center(page) {
  // One atomic read: the star may vanish between two separate queries.
  return page.evaluate(() => {
    const el = document.querySelector(".star-target");
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
}

async function caught(page) {
  return page.locator(".progress span.on").count();
}

async function fill(page) {
  return Number(await page.locator(".star-target").getAttribute("data-fill"));
}

// Follow the star with the pointer until one more catch is counted.
async function hold(page) {
  const before = await caught(page);
  const deadline = Date.now() + 8000;
  while ((await caught(page)) === before && Date.now() < deadline) {
    if (await page.locator(".overlay").count()) break;
    const c = await center(page);
    if (c) await page.mouse.move(c.x, c.y, { steps: 2 });
    await page.waitForTimeout(40);
  }
}

(async () => {
  let game;
  try {
    game = await openGame("juegos/estrellas.html");
    const { page } = game;
    check((await page.locator(".overlay svg").count()) >= 1, "start screen shows the SVG star");
    await pressPlay(page);
    await page.waitForSelector(".star-target");

    // Clicking far away and a quick pass do not catch the star.
    await page.mouse.click(20, 700);
    const c = await center(page);
    await page.mouse.move(c.x - 300, c.y);
    await page.mouse.move(c.x + 300, c.y, { steps: 4 });
    await page.mouse.move(20, 700);
    check((await caught(page)) === 0, "a quick pass or a click does not catch the star");

    // Holding fills the ring; leaving empties it slowly.
    await page.mouse.move(c.x, c.y);
    await page.waitForTimeout(450);
    const half = await fill(page);
    check(half > 0.2 && half < 1, `holding fills the ring (${half})`);
    await page.mouse.down();
    await page.mouse.up();
    check((await caught(page)) === 0, "clicking on the star does not speed it up");
    await page.mouse.move(20, 700);
    await page.waitForTimeout(300);
    const after = await fill(page);
    check(after < half && after > 0, `leaving empties the ring slowly (${half} -> ${after})`);

    const sizes = [];
    for (let level = 1; level <= 2; level++) {
      sizes.push(await page.locator(".star-target").evaluate((el) => el.offsetWidth));
      if (level === 2) {
        await page.mouse.move(20, 700);
        const a = await center(page);
        await page.waitForTimeout(600);
        const b = await center(page);
        check(Math.hypot(a.x - b.x, a.y - b.y) > 10, "level 2: the star drifts on its own");
      } else {
        const a = await center(page);
        await page.waitForTimeout(400);
        const b = await center(page);
        check(a.x === b.x && a.y === b.y, "level 1: the star stays still");
      }
      for (let n = 1; n <= 10; n++) {
        await hold(page);
        if (n < 10) check((await caught(page)) === n, `level ${level}: catch ${n} counts once`);
        if (level === 1 && n === 1) check((await page.locator(".particle").count()) >= 1, "a catch bursts into sparkles");
      }
      await page.waitForSelector(".overlay");
      check((await page.locator(".medals").textContent()) === "🏅".repeat(level), `level ${level}: medal awarded`);
      await pressPlay(page);
      await page.waitForSelector(".star-target");
    }
    sizes.push(await page.locator(".star-target").evaluate((el) => el.offsetWidth));
    check(sizes[0] > sizes[1] && sizes[1] > sizes[2], `the star gets smaller (${sizes})`);

    await page.emulateMedia({ reducedMotion: "reduce" });
    check(
      await page.locator(".sky-dot").first().evaluate((el) => getComputedStyle(el).animationName === "none"),
      "reduced motion stops the twinkling sky"
    );
    await finish(game);
  } catch (error) {
    check(false, error.message);
    if (game) await game.browser.close();
  }
})();
