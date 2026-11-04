// Cazaburbujas: left click pops, right click does not; levels ask for 5, 7, 9 and 12 pops.
const { openGame, pressPlay, check, finish } = require("./helpers");

async function popUntilOverlay(page) {
  while (!(await page.locator(".overlay").count())) {
    const bubble = page.locator(".bubble:not(.popping)").first();
    const box = (await bubble.count()) ? await bubble.boundingBox() : null;
    if (!box || box.y < 0) {
      await page.waitForTimeout(100);
      continue;
    }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
}

(async () => {
  const game = await openGame("juegos/burbujas.html");
  const { page } = game;

  await page.mouse.click(600, 600, { button: "right" });
  check((await page.locator(".wrong-button-hint").count()) === 1, "right click shows the green-button hint");

  await pressPlay(page);
  await page.waitForSelector(".bubble");
  await page.waitForTimeout(1500);
  const first = await page.locator(".bubble:not(.popping)").first().boundingBox();
  await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2, { button: "right" });
  check((await page.locator(".progress span.on").count()) === 0, "right click does not pop a bubble");

  // Each level is longer than the one before, while bubbles get smaller.
  const goals = [5, 7, 9, 12];
  const sizes = [];
  for (let level = 1; level <= goals.length; level++) {
    const goal = goals[level - 1];
    check((await page.locator(".progress span").count()) === goal, `level ${level}: asks for ${goal} pops (${await page.locator(".progress span").count()})`);
    await page.waitForSelector(".bubble:not(.popping)");
    sizes.push(await page.locator(".bubble:not(.popping)").first().evaluate((el) => el.offsetWidth));
    await popUntilOverlay(page);
    check((await page.locator(".progress span.on").count()) === goal, `level ${level}: ${goal} stars lit`);
    check((await page.locator(".medals").textContent()).length >= level, `level ${level}: medal awarded`);
    await pressPlay(page);
  }
  check(sizes.every((size, i) => i === 0 || size < sizes[i - 1]), `bubbles get smaller every level (${sizes.join(" -> ")})`);

  await finish(game);
})();
