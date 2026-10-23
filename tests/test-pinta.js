// Pinta el Camino: passing the pointer over a grey zone colours it, no click
// needed. A finished drawing comes alive; three drawings end a level.
const { openGame, pressPlay, check, finish } = require("./helpers");

// A screen point that really lands on the first unpainted zone.
async function zonePoint(page) {
  return page.evaluate(() => {
    for (const zone of document.querySelectorAll(".drawing .zone:not(.painted)")) {
      const box = zone.getBBox();
      const ctm = zone.getScreenCTM();
      for (let fy = 0.5; fy < 1; fy += 0.1) {
        for (const sign of [1, -1]) {
          const y = box.y + box.height * (sign > 0 ? fy : 1 - fy);
          for (let fx = 0.1; fx < 1; fx += 0.1) {
            const x = box.x + box.width * fx;
            if (!zone.isPointInFill(new DOMPoint(x, y))) continue;
            const p = new DOMPoint(x, y).matrixTransform(ctm);
            if (document.elementFromPoint(p.x, p.y) === zone) return { x: p.x, y: p.y };
          }
        }
      }
    }
    return null;
  });
}

async function painted(page) {
  return page.locator(".drawing .zone.painted").count();
}

async function done(page) {
  return page.locator(".progress span.on").count();
}

async function paintDrawing(page) {
  const before = await done(page);
  const deadline = Date.now() + 10000;
  while ((await done(page)) === before && Date.now() < deadline) {
    if (await page.locator(".overlay").count()) break;
    const p = await zonePoint(page);
    if (p) await page.mouse.move(p.x, p.y, { steps: 3 });
    else await page.waitForTimeout(50);
  }
}

(async () => {
  let game;
  try {
    game = await openGame("juegos/pinta.html");
    const { page } = game;
    check((await page.locator(".overlay svg").count()) >= 1, "start screen shows an SVG palette");
    await pressPlay(page);
    await page.waitForSelector(".drawing .zone");

    // The pointer rests where the play button was, so a zone under it may
    // already be painted: compare against that baseline.
    await page.mouse.move(30, 740);
    const start = await painted(page);
    await page.mouse.click(30, 740);
    await page.keyboard.press("Space");
    check((await painted(page)) === start, "clicks and keys paint nothing");

    // Hovering one zone paints exactly that zone, with a visible sparkle.
    const p = await zonePoint(page);
    await page.mouse.move(p.x, p.y);
    check((await painted(page)) === start + 1, "hovering a zone paints it");
    check(
      await page.locator(".drawing .zone.painted").first().evaluate((el) => el.getAttribute("fill") !== "#f1f5f9"),
      "a painted zone gets its colour"
    );
    check((await page.locator(".particle").count()) >= 1, "painting shows sparkles");

    const zones = [];
    for (let level = 1; level <= 2; level++) {
      for (let drawing = 1; drawing <= 3; drawing++) {
        await page.waitForSelector(".drawing:not(.alive) .zone");
        if (drawing === 1) zones.push(await page.locator(".drawing .zone").count());
        await paintDrawing(page);
        if (drawing < 3) {
          check((await done(page)) === drawing, `level ${level}: drawing ${drawing} counts once`);
          check((await page.locator(".drawing.alive").count()) === 1, "a finished drawing comes alive");
        }
      }
      await page.waitForSelector(".overlay");
      check((await page.locator(".medals").textContent()) === "🏅".repeat(level), `level ${level}: medal awarded`);
      await pressPlay(page);
    }
    await page.waitForSelector(".drawing:not(.alive) .zone");
    zones.push(await page.locator(".drawing .zone").count());
    check(zones.join(",") === "3,5,7", `zones grow 3 -> 5 -> 7 (${zones})`);

    await page.emulateMedia({ reducedMotion: "reduce" });
    check(
      await page.locator(".sun").evaluate((el) => getComputedStyle(el).animationName === "none"),
      "reduced motion stops the spinning sun"
    );
    await finish(game);
  } catch (error) {
    check(false, error.message);
    if (game) await game.browser.close();
  }
})();
