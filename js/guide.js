// First-game objectives: a mission bar that teaches the controls and ticks itself off as you play.
window.WD = window.WD || {};

WD.Guide = (() => {
  const KEY = "worldDominion.tutorial";
  const STEPS = [
    { id: "select", title: "Select your capital", text: "Left-click your home country. It's pulsing on the map." },
    { id: "buy", title: "Recruit an army", text: "With your country selected, click a unit card or press Q for infantry, W for tanks." },
    { id: "attack", title: "Launch an attack", text: "Right-click a neighboring country. Hover first to see the route and your odds." },
    { id: "capture", title: "Conquer a nation", text: "Win the battle (⚔) to take the country. Bigger armies win faster." },
    { id: "support", title: "Call in support", text: "Weaken a target with an air strike (A), artillery (B) or a missile (M)." },
    { id: "grow", title: "Build an empire", text: "Control 5 nations. Rich countries pay more and count more toward victory." },
  ];
  let done = new Set(), active = false, finishedAt = 0, el = null, onDone = () => {};

  const finished = () => { try { return localStorage.getItem(KEY) === "done"; } catch { return false; } };

  function start({ force = false, onComplete } = {}) {
    el = document.getElementById("mission");
    onDone = onComplete || (() => {});
    if (!force && finished()) { stop(); return; }
    done = new Set();
    active = true;
    finishedAt = 0;
    render();
  }

  function stop() {
    active = false;
    if (el) el.hidden = true;
  }

  function event(id) {
    if (!active || done.has(id) || !STEPS.some(s => s.id === id)) return;
    done.add(id);
    if (done.size === STEPS.length) {
      finishedAt = performance.now();
      try { localStorage.setItem(KEY, "done"); } catch { /* storage blocked */ }
      onDone();
      setTimeout(() => { if (finishedAt) stop(); }, 7000);
    }
    render(true);
  }

  function render(pulse) {
    if (!el || !active) return;
    const next = STEPS.find(s => !done.has(s.id));
    const dots = STEPS.map(s => `<span class="m-dot${done.has(s.id) ? " on" : ""}${s === next ? " now" : ""}" title="${s.title}"></span>`).join("");
    el.innerHTML = next
      ? `<div class="m-tag">Mission ${done.size + 1}/${STEPS.length}</div>
         <div class="m-body"><b>${next.title}</b><span>${next.text}</span></div>
         <div class="m-dots">${dots}</div>
         <button class="m-x" title="Hide the tips (turn them back on in Settings)">×</button>`
      : `<div class="m-tag done">Training complete</div>
         <div class="m-body"><b>You're ready, Commander.</b><span>Now conquer the world. Open Diplomacy (D) to make or break treaties.</span></div>
         <div class="m-dots">${dots}</div>`;
    el.hidden = false;
    el.querySelector(".m-x")?.addEventListener("click", () => {
      try { localStorage.setItem(KEY, "done"); } catch { /* storage blocked */ }
      stop();
    });
    if (pulse) {
      el.classList.remove("pulse");
      el.getBoundingClientRect();
      el.classList.add("pulse");
    }
  }

  // Objectives that depend on the game state rather than a single action.
  function check(ownedCount) { if (active && ownedCount >= 5) event("grow"); }

  const reset = () => { try { localStorage.removeItem(KEY); } catch { /* storage blocked */ } };
  // Boot Camp teaches the same things, so finishing it retires these missions.
  const finish = () => { try { localStorage.setItem(KEY, "done"); } catch { /* storage blocked */ } stop(); };

  return { start, stop, event, check, reset, finish, get active() { return active; }, finished };
})();
