// Every published page asks search engines not to list it, so the school's
// portal is reached only through the link the teacher shares.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pages = ["index.html", ...fs.readdirSync(path.join(root, "juegos")).filter((f) => f.endsWith(".html")).map((f) => `juegos/${f}`)];
let failures = 0;
for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  const head = html.slice(0, html.indexOf("</head>"));
  const ok = /<meta name="robots" content="noindex, nofollow, noimageindex">/.test(head);
  if (!ok) failures++;
  console[ok ? "log" : "error"](`${ok ? "ok" : "FAIL"}: ${page} asks search engines not to index it, its links or its images`);
}
console.log(`TOTAL: ${pages.length - failures} ok, ${failures} FAIL`);
process.exit(failures ? 1 : 0);
