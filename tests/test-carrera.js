// Gran Carrera: right answers push the kart, wrong ones only skid, rivals race
// on their own and every finish gets a prize. Every sound has a visible twin.
const { openGame, pressPlay, check, finish } = require("./helpers");

const NUMBER_KINDS = ["count", "sum"];

async function question(page) {
  await page.waitForSelector(".question[data-ready='1']");
  return page.locator(".question").evaluate((el) => ({
    kind: el.dataset.kind,
    answer: el.dataset.answer,
    options: [...el.querySelectorAll(".answer")].map((b) => b.dataset.value),
  }));
}

async function answer(page, value, how = "click") {
  if (how === "key") await page.keyboard.press(value.toLowerCase());
  else await page.click(`.answer[data-value="${value}"]`);
}

async function placed(page) {
  return Number(await page.locator(".progress span.on").count());
}

(async () => {
  let game;
  try {
    game = await openGame("juegos/carrera.html");
    const { page } = game;
    check((await page.locator(".overlay svg.mascot").count()) === 1, "start screen shows our own SVG mascot");
    check((await page.locator(".racer").count()) === 4, "four karts: player plus three rivals");
    await pressPlay(page);

    // Question shape and the 1º bank limits.
    const kinds = [];
    let q = await question(page);
    check(q.options.length === 3 && q.options.includes(q.answer), "three big answers, one is right");

    // Wrong answer: visible feedback, no progress, kart skids.
    const wrong = q.options.find((v) => v !== q.answer);
    await answer(page, wrong);
    check((await page.locator(`.answer[data-value="${wrong}"].wrong`).count()) === 1, "wrong answer shakes red");
    check((await page.locator(`.answer[data-value="${q.answer}"].reveal`).count()) === 1, "right answer is shown after a mistake");
    check((await page.locator(".racer.player.skid").count()) === 1, "wrong answer makes the kart skid");
    check((await placed(page)) === 0, "wrong answer does not count");

    // Race 1: answer slowly so a rival can win; prize is still given.
    await page.waitForFunction(() => document.querySelector(".racer.rival[data-finished='1']"), null, { timeout: 90000 });
    for (let n = 1; n <= 10; n++) {
      q = await question(page);
      kinds.push(q.kind);
      if (q.kind === "count") check(Number(q.answer) >= 1 && Number(q.answer) <= 9, "count answer is 1-9");
      await answer(page, q.answer, n % 2 ? "click" : "key");
      await page.waitForFunction((v) => document.querySelectorAll(".progress span.on").length === v, n);
      if (n === 1) check((await page.locator(".flash-ok").count()) >= 1, "right answer has a visible celebration");
      if (n === 3) check((await page.locator(".racer.player.turbo").count()) === 1, "three in a row light the turbo");
    }
    check(kinds.some((k) => NUMBER_KINDS.includes(k)) && kinds.includes("vowel"), `numbers and letters are mixed (${kinds.join(",")})`);
    check(kinds.every((k, i) => i === 0 || NUMBER_KINDS.includes(k) !== NUMBER_KINDS.includes(kinds[i - 1])), "number and letter questions alternate");
    await page.waitForSelector(".overlay");
    const place1 = Number(await page.evaluate(() => document.body.dataset.place));
    check(place1 >= 2, `slow race: real rivals can beat you (place ${place1})`);
    check((await page.locator(".overlay .podium").count()) === 1, "finish shows the podium");
    check((await page.locator(".medals").textContent()).length >= 1, "every finish gets a prize");
    const pace1 = Number(await page.locator(".racer.rival").first().getAttribute("data-pace"));
    await pressPlay(page);

    // Race 2: fast answers win; rivals are faster than in race 1.
    const pace2 = Number(await page.locator(".racer.rival").first().getAttribute("data-pace"));
    check(pace2 > pace1, `rivals get faster (${pace1} -> ${pace2})`);
    for (let n = 1; n <= 10; n++) {
      q = await question(page);
      await answer(page, q.answer, "key");
      await page.waitForFunction((v) => document.querySelectorAll(".progress span.on").length === v, n);
    }
    await page.waitForSelector(".overlay");
    check((await page.evaluate(() => document.body.dataset.place)) === "1", "fast race: first place");
    check((await page.locator(".medals").textContent()).includes("🥇"), "first place gets the gold medal");
    await pressPlay(page);

    // Keys that are not an answer do nothing.
    q = await question(page);
    const unused = "123456789aeiou".split("").find((k) => !q.options.map((o) => o.toLowerCase()).includes(k));
    await page.keyboard.press(unused);
    check((await placed(page)) === 0, "a key that is not an answer does not count");

    await page.emulateMedia({ reducedMotion: "reduce" });
    check(
      await page.locator(".track").evaluate((el) => getComputedStyle(el).animationName === "none"),
      "reduced motion stops the scrolling track"
    );
    await finish(game);
  } catch (error) {
    check(false, error.message);
    if (game) await game.browser.close();
  }
})();
