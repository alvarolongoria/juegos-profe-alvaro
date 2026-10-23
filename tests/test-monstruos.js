// Real mouse drags exercise capture, rejection, snapping and level progression.
const { openGame, pressPlay, check, finish } = require('./helpers');

async function drag(page, part, target, button = 'left') {
  const box = await part.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button });
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up({ button });
}
async function center(locator) {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
(async () => {
  const game = await openGame('juegos/monstruos.html');
  const { page } = game;
  await pressPlay(page);
  await page.waitForSelector('.part:not(.placed)');
  const first = page.locator('.part:not(.placed)').first();
  const original = await center(first);
  const slot = page.locator('.slot').first();
  const target = await center(slot);
  const held = await first.boundingBox();
  await page.mouse.move(held.x + held.width / 2, held.y + held.height / 2);
  await page.mouse.down();
  await page.mouse.move(700, 300, { steps: 8 });
  check(await first.evaluate(el => el.classList.contains('held') && el.style.transform.includes('scale(1.12)')), 'held part follows the pointer and grows');
  await page.mouse.move(original.x, original.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await drag(page, first, target, 'right');
  check(await page.locator('.progress .on').count() === 0, 'right-button drag does not count');
  check(await first.evaluate(el => !el.classList.contains('placed')), 'right-button drag does not place');
  await drag(page, first, { x: 1100, y: 180 });
  await page.waitForTimeout(400);
  const returned = await center(first);
  check(Math.abs(returned.x - original.x) < 2 && Math.abs(returned.y - original.y) < 2, 'outside drop returns to tray');
  check(await page.locator('.progress .on').count() === 0, 'outside drop does not count');
  await drag(page, first, await center(page.locator('.slot').nth(1)));
  await page.waitForTimeout(400);
  check(await page.locator('.progress .on').count() === 0, 'wrong slot does not count');
  const counts = [];
  for (let level = 1; level <= 3; level++) {
    counts.push(await page.locator('.slot').count());
    for (let success = 1; success <= 10; success++) {
      await page.waitForSelector('.part:not(.placed)');
      const part = page.locator('.part:not(.placed)').first();
      const id = await part.getAttribute('data-slot');
      await drag(page, part, await center(page.locator(`.slot[data-slot="${id}"]`)));
      check(await page.locator('.progress .on').count() === success, `level ${level}: part ${success} counts once`);
      if (level === 1 && success === 3) check(await page.locator('.monster.dancing').count() === 1, 'complete monster dances');
      if (success < 10) await page.waitForFunction(() => !document.querySelector('.monster.dancing'));
    }
    await page.waitForSelector('.overlay');
    check(await page.locator('.medals').textContent() === '🏅'.repeat(Math.min(level, 2)) + (level === 3 ? '🏆' : ''), `level ${level}: correct medal`);
    await pressPlay(page);
  }
  check(counts.join(',') === '3,4,5', 'levels increase from three to five slots');
  check(await page.locator('.slot').count() === 5, 'last level repeats');
  await finish(game);
})().catch(error => { console.error(error); process.exitCode = 1; });
