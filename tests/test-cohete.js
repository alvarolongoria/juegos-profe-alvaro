// Real keyboard input; the public state only helps time a hop, never collects anything.
const { openGame, pressPlay, check, finish } = require("./helpers");

// Reads only what the page already publishes: where the rocket is, where the
// flying things are, and the speed of the level.
function readState(page) {
  return page.evaluate(() => {
    const rocket = document.querySelector("#rocket");
    const world = document.querySelector("#world");
    const rx = Number(rocket.dataset.x);
    return {
      height: Number(rocket.dataset.height),
      hops: Number(rocket.dataset.hops),
      state: world.dataset.state,
      lives: Number(world.dataset.lives),
      missed: Number(world.dataset.missed),
      speed: Number(world.dataset.speed) || 250,
      stars: document.querySelectorAll(".progress span.on").length,
      overlay: document.querySelector(".overlay")
        ? {
            emoji: document.querySelector(".overlay .big-emoji").textContent,
            text: document.querySelector(".overlay .overlay-text")?.textContent || "",
          }
        : null,
      items: [...document.querySelectorAll(".star, .hazard")].map((el) => ({
        kind: el.classList.contains("star") ? "star" : el.dataset.kind,
        lead: Number(el.dataset.x) - rx,
      })),
    };
  });
}

// Plays like a child: hop when something is about to arrive, stay on the ground
// while a UFO passes over. A child's timing is a hop ahead of the contact.
async function flyLevel(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let restarts = 0;
  while (Date.now() < deadline) {
    const now = await readState(page);
    if (now.overlay) {
      if (now.overlay.emoji.includes("💥")) {
        restarts++;
        await page.click(".overlay .play-btn", { force: true });
        continue;
      }
      return { ...now, restarts };
    }
    if (now.state === "ready") {
      await page.keyboard.press("Enter");
      continue;
    }
    const secondsToArrive = (item) => item.lead / now.speed;
    const ufoPassing = now.items.some(
      (item) => item.kind === "ufo" && secondsToArrive(item) > 0.2 && secondsToArrive(item) < 1.3
    );
    const next = now.items
      .filter((item) => item.kind !== "ufo" && item.lead > 100 && item.lead < 180)
      .sort((a, b) => a.lead - b.lead)[0];
    if (now.height === 0 && !ufoPassing && next) await page.keyboard.press("Space");
  }
  return null;
}

(async () => {
  let game;
  try {
    game = await openGame("juegos/cohete.html");
    const { page } = game;

    await pressPlay(page);
    check((await page.locator("#world").getAttribute("data-state")) === "ready", "the start screen leaves the rocket on the pad");
    check((await page.locator("#lives span").count()) === 3, "three hearts before the flight");
    await page.keyboard.press("Space");
    check((await page.locator("#world").getAttribute("data-state")) === "ready", "SPACE before ENTER does not launch");
    await page.keyboard.press("a");
    check(await page.locator("#enter-key").evaluate((el) => el.classList.contains("hint")), "wrong key hints ENTER");

    // S1: the rocket no longer stays in one place, it flies sideways on its own.
    await page.keyboard.press("Enter");
    check((await page.locator("#world").getAttribute("data-state")) === "flying", "ENTER starts the flight");
    const firstX = Number(await page.locator("#rocket").getAttribute("data-x"));
    await page.waitForTimeout(700);
    const laterX = Number(await page.locator("#rocket").getAttribute("data-x"));
    check(Math.abs(laterX - firstX) > 20, `rocket flies sideways by itself (${firstX} -> ${laterX})`);
    await page.keyboard.press("x");
    check(await page.locator("#space-key").evaluate((el) => el.classList.contains("hint")), "wrong flying key hints SPACE");

    // S3: hazards arrive; grounded flight also cannot collect a star.
    await page.waitForSelector(".hazard", { timeout: 20000 });
    check(true, "hazards fly in");
    await page.waitForFunction(() => document.querySelector("#world").dataset.missed === "1", null, { timeout: 25000 });
    check((await page.locator(".progress span.on").count()) === 0, "grounded flight cannot collect elevated stars");

    // S5 + S8: three bumps empty the hearts, restart the level and report the metres.
    await page.waitForSelector(".overlay", { timeout: 40000 });
    const failEmoji = await page.locator(".overlay .big-emoji").textContent();
    const failText = await page.locator(".overlay .overlay-text").textContent();
    check(failEmoji === "💥", "the third bump ends the level");
    check((await page.locator("#world").getAttribute("data-lives")) === "0", "the third bump empties the hearts");
    check(/Has volado \d+ metros · Récord: \d+ metros/.test(failText), `losing shows the distance flown (${failText})`);
    check((await page.locator(".medals").textContent()) === "", "losing awards no medal");
    await pressPlay(page);
    check((await page.locator("#world").getAttribute("data-state")) === "ready", "losing restarts the level on the pad");
    check((await page.locator("#world").getAttribute("data-lives")) === "3", "the restarted level gives three hearts again");
    check((await page.locator(".progress span.on").count()) === 0, "the restarted level starts from zero stars");

    // S7: a full level reports the metres flown and the record of the session.
    await page.keyboard.press("Enter");
    const won = await flyLevel(page, 180000);
    check(won !== null, "the level can be finished");
    check(won && won.stars === 10, "ten caught stars finish the level");
    check(won && won.overlay.emoji.includes("🎉"), "finishing the level celebrates");
    check(won && /Has volado \d+ metros · Récord: \d+ metros/.test(won.overlay.text), `the level end reports metres and the record (${won && won.overlay.text})`);
    const shownMetres = Number((won && won.overlay.text.match(/Has volado (\d+) metros/) || [])[1]);
    check(shownMetres > 0 && shownMetres === Number((won && won.overlay.text.match(/Récord: (\d+) metros/) || [])[1]), "the first distance sets the record");
    check((await page.locator(".medals").textContent()).includes("🏅"), "a medal is awarded");
    check(await page.evaluate(() => window.scrollY === 0 && document.documentElement.scrollTop === 0), "the game never scrolls the page");

    // S2 + S6: the next level flies higher and adds UFOs.
    await pressPlay(page);
    check((await page.locator("#world").getAttribute("data-state")) === "ready", "level two waits on the pad");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".star", { timeout: 15000 });
    const firstHeight = Number(await page.locator(".star").first().getAttribute("data-height"));
    check(firstHeight > 120, `level two stars fly higher (${firstHeight})`);
    const hopsBefore = Number(await page.locator("#rocket").getAttribute("data-hops"));
    await page.keyboard.press("Space");
    const hopsAfter = Number(await page.locator("#rocket").getAttribute("data-hops"));
    check(hopsAfter === hopsBefore + 1, "SPACE hops once");
    await page.keyboard.down("Space");
    check(Number(await page.locator("#rocket").getAttribute("data-hops")) === hopsAfter, "SPACE in the air adds no hop");
    await page.keyboard.up("Space");
    await page.waitForSelector('.hazard[data-kind="ufo"]', { timeout: 30000 });
    check(true, "level two adds UFOs");
    check(await page.evaluate(() => window.scrollY === 0), "holding SPACE never scrolls the page");

    if (await page.locator(".overlay").count()) await pressPlay(page);
    await finish(game);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    if (game) await game.browser.close();
  }
})();
