// Shared test helpers: open a game page in a headless browser and collect
// errors and any network request that leaves the local files.
const path = require("path");
const os = require("os");
const { chromium } = require("playwright-core");

const ROOT = "file://" + path.resolve(__dirname, "..");
const EXECUTABLE =
  process.env.CHROME_PATH ||
  path.join(os.homedir(), ".cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell");

async function openGame(file) {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  const external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("request", (r) => !r.url().startsWith("file://") && external.push(r.url()));
  await page.goto(`${ROOT}/${file}`);
  return { browser, page, errors, external };
}

// The play button pulses forever, so it is never "stable": force the click.
async function pressPlay(page) {
  await page.waitForSelector(".overlay .play-btn");
  await page.click(".overlay .play-btn", { force: true });
}

function check(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${message}`);
  }
}

// Common end-of-test checks every game must pass.
async function finish({ browser, page, errors, external }) {
  await page.click(".home-btn");
  check(page.url().endsWith("/index.html"), "home button returns to the portal");
  check(external.length === 0, `no external requests (${external.join(", ")})`);
  check(errors.length === 0, `no page errors (${errors.join(" | ")})`);
  await browser.close();
}

module.exports = { openGame, pressPlay, check, finish };
