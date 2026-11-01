// The world news ticker along the bottom of the screen: one headline at a time. When the news
// gets busy, headlines move along faster and the oldest unread ones are dropped.
window.WD = window.WD || {};

WD.News = (() => {
  const MAX = 6;
  let el = null, textEl = null, timer = 0, current = null;
  let queue = [];

  // onClick(country) runs when a headline about a country is clicked.
  function init(root, onClick) {
    el = root;
    textEl = root.querySelector(".tk-text");
    el.addEventListener("click", () => { if (current && current.country >= 0) onClick(current.country); });
  }

  function push(item) {
    queue.push(item);
    if (queue.length > MAX) queue.shift();
    if (!current) next();
  }

  function next() {
    clearTimeout(timer);
    current = queue.shift() || null;
    if (!current) { el.classList.add("idle"); return; }
    el.classList.remove("idle");
    el.dataset.cls = current.cls || "info";
    el.title = current.text + (current.country >= 0 ? " · click to view" : "");
    textEl.textContent = current.text;
    textEl.classList.remove("in");
    void textEl.offsetWidth;   // restart the slide-in animation
    textEl.classList.add("in");
    const hold = Math.min(9000, 3500 + current.text.length * 45) / (queue.length > 2 ? 1.7 : 1);
    timer = setTimeout(() => { current = null; next(); }, hold);
  }

  function clear() {
    clearTimeout(timer);
    queue = [];
    current = null;
    if (textEl) textEl.textContent = "";
    if (el) el.classList.add("idle");
  }

  return { init, push, clear };
})();
