// Boot Camp: a short guided training war before a player's first real one. A drill sergeant gives
// one order at a time, highlights what to click, and moves on as soon as the order is carried out.
// The training world itself is set up by Game (settings.tutorial): France against two rivals who
// never move, with weak neighbors to practise on.
window.WD = window.WD || {};

WD.Bootcamp = (() => {
  const KEY = "worldDominion.bootcamp";   // "done" once finished, "skipped" once declined
  let hooks = null, el = null, steps = [], i = 0, active = false, shown = "";
  let st = {};                             // what the player has done during the current step
  let marked = [];                         // elements currently highlighted
  let aimed = "";                          // the last target scrolled into view

  const status = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
  const remember = v => { try { localStorage.setItem(KEY, v); } catch { /* storage blocked */ } };
  const val = (x, c) => (typeof x === "function" ? x(c) : x);

  // hooks: ctx() -> { G, me, selected, hover, frac, modal, action, touch, target, radar, shopTab, techSel }, beacon(c), show(c, zoom),
  // fold(on) (upright phones: shrink the panel sheet), contract(c), sound(name), complete(first) -> experience paid,
  // finish(how), invite() -> room code or ""
  function init(world, h) {
    hooks = h;
    el = document.getElementById("coach");
    steps = build(world);
    el.addEventListener("click", ev => {
      const b = ev.target.closest("[data-c]");
      if (!b) return;
      if (b.dataset.c === "next") advance();
      else if (b.dataset.c === "skip") { if (status() !== "done") remember("skipped"); hooks.finish("menu"); }
      else hooks.finish(b.dataset.c);
    });
  }

  function build(W) {
    const id = name => W.byName.get(name).id;
    const FR = id("France"), BE = id("Belgium"), LU = id("Luxembourg"), ES = id("Spain");
    const mine = (c, x) => x >= 0 && c.G.owner[x] === c.me.id;
    // Orders are worded for a mouse or for fingers, whichever the player is using (c.touch).
    const click = c => (c.touch ? "tap" : "click"), Click = c => (c.touch ? "Tap" : "Click");
    // A window step: open it, look around, close it.
    const windowStep = (name, title, open, inside, button) => ({
      title,
      text: c => (st.opened ? inside + " Close it to carry on." : val(open, c)),
      target: () => (st.opened ? "#modalCard [data-m=close]" : button),
      watch: c => { if (c.modal === name) st.opened = true; },
      done: c => st.opened && !c.modal,
    });
    return [
      { title: "Welcome to Boot Camp", text: "I'm your drill sergeant. In about three minutes you'll learn everything you need to conquer the world. Nobody will attack you here, so take your time.", next: true },
      { title: "Your capital", text: c => `This is <b>France</b>, your home nation. The gold ★ marks your capital. <b>${c.touch ? "Tap" : "Left-click"} France</b> to select it.`, country: FR,
        done: c => c.selected === FR },
      { title: "Recruit infantry", panel: true, text: c => `The panel shows your troops. Buy <b>5 infantry</b>: ${c.touch ? "tap the Infantry card (×5 buys five with one tap)" : "click the Infantry card, or press <kbd>Q</kbd>"}. (${Math.min(5, st.inf || 0)}/5)`,
        target: '#panel .unit-card[data-t="inf"]', done: () => (st.inf || 0) >= 5 },
      { title: "Bring tanks", panel: true, text: c => `Tanks hit three times harder than infantry. Buy <b>2 tanks</b>: ${click(c)} the Tanks card${c.touch ? "" : ", or press <kbd>W</kbd>"}. (${Math.min(2, st.tank || 0)}/2)`,
        target: '#panel .unit-card[data-t="tank"]', done: () => (st.tank || 0) >= 2 },
      { title: "Choose your force", panel: true, text: c => `Pick how much of the army to send. ${Click(c)} <b>All</b>${c.touch ? "" : ", or press <kbd>4</kbd>"}.`,
        target: '#panel [data-act="frac"][data-v="1"]', done: c => c.frac === 1 },
      { title: "Scout the target", country: BE, done: c => c.hover === BE,
        text: c => (c.touch ? "<b>Tap Belgium</b>, just north of France. A card shows the route, the travel time and your odds."
          : "Move your mouse over <b>Belgium</b>, just north of France. The tooltip shows the route, the travel time and your odds.") },
      { title: "Attack!", country: BE,
        text: c => (!c.touch ? "<b>Right-click Belgium</b> to send your army. (You can also press <kbd>G</kbd> and left-click a target.)"
          : c.target === BE ? "Tap <b>⚔ Attack</b> on the card to send your army."
          : !mine(c, c.selected) ? "<b>Tap France</b> to select your army, then tap <b>Belgium</b>."
          : "<b>Tap Belgium</b>, then <b>⚔ Attack</b> on its card."),
        target: c => (c.touch && c.target === BE ? '#targetCard [data-tc="go"]' : null),
        done: c => mine(c, BE) || c.G.sieges[BE].some(s => s.owner === c.me.id) || c.G.armies.some(a => a.owner === c.me.id && a.path[a.path.length - 1] === BE) },
      { title: "Into battle", text: "Your army marches to Belgium and fights as soon as it arrives. The badge shows defenders ⚔ attackers. Beat every defender to take the nation.", country: BE,
        done: c => mine(c, BE) },
      { title: "Conquered!", text: "Belgium is yours. Every nation you hold pays into your <b>treasury</b> (at the top) and trains troops on its own, and big economies give the most. Money buys more.", target: ".hud-money", next: true },
      { title: "Contracts", country: LU, view: [LU, 6],
        text: c => (c.touch
          ? "<b>Contracts</b> pay cash for goals. Take <b>Luxembourg</b> for $300: tap <b>Belgium</b> (your army is there), then <b>Luxembourg</b>, then <b>⚔ Attack</b>."
          : "<b>Contracts</b> pay cash for goals. Here's one: <b>take Luxembourg</b> for $300. Your army is in Belgium now: <b>left-click Belgium</b>, then <b>right-click Luxembourg</b>."),
        target: c => (c.touch && c.target === LU ? '#targetCard [data-tc="go"]' : "#bounties"),
        enter: () => hooks.contract(LU), done: c => mine(c, LU) },
      // On a touchscreen the target card has the support weapons too, so it teaches those instead of the panel.
      { title: "Air strike", country: ES, view: [FR, 3.4],
        text: c => (c.action === "air" ? `Now ${click(c)} <b>Spain</b> to bomb it.`
          : c.touch && c.target === ES ? "Tap <b>✈️ Air strike</b> on the card. (🚀 Missiles and 💥 artillery show up there too, when you have them.)"
          : c.selected !== FR ? `Support weapons soften up a target before you attack. Your aircraft are in France: <b>${c.touch ? "tap" : "left-click"} France</b> to select it.`
          : c.touch ? "Support weapons soften up a target before you attack. Tap <b>Spain</b>, then <b>✈️ Air strike</b> on its card."
          : "Support weapons soften up a target before you attack. Click <b>✈️ Air strike</b> in the panel, or press <kbd>A</kbd>. (<kbd>M</kbd> fires a missile, <kbd>B</kbd> shells a neighbor with artillery.)"),
        target: c => (c.touch ? (c.target === ES ? '#targetCard [data-tc="air"]' : null)
          : c.selected === FR && c.action !== "air" ? '#panel [data-act="mode"][data-v="air"]' : null),
        done: () => !!st.air },
      // The shop opens on the research tree: pick Blitzkrieg in it, then research it.
      { title: "The Shop", text: c => (st.tech ? "Researched! The Shop also sells supply packs, special ops and boosts. Close it to carry on."
          : c.modal !== "research" ? `Here's $600 of war funds. Open the <b>Shop</b> (${c.touch ? "the gold 🛒 button" : "<kbd>U</kbd>, or the gold button"} at the top) and research <b>Blitzkrieg</b>.`
          : c.shopTab !== "tree" ? `${Click(c)} the <b>🔬 Research</b> tab.`
          : c.techSel !== "blitz" ? `This is the research tree: each upgrade opens the ones below it. ${Click(c)} <b>⚡ Blitzkrieg</b> at the top of the Armor branch.`
          : `Research lasts for the rest of the war. ${Click(c)} <b>Research</b>.`),
        target: c => (st.tech ? "#modalCard [data-m=close]" : c.modal !== "research" ? "#btnTech"
          : c.shopTab !== "tree" ? '#modalCard [data-tab="tree"]' : c.techSel !== "blitz" ? '#modalCard [data-node="blitz"]' : '#modalCard [data-tech="blitz"]'),
        enter: c => { c.me.money += 600; st.techs = c.me.tech.length; },
        watch: c => { if (c.me.tech.length > st.techs) st.tech = true; },
        done: c => !!st.tech && !c.modal },
      windowStep("autopilot", "Autopilot", c => `Open the <b>Autopilot</b> (${c.touch ? "the 🛡 button" : "<kbd>P</kbd>, or the button"} at the top).`,
        "Your nations raise free militia 🛡, and the Autopilot defends them while you're busy elsewhere.", "#btnAuto"),
      windowStep("diplomacy", "Rivals and diplomacy", c => `Rival empires are ranked in the <b>Power rankings</b>. Open <b>Diplomacy</b> (${c.touch ? "the 🤝 button" : "<kbd>D</kbd>"}).`,
        "Offer peace to stop a war, or an alliance to march through each other's land.", "#btnDiplomacy"),
      // Phones have no radar (pinching out does the same job), so they're shown the pause button instead.
      { title: "Stay alert", next: true, target: c => (c.radar ? "#minimap" : '.hud-speed [data-speed="0"]'),
        text: c => `Red dashed routes and ⚠ alerts warn you of incoming attacks. ${c.radar
          ? `The <b>radar</b> shows the whole world: ${click(c)} it to jump there.` : `${c.touch ? "Pinch" : "Scroll"} to zoom out and see the whole world.`} ${c.touch
          ? "Tap <b>❚❚</b>" : "Press <kbd>Space</kbd>"} to pause any time.` },
      { title: "How to win", text: "Control the share of the world shown on the <b>World Control</b> bar: 75% in a standard war. Capture enemy capitals ★ to loot them and split their empires.", target: ".hud-control", next: true },
      { title: "Boot Camp complete!", text: () => (st.xp ? `You're ready, Commander. <b>+${st.xp} XP</b> for finishing your training.` : "You're ready, Commander. Now go and conquer the world."), final: true },
    ];
  }

  function start() {
    active = true;
    i = 0;
    enter();
    el.hidden = false;
    render(true, hooks.ctx());
  }

  function stop() {
    active = false;
    mark([]);
    if (el) el.hidden = true;
  }

  function enter() {
    st = {};
    aimed = "";
    const s = steps[i];
    const c = hooks.ctx();
    if (s.enter) s.enter(c);
    hooks.fold(!s.panel);
    if (s.country !== undefined) hooks.beacon(s.country);
    if (s.view) hooks.show(...s.view);
    else if (s.country !== undefined) hooks.show(s.country);
    if (s.final) { const first = status() !== "done"; remember("done"); st.xp = hooks.complete(first); }
  }

  function advance() {
    if (i >= steps.length - 1) return;
    i++;
    hooks.sound(steps[i].final ? "medal" : "notify");
    enter();
    render(true, hooks.ctx());
  }

  // Called by the interface a few times a second.
  function tick() {
    if (!active) return;
    const s = steps[i], c = hooks.ctx();
    if (s.watch) s.watch(c);
    if (s.done && s.done(c)) { advance(); return; }
    render(false, c);
  }

  // Things the interface reports as they happen.
  function event(name, data = {}) {
    if (!active) return;
    if (name === "buy") st[data.type] = (st[data.type] || 0) + data.n;
    if (name === "air") st.air = true;
    // Move on straight away, so a quick next purchase counts toward the next order.
    tick();
  }

  function render(force, c) {
    const s = steps[i];
    const text = val(s.text, c);
    const key = i + "|" + text;
    if (force || key !== shown) {
      shown = key;
      const code = s.final ? hooks.invite() : "";
      const buttons = s.final
        ? `<button class="primary" data-c="${code ? "join" : "war"}">${code ? `🌐 Join room ${code}` : "⚔ Start a real war"}</button><button class="ghost" data-c="menu">Main menu</button>`
        : `${s.next ? `<button class="primary" data-c="next">Next ▶</button>` : ""}<button class="c-skip" data-c="skip">Skip training</button>`;
      const dots = steps.map((_, k) => `<i class="${k < i ? "on" : k === i ? "now" : ""}"></i>`).join("");
      el.innerHTML = `<div class="c-face">${s.final ? "🎖️" : "🪖"}</div>
        <div class="c-body"><span class="c-tag">Boot Camp · ${s.final ? "Complete" : `Step ${i + 1} of ${steps.length - 1}`}</span>
          <b class="c-title">${s.title}</b><span class="c-text">${text}</span><span class="c-dots">${dots}</span></div>
        <div class="c-side">${buttons}</div>`;
      el.classList.remove("pop");
      void el.offsetWidth;
      el.classList.add("pop");
    }
    const target = val(s.target, c);
    const list = target ? [...document.querySelectorAll(target)] : [];
    mark(list);
    // Scroll a new target into view once (it may sit low in the side panel), then leave scrolling to the player.
    if (list[0] && target !== aimed) { aimed = target; list[0].scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  }

  // Ring what the order is about. The ring is reapplied each tick because panels get rebuilt.
  function mark(list) {
    for (const node of marked) if (!list.includes(node)) node.classList.remove("coach-target");
    for (const node of list) node.classList.add("coach-target");
    marked = list;
  }

  return { init, start, stop, tick, event, status, skip: () => { if (!status()) remember("skipped"); }, get active() { return active; } };
})();
