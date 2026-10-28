// Portal contract: game of the day, mascot and school branding.
const { openGame, check, finish } = require('./helpers');
(async () => {
  const ctx = await openGame('index.html');
  const { page } = ctx;
  check(await page.evaluate(() => typeof Portal === 'object' && typeof Portal.dailyIndex === 'function'), 'Portal.dailyIndex is public');

  // The game of the day is stable within a day, changes over days and reaches every game.
  const stats = await page.evaluate(() => {
    const day = new Date(2026, 9, 28);
    const same = Portal.dailyIndex(new Date(2026, 9, 28, 8, 0), 9) === Portal.dailyIndex(new Date(2026, 9, 28, 23, 59), 9);
    const seen = new Set();
    let inRange = true;
    for (let i = 0; i < 400; i++) {
      const d = new Date(day.getTime() + i * 86400000);
      const idx = Portal.dailyIndex(d, 9);
      if (!(idx >= 0 && idx < 9)) inRange = false;
      seen.add(idx);
    }
    return { same, inRange, seen: seen.size };
  });
  check(stats.same, 'game of the day is stable within a day');
  check(stats.inRange, 'game of the day index is always a valid game');
  check(stats.seen === 9, 'every game can be the game of the day');

  // Exactly one featured card, and it is today's game; the DOM order is untouched.
  check(await page.locator('main a.card.today').count() === 1, 'exactly one game of the day');
  check(await page.evaluate(() => {
    const cards = [...document.querySelectorAll('main a.card')];
    return cards.indexOf(document.querySelector('main a.card.today')) === Portal.dailyIndex(new Date(), cards.length);
  }), 'the featured card is the one picked for today');
  check(await page.locator('main a').last().getAttribute('href') === 'juegos/pinta.html', 'DOM order keeps Pinta el Camino last');
  check(await page.evaluate(() => document.cookie === '' && localStorage.length === 0), 'portal stores nothing in cookies or localStorage');
  check(await page.getByRole('img', { name: /Colegio San Ramón/ }).count() === 1, 'school logo is present with a text alternative');

  // The mascot hides behind a card, pops up, says something and hides again.
  check(await page.locator('.boliche').evaluate(el => getComputedStyle(el).visibility === 'hidden'), 'mascot starts hidden');
  await page.waitForSelector('.say.on', { timeout: 6000 });
  check((await page.locator('.say').textContent()).trim().length > 0, 'mascot says something');
  check(await page.locator('.boliche').evaluate(el => getComputedStyle(el).visibility === 'visible'), 'mascot is visible while talking');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.boliche')).visibility === 'hidden', null, { timeout: 8000 });
  check(true, 'mascot hides again');

  check(ctx.errors.length === 0 && ctx.external.length === 0, 'portal has no errors or external requests');
  await ctx.browser.close();
})();
