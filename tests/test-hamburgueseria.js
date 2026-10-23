// Hamburguesería: build the pictured burger in order. Wrong layers bounce back,
// five burgers end a level and the last level is built by dragging.
const { openGame, pressPlay, check, finish } = require("./helpers");

async function order(page) {
  await page.waitForSelector(".customer[data-ready='1']");
  return page.locator(".order .layer").evaluateAll((els) => els.map((el) => el.dataset.ing));
}

async function plateCount(page) {
  return page.locator(".plate .layer").count();
}

async function served(page) {
  return page.locator(".progress span.on").count();
}

async function drag(page, ing) {
  const from = await page.locator(`.ingredient[data-ing="${ing}"]`).boundingBox();
  const to = await page.locator(".plate").boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
}

(async () => {
  let game;
  try {
    game = await openGame("juegos/hamburgueseria.html");
    const { page } = game;
    check((await page.locator(".overlay svg").count()) >= 1, "start screen shows an SVG burger");
    check((await page.locator(".progress span").count()) === 5, "a level is five burgers");
    await pressPlay(page);

    let wanted = await order(page);
    check(wanted[0] === "pan-abajo" && wanted[wanted.length - 1] === "pan-arriba", "orders start and end with bread");

    // A wrong ingredient bounces back and never counts.
    const wrong = await page.locator(".ingredient").evaluateAll(
      (els, next) => els.map((el) => el.dataset.ing).find((i) => i !== next),
      wanted[0]
    );
    await page.click(`.ingredient[data-ing="${wrong}"]`, { force: true });
    check((await page.locator(`.ingredient[data-ing="${wrong}"].no`).count()) === 1, "wrong ingredient shakes red");
    check((await page.locator(`.ingredient[data-ing="${wanted[0]}"].hint`).count()) === 1, "the right ingredient glows as a hint");
    check((await page.locator(".order .layer.next").count()) === 1, "the next layer of the order glows");
    check((await plateCount(page)) === 0, "wrong ingredient is not added");

    const layers = [];
    for (let level = 1; level <= 3; level++) {
      for (let burger = 1; burger <= 5; burger++) {
        wanted = await order(page);
        if (burger === 1) layers.push(wanted.length);
        for (let i = 0; i < wanted.length; i++) {
          await page.click(`.ingredient[data-ing="${wanted[i]}"]`, { force: true });
          if (level === 1 && burger === 1 && i === 0) {
            check((await page.locator(".flash-ok").count()) >= 1, "a right layer has a visible sparkle");
          }
        }
        check((await plateCount(page)) === wanted.length, `level ${level} burger ${burger}: plate matches the order`);
        if (burger < 5) {
          check((await page.locator(".customer.happy").count()) === 1, "the served customer is happy");
          await page.waitForFunction((n) => document.querySelectorAll(".progress span.on").length === n, burger);
        }
      }
      await page.waitForSelector(".overlay");
      check((await page.locator(".medals").textContent()).length >= level, `level ${level}: medal awarded`);
      await pressPlay(page);
    }
    check(layers.join(",") === "3,4,5", `burgers grow from 3 to 5 layers (${layers})`);

    // Level 4: six layers, built by dragging; a plain click only shows a drag hint.
    wanted = await order(page);
    check(wanted.length === 6, "last level has six layers");
    await page.click(`.ingredient[data-ing="${wanted[0]}"]`, { force: true });
    check((await plateCount(page)) === 0, "level 4: a click does not add");
    check((await page.locator(`.ingredient[data-ing="${wanted[0]}"].drag-hint`).count()) === 1, "level 4: click shows a drag hint");
    await drag(page, wrong === wanted[0] ? "queso" : wrong);
    check((await plateCount(page)) === 0, "level 4: dragging the wrong layer does not add");
    for (const ing of wanted) await drag(page, ing);
    check((await plateCount(page)) === 6, "level 4: dragging builds the burger");
    await page.waitForFunction(() => document.querySelectorAll(".progress span.on").length === 1);
    check((await served(page)) === 1, "level 4: the dragged burger counts");

    await page.emulateMedia({ reducedMotion: "reduce" });
    check(
      await page.locator(".customer").evaluate((el) => getComputedStyle(el).animationName === "none"),
      "reduced motion stops the customer idle bounce"
    );
    await finish(game);
  } catch (error) {
    check(false, error.message);
    if (game) await game.browser.close();
  }
})();
