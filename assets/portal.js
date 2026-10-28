/* Portal behaviour: the game of the day and Boliche, the mascot who peeks out
   from behind the game cards. Nothing is stored: no cookies, no localStorage. */
const Portal = (() => {
  // FNV-1a: a tiny, well-spread hash, so nearby dates give unrelated numbers.
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Same local date -> same game, whatever the hour. Tomorrow may repeat it.
  function dailyIndex(date, count) {
    return hash(`${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`) % count;
  }

  function featureToday() {
    const cards = [...document.querySelectorAll("main a.card")];
    const today = cards[dailyIndex(new Date(), cards.length)];
    today.classList.add("today");
    today.closest("main").classList.add("has-today");
    return today;
  }

  // Pixel-art sprite on an 18x22 grid: orange head, red school shirt with the crest.
  function sprite() {
    const r = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
    const ink = "#24334b", fur = "#ff9a3c", shirt = "#c8102e", shorts = "#2b2f36", cream = "#fff7e4";
    return `<svg viewBox="-1 0 18 22" shape-rendering="crispEdges" aria-hidden="true" focusable="false">`
      + r(0, 1, 16, 10, ink) + r(0, 0, 4, 2, ink) + r(12, 0, 4, 2, ink) + r(1, 10, 14, 8, ink)
      + r(-1, 10, 2, 5, ink) + r(15, 10, 2, 5, ink) + r(3, 18, 10, 2, ink)
      + r(1, 0, 2, 2, fur) + r(13, 0, 2, 2, fur) + r(1, 2, 14, 8, fur) + r(5, 3, 6, 1, "#ffb86b")
      + r(4, 5, 2, 2, ink) + r(10, 5, 2, 2, ink) + r(7, 7, 2, 1, ink) + r(6, 8, 4, 1, cream)
      + r(2, 10, 12, 7, shirt) + r(0, 10, 2, 4, shirt) + r(14, 10, 2, 4, shirt)
      + r(0, 14, 2, 1, fur) + r(14, 14, 2, 1, fur) + r(5, 10, 6, 1, cream) + r(3, 17, 10, 2, shorts)
      + r(4, 19, 3, 2, fur) + r(9, 19, 3, 2, fur) + r(3, 21, 4, 1, cream) + r(9, 21, 4, 1, cream)
      + `<image href="assets/escudo-colegio.png" x="9" y="11" width="3" height="4"/></svg>`;
  }

  // Boliche waits behind a card, pops up above its top edge, talks, and hides.
  function mascot(today) {
    const W = 104, VISIBLE = 112;
    const mascotEl = document.createElement("div");
    mascotEl.className = "boliche";
    mascotEl.setAttribute("aria-hidden", "true");
    mascotEl.innerHTML = sprite();
    const say = document.createElement("div");
    say.className = "say";
    say.setAttribute("aria-hidden", "true");
    document.body.append(say, mascotEl);

    const name = today.getAttribute("aria-label");
    const lines = ["¡Hola!", "¡Aquí estoy!", "¿Jugamos?", "¡Elige un juego!", `¡Hoy toca ${name}!`];
    let x = 0, hiddenY = 0, peekY = 0, up = false, hideTimer, nextTimer, lastCard = null;

    const place = (px, py) => { mascotEl.style.transform = `translate(${px}px, ${py}px)`; };
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

    // A spot is free when the popped-up mascot would not collide with anything else.
    function findSpot() {
      const cards = [...document.querySelectorAll("main a.card")];
      const bubble = document.querySelector(".hello").getBoundingClientRect();
      for (let tries = 0; tries < 30; tries++) {
        const card = cards[Math.floor(Math.random() * cards.length)];
        if (card === lastCard && cards.length > 1) continue;
        const r = card.getBoundingClientRect();
        if (r.width < W || r.top - VISIBLE < 56 || r.top > innerHeight - 40) continue;
        const px = r.left + Math.random() * (r.width - W);
        const box = { left: px, right: px + W, top: r.top - VISIBLE, bottom: r.top };
        const blocked = cards.some(c => c !== card && overlaps(box, c.getBoundingClientRect())) || overlaps(box, bubble);
        if (!blocked) return { card, px, top: r.top };
      }
      return null;
    }

    function talk(text) {
      say.textContent = text;
      const width = say.offsetWidth;
      say.style.left = `${Math.min(Math.max(8, x + W / 2 - width / 2), innerWidth - width - 8)}px`;
      say.style.top = `${Math.max(8, peekY - 62)}px`;
      say.classList.add("on");
    }

    function show() {
      clearTimeout(nextTimer);
      const spot = findSpot();
      if (!spot) { nextTimer = setTimeout(show, 3000); return; }
      lastCard = spot.card;
      x = spot.px; hiddenY = spot.top + 6; peekY = spot.top - VISIBLE;
      mascotEl.style.transition = "none";
      place(x, hiddenY);
      mascotEl.style.visibility = "visible";
      void mascotEl.offsetWidth;
      mascotEl.style.transition = "";
      place(x, peekY);
      up = true;
      setTimeout(() => { if (up) talk(lines[Math.floor(Math.random() * lines.length)]); }, 420);
      hideTimer = setTimeout(hide, 3600);
    }

    function hide() {
      up = false;
      clearTimeout(hideTimer);
      clearTimeout(nextTimer);
      say.classList.remove("on");
      place(x, hiddenY);
      setTimeout(() => { if (!up) mascotEl.style.visibility = "hidden"; }, 380);
      nextTimer = setTimeout(show, 3500 + Math.random() * 4500);
    }

    mascotEl.addEventListener("click", () => {
      if (!up) return;
      clearTimeout(hideTimer);
      talk("¡Jijiji!");
      hideTimer = setTimeout(hide, 1100);
    });
    // The spot is computed from where the cards are right now: moving the page invalidates it.
    ["scroll", "resize"].forEach(type => window.addEventListener(type, () => { if (up) hide(); }, { passive: true }));
    nextTimer = setTimeout(show, 1200);
  }

  function start() {
    const today = featureToday();
    mascot(today);
  }

  return { dailyIndex, start };
})();
