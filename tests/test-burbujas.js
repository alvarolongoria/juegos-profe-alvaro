// Cazaburbujas: left click pops, right click does not, 10 pops end a level.
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

  const sizes = [];
  for (let level = 1; level <= 2; level++) {
    await page.waitForSelector(".bubble:not(.popping)");
    sizes.push(await page.locator(".bubble:not(.popping)").first().evaluate((el) => el.offsetWidth));
    await popUntilOverlay(page);
    check((await page.locator(".progress span.on").count()) === 10, `level ${level}: 10 stars lit`);
    check((await page.locator(".medals").textContent()).length >= level, `level ${level}: medal awarded`);
    await pressPlay(page);
  }
  check(sizes[1] < sizes[0], `bubbles get smaller (${sizes.join(" -> ")})`);

  await finish(game);
})();
