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
  ['teclado', 'Naves del teclado'], ['pinta', 'Pinta el Camino'],
];
const sizes = [[1024, 600], [1366, 657], [1516, 694], [1366, 768], [1920, 1080]];
(async () => {
  const portal = await openGame('index.html');
  const { page } = portal;
  check(await page.locator('main a').count() === 10, 'exactly ten game links');
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
  for (const [width, height] of [[1366, 768], [1024, 600]]) {
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
    const p = ctx.page;
    await p.emulateMedia({ reducedMotion: 'reduce' });
    if (id === 'estrellas') {
      for (const [width, height] of sizes) {
        await p.setViewportSize({ width, height });
        await p.screenshot({ path: `odd/visual-checks/T5/start-${width}.png` });
      }
    }
    check(await p.locator('.play-btn').first().evaluate(el => getComputedStyle(el).animationName === 'none'), `${id}: reduced-motion play`);
    await pressPlay(p);
    check(await p.locator('.overlay').count() === 0, `${id}: play dismisses overlay`);
    if (id !== 'teclado') {
      const expected = ['monstruos', 'pinta'].includes(id) ? 3 : 4;
      check(await p.locator('.trophy-slot').count() === expected && await p.locator('.trophy-slot[data-filled="true"]').count() === 0, `${id}: game's own case has ${expected} empty slots`);
    }
    await p.evaluate(() => {
      // Use one isolated instance to test the same 12-star header in every game.
      document.querySelectorAll('.progress, .trophies, .medals').forEach(el => el.remove());
      window.uiTrophies = Juegos.trophies(4);
      window.uiProgress = Juegos.progress(12);
      uiProgress.set(4);
    });
    check(await p.locator('.progress .on').count() === 4, `${id}: public progress markers`);
    await p.evaluate(() => uiProgress.set(12));
    check(await p.locator('.trophy-slot').count() === 4 && await p.locator('.trophy-slot[data-filled="true"]').count() === 0, `${id}: four empty trophy slots from start`);
    for (const [width, height] of sizes) {
      await p.setViewportSize({ width, height });
      const layout = await p.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        const home = rect('.home-btn'), progress = rect('.progress'), trophies = rect('.trophies');
        const inside = r => r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
        const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
        return [home, progress, trophies].every(inside) && apart(home, progress) && apart(home, trophies) && apart(progress, trophies) && Math.max(home.bottom, progress.bottom, trophies.bottom) <= 100;
      });
      check(layout, `${id}: 12 stars, home and trophy case stay separate at ${width}x${height}`);
      if (id === 'estrellas') await p.screenshot({ path: `odd/visual-checks/T5/active-${width}.png` });
    }
    await finish(ctx);
  }

  const ctx = await openGame('juegos/piano.html');
  const p = ctx.page;
  await p.setViewportSize({ width: 1366, height: 657 });
  await pressPlay(p);
  await p.evaluate(() => {
    document.querySelectorAll('.trophies, .medals').forEach(el => el.remove());
    window.uiTrophies = Juegos.trophies(4);
  });
  const slots = p.locator('.trophy-slot');
  check(await slots.count() === 4, 'four-level case has four slots');
  check((await slots.evaluateAll(els => els.map(el => el.dataset.award))).join(',') === 'bronze,silver,gold,cup', 'four-level awards are bronze, silver, gold, cup');
  check(await slots.locator('svg').count() === 4, 'award silhouettes use visible vector artwork');
  await p.evaluate(() => { window.uiResolved = false; uiTrophies.award(0, { text: '¡Muy bien!' }).then(() => { window.uiResolved = true; }); });
  check(await p.locator('.overlay .big-emoji svg').count() === 1, 'winning shows the award large in the celebration');
  check(await p.locator('.overlay .big-emoji').evaluate(el => el.querySelector('[role="img"]')?.getAttribute('aria-label')) === 'bronce', 'large award has an accessible name');
  const screenshot = await p.screenshot({ animations: 'disabled' }); // In memory: no files outside the edit surface.
  const bronzePixels = await p.evaluate(async base64 => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const context = canvas.getContext('2d');
    context.drawImage(img, 0, 0);
    const pixels = context.getImageData(Math.round(img.width / 2 - 150), 50, 300, 300).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] >= 190 && pixels[i] <= 215 && pixels[i + 1] >= 115 && pixels[i + 1] <= 140 && pixels[i + 2] >= 55 && pixels[i + 2] <= 80) count++;
    return count;
  }, screenshot.toString('base64'));
  check(bronzePixels > 300, `headless screenshot actually renders the bronze award (${bronzePixels} colored pixels)`);
  check(await p.locator('.overlay .overlay-text').textContent() === '¡Muy bien!', 'celebration preserves result text');
  check(await slots.nth(0).getAttribute('data-filled') !== 'true', 'slot stays empty until the celebration is dismissed');
  check(await p.evaluate(() => !window.uiResolved), 'award promise waits for the celebration');
  await p.locator('.overlay .play-btn').click({ force: true });
  check(await p.locator('.trophy-flight').count() === 1, 'normal motion flies the award to the case');
  await p.waitForFunction(() => window.uiResolved);
  check(await slots.nth(0).getAttribute('data-filled') === 'true', 'flight fills the matching slot before resolving');
  check(await p.locator('.trophy-flight').count() === 0, 'flight cleans up after itself');
  await p.emulateMedia({ reducedMotion: 'reduce' });
  for (let i = 0; i < 3; i++) {
    await p.evaluate(() => { window.uiResolved = false; uiTrophies.award(3).then(() => { window.uiResolved = true; }); });
    check(await p.locator('.overlay .big-emoji svg').count() === 1, 'reduced motion still shows the award');
    await p.locator('.overlay .play-btn').click({ force: true });
    await p.waitForFunction(() => window.uiResolved);
    check(await p.locator('.trophy-flight').count() === 0, 'reduced motion skips the flight');
  }
  check(await slots.nth(3).getAttribute('data-count') === '3' && await slots.nth(3).textContent() === '×3', 'repeated final wins keep one slot with a visible count');
  check(await slots.count() === 4, 'repeated wins do not grow the case');
  await p.evaluate(() => { document.querySelector('.trophies').remove(); window.uiTrophies = Juegos.trophies(3); });
  check((await p.locator('.trophy-slot').evaluateAll(els => els.map(el => el.dataset.award))).join(',') === 'bronze,gold,cup', 'three-level case omits silver');
  await p.evaluate(() => { window.uiResolved = false; uiTrophies.award(1, { prize: 'silver', text: '2º puesto' }).then(() => { window.uiResolved = true; }); });
  check(await p.locator('.overlay .overlay-text').textContent() === '2º puesto', 'race result remains visible');
  await p.locator('.overlay .play-btn').click({ force: true });
  await p.waitForFunction(() => window.uiResolved);
  check(await p.locator('.trophy-slot').nth(1).getAttribute('data-award') === 'silver', 'race can record its actual placement prize');
  await finish(ctx);
})().catch(error => { console.error(error); process.exit(1); });
