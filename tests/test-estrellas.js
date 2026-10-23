// Hover lights stars; clicks add nothing and trails must be followed in order.
const { openGame, pressPlay, check, finish } = require('./helpers');

async function hover(page, locator) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
}

(async () => {
  let game;
  try {
    game = await openGame('juegos/estrellas.html');
    const { page } = game;
    await pressPlay(page);
    await page.evaluate(() => {
      window.starSounds = 0;
      window.hintSounds = 0;
      const star = Juegos.sound.star;
      const oops = Juegos.sound.oops;
      Juegos.sound.star = () => { window.starSounds++; star(); };
      Juegos.sound.oops = () => { window.hintSounds++; oops(); };
    });
    const sizes = [];
    for (let level = 0; level < 5; level++) {
      await page.waitForSelector('.star');
      sizes.push(await page.locator('.star').first().evaluate(el => el.offsetWidth));
      check(await page.locator('.star').count() === 10, `round ${level + 1}: ten targets`);
      await page.mouse.move(5, 400, { steps: 10 });
      await page.keyboard.press('Space');
      await page.mouse.click(5, 400);
      check(await page.locator('.progress .on').count() === 0, 'unrelated clicks and keys do not count');
      if (level >= 2) {
        check(await page.locator('.star.next').count() === 1, 'only next trail star glows');
        // Approach the last target from outside the trail, without crossing its first star.
        await page.mouse.move(1350, 740, { steps: 20 });
        const hintsBefore = await page.evaluate(() => window.hintSounds);
        await hover(page, page.locator('.star').last());
        check(await page.evaluate(() => window.hintSounds) > hintsBefore, 'out-of-order hover gives a gentle sound hint');
        check(await page.locator('.progress .on').count() === 0, 'out-of-order hover does not count');
        await page.mouse.down();
        await page.mouse.up();
        check(await page.locator('.progress .on').count() === 0, 'click cannot bypass trail order');
      }
      await hover(page, page.locator('.star').first());
      check(await page.locator('.star').first().evaluate(el => el.classList.contains('lit')), 'hover turns star golden');
      const before = await page.locator('.progress .on').count();
      await page.mouse.down();
      await page.mouse.up();
      check(await page.locator('.progress .on').count() === before, 'clicking a lit star adds nothing');
      for (let i = 1; i < 10; i++) await hover(page, page.locator('.star').nth(i));
      await page.waitForSelector('.overlay');
      check(await page.locator('.progress .on').count() === 10, `round ${level + 1}: ten successes finish level`);
      check(await page.evaluate(() => window.starSounds) === (level + 1) * 10, 'each newly lit star sounds exactly once');
      check(await page.locator('.medals').textContent() === '🏅'.repeat(Math.min(level + 1, 3)) + '🏆'.repeat(Math.max(0, level - 2)), 'medal awarded, trophy for final level');
      await pressPlay(page);
    }
    check(sizes.join(',') === '130,100,100,70,70', `sizes and final-level repeat: ${sizes}`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    check(await page.locator('.star.next').evaluate(el => getComputedStyle(el).animationName) === 'none', 'reduced motion disables trail pulse');
    await finish(game);
  } catch (error) {
    check(false, error.message);
    if (game) await game.browser.close();
  }
})();
