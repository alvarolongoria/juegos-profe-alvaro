// Shared UI contract: exercise public helpers, not game-private state.
const { openGame, pressPlay, check, finish } = require('./helpers');
const fs = require('fs');
// Screenshots also work in a fresh checkout without the local ODD artifacts.
fs.mkdirSync('odd/visual-checks/T5', { recursive: true });
const games = [
  ['estrellas', 'Enciende las estrellas'], ['burbujas', 'Cazaburbujas'],
  ['monstruos', 'Fábrica de monstruos'], ['cohete', 'Cohete saltarín'],
  ['piano', 'Piano de letras'], ['carrera', 'Gran Carrera'],
  ['hamburgueseria', 'La Hamburguesería'], ['topos', 'Atrapa el Topo'],
  ['pinta', 'Pinta el Camino'],
];
const sizes = [[1366, 768], [1024, 600]];
(async () => {
  const portal = await openGame('index.html');
  const { page } = portal;
  check(await page.locator('main a').count() === 9, 'exactly nine game links');
  for (const [id, name] of games) {
    const link = page.getByRole('link', { name, exact: true });
    check(await link.getAttribute('href') === `juegos/${id}.html`, `${id}: accessible name and destination`);
    check(await link.locator('svg[aria-hidden="true"]').count() === 1, `${id}: original inert SVG preview`);
    check(await link.evaluate(el => { const r = el.getBoundingClientRect(); return r.width >= 100 && r.height >= 100; }), `${id}: large navigation target`);
    await link.focus();
    check(await link.evaluate(el => document.activeElement === el && getComputedStyle(el).outlineStyle !== 'none'), `${id}: visible keyboard focus`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check(await page.locator('.card').first().evaluate(el => getComputedStyle(el).transitionDuration === '0s'), 'portal respects reduced motion');
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    check(await page.locator('h1').evaluate(el => el.getBoundingClientRect().top >= 0), 'Spanish portal title visible at top');
    await page.screenshot({ path: `odd/visual-checks/T5/portal-${width}.png`, fullPage: true });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'portal has no horizontal overflow');
  }
  await page.locator('main a').last().focus();
  await Promise.all([page.waitForURL('**/juegos/pinta.html'), page.keyboard.press('Enter')]);
  check(page.url().endsWith('/juegos/pinta.html'), 'keyboard navigation opens game');
  check(portal.errors.length === 0 && portal.external.length === 0, 'portal has no errors or external requests');
  await portal.browser.close();

  for (const [id] of games) {
    const ctx = await openGame(`juegos/${id}.html`);
    await ctx.page.emulateMedia({ reducedMotion: 'reduce' });
    check(await ctx.page.locator('.play-btn').evaluate(el => getComputedStyle(el).animationName === 'none'), `${id}: reduced-motion play`);
    if (id === 'estrellas') {
      for (const [width, height] of sizes) {
        await ctx.page.setViewportSize({ width, height });
        await ctx.page.screenshot({ path: `odd/visual-checks/T5/start-${width}.png` });
      }
    }
    await pressPlay(ctx.page);
    check(await ctx.page.locator('.overlay').count() === 0, `${id}: play dismisses overlay`);
    await ctx.page.evaluate(() => {
      window.uiMedals = Juegos.medals();
      window.uiProgress = Juegos.progress(10);
      uiProgress.set(4);
    });
    check(await ctx.page.locator('.progress').last().locator('.on').count() === 4, `${id}: public progress markers`);
    for (const count of [10, 50]) {
      await ctx.page.evaluate(n => {
        for (let i = (n === 10 ? 0 : 10); i < n; i++) uiMedals.add();
      }, count);
      check(await ctx.page.locator('.medals').last().textContent() === '🏅'.repeat(count), `${id}: ${count} medal text preserved`);
      for (const [width, height] of sizes) {
        await ctx.page.setViewportSize({ width, height });
        const layout = await ctx.page.evaluate(() => {
          const rect = el => el.getBoundingClientRect();
          const home = rect(document.querySelector('.home-btn'));
          const progress = rect(document.querySelector('.progress'));
          const medals = rect([...document.querySelectorAll('.medals')].at(-1));
          const inside = r => r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
          const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
          const box = [...document.querySelectorAll('.medals')].at(-1);
          box.scrollTop = box.scrollHeight;
          return inside(home) && inside(progress) && inside(medals) && apart(home, medals) && apart(progress, medals) && medals.bottom <= 100 && ['auto', 'scroll'].includes(getComputedStyle(box).overflowY);
        });
        check(layout, `${id}: ${count} medals bounded and separate from header at ${width}x${height}`);
        if (id === 'estrellas' && count === 50) await ctx.page.screenshot({ path: `odd/visual-checks/T5/earned-${width}.png` });
        if (id === 'estrellas' && count === 10) await ctx.page.screenshot({ path: `odd/visual-checks/T5/active-${width}.png` });
      }
    }
    await finish(ctx);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
