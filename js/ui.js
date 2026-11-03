// Menus, HUD, panels, the multiplayer lobby, input handling and the main loop.
// The battle map lives in map.js and the title globe in globe.js.
window.WD = window.WD || {};

WD.UI = (() => {
  const Game = WD.Game, Net = WD.Net, Map = WD.Map, Globe = WD.Globe, Sound = WD.Sound, Guide = WD.Guide, U = Game.U;
  const Progress = WD.Progress, News = WD.News, Replay = WD.Replay, Minimap = WD.Minimap, Bootcamp = WD.Bootcamp;
  const $ = id => document.getElementById(id);
  const SAVE_PREFIX = "worldDominion.save.";
  const NAME_KEY = "worldDominion.playerName";
  const SETTINGS_KEY = "worldDominion.settings";
  const FLAG_BASE = "https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/";
  const SLOTS = ["auto", "1", "2", "3"];
  const BUY_KEYS = { q: "inf", w: "tank", e: "art", r: "ship", t: "air", y: "mis" };
  const REL_ICON = { war: "⚔", peace: "🕊", alliance: "🤝" };
  // Phone layouts (the same queries as the stylesheet): compact covers phones either way up,
  // sheet only upright phones, where the selected nation's panel sits at the bottom.
  const compactMq = matchMedia("(max-width: 640px) and (orientation: portrait), (max-height: 520px) and (orientation: landscape)");
  const sheetMq = matchMedia("(max-width: 640px) and (orientation: portrait)");
  const compact = () => compactMq.matches;

  let world = null;
  const S = {
    phase: "loading",            // loading | menu | lobby | game
    me: 0,                       // the local player's empire id
    mirror: false,               // true while the state on screen is a copy of another player's hosted game
    selected: -1, hover: -1, action: null, preview: null,
    frac: 0.5, types: { inf: true, tank: true, art: true, ship: true },
    speed: 1, paused: false, modalPause: false, graceLeft: 0,
    setup: { country: -1, mode: "standard", rivals: 6, victory: 75, difficulty: "normal", teams: "ffa", scenario: "classic", fog: true },
    panelKey: "", panelDyn: {}, proposalKey: "", offerKey: "", bountyKey: "", lobbyHtml: "", modal: null, busy: false,
    threatIds: new Set(), vision: null, visionAt: 0, bannerTimer: 0,
    // Touchscreens: taps instead of hover and right-click (see setTouch), the tapped target, and
    // how many units each tap on a unit card buys.
    touch: matchMedia("(pointer: coarse)").matches, target: -1, targetKey: {}, buyN: 1, sheetMin: false,
  };
  const settings = { effects: true, lanes: true, tips: true };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); } catch { /* storage blocked */ }

  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  // Colors can arrive from another player's game, so only plain hex colors reach the page.
  const col = c => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : "#8d8d86");
  const fmt = n => (n >= 10000 ? (n / 1000).toFixed(1) + "k" : Math.floor(n).toLocaleString());
  const fmtRate = n => (n < 10 ? n.toFixed(1) : fmt(n));
  const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const nameOf = c => world.countries[c].name;

  const online = () => Net.role !== null;
  const isHost = () => Net.role === "host";
  const isClient = () => Net.role === "client";
  const isMine = c => Game.state.owner[c] === S.me;
  const clockNow = () => (isClient() ? { speed: Net.speed, paused: Net.paused } : { speed: S.speed, paused: S.paused });
  const activeTypes = () => Object.keys(S.types).filter(t => S.types[t]);
  const perkOf = c => WD.PERKS[world.countries[c].perk];
  const stars = v => "★".repeat(Math.floor((v || 0) + 0.01));
  const leaderName = e => (e.leader ? `${e.leader.title} ${e.leader.name}` : "");
  const prefs = () => ({ color: Progress.color(), title: Progress.title(), rank: Progress.rank() });
  const coin = (cls = "") => `<i class="coin ${cls}"></i>`;
  const starRow = (n, max = 3) => Array.from({ length: max }, (_, i) => `<i class="${i < n ? "on" : ""}">★</i>`).join("");

  // A laurel wreath in brushed gold for the result screen: two branches of leaves around a plaque.
  function laurel(grey) {
    const leaves = [];
    for (let i = 0; i < 9; i++) {
      const a = (112 + i * 16) * Math.PI / 180;   // from the bottom, round the left side, up toward the top
      const x = 180 + Math.cos(a) * 150, y = 64 + Math.sin(a) * 56;
      const tilt = a * 180 / Math.PI + 90;
      for (const side of [-1, 1]) {
        const r = tilt + side * 32;
        const ox = x + Math.cos((r - 90) * Math.PI / 180) * 8, oy = y + Math.sin((r - 90) * Math.PI / 180) * 8;
        leaves.push(`<ellipse cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" rx="4.6" ry="11" transform="rotate(${r.toFixed(0)} ${ox.toFixed(1)} ${oy.toFixed(1)})"/>`);
      }
    }
    const fill = grey ? "url(#wreathGrey)" : "url(#wreathGold)";
    const branch = `<path d="M180,120 Q30,118 46,10" fill="none" stroke="${grey ? "#555b62" : "#9a6410"}" stroke-width="3"/>${leaves.join("")}`;
    return `<svg viewBox="0 0 360 128" aria-hidden="true">
      <defs>
        <linearGradient id="wreathGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2c0"/><stop offset=".45" stop-color="#ffcf4d"/><stop offset="1" stop-color="#b8740c"/></linearGradient>
        <linearGradient id="wreathGrey" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9ced4"/><stop offset=".5" stop-color="#7b838c"/><stop offset="1" stop-color="#3d4248"/></linearGradient>
      </defs>
      <g fill="${fill}" stroke="${grey ? "#2a2e33" : "#5e3700"}" stroke-width="1">${branch}</g>
      <g fill="${fill}" stroke="${grey ? "#2a2e33" : "#5e3700"}" stroke-width="1" transform="translate(360,0) scale(-1,1)">${branch}</g>
    </svg>`;
  }

  // Fog of war: what the local player can see, refreshed a few times a second (null = everything).
  function visionNow() {
    const G = Game.state;
    if (S.phase !== "game" || !G || !G.settings.fog) return null;
    const now = performance.now();
    if (!S.vision || now - S.visionAt > 400) { S.vision = Game.vision(S.me); S.visionAt = now; }
    return S.vision;
  }
  const known = c => { const v = visionNow(); return !v || !!v[c] || isMine(c); };

  function flag(c, cls = "") {
    const code = c >= 0 && world ? WD.FLAGS[world.countries[c]?.name] : null;
    if (!code) return `<span class="flag noflag ${cls}"></span>`;
    return `<img class="flag ${cls}" src="${FLAG_BASE}${code}.svg" alt="" loading="lazy" onerror="this.className='flag noflag ${cls}';this.removeAttribute('src')">`;
  }

  // Every order goes through here: solo players and the host apply it directly,
  // a client sends it to the host. Always resolves to the game's { ok, reason } result.
  function act(op, ...args) {
    if (isClient()) return Net.command(op, args);
    Game.noteOrder(S.me);
    return Promise.resolve(Game[op](S.me, ...args));
  }

  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage blocked */ } }
  function applySettings() {
    document.body.classList.toggle("fx-off", !settings.effects);
    Map.setLanes(settings.lanes);
    $("btnSound").textContent = Sound.settings.muted ? "🔇" : "🔊";
  }

  // ---------- startup ----------
  async function init() {
    try {
      world = await WD.World.load();
    } catch (err) {
      $("loadingText").innerHTML = `Couldn't load the world map. The game needs an internet connection to download it.<br><small>${esc(err.message)}</small>`;
      return;
    }
    Net.init(world, () => ({ speed: S.speed, paused: S.paused }));
    Map.init(world, {
      phase: () => S.phase, me: () => S.me, selected: () => S.selected, hover: () => S.hover,
      effects: () => settings.effects, lanes: () => settings.lanes, vision: visionNow, touch: () => S.touch, insets: mapInsets,
      onLeft, onRight, onHover: setHover,
      // A tap on the sea first closes the target card, then deselects.
      onEmpty: () => { if (S.phase !== "game" || S.action) return; if (S.target >= 0) closeTargetCard(); else select(-1); },
      onEmptyRight: () => { if (S.action) setAction(null); },
      onAlert: c => Map.focus(c),
    });
    News.init($("ticker"), c => Map.focus(c));
    Bootcamp.init(world, {
      ctx: () => ({
        G: Game.state, me: Game.state.empires[S.me], selected: S.selected, hover: S.hover, frac: S.frac, modal: S.modal, action: S.action,
        touch: S.touch, target: S.target, radar: !!$("minimap").offsetWidth,
      }),
      beacon: c => Map.beacon(c),
      // Upright phones: fold the panel sheet down to its title while a step doesn't need it, so the map shows.
      fold: on => { S.sheetMin = on; if (S.phase === "game") renderPanel(); },
      // With a zoom level the camera always moves there; without one it only moves if c is off screen.
      show: (c, k) => { if (k) Map.focus(c, k); else if (!Map.onScreen(c)) Map.focus(c); },
      // The one contract Boot Camp hands out.
      contract: c => {
        const G = Game.state;
        G.bounties.push({ id: G.nextId++, for: S.me, kind: "take", target: c, icon: "🎯", title: `Take ${nameOf(c)}`, reward: 300, start: G.time, expires: G.time + 900 });
        S.bountyKey = "";
      },
      sound: name => Sound.play(name),
      // Only the first completion pays experience.
      complete: first => {
        Guide.finish();
        const xp = first ? Progress.bank("bootcamp", 200).add : 0;
        toast(xp ? `🎖 Boot Camp complete! +${xp} XP` : "🎖 Boot Camp complete!", "good");
        return xp;
      },
      finish: finishBootcamp,
      invite: () => (/^[A-Z0-9]{6}$/.test($("mpCode").value.trim().toUpperCase()) ? $("mpCode").value.trim().toUpperCase() : ""),
    });
    Minimap.init(world, {
      view: () => Map.view(),
      colorOf: c => {
        const G = Game.state, o = G ? G.owner[c] : -1;
        return o >= 0 ? col(G.empires[o].color) : "#2c3542";
      },
      threats: () => Map.threats().map(t => t.dest),
      capital: () => Game.state?.empires[S.me]?.capital ?? -1,
      onJump: ll => Map.focusAt(ll),
    });
    Globe.init(world, {
      colorOf: menuColor,
      chosen: () => S.setup.country,
      labels: globeLabels,
      onPick: c => { Sound.play("select"); chooseCountry(c); },
      onHover: (c, ev) => setHover(c, ev),
    });
    bindUI();
    bindGameEvents();
    bindNetEvents();
    applySettings();
    $("loading").hidden = true;
    showMenu();
    acceptInvite();

    let lastUi = 0, nextFrame = 0;
    const frame = now => {
      requestAnimationFrame(frame);
      // Phones and some monitors refresh 90 or 120 times a second. The map moves smoothly at 60,
      // and drawing it more often would only drain batteries.
      if (now < nextFrame - 2) return;
      nextFrame = Math.max(nextFrame + 1000 / 60, now);
      simStep();
      if (S.phase === "game") {
        Map.frame();
        if (now - lastUi > 200) { lastUi = now; refreshUi(); }
      }
    };
    requestAnimationFrame(frame);
    // Animation frames stop in background tabs; this keeps a hosted war running for everyone.
    setInterval(simStep, 100);
  }

  let lastSim = performance.now();
  function simStep() {
    const now = performance.now();
    const dt = Math.min(2, (now - lastSim) / 1000);
    lastSim = now;
    if (S.phase !== "game" || !Game.state) return;
    if (S.mirror) { if (isClient() && !Net.paused) Game.extrapolate(dt * Net.speed); return; }
    // Solo games pause while a menu is open or the tab is hidden; online games keep going.
    if (S.paused || (!online() && (S.modalPause || document.hidden))) return;
    let left = dt * S.speed;
    while (left > 1e-6) {
      const step = Math.min(0.1, left);
      Game.tick(step);
      left -= step;
    }
  }

  // ---------- globe colors (menu & lobby) ----------
  const lobbyMe = () => Net.lobby.players.find(p => p.id === Net.me);
  function menuColor(c) {
    if (S.phase === "lobby") {
      if (c === S.setup.country) return lobbyMe()?.color || WD.PLAYER_COLOR;
      const p = Net.lobby.players.find(x => x.country === c);
      if (p) return p.color;
    } else if (c === S.setup.country) return Progress.color();
    // Five shades only, so the globe can draw same-colored countries together.
    return d3.interpolateRgb("#233044", "#3a4c66")(Math.round(Math.min(1, world.countries[c].value / 8) * 4) / 4);
  }
  function globeLabels() {
    if (S.phase === "lobby") return Net.lobby.players.filter(p => p.country >= 0).map(p => ({ country: p.country, text: p.name, color: col(p.color) }));
    return S.setup.country >= 0 ? [{ country: S.setup.country, text: nameOf(S.setup.country), color: Progress.color() }] : [];
  }

  // ---------- selection & orders ----------
  function select(c) {
    closeTargetCard();
    S.selected = c;
    setAction(null);
    Map.select(c, c >= 0 && isMine(c));
    if (c >= 0 && isMine(c)) {
      Sound.play("select");
      Guide.event("select");
      Map.beacon(-1);
    } else if (c >= 0) Sound.play("click");
    S.panelKey = "";
    renderPanel();
    updatePreview(S.hover);
  }

  function onLeft(c) {
    if (S.phase === "menu" || S.phase === "lobby") { chooseCountry(c); return; }
    if (S.phase !== "game") return;
    if (S.action) { doAction(S.action, c); return; }
    // Touchscreens have no right-click: tapping another nation while one of yours is selected
    // opens its target card (odds and orders). Your own nations are simply selected.
    if (S.touch && S.selected >= 0 && isMine(S.selected) && c !== S.selected && !isMine(c)) { openTargetCard(c); return; }
    // A click on the selected nation deselects it. Fingers hit it again by accident too often, so
    // on a touchscreen it stays selected (tap the sea or × to deselect).
    select(c === S.selected && !S.touch ? -1 : c);
  }

  function onRight(c) {
    if (S.phase !== "game") return;
    // A long press on a phone arrives here too. It only acts like a tap, so a finger that rests
    // before panning never launches an attack.
    if (S.touch) { onLeft(c); return; }
    if (S.action) { doAction(S.action, c); return; }
    if (S.selected >= 0 && isMine(S.selected) && c !== S.selected) doAction("move", c);
    else if (S.selected < 0 || !isMine(S.selected)) toast("Left-click one of your countries first, then right-click a target.");
  }

  function doAction(a, c) {
    const from = S.selected;
    setAction(null);
    closeTargetCard();
    if (a === "nuke") { fireNuke(c); return; }
    if (from < 0 || !isMine(from)) { toast("Select one of your countries first.", "bad"); return; }
    const hostile = !isMine(c);
    let req;
    if (a === "move") req = act("sendArmy", from, c, S.frac, activeTypes());
    else if (a === "air") req = act("launchAir", from, c);
    else if (a === "bombard") req = act("toggleBombard", from, c);
    else req = act("launchMissile", from, c);
    req.then(r => {
      if (!r.ok) { toast(r.reason, "bad"); Sound.play("error"); return; }
      Map.flash(c);
      if (a === "move") { Sound.play("march"); if (hostile) Guide.event("attack"); }
      if (a === "air") {
        Sound.play("jet");
        if (!r.rebase) { Guide.event("support"); Bootcamp.event("air"); } else toast(`Aircraft are flying to ${nameOf(c)}.`);
      }
      if (a === "missile") { Sound.play("missile"); Guide.event("support"); }
      if (a === "bombard") {
        toast(r.stopped ? `Artillery in ${nameOf(from)} stopped firing.` : `Artillery in ${nameOf(from)} is bombarding ${nameOf(c)}.`);
        if (!r.stopped) { Sound.play("boom"); Guide.event("support"); }
      }
      renderPanel();
      updatePreview(S.hover);
    });
    renderPanel();
  }

  // Nukes fly from your nation nearest the target, so they need no selected country.
  function fireNuke(c) {
    const G = Game.state;
    if (isMine(c)) { toast("Pick an enemy nation for the nuclear strike.", "bad"); return; }
    act("launchNuke", c).then(r => {
      if (!r.ok) { toast(r.reason, "bad"); Sound.play("error"); return; }
      Map.flash(c);
      toast(`☢ Warhead away. Impact on ${nameOf(c)} in a few seconds. The world is watching.`, "bad");
      if (S.modal === "research") openResearch();
      renderPanel();
      updateHud();
    });
    if (G.owner[c] >= 0 && G.empires[G.owner[c]].human && G.owner[c] !== S.me) Sound.play("alert");
  }

  function canAct(a) {
    const c = S.selected, G = Game.state;
    if (a === "nuke") return !!G && G.empires[S.me].nukes >= 1;
    if (c < 0 || !G || !isMine(c)) return false;
    const u = G.units[c];
    if (a === "air") return u.air >= 0.5;
    if (a === "bombard") return u.art >= 0.5;
    if (a === "missile") return u.mis >= 1;
    return U.count(u, WD.ARMY_TYPES) >= 0.5;
  }

  function trySetAction(a) {
    if (S.action === a) { setAction(null); return; }
    if (a === "nuke") {
      if (!canAct("nuke")) {
        toast(Game.mods(S.me).nuclear ? "You have no warheads. Build them in Research (U)." : "Nukes need the Nuclear Program. Open Research (U).", "bad");
        Sound.play("error");
        return;
      }
      setAction(a);
      return;
    }
    if (S.selected < 0 || !isMine(S.selected)) { toast("Select one of your countries first."); return; }
    if (!canAct(a)) {
      const need = { air: "aircraft (T)", bombard: "artillery (E)", missile: "missiles (Y)", move: "troops" }[a];
      toast(`${nameOf(S.selected)} has no ${need}.`, "bad");
      Sound.play("error");
      return;
    }
    setAction(a);
  }

  function setAction(a) {
    S.action = a;
    Map.setRange(-1);
    const hint = $("modeHint");
    hint.classList.toggle("nuke", a === "nuke");
    if (!a) { hint.hidden = true; return; }
    closeTargetCard();
    const v = S.touch ? "Tap" : "Click", again = S.touch ? "tap" : "click";
    const text = {
      move: `${v} a country to move or attack`,
      air: `${v} a target to bomb, or one of your countries to move aircraft there`,
      bombard: `${v} a neighboring country to bombard (${again} it again later to stop)`,
      missile: Game.missileRange(S.me) === Infinity ? `${v} any target on Earth for the missile` : `${v} a target for the missile`,
      nuke: `☢ ${v} an enemy nation for the nuclear strike`,
    }[a];
    // The ✕ cancels on touchscreens, which have no Esc key.
    hint.innerHTML = `<span>${text}${S.touch ? "" : "<small> · Esc to cancel</small>"}</span><button class="mh-x" aria-label="Cancel">✕</button>`;
    hint.hidden = false;
    if (a === "air") Map.setRange(S.selected, Game.airRange(S.me), "air");
    if (a === "missile") Map.setRange(S.selected, Game.missileRange(S.me), "missile");
  }

  function buy(c, type, n) {
    act("buy", c, type, n).then(r => {
      if (!r.ok) { toast(r.reason, "bad"); Sound.play("error"); return; }
      Sound.play("buy");
      Guide.event("buy");
      Bootcamp.event("buy", { type, n });
      renderPanel();
      const card = $("panel").querySelector(`.unit-card[data-t="${type}"]`);
      if (card) { card.classList.remove("got"); card.getBoundingClientRect(); card.classList.add("got"); }
      updatePreview(S.hover);
    });
  }

  // ---------- hover: tooltip and attack preview ----------
  function updatePreview(c) {
    let info = null;
    if (S.phase === "game" && c >= 0 && S.selected >= 0 && isMine(S.selected) && c !== S.selected && (!S.action || S.action === "move")) {
      info = Game.preview(S.me, S.selected, c, S.frac, activeTypes());
      if (info && info.path && !info.blocked && info.count >= 0.5) {
        info.unknown = info.hostile && !known(c);
        const ratio = info.hostile ? info.attack / Math.max(0.1, info.defense) : Infinity;
        info.kind = !info.hostile ? "move" : info.unknown ? "risky" : ratio >= 1.6 ? "ok" : ratio >= 1.05 ? "risky" : "bad";
        Map.setPreview(info.path, info.kind);
      } else Map.setPreview(null);
    } else Map.setPreview(null);
    S.preview = info;
  }

  function who(e) {
    if (e.id === S.me) return "You";
    if (e.human && e.playerName) return e.away ? `${e.playerName} (AI)` : e.playerName;
    return e.name;
  }

  function unitSummary(u, types = WD.UNIT_TYPES) {
    const parts = types.filter(t => u[t] >= 0.5).map(t => `${WD.UNITS[t].icon} ${Math.round(u[t])}`);
    return parts.length ? parts.join("&nbsp; ") : "No troops";
  }

  function ownerLine(c) {
    const G = Game.state;
    const o = G.owner[c];
    if (o < 0) return `<span class="swatch" style="background:#5d6b80"></span>Independent nation`;
    const e = G.empires[o];
    if (o === S.me) return `<span class="swatch" style="background:${col(e.color)}"></span>Your empire`;
    const player = e.human && e.playerName ? ` (${esc(e.playerName)})` : "";
    return `<span class="swatch" style="background:${col(e.color)}"></span>${esc(e.name)}${player} · <span class="rel ${Game.relation(S.me, o)}">${Game.relation(S.me, o)}</span>`;
  }

  function previewHtml(info) {
    if (!info) return "";
    if (!info.path) return `<div class="tip">No route. You need a border or sea lane through your own or allied land.</div>`;
    if (info.blocked) return `<div class="tip">You have a treaty with this empire. Break it in Diplomacy to attack.</div>`;
    if (info.count < 0.5) return `<div class="tip">No troops selected to send. Recruit some or change the unit types.</div>`;
    const verdict = verdictOf(info);
    const hops = info.path.length - 1;
    return `<div class="odds"><span>Sending</span><b>${Math.round(info.count)} troops</b>
      <span>Travel</span><b>${Math.ceil(info.eta)}s${hops > 1 ? ` · ${hops} hops` : ""}</b>
      ${info.hostile ? `<span>Power</span><b>${Math.round(info.attack)} vs ${info.unknown ? "?" : Math.round(info.defense)}</b>` : ""}
      <div class="verdict ${verdict[1]}">${verdict[0]}</div></div>
      <div class="tip">Right-click to ${info.hostile ? "attack" : "move troops here"}</div>`;
  }
  const verdictOf = info => (info.unknown ? ["Unknown odds · fog of war", "risky-t"]
    : { ok: ["Strong attack", "ok-t"], risky: ["Risky attack", "risky-t"], bad: ["Likely to fail", "bad-t"], move: ["Reinforcement", "ok-t"] }[info.kind]);
  // Why an order can't go ahead, or "" when it can.
  function previewProblem(info) {
    if (!info) return "Pick one of your nations first.";
    if (!info.path) return "No route. You need a border or sea lane through your own or allied land.";
    if (info.blocked) return "You have a treaty with this empire. Break it in Diplomacy to attack.";
    if (info.count < 0.5) return "No troops to send from here. Recruit some, or change the unit types in the panel.";
    return "";
  }

  const capitalStar = c => {
    const o = Game.state.owner[c];
    return o >= 0 && Game.state.empires[o].capital === c ? '<span class="cap-star" title="Capital">★</span>' : "";
  };
  // What's known about a country in a war: troops, economy and defenses. Shared by the tooltip and the target card.
  function countryFacts(c) {
    const G = Game.state, cc = world.countries[c], o = G.owner[c], seen = known(c);
    const capital = o >= 0 && G.empires[o].capital === c;
    let html = seen ? `<div class="u">${unitSummary(G.units[c], WD.ALL_TYPES)}${G.vet[c] >= 1 ? ` <span class="vet">${stars(G.vet[c])}</span>` : ""}</div>`
      : `<div class="u fogged">🌫 Troops unknown</div>`;
    html += `<div class="o" style="margin:5px 0 0">Economy +$${fmtRate(cc.value)}/s${cc.coastal ? " · coastal" : ""}${capital ? " · capital, defends +50%" : ""}</div>`;
    if (o < 0) { const perk = perkOf(c); html += `<div class="o">${perk.icon} Defends with ${perk.name}</div>`; }
    if (Game.cache.rad.has(c)) html += `<div class="tip rad-t">☢ Radioactive: no income or recruiting</div>`;
    if (G.sieges[c].length && seen) html += `<div class="tip">⚔ Battle in progress</div>`;
    return html;
  }

  function setHover(c, ev) {
    const tip = $("tooltip");
    // Fingers don't hover. A tap still sends the browser's imitation mouse moves, which are
    // ignored here: the target card shows a tapped country instead.
    if (S.touch) { tip.hidden = true; return; }
    const changed = c !== S.hover;
    S.hover = c;
    if (changed && S.phase === "game") {
      Map.hover(c);
      updatePreview(c);
    }
    if (c < 0 || S.phase === "loading" || !$("modal").hidden) { tip.hidden = true; return; }
    if (changed || S.phase === "game") {
      const cc = world.countries[c];
      if (S.phase !== "game") {
        const taker = S.phase === "lobby" && Net.lobby.players.find(p => p.country === c && p.id !== Net.me);
        const action = taker ? `Taken by ${esc(taker.name)}` : "Click to rule this nation";
        const tier = cc.value >= 8 ? "Superpower" : cc.value >= 3 ? "Major power" : cc.value >= 1.2 ? "Regional power" : "Minor nation";
        const perk = perkOf(c);
        tip.innerHTML = `<div class="t">${flag(c)}${esc(cc.name)}</div><div class="o">${tier} · economy +$${fmtRate(cc.value)}/s</div>
          <div class="perk-line"><b>${perk.icon} ${perk.name}</b> ${perk.desc}</div><div class="tip">${action}</div>`;
      } else {
        tip.innerHTML = `<div class="t">${flag(c)}${capitalStar(c)}${esc(cc.name)}</div><div class="o">${ownerLine(c)}</div>` + countryFacts(c) + previewHtml(S.preview);
      }
    }
    tip.hidden = false;
    if (ev) {
      const r = tip.getBoundingClientRect();
      tip.style.left = Math.min(ev.clientX + 18, innerWidth - r.width - 8) + "px";
      tip.style.top = Math.min(ev.clientY + 18, innerHeight - r.height - 8) + "px";
    }
  }

  // ---------- touchscreens: the target card ----------
  // Tapping another nation while one of yours is selected opens this card: what's there, your
  // odds, and the orders you can give. It stands in for hover and right-click.
  function openTargetCard(c) {
    S.target = c;
    S.hover = c;
    Map.hover(c);
    updatePreview(c);
    document.body.classList.add("targeting");
    renderTargetCard();
    Sound.play("click");
  }

  function closeTargetCard() {
    if (S.target < 0) return;
    S.target = -1;
    document.body.classList.remove("targeting");
    $("targetCard").hidden = true;
    S.hover = -1;
    Map.hover(-1);
    updatePreview(-1);
  }

  // The card changes part by part, and only when a part's content changes, so a button is never
  // replaced under a finger that's pressing it.
  function renderTargetCard() {
    const c = S.target, box = $("targetCard"), G = Game.state, from = S.selected;
    if (c < 0) return;
    if (S.phase !== "game" || from < 0 || !isMine(from) || isMine(c)) { closeTargetCard(); return; }
    if (box.hidden || box.__c !== c) {
      box.__c = c;
      S.targetKey = {};
      const fracs = [[0.25, "25%"], [0.5, "50%"], [0.75, "75%"], [1, "All"]].map(([v, l]) => `<button data-tc="frac" data-v="${v}">${l}</button>`).join("");
      box.innerHTML = `<div class="tc-head">${flag(c, "lg")}<div class="tc-name"><b data-tc="name"></b><div class="o" data-tc="owner"></div></div><button class="x" data-tc="close" aria-label="Close">×</button></div>
        <div class="tc-info" data-tc="facts"></div><div data-tc="odds"></div><div class="seg tc-frac">${fracs}</div><div class="tc-acts" data-tc="acts"></div>`;
      box.hidden = false;
    }
    const part = (name, html) => {
      if (S.targetKey[name] === html) return;
      S.targetKey[name] = html;
      box.querySelector(`[data-tc="${name}"]`).innerHTML = html;
    };
    part("name", capitalStar(c) + esc(nameOf(c)));
    part("owner", ownerLine(c));
    part("facts", countryFacts(c));
    const info = S.preview, problem = previewProblem(info);
    if (problem) part("odds", `<div class="tc-why">${problem}</div>`);
    else {
      const verdict = verdictOf(info), hops = info.path.length - 1;
      part("odds", `<div class="tc-odds"><span>Sending</span><b>${Math.round(info.count)} troops</b><span>Travel</span><b>${Math.ceil(info.eta)}s${hops > 1 ? ` · ${hops} hops` : ""}</b>
        ${info.hostile ? `<span>Power</span><b>${Math.round(info.attack)} vs ${info.unknown ? "?" : Math.round(info.defense)}</b>` : ""}
        <div class="verdict ${verdict[1]}">${verdict[0]}</div></div>`);
    }
    for (const b of box.querySelectorAll('[data-tc="frac"]')) b.classList.toggle("on", +b.dataset.v === S.frac);
    // The main order, then whatever support weapons can reach the target from the selected nation.
    const u = G.units[from], hostile = Game.isHostile(S.me, c), km = Game.dist(from, c);
    const support = (kind, icon, label, ok, why) => `<button class="ghost" data-tc="${kind}" ${ok ? "" : `disabled title="${why}"`}>${icon}<small>${label}</small></button>`;
    let acts = `<button class="primary" data-tc="go" ${problem ? "disabled" : ""}>${hostile ? "⚔ Attack" : "➜ Move troops"}</button>`;
    if (hostile && u.air >= 0.5) acts += support("air", "✈️", "Air strike", km <= Game.airRange(S.me), "Out of aircraft range");
    if (hostile && u.mis >= 1) acts += support("missile", "🚀", "Missile", km <= Game.missileRange(S.me), "Out of missile range");
    if (hostile && u.art >= 0.5 && Game.edgeOf(from, c)) {
      const firing = G.bombards.some(b => b.from === from && b.to === c);
      acts += support("bombard", "💥", firing ? "Stop" : "Bombard", true, "");
    }
    acts += support("details", "ⓘ", "Details", true, "");
    part("acts", acts);
  }

  function onTargetClick(ev) {
    const b = ev.target.closest("button[data-tc]");
    if (!b || b.disabled) return;
    const c = S.target;
    switch (b.dataset.tc) {
      case "close": closeTargetCard(); break;
      case "frac": S.frac = +b.dataset.v; updatePreview(c); renderPanel(); renderTargetCard(); break;
      case "go": doAction("move", c); break;
      case "air": case "missile": case "bombard": doAction(b.dataset.tc, c); break;
      case "details": select(c); break;
    }
  }

  // ---------- side panel ----------
  function renderPanel() {
    const panel = $("panel");
    const c = S.selected, G = Game.state;
    if (c < 0 || S.phase !== "game") { panel.hidden = true; S.panelKey = ""; return; }
    const key = c + "|" + G.owner[c];
    if (key !== S.panelKey) {
      if (S.panelKey && S.panelKey.split("|")[0] === String(c)) { setAction(null); Map.select(c, isMine(c)); }
      S.panelKey = key;
      S.panelDyn = {};
      buildPanel(c);
    }
    updatePanel(c);
    panel.classList.toggle("min", S.sheetMin && sheetMq.matches);
    panel.hidden = false;
  }

  function buildPanel(c) {
    const cc = world.countries[c], mine = isMine(c), G = Game.state, o = G.owner[c];
    const cards = WD.UNIT_TYPES.map(t => {
      const u = WD.UNITS[t], cost = Game.unitCost(S.me, t);
      const inner = `<span class="u-ic">${u.icon}</span><span class="u-cnt" data-cnt="${t}">0</span><span class="u-name">${u.name}</span>`;
      return mine
        ? `<button class="unit-card" data-act="buy" data-t="${t}" title="Buy 1 ${u.name} for $${cost} (Shift: buy 5)">${inner}<span class="u-buy">${cost < u.cost ? `<s>$${u.cost}</s> ` : ""}$${cost} <kbd>${u.key}</kbd></span></button>`
        : `<div class="unit-card">${inner}</div>`;
    }).join("");
    const capital = o >= 0 && G.empires[o].capital === c;
    let html = `
      <div class="p-head">
        ${flag(c, "lg")}
        <div class="p-title"><h2>${capital ? '<span class="cap-star" title="Capital: defends 50% harder">★</span> ' : ""}${esc(cc.name)}</h2><div class="sub" data-dyn="owner"></div></div>
        <button class="x" data-act="close" title="Close (Esc)">×</button>
      </div>
      <div class="p-stats">
        <div><span>Economy</span><b>+$${fmtRate(cc.value)}/s</b></div>
        <div><span>Defense</span><b data-dyn="power">0</b></div>
        <div><span>Veterans</span><b class="vet" data-dyn="vet">—</b></div>
      </div>
      <div class="p-note" data-dyn="note"></div>
      <div class="p-sec"><h5 class="tools">${mine
        ? `<span>Garrison · <span class="mouse-only">click</span><span class="touch-only">tap</span> to recruit</span><span class="seg buy-n touch-only">${[1, 5, 10].map(n => `<button data-act="buyn" data-v="${n}">×${n}</button>`).join("")}</span>`
        : "Defenders"}</h5><div class="units-grid">${cards}</div>
        ${mine ? `<div class="militia-line recruit-line" data-dyn="recruits"></div>` : ""}
        <div class="militia-line" data-dyn="militia"></div></div>`;
    if (mine) {
      const fr = [[0.25, "25%"], [0.5, "50%"], [0.75, "75%"], [1, "All"]]
        .map(([v, l], i) => `<button data-act="frac" data-v="${v}" title="Key ${i + 1}">${l}</button>`).join("");
      const chips = WD.ARMY_TYPES.map(t => `<button class="chip" data-act="type" data-t="${t}">${WD.UNITS[t].icon} ${WD.UNITS[t].name}</button>`).join("");
      html += `
        <div class="p-sec"><h5>Deploy</h5>
          <div class="seg">${fr}</div>
          <div class="chips">${chips}</div>
          <div class="hint mouse-only"><b>Hover</b> a country to preview the route and odds. <b>Right-click</b> it to send troops.</div>
          <div class="hint touch-only"><b>Tap</b> a country to see the route and your odds, then <b>⚔ Attack</b>.</div>
        </div>
        <div class="p-sec"><h5>Orders</h5>
          <div class="acts">
            <button class="act" data-act="mode" data-v="move" title="Pick a target with left-click"><i>🎯</i><span>Move / attack</span><kbd>G</kbd></button>
            <button class="act" data-act="mode" data-v="air" title="Bomb a target up to ${WD.RULES.airRangeKm.toLocaleString()} km away"><i>✈️</i><span>Air strike</span><kbd>A</kbd></button>
            <button class="act" data-act="mode" data-v="bombard" title="Shell a neighboring country nonstop"><i>💥</i><span>Bombard</span><kbd>B</kbd></button>
            <button class="act" data-act="mode" data-v="missile" title="Hit a target up to ${WD.RULES.missileRangeKm.toLocaleString()} km away"><i>🚀</i><span>Missile</span><kbd>M</kbd></button>
            ${Game.mods(S.me).nuclear ? `<button class="act nuke" data-act="mode" data-v="nuke" title="Fire a nuclear warhead at any enemy nation"><i>☢</i><span>Nuke</span><kbd>N</kbd></button>` : ""}
          </div>
          <div class="blist" data-dyn="bombards"></div>
        </div>`;
    } else {
      const perk = o < 0 ? perkOf(c) : null;
      const leader = o >= 0 && G.empires[o].leader;
      html += `<div class="p-sec">
        ${perk ? `<div class="perk-line"><b>${perk.icon} ${perk.name}</b> ${perk.desc}</div>` : ""}
        ${leader ? `<div class="leader-line"><span class="face">${leader.face}</span><span><b>${esc(leaderName(G.empires[o]))}</b><br>${WD.PERSONAS[leader.persona].icon} ${WD.PERSONAS[leader.persona].name}</span></div>` : ""}
        <div class="hint mouse-only">To attack, left-click one of your countries, then right-click ${esc(cc.name)}.</div>
        <div class="hint touch-only">To attack, tap one of your countries, then tap ${esc(cc.name)}.</div></div>`;
    }
    html += `<div class="p-sec" data-dyn="siegeSec"><h5>Battle</h5><div data-dyn="siege"></div></div>`;
    $("panel").innerHTML = html;
  }

  function setDyn(name, html) {
    if (S.panelDyn[name] === html) return;
    S.panelDyn[name] = html;
    const el = $("panel").querySelector(`[data-dyn="${name}"]`);
    if (el) el.innerHTML = html;
  }

  function updatePanel(c) {
    const G = Game.state, panel = $("panel"), u = G.units[c], mine = isMine(c), seen = known(c);
    for (const el of panel.querySelectorAll("[data-cnt]")) el.textContent = seen ? Math.round(u[el.dataset.cnt]) : "?";
    setDyn("owner", ownerLine(c));
    setDyn("power", seen ? String(Math.round(Game.defenseOf(c))) : "?");
    setDyn("vet", seen && G.vet[c] >= 1 ? stars(G.vet[c]) : seen ? "—" : "?");
    const o = G.owner[c];
    setDyn("militia", o < 0 ? `<span>Independent nations have no militia, only their own army.</span>`
      : !seen ? `<span>🛡 Militia: unknown</span>`
      : `<span>🛡 Local militia · free, never leave home</span><b>${Math.floor(u.mil || 0)} / ${Math.floor(Game.militiaCap(c))}</b>`);
    const notes = [];
    if (!seen) notes.push("🌫 Hidden by the fog of war. Get closer, or station aircraft within range, to see the defenders.");
    if (Game.cache.rad.has(c)) notes.push("☢ Radioactive: no income or recruiting here for now.");
    if (mine && Game.integration(c) < 1) notes.push(`🏗 Integrating: pays ${Math.round(Game.integration(c) * 100)}% of its income.`);
    setDyn("note", notes.map(n => `<div>${n}</div>`).join(""));
    if (mine) {
      // The troops this nation trains on its own, and how close it is to its limit.
      const have = U.count(u, WD.ARMY_TYPES), cap = Game.recruitCap(c), perMin = Game.recruitRate(c) * 60;
      const fill = `<b>${Math.floor(have)} / ${Math.floor(cap)}</b>`;
      setDyn("recruits", Game.cache.rad.has(c) ? `<span>🪖 No training while radioactive</span>`
        : G.sieges[c].length ? `<span>🪖 Training paused by the battle</span>${fill}`
        : have >= cap - 0.5 ? `<span>🪖 Barracks full · send troops out to train more</span>${fill}`
        : `<span>🪖 Trains troops on its own · +${perMin < 10 ? perMin.toFixed(1) : Math.round(perMin)} a minute</span>${fill}`);
      const money = G.empires[S.me].money, rad = Game.cache.rad.has(c);
      for (const b of panel.querySelectorAll('[data-act="buy"]')) {
        const t = b.dataset.t;
        const landlocked = t === "ship" && !world.countries[c].coastal;
        b.disabled = money < Game.unitCost(S.me, t) || landlocked || rad;
        if (landlocked) b.title = "Landlocked: warships need a coastline";
      }
      for (const b of panel.querySelectorAll('[data-act="frac"]')) b.classList.toggle("on", +b.dataset.v === S.frac);
      for (const b of panel.querySelectorAll('[data-act="buyn"]')) b.classList.toggle("on", +b.dataset.v === S.buyN);
      for (const b of panel.querySelectorAll('[data-act="type"]')) b.classList.toggle("on", S.types[b.dataset.t]);
      for (const b of panel.querySelectorAll('[data-act="mode"]')) {
        b.disabled = !canAct(b.dataset.v);
        b.classList.toggle("on", S.action === b.dataset.v);
      }
      setDyn("bombards", G.bombards.filter(b => b.from === c)
        .map(b => `<div>💥 Shelling ${esc(nameOf(b.to))} <button data-act="stopb" data-to="${b.to}">Stop</button></div>`).join(""));
    }
    const sieges = seen ? G.sieges[c] : [];
    const incoming = G.bombards.filter(b => b.to === c && (b.owner === S.me || mine));
    panel.querySelector('[data-dyn="siegeSec"]').hidden = !sieges.length && !incoming.length;
    let sh = "";
    if (sieges.length) {
      const D = Game.defenseOf(c), A = sieges.reduce((s, x) => s + Game.attackOf(x.units, x.owner, x.vet), 0);
      const defColor = G.owner[c] < 0 ? "#6b7a90" : col(G.empires[G.owner[c]].color);
      sh += `<div class="siege-meter"><i style="width:${(100 * D / (D + A + 0.01)).toFixed(0)}%;background:${defColor}"></i>` +
        sieges.map(s => `<i style="width:${(100 * U.attack(s.units) / (D + A + 0.01)).toFixed(0)}%;background:${col(G.empires[s.owner].color)}"></i>`).join("") + `</div>`;
    }
    sh += sieges.map(s => {
      const e = G.empires[s.owner];
      return `<div class="siege-row"><span><span class="sw" style="background:${col(e.color)}"></span>${s.owner === S.me ? "Your army" : esc(e.name)}${s.landing > 0 ? " (landing)" : ""}</span><b>${s.vet >= 1 ? `<span class="vet">${stars(s.vet)}</span> ` : ""}${Math.round(U.count(s.units, WD.ARMY_TYPES))}</b></div>`;
    }).join("");
    const attrition = Game.landMods(c).attrition;
    if (sieges.length && attrition) sh += `<div class="siege-row attr"><span>${G.owner[c] >= 0 ? WD.PERKS[G.empires[G.owner[c]].perk].icon : perkOf(c).icon} Invaders lose ${Math.round(attrition * 100)}% per second</span></div>`;
    sh += incoming.map(b => `<div class="siege-row"><span>💥 Shelled from ${esc(nameOf(b.from))}</span></div>`).join("");
    setDyn("siege", sh);
  }

  function onPanelClick(ev) {
    const b = ev.target.closest("button");
    // Upright phones: tapping the sheet's title bar folds it down to just that bar, and back up.
    if (!b && sheetMq.matches && ev.target.closest(".p-head")) { S.sheetMin = !S.sheetMin; renderPanel(); return; }
    if (!b || b.disabled) return;
    const c = S.selected;
    switch (b.dataset.act) {
      case "close": select(-1); break;
      case "buy": {
        // Shift buys 5; touchscreens buy ×1, ×5 or ×10 per tap. Either way, no more than the treasury can pay for.
        let n = ev.shiftKey ? 5 : S.touch ? S.buyN : 1;
        if (n > 1) n = Math.max(1, Math.min(n, Math.floor(Game.state.empires[S.me].money / Game.unitCost(S.me, b.dataset.t))));
        buy(c, b.dataset.t, n);
        break;
      }
      case "buyn": S.buyN = +b.dataset.v; break;
      case "frac": S.frac = +b.dataset.v; updatePreview(S.hover); break;
      case "type": S.types[b.dataset.t] = !S.types[b.dataset.t]; updatePreview(S.hover); break;
      case "mode": trySetAction(b.dataset.v); break;
      case "stopb": act("toggleBombard", c, +b.dataset.to).then(() => renderPanel()); break;
    }
    renderPanel();
  }

  // ---------- HUD, rankings, alerts ----------
  function refreshUi() {
    updateHud();
    renderPanel();
    renderLeaderboard();
    renderProposals();
    renderOffers();
    renderBounties();
    const threats = Map.refresh();
    renderAlerts(threats);
    Minimap.draw();
    Bootcamp.tick();
    if (S.modal === "research") updateResearch();
    Guide.check(Game.cache.owned[S.me]?.length || 0);
    // Keep the hovered country's tooltip (or the tapped one's card) and route preview current as the war moves on.
    if (S.target >= 0) {
      updatePreview(S.target);
      renderTargetCard();
    } else if (S.hover >= 0 && !$("tooltip").hidden) {
      updatePreview(S.hover);
      setHover(S.hover);
    }
  }

  function updateHud() {
    const G = Game.state, me = G.empires[S.me];
    $("hudMoney").textContent = "$" + fmt(me.money);
    $("hudIncome").textContent = "+" + fmtRate(Game.incomeOf(S.me)) + "/s";
    const boost = Game.mobilization();
    $("hudBoost").hidden = boost < 1.02;
    const boostText = `<span class="lbl">Mobilization </span>×${boost.toFixed(1)}`;
    if ($("hudBoost").innerHTML !== boostText) $("hudBoost").innerHTML = boostText;
    $("hudBoost").title = "Opening mobilization: extra income that fades out over the first few minutes";
    const nuclear = !!Game.mods(S.me).nuclear || me.nukes > 0;
    $("btnNukes").hidden = !nuclear;
    $("hudNukes").textContent = me.nukes;
    $("btnNukes").classList.toggle("armed", me.nukes > 0);
    const auto = me.auto;
    $("btnAuto").hidden = !auto;
    if (auto) {
      const label = auto.budget > 0 ? Math.round(auto.budget * 100) + "%" : "Off";
      if ($("hudAuto").textContent !== label) $("hudAuto").textContent = label;
      $("btnAuto").classList.toggle("off", !auto.budget && !auto.reinforce && !auto.retake);
    }
    $("hudCountries").textContent = Game.cache.owned[S.me].length;
    const share = Game.worldShare(S.me);
    $("hudShare").textContent = share.toFixed(1) + "%";
    $("hudBar").style.width = Math.min(100, share) + "%";
    $("hudTime").textContent = fmtTime(G.time);
    const grace = G.settings.tutorial ? 0 : WD.MODES[G.settings.mode].grace - G.time;
    if (S.graceLeft > 0 && grace <= 0) Sound.play("ceasefire");
    S.graceLeft = grace;
    const label = $("hudTimeLabel");
    label.textContent = grace > 0 ? `Ceasefire ${fmtTime(grace)}` : "Time";
    label.classList.toggle("ceasefire", grace > 0);
    label.parentNode.title = grace > 0 ? "Rival empires won't attack anyone until the ceasefire ends (unless attacked first)" : "Game time";
    const ck = clockNow();
    for (const b of document.querySelectorAll(".hud-speed button[data-speed]")) {
      const v = +b.dataset.speed;
      b.classList.toggle("on", v === 0 ? ck.paused : !ck.paused && v === ck.speed);
      b.title = isClient() ? "Only the host can pause or change the speed" : v === 0 ? "Pause (Space)" : `${v}× speed`;
    }
    const cycle = document.querySelector(".hud-speed .spd-cycle");
    if (cycle.textContent !== ck.speed + "×") cycle.textContent = ck.speed + "×";
    const banner = $("pauseBanner");
    banner.hidden = !ck.paused || S.modal === "over";
    const resume = S.touch ? "tap ❚❚ to resume" : "Space to resume";
    if (ck.paused) $("pauseText").textContent = isClient() ? "The host paused the game" : online() ? `Paused for everyone · ${resume}` : resume[0].toUpperCase() + resume.slice(1);
  }

  function renderLeaderboard() {
    const G = Game.state, box = $("leaderboard");
    if (!box.__rows) {
      // On phones the rankings fold into a chip that shows your place (see the stylesheet).
      box.innerHTML = `<div class="lb-h">Power rankings <b class="lb-me"></b></div>`;
      box.__rows = new globalThis.Map();
      box.__order = "";
    }
    const rows = G.empires
      .filter(e => e.alive || !e.rebel)
      .map(e => ({ e, share: Game.worldShare(e.id), n: Game.cache.owned[e.id].length }))
      .sort((a, b) => (b.e.alive - a.e.alive) || b.share - a.share);
    const max = Math.max(1, ...rows.map(r => r.share));
    const order = rows.map(r => r.e.id).join(",");
    const reorder = box.__order !== order;
    box.__order = order;
    if (reorder) box.querySelector(".lb-me").textContent = `#${rows.findIndex(r => r.e.id === S.me) + 1}`;
    for (const { e, share, n } of rows) {
      let row = box.__rows.get(e.id);
      if (!row) {
        row = document.createElement("div");
        row.className = "lb-row";
        row.innerHTML = `${flag(e.start, "sm")}<span class="n"></span><span class="r"></span><span class="p"></span><div class="lb-bar"><i></i></div>`;
        box.__rows.set(e.id, row);
      }
      row.classList.toggle("me", e.id === S.me);
      row.classList.toggle("dead", !e.alive);
      const persona = e.leader && !e.human ? ` · ${leaderName(e)}, ${WD.PERSONAS[e.leader.persona].name.toLowerCase()}` : "";
      row.title = `${e.name} · ${n} nations${persona}${e.nukes > 0 ? ` · ☢ ${e.nukes} warheads` : ""}`;
      const [, nm, rel, pct, bar] = row.childNodes;
      const label = (e.human && e.id !== S.me ? "👤 " : "") + (Game.mods(e.id).nuclear ? "☢ " : "") + who(e);
      if (nm.textContent !== label) nm.textContent = label;
      rel.textContent = e.id === S.me || !e.alive ? "" : REL_ICON[Game.relation(S.me, e.id)];
      pct.textContent = share.toFixed(1) + "%";
      bar.firstChild.style.width = (100 * share / max).toFixed(1) + "%";
      bar.firstChild.style.background = col(e.color);
      if (reorder) box.appendChild(row);
    }
    // Defeated rebel factions leave the rankings.
    for (const [id, row] of box.__rows) if (!rows.some(r => r.e.id === id)) { row.remove(); box.__rows.delete(id); }
  }

  function renderAlerts(list) {
    const box = $("alerts");
    const ids = new Set(list.map(t => t.id));
    if ([...ids].some(id => !S.threatIds.has(id))) Sound.play("alert");
    S.threatIds = ids;
    if (!list.length) { box.hidden = true; return; }
    const byDest = new globalThis.Map();
    for (const th of list) {
      const g = byDest.get(th.dest) || { dest: th.dest, eta: th.eta, size: 0 };
      g.size += th.size;
      g.eta = Math.min(g.eta, th.eta);
      byDest.set(th.dest, g);
    }
    box.innerHTML = `<h4>Incoming attacks</h4>` + [...byDest.values()].slice(0, 5).map(g =>
      `<div class="alert-row" data-c="${g.dest}" title="Click to view"><span>${flag(g.dest, "sm")} ${esc(nameOf(g.dest))} <small style="color:var(--muted)">· ${Math.round(g.size)} troops</small></span><b>${Math.max(0, Math.ceil(g.eta))}s</b></div>`).join("");
    // Under the rankings; on phones under the folded rankings and contracts chips.
    const above = compact() && !$("bounties").hidden ? $("bounties") : $("leaderboard");
    box.style.top = Math.round((compact() ? chipBottom(above) : above.getBoundingClientRect().bottom) + 8) + "px";
    box.hidden = false;
  }

  // Where a folded chip (the rankings or the contracts on a phone) ends, even while it's unfolded.
  const chipBottom = box => box.querySelector(".lb-h, h4").getBoundingClientRect().bottom + 8;

  // ---------- contracts ----------
  function contractProgress(b) {
    const G = Game.state, me = G.empires[S.me];
    if (b.kind === "expand") return `${Game.cache.owned[S.me].length}/${b.goal}`;
    if (b.kind === "kill") return `${Math.min(b.goal, Math.floor(me.stats.kills - b.base))}/${b.goal}`;
    return "";
  }

  // The side panel shrinks to make room for the contracts below it. Only touched when the
  // height changes: restyling the page on every refresh is expensive with the map behind it.
  // h: height of the contracts box. The radar sits beside it, so the taller of the two counts.
  function fitPanel(h) {
    const mm = $("minimap");
    // Phones fold the contracts into a chip and place the panel themselves (see the stylesheet).
    const stack = compact() ? 0 : Math.max(h, mm.hidden || !mm.offsetWidth ? 0 : mm.offsetHeight + 10);
    if (S.bountyH === stack) return;
    S.bountyH = stack;
    $("panel").style.maxHeight = stack ? `calc(100dvh - var(--top-h) - var(--sat) - var(--sab) - ${118 + stack}px)` : "";
  }

  function renderBounties() {
    const G = Game.state, box = $("bounties");
    const list = G.bounties.filter(b => b.for === S.me);
    Map.setBounties(list.filter(b => b.target !== undefined).map(b => b.target));
    if (!list.length) {
      box.hidden = true;
      S.bountyKey = "";
      fitPanel(0);
      return;
    }
    // On phones the contracts fold into a chip under the rankings chip.
    const top = compact() ? Math.round(chipBottom($("leaderboard")) + 4) + "px" : "";
    if (box.style.top !== top) box.style.top = top;
    const key = list.map(b => b.id).join(",");
    if (key !== S.bountyKey) {
      S.bountyKey = key;
      box.innerHTML = `<h4>Contracts <b class="b-n">${list.length}</b></h4>` + list.map(b => `
        <div class="bounty-row${b.target !== undefined ? " go" : ""}" data-id="${b.id}" ${b.target !== undefined ? `data-c="${b.target}" title="Click to view the target"` : ""}>
          <span class="b-ic">${b.icon}</span>
          <span class="b-body"><b>${esc(b.title)}</b><small class="b-prog"></small></span>
          <span class="b-pay">+$${fmt(b.reward)}</span>
          <span class="b-time"><i></i></span>
        </div>`).join("");
      box.hidden = false;
      fitPanel(box.offsetHeight + 10);
    }
    for (const b of list) {
      const row = box.querySelector(`[data-id="${b.id}"]`);
      if (!row) continue;
      const left = Math.max(0, b.expires - G.time), total = b.expires - b.start;
      row.querySelector(".b-time i").style.width = (100 * left / total).toFixed(1) + "%";
      row.classList.toggle("late", left < 20);
      const prog = contractProgress(b);
      const text = (prog ? prog + " · " : "") + fmtTime(left) + " left";
      const el = row.querySelector(".b-prog");
      if (el.textContent !== text) el.textContent = text;
    }
  }

  // ---------- offers: arms deals and ultimatums ----------
  function offerHtml(o) {
    const G = Game.state;
    const pack = Object.entries(o.units || {}).map(([t, n]) => `${n} ${WD.UNITS[t].name.toLowerCase()}`).join(" + ");
    if (o.kind === "arms") {
      return `<span class="o-ic">🔫</span><span><b>Arms dealer</b> offers ${pack} (with veteran crews) for <b>$${fmt(o.cost)}</b>. That's half price!</span>
        <span class="btns"><button class="okb" data-yes="1">Buy</button><button class="ghost" data-yes="0">No thanks</button></span>`;
    }
    const e = G.empires[o.from];
    const ask = o.country >= 0 ? `hand over <b>${esc(nameOf(o.country))}</b>` : `pay <b>$${fmt(o.money)}</b> in tribute`;
    return `<span class="o-ic face">${e.leader ? e.leader.face : "⚠"}</span><span><b>Ultimatum!</b> ${esc(leaderName(e) || e.name)} of the ${esc(e.name)} demands you ${ask}, or they attack.</span>
      <span class="btns"><button class="danger" data-yes="1">Give in</button><button class="okb" data-yes="0">Refuse</button></span>`;
  }

  function renderOffers() {
    const G = Game.state, box = $("toasts");
    const mine = G.offers.filter(o => o.to === S.me);
    const key = mine.map(o => o.id).join(",");
    if (key !== S.offerKey) {
      const fresh = mine.filter(o => !S.offerKey.split(",").includes(String(o.id)));
      S.offerKey = key;
      if (fresh.some(o => o.kind === "ultimatum")) { Sound.play("alarm"); }
      else if (fresh.length) Sound.play("notify");
      box.querySelectorAll(".offer").forEach(el => { if (!mine.some(o => String(o.id) === el.dataset.id)) el.remove(); });
      for (const o of fresh) {
        const el = document.createElement("div");
        el.className = "toast offer " + o.kind;
        el.dataset.id = o.id;
        el.innerHTML = offerHtml(o) + `<span class="o-time"><i></i></span>`;
        el.addEventListener("click", ev => {
          const b = ev.target.closest("button");
          if (!b) return;
          el.remove();
          const yes = b.dataset.yes === "1";
          act("answerOffer", o.id, yes).then(r => {
            if (!r.ok) { toast(r.reason, "bad"); Sound.play("error"); return; }
            if (o.kind === "arms" && yes) { Sound.play("buy"); if (r.delivered >= 0) Map.flash(r.delivered); }
            if (o.kind === "ultimatum") Sound.play(yes ? "lost" : "alert");
          });
        });
        box.prepend(el);
      }
    }
    for (const o of mine) {
      const bar = box.querySelector(`.offer[data-id="${o.id}"] .o-time i`);
      if (bar) bar.style.width = (100 * Math.max(0, o.expires - G.time) / WD.RULES.offerTime).toFixed(1) + "%";
    }
  }

  // ---------- big moments: a banner across the middle of the screen ----------
  function showBanner(text, sub = "", cls = "bad") {
    const el = $("banner");
    $("bannerText").textContent = text;
    $("bannerSub").textContent = sub;
    el.className = cls;
    el.hidden = false;
    el.classList.remove("in");
    void el.offsetWidth;
    el.classList.add("in");
    clearTimeout(S.bannerTimer);
    S.bannerTimer = setTimeout(() => { el.hidden = true; }, 3600);
  }

  // ---------- log, toasts, proposals ----------
  // `from` marks a chat line: { name, color } of the player who wrote it.
  // `leader` marks a message from an AI leader: { face, name, empire, color }.
  function log(text, cls = "info", country, from, leader) {
    const box = $("log");
    const el = document.createElement("div");
    el.className = "log-item " + cls;
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = Game.state ? fmtTime(Game.state.time) : "";
    el.append(t);
    const body = document.createElement("span");
    if (from) {
      const name = document.createElement("span");
      name.className = "who";
      name.style.color = col(from.color);
      name.textContent = from.name + ":";
      body.append(name, document.createTextNode(" " + text));
    } else if (leader) {
      const face = document.createElement("span");
      face.className = "face";
      face.textContent = leader.face;
      const name = document.createElement("span");
      name.className = "who";
      name.style.color = col(leader.color);
      name.textContent = leader.name;
      name.title = leader.empire;
      const quote = document.createElement("q");
      quote.textContent = text;
      body.append(face, name, document.createElement("br"), quote);
      el.style.borderLeftColor = col(leader.color);
    } else body.textContent = text;
    el.append(body);
    if (country !== undefined && country !== null && country >= 0) { el.title = "Click to view"; el.addEventListener("click", () => Map.focus(country)); }
    box.appendChild(el);
    while (box.children.length > 7) box.firstChild.remove();
    const life = from || leader ? 20000 : 13000;
    setTimeout(() => el.classList.add("fade"), life);
    setTimeout(() => el.remove(), life + 700);
  }

  function toast(text, cls = "") {
    const box = $("toasts");
    const el = document.createElement("div");
    el.className = "toast " + cls;
    el.textContent = text;
    box.appendChild(el);
    const plain = [...box.querySelectorAll(".toast:not(.proposal):not(.offer)")];
    if (plain.length > 3) plain[0].remove();
    setTimeout(() => el.remove(), 3800);
  }

  function renderProposals() {
    const G = Game.state;
    const mineP = G.proposals.filter(p => p.to === S.me);
    const key = mineP.map(p => p.id).join(",");
    if (key === S.proposalKey) return;
    const fresh = mineP.some(p => !S.proposalKey.split(",").includes(String(p.id)));
    S.proposalKey = key;
    if (fresh) Sound.play("notify");
    const box = $("toasts");
    box.querySelectorAll(".proposal").forEach(el => el.remove());
    for (const p of mineP) {
      const e = G.empires[p.from];
      const el = document.createElement("div");
      el.className = "toast proposal";
      el.innerHTML = `${flag(e.start)}<span><b>${esc(who(e))}</b> offers ${p.kind === "peace" ? "🕊 a peace treaty" : "🤝 an alliance"}.</span>
        <span class="btns"><button class="okb" data-accept="1">Accept</button><button class="danger" data-accept="0">Decline</button></span>`;
      el.addEventListener("click", ev => {
        const b = ev.target.closest("button");
        if (!b) return;
        el.remove();
        act("answerProposal", p.id, b.dataset.accept === "1").then(r => {
          if (!r.ok) toast(r.reason, "bad");
          if (S.modal === "diplomacy") renderDiplomacy();
        });
      });
      box.prepend(el);
    }
  }

  // ---------- chat ----------
  function openChat() {
    if (!online() || S.modal) return;
    $("chatBox").hidden = false;
    $("log").classList.add("chat-open");
    $("chatInput").focus();
  }
  function closeChat() {
    $("chatBox").hidden = true;
    $("log").classList.remove("chat-open");
    $("chatInput").value = "";
    $("chatInput").blur();
  }

  // ---------- main menu ----------
  function leaveGameScreen() {
    if (S.phase === "game") bankCareer();
    Guide.stop();
    closeModal();
    closeChat();
    if (Map.ready()) { select(-1); Map.reset(); }
    setAction(null);
    for (const id of ["hud", "leaderboard", "alerts", "panel", "targetCard", "pauseBanner", "mission", "bounties", "ticker", "banner"]) $(id).hidden = true;
    $("leaderboard").classList.remove("open");
    $("bounties").classList.remove("open");
    Minimap.hide();
    closeConfirm(false);
    $("log").innerHTML = "";
    $("toasts").innerHTML = "";
    $("leaderboard").__rows = null;
    News.clear();
    S.proposalKey = S.offerKey = S.bountyKey = "";
    S.threatIds = new Set();
    S.vision = null;
    Map.hide();
    Globe.show();
  }

  // Add the experience earned in this war to the commander career (each war counts once).
  function bankCareer(quiet) {
    const G = Game.state;
    const me = G && G.empires[S.me];
    if (!me || !me.human) return null;
    const res = Progress.bank(G.id, me.xp);
    if (res.promoted && !quiet) {
      const r = Progress.rank();
      toast(`🎖 Promoted to ${WD.RANKS[r].name}!`, "good");
      Sound.play("rankup");
    }
    return res;
  }

  // ---------- commander career (main menu) ----------
  function renderCareer() {
    const d = Progress.data, r = Progress.rank(), rank = WD.RANKS[r], next = WD.RANKS[r + 1];
    const pct = next ? Math.min(100, (d.xp - rank.xp) / (next.xp - rank.xp) * 100) : 100;
    const medals = Object.keys(d.medals).length;
    const swatches = Progress.colors().map(c => `<button class="swatch-btn${c.value === Progress.color() ? " on" : ""}" data-color="${c.value}" ${c.open ? "" : "disabled"}
      style="--c:${col(c.value)}" title="${c.open ? esc(c.label) : `${esc(c.label)} · unlocks at ${WD.RANKS[c.rank].name}`}">${c.open ? "" : "🔒"}</button>`).join("");
    const titles = Progress.titles().map(t => `<option value="${esc(t.value)}" ${t.value === Progress.title() ? "selected" : ""} ${t.open ? "" : "disabled"}>${esc(t.value)}${t.open ? "" : ` 🔒 ${WD.RANKS[t.rank].name}`}</option>`).join("");
    $("careerBox").innerHTML = `
      <div class="career-top">
        <span class="pin">${rank.pin}</span>
        <div class="career-id"><b>${rank.name}</b><span>${d.wars} wars · ${d.wins} won</span></div>
        <button class="ghost medals-btn" data-m="medals" title="Your medal collection">🎖 ${medals}/${Object.keys(WD.MEDALS).length}</button>
      </div>
      <div class="xp-bar" title="${fmt(d.xp)} XP"><i style="width:${pct.toFixed(1)}%"></i></div>
      <small class="xp-note">${next ? `${fmt(d.xp - rank.xp)} / ${fmt(next.xp - rank.xp)} XP to ${next.name}` : `${fmt(d.xp)} XP · highest rank`}</small>
      <div class="career-picks">
        <div class="swatches" role="group" aria-label="Empire color">${swatches}</div>
        <select id="titlePick" aria-label="Empire title">${titles}</select>
      </div>`;
  }

  function openMedals() {
    const d = Progress.data;
    const cards = Object.entries(WD.MEDALS).map(([id, m]) => {
      const n = d.medals[id] || 0;
      return `<div class="medal-card${n ? " got" : ""}"><span class="m-icon">${n ? m.icon : "❔"}</span><b>${m.name}</b><span>${m.desc}</span>${n > 1 ? `<em>×${n}</em>` : ""}</div>`;
    }).join("");
    const r = Progress.rank();
    const ranks = WD.RANKS.map((x, i) => `<span class="rank-step${i <= r ? " on" : ""}${i === r ? " now" : ""}" title="${fmt(x.xp)} XP"><b>${x.pin}</b>${x.name}</span>`).join("");
    openModal("medals", `<h2>Service record</h2><p class="lead">${fmt(d.xp)} XP · ${d.wars} wars fought · ${d.wins} won. Earn experience by conquering, completing contracts and winning medals.</p>
      <div class="rank-ladder">${ranks}</div><div class="medal-grid">${cards}</div>
      <div class="foot"><button class="primary" data-m="close">Close</button></div>`);
  }

  function showMenu() {
    if (online()) Net.leave();
    if (S.bootcamp) { S.bootcamp = false; Bootcamp.stop(); }
    S.phase = "menu";
    S.me = 0;
    leaveGameScreen();
    $("setupSlot").appendChild($("setupBlock"));
    $("menuMain").hidden = false;
    $("menuLobby").hidden = true;
    $("menu").hidden = false;

    const sel = $("selCountry");
    if (!sel.options.length) {
      const sorted = world.countries.slice().sort((a, b) => a.name.localeCompare(b.name));
      sel.innerHTML = `<option value="-1">Choose a nation…</option>` +
        sorted.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    }
    if (S.setup.country < 0) {
      const good = world.countries.filter(c => c.value >= 1.5);
      S.setup.country = good[Math.floor(Math.random() * good.length)].id;
    }
    renderCareer();
    renderBootBox();
    renderSetup();
    renderSaves();
    Globe.focus(S.setup.country);
  }

  // ---------- Boot Camp ----------
  function renderBootBox() {
    const done = Bootcamp.status() === "done";
    $("bootBox").innerHTML = `<h3>Boot Camp</h3><div class="boot-row"><span class="boot-ic">🎓</span>
      <span>${done ? "Training complete. Replay it any time." : "<b>New here?</b> Learn the controls in a 3-minute training war."}</span>
      <button class="${done ? "ghost" : "primary"}" data-boot="1">${done ? "Replay" : "Start"}</button></div>`;
  }

  function startBootcamp() {
    if (online()) Net.leave();
    const france = world.byName.get("France").id;
    S.me = 0;
    S.bootcamp = true;
    S.shopTab = "t0";
    S.frac = 0.5;
    Game.newGame(world, {
      mode: "standard", difficulty: "easy", rivals: 2, victory: 100, scenario: "classic", fog: false, tutorial: true,
      playerCountry: france, playerColor: Progress.color(), playerTitle: Progress.title(),
    });
    enterGame();
    Map.focus(france, 3.4);
    Bootcamp.start();
  }

  // First war on this browser? Offer Boot Camp before the real thing (it's on the menu too).
  function offerBootcamp(then) {
    if (Bootcamp.status()) { then(); return; }
    confirmBox({ title: "Boot Camp", text: "First time here? Learn the controls in a 3-minute training war before the real thing.", yes: "🎓 Boot Camp", no: "Skip", tone: "primary" })
      .then(yes => {
        if (yes) startBootcamp();
        else { Bootcamp.skip(); then(); }
      });
  }

  // How Boot Camp ends: straight into a real war, into the room the player was invited to, or the menu.
  function finishBootcamp(how) {
    showMenu();
    if (how === "war") startGame();
    if (how === "join") joinGame();
  }

  // Scenarios as a level-select carousel: the chosen one in the middle, its neighbors peeking in.
  // Cards are built once and only change position, so they slide.
  const STATUS = [["New", ""], ["Played", ""], ["Won", "won"], ["Mastered", "master"]];
  function renderCarousel() {
    const box = $("scenarioCards"), ids = Object.keys(WD.SCENARIOS), n = ids.length;
    if (!box.__built) {
      box.innerHTML = `<button class="car-arrow left" data-car="-1" aria-label="Previous scenario">◀</button>` +
        ids.map((k, i) => `<button class="sc-card" data-scenario="${k}" title="${esc(WD.SCENARIOS[k].desc)}">
          <span class="sc-level">Scenario ${i + 1}</span>
          <span class="sc-art ${k}"><span>${WD.SCENARIOS[k].icon}</span></span>
          <b>${WD.SCENARIOS[k].name}</b><span class="sc-stars"></span><span class="sc-status"></span></button>`).join("") +
        `<button class="car-arrow right" data-car="1" aria-label="Next scenario">▶</button>`;
      $("scenarioDots").innerHTML = ids.map(k => `<i data-scenario="${k}" title="${esc(WD.SCENARIOS[k].name)}"></i>`).join("");
      box.__built = true;
    }
    const sel = Math.max(0, ids.indexOf(S.setup.scenario));
    ids.forEach((k, i) => {
      const card = box.querySelector(`.sc-card[data-scenario="${k}"]`);
      card.dataset.pos = ((i - sel + n + 2) % n) - 2;
      const stars = Progress.starsFor(k);
      card.querySelector(".sc-stars").innerHTML = starRow(stars);
      const [label, cls] = STATUS[stars];
      const status = card.querySelector(".sc-status");
      status.textContent = label;
      status.className = "sc-status " + cls;
    });
    for (const dot of $("scenarioDots").children) dot.classList.toggle("on", dot.dataset.scenario === S.setup.scenario);
  }

  function pickScenario(id) {
    S.setup.scenario = id;
    // Underdog wants a small nation: swap a big pick for a random small one.
    if (id === "underdog" && S.setup.country >= 0 && world.countries[S.setup.country].value >= WD.UNDERDOG_MAX) {
      const small = world.countries.filter(c => c.value < WD.UNDERDOG_MAX && c.value >= 0.6);
      chooseCountry(small[Math.floor(Math.random() * small.length)].id);
    }
    settingsChanged();
  }

  function renderSetup() {
    renderCarousel();
    const sc = WD.SCENARIOS[S.setup.scenario] || WD.SCENARIOS.classic;
    $("scenarioInfo").textContent = sc.desc;
    $("modeCards").innerHTML = Object.entries(WD.MODES).map(([k, m]) =>
      `<button class="mode-card${S.setup.mode === k ? " on" : ""}" data-mode="${k}"><b>${m.name}</b><span>${m.desc}</span></button>`).join("");
    $("rivals").value = S.setup.rivals;
    $("rivalsVal").textContent = S.setup.rivals;
    $("rivalsField").classList.toggle("readonly", !sc.rivals);
    $("rivalsField").title = sc.rivals ? "" : "This scenario has a fixed cast of rivals";
    $("victory").value = S.setup.victory;
    $("fogToggle").checked = !!S.setup.fog;
    for (const b of $("diffSeg").children) b.classList.toggle("on", b.dataset.diff === S.setup.difficulty);
    for (const b of $("teamsSeg").children) b.classList.toggle("on", b.dataset.teams === S.setup.teams);
    $("teamsField").hidden = S.phase !== "lobby";
    $("rulesBlock").classList.toggle("readonly", isClient());
    markChoice(S.setup.country);
  }

  // Rules changed on the menu or in the lobby (only the host can change lobby rules).
  function settingsChanged() {
    renderSetup();
    if (isHost() && S.phase === "lobby") {
      const { mode, rivals, victory, difficulty, teams, scenario, fog } = S.setup;
      Net.setSettings({ mode, rivals, victory, difficulty, teams, scenario, fog });
    }
  }

  // Which team a nation would join in the chosen scenario, for the setup info line.
  function scenarioRole(c) {
    const sc = WD.SCENARIOS[S.setup.scenario];
    if (!sc?.empires) return "";
    const entry = sc.empires.find(x => x.start === world.countries[c].name);
    if (entry?.team) return ` · joins the ${sc.teams[entry.team]}`;
    return entry ? " · non-aligned power" : " · non-aligned";
  }

  function markChoice(c) {
    $("selCountry").value = c;
    if (c < 0) { $("countryInfo").textContent = "Pick a nation on the globe or in the list."; return; }
    const cc = world.countries[c], perk = perkOf(c);
    const tier = cc.value >= 8 ? "Superpower start" : cc.value >= 3 ? "Strong start" : cc.value >= 1.2 ? "Modest start" : "Underdog start: very hard";
    const underdog = S.setup.scenario === "underdog" && cc.value >= WD.UNDERDOG_MAX ? " · too big for Underdog!" : "";
    $("countryInfo").innerHTML = `${tier} · income +$${fmtRate((WD.RULES.baseIncome + cc.value) * WD.MODES[S.setup.mode].income)}/s · ${cc.coastal ? "coastal" : "landlocked"}${esc(scenarioRole(c))}<b class="${underdog ? "bad-t" : ""}">${underdog}</b>
      <span class="perk-line"><b>${perk.icon} ${perk.name}:</b> ${perk.desc}</span>`;
  }

  function chooseCountry(c) {
    if (S.phase === "lobby" && c >= 0) {
      const other = Net.lobby.players.find(p => p.country === c && p.id !== Net.me);
      if (other) { toast(`${nameOf(c)} is already taken by ${other.name}.`, "bad"); Sound.play("error"); return; }
    }
    S.setup.country = c;
    markChoice(c);
    if (S.phase === "lobby") Net.pickNation(c);
    Globe.focus(c);
  }

  // ---------- saves ----------
  function readSaves() {
    return SLOTS.map(slot => {
      try {
        const raw = localStorage.getItem(SAVE_PREFIX + slot);
        return raw ? { slot, meta: JSON.parse(raw).meta } : { slot };
      } catch { return { slot }; }
    });
  }

  function saveLabel(s) {
    const title = s.slot === "auto" ? "Autosave" : "Slot " + s.slot;
    if (!s.meta) return `<div class="meta"><b>${title}</b>Empty</div>`;
    const m = s.meta;
    const when = new Date(m.savedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const friends = m.multiplayer && m.players?.length > 1 ? ` · 🌐 with ${m.players.slice(1).map(esc).join(", ")}` : "";
    return `<div class="meta"><b>${title}: ${esc(m.empire)}</b>${WD.MODES[m.mode]?.name || m.mode} · ${fmtTime(m.time)} · ${m.share.toFixed(1)}% of world${friends} · ${when}</div>`;
  }

  function loadButtons(s) {
    if (!s.meta) return "";
    if (s.meta.multiplayer) {
      return `<button class="primary" data-load="${s.slot}" data-how="host" title="Open a room so your friends can rejoin">Host</button>` +
        `<button class="ghost" data-load="${s.slot}" data-how="solo" title="Play alone; the AI runs your friends' empires">Solo</button>`;
    }
    return `<button class="primary" data-load="${s.slot}" data-how="solo">Load</button>`;
  }

  function renderSaves() {
    const saves = readSaves().filter(s => s.meta);
    $("savesBox").hidden = !saves.length;
    $("savesList").innerHTML = saves.map(s => `<div class="save-row">${saveLabel(s)}${loadButtons(s)}</div>`).join("");
  }

  function writeSave(slot) {
    const G = Game.state;
    const meta = {
      savedAt: Date.now(), mode: G.settings.mode, time: G.time, empire: G.empires[S.me].name, share: Game.worldShare(S.me),
      multiplayer: !!G.settings.multiplayer, players: G.empires.filter(e => e.human && e.playerName).map(e => e.playerName),
    };
    try {
      localStorage.setItem(SAVE_PREFIX + slot, JSON.stringify({ meta, state: Game.serialize() }));
      toast(slot === "auto" ? "Autosaved." : "Game saved to slot " + slot + ".", "good");
      return true;
    } catch {
      toast("Couldn't save. Your browser is blocking storage for this page.", "bad");
      return false;
    }
  }

  // how: "solo" plays alone (the AI runs other players' empires) or "host" reopens it online.
  async function loadSave(slot, how = "solo") {
    if (S.busy) return;
    try {
      const data = JSON.parse(localStorage.getItem(SAVE_PREFIX + slot));
      Game.load(world, data.state);
    } catch (err) {
      toast("Couldn't load that save. " + (err.message || ""), "bad");
      return;
    }
    if (online()) Net.leave();
    S.me = 0;
    for (const e of Game.state.empires) if (e.human && e.id !== S.me && e.alive) Game.setAway(e.id, true);
    if (how === "host") {
      S.busy = true;
      toast("Opening a room…");
      try {
        await Net.hostSaved(myName(), S.me, prefs());
      } catch (err) {
        S.busy = false;
        toast(err.message, "bad");
        return;
      }
      S.busy = false;
    }
    enterGame();
    const owned = Game.cache.owned[S.me];
    if (owned.length) Map.focus(owned[0], 3);
    if (how === "host") {
      S.paused = true;
      log(`🌐 Room code ${Net.code}. Friends rejoin by joining with the same names as last time. Press Space when everyone is back.`, "good");
    } else log("Game loaded. The war resumes!", "good");
  }

  // ---------- starting a war ----------
  function startGame() {
    const st = S.setup;
    if (st.country < 0) { toast("Pick a nation first.", "bad"); return; }
    if (!Bootcamp.status()) { offerBootcamp(startGame); return; }
    if (st.scenario === "underdog" && world.countries[st.country].value >= WD.UNDERDOG_MAX) {
      toast(`Underdog needs a small nation (income under +$${WD.UNDERDOG_MAX}/s). Pick one, or press 🎲 for a random one.`, "bad");
      Sound.play("error");
      return;
    }
    S.me = 0;
    Game.newGame(world, {
      mode: st.mode, difficulty: st.difficulty, rivals: st.rivals, victory: st.victory, scenario: st.scenario, fog: st.fog,
      playerCountry: st.country, playerColor: Progress.color(), playerTitle: Progress.title(),
    });
    enterGame();
    Map.focus(st.country, 3);
    introLogs();
  }

  function startOnline() {
    const players = Net.lobby.players;
    if (!players.every(p => p.country >= 0)) { toast("Everyone needs to pick a nation first.", "bad"); return; }
    const st = S.setup;
    Game.newGame(world, {
      mode: st.mode, difficulty: st.difficulty, rivals: st.rivals, victory: st.victory, teams: st.teams, multiplayer: true,
      scenario: st.scenario, fog: st.fog,
      humans: players.map(p => ({ country: p.country, name: p.name, color: p.color, title: p.title })),
    });
    S.me = 0;
    Net.beginGame();
    enterGame();
    Map.focus(players[0].country, 3);
    introLogs();
  }

  function introLogs() {
    const G = Game.state, st = G.settings, me = G.empires[S.me], perk = WD.PERKS[me.perk];
    const goal = st.teams === "coop" && online() ? `Together with your team, control ${st.victory}% of the world to win!` : `Control ${st.victory}% of the world to win!`;
    log(`Your empire rises in ${nameOf(me.start)}. ${goal}`, "good", me.start);
    log(`${perk.icon} Your superpower, ${perk.name}: ${perk.desc}`, "info");
    log(`🕊 Opening ceasefire: for ${fmtTime(WD.MODES[st.mode].grace)} rival empires only grab independent nations. Mobilization doubles your income at first. Expand fast!`, "info");
    if (me.team) {
      const sc = WD.SCENARIOS[st.scenario];
      log(`🤝 You fight for the ${sc.teams[me.team]}. Your teammates are your allies, for now.`, "info");
    }
    if (st.fog) log("🌫 Fog of war: enemy troops show as ? until your land, armies or aircraft get close.", "info");
    if (online()) log("Press Enter to chat with the other players.", "info");
    News.push({ text: `📰 War breaks out across the globe. ${G.empires.filter(e => e.alive).length} empires race for world domination.`, cls: "info" });
  }

  function enterGame() {
    const G = Game.state;
    S.phase = "game";
    S.mirror = isClient();
    S.paused = false;
    S.speed = 1;
    S.modalPause = false;
    S.selected = -1;
    S.sheetMin = false;
    S.panelKey = "";
    S.proposalKey = "";
    S.graceLeft = G.settings.tutorial ? 0 : WD.MODES[G.settings.mode].grace - G.time;
    S.vision = null;
    S.overInfo = null;
    S.offerKey = S.bountyKey = "";
    S.threatIds = new Set(Map.threats().map(t => t.id));
    closeModal();
    closeChat();
    $("setupSlot").appendChild($("setupBlock"));
    Globe.hide();
    Map.show();
    $("menu").hidden = true;
    $("hud").hidden = false;
    $("leaderboard").hidden = false;
    $("leaderboard").__rows = null;
    $("ticker").hidden = false;
    Minimap.show();
    S.bountyH = undefined;
    News.clear();
    $("log").innerHTML = "";
    $("toasts").innerHTML = "";
    const me = G.empires[S.me], perk = WD.PERKS[me.perk];
    $("hudFlag").innerHTML = flag(me.start);
    $("hudPerk").textContent = perk.icon;
    $("hudPerk").title = `${perk.name}: ${perk.desc}`;
    $("hudName").textContent = me.name;
    const mode = WD.MODES[G.settings.mode].name;
    $("hudSub").textContent = S.bootcamp ? "Boot Camp · Training"
      : online() ? `${isHost() ? "Host" : "Online"} · ${mode}` : `${mode} · ${WD.DIFFICULTY[G.settings.difficulty].name}`;
    $("hudGoal").textContent = `${G.settings.teams === "coop" && G.settings.multiplayer ? "team " : ""}goal ${G.settings.victory}%`;
    $("hudGoalMark").style.left = `calc(${Math.min(100, G.settings.victory)}% - 1px)`;
    $("btnSave").hidden = isClient() || S.bootcamp;
    $("btnRoom").hidden = !isHost();
    $("btnChat").hidden = !online();
    $("hudCode").textContent = Net.code || "";
    Map.recolorAll();
    select(-1);
    const home = Game.cache.owned[S.me].includes(me.capital) ? me.capital : Game.cache.owned[S.me][0];
    if (home !== undefined) Map.beacon(home);
    // Boot Camp has its own coach, so the first-war missions stay out of its way.
    if (settings.tips && !S.bootcamp) Guide.start({ onComplete: () => Sound.play("capture") });
    else Guide.stop();
    refreshUi();
  }

  // ---------- multiplayer lobby ----------
  function myName() {
    const name = $("mpName").value.trim().slice(0, 20);
    return name || "Commander";
  }

  async function hostGame() {
    if (S.busy) return;
    if (!Bootcamp.status()) { offerBootcamp(hostGame); return; }
    S.busy = true;
    toast("Opening a room…");
    try {
      await Net.host(myName(), prefs());
    } catch (err) {
      toast(err.message, "bad");
      return;
    } finally {
      S.busy = false;
    }
    showLobby();
  }

  async function joinGame() {
    if (S.busy) return;
    if (!Bootcamp.status()) { offerBootcamp(joinGame); return; }
    S.busy = true;
    toast("Connecting…");
    try {
      await Net.join($("mpCode").value, myName(), prefs());
    } catch (err) {
      toast(err.message, "bad");
      return;
    } finally {
      S.busy = false;
    }
    if (!Net.inGame) showLobby();   // rejoining a war in progress goes straight into it (the "start" event)
  }

  function showLobby() {
    S.phase = "lobby";
    S.lobbyHtml = "";
    $("menuMain").hidden = true;
    $("menuLobby").hidden = false;
    $("lobbySetupSlot").appendChild($("setupBlock"));
    if (isClient() && Net.lobby.settings) Object.assign(S.setup, Net.lobby.settings);
    // Claim the nation picked on the main menu, unless a friend already has it.
    const want = S.setup.country;
    const taken = want >= 0 && Net.lobby.players.some(p => p.country === want && p.id !== Net.me);
    if (taken) S.setup.country = -1;
    renderSetup();
    renderLobby();
    if (want >= 0 && !taken) Net.pickNation(want);
    if (isHost()) settingsChanged();
    Sound.play("notify");
  }

  function renderLobby() {
    if (S.phase !== "lobby") return;
    const host = isHost();
    $("lobbyTitle").textContent = host ? "Room code" : "Joined room";
    $("lobbyCode").textContent = Net.code || "······";
    $("btnCopyInvite").hidden = !host;
    $("lobbyHint").textContent = host
      ? "Send your friends the invite link: it opens the game with this code filled in. They can also type the code under Play with friends."
      : "Pick your nation on the globe. The host sets the rules and starts the war.";
    const players = Net.lobby.players;
    $("lobbyCount").textContent = `${players.length}/${WD.MAX_PLAYERS}`;
    const pin = p => { const r = WD.RANKS[p.rank]; return Number.isInteger(p.rank) && r ? `<span class="pin-sm" title="${esc(r.name)}">${r.pin}</span>` : ""; };
    const html = players.map(p => `<div class="player-row">${p.country >= 0 ? flag(p.country) : '<span class="flag noflag"></span>'}
      <div class="who"><b style="color:${col(p.color)}">${pin(p)}${esc(p.name)}${p.id === Net.me ? " (you)" : ""}</b>
      <span class="${p.country >= 0 ? "picked" : ""}">${p.country >= 0 ? esc(nameOf(p.country)) : "Choosing a nation…"}</span></div>
      ${p.id === "host" ? '<span class="tag">Host</span>' : ""}</div>`).join("");
    if (html !== S.lobbyHtml) { $("lobbyPlayers").innerHTML = html; S.lobbyHtml = html; }
    const ready = players.length > 0 && players.every(p => p.country >= 0);
    const start = $("btnLobbyStart");
    start.hidden = !host;
    start.disabled = !ready;
    start.textContent = ready ? (players.length > 1 ? `Start the war (${players.length} players)` : "Start the war") : "Waiting for everyone to pick a nation";
    $("lobbyWait").hidden = host;
  }

  async function copyCode() {
    const code = Net.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast(`Copied room code ${code}.`, "good");
    } catch {
      toast(`Room code: ${code}`);
    }
  }

  // A link that opens the game with the room code filled in. From disk it points at the
  // published copy, since a friend can't open a file on this computer.
  function inviteUrl(code) {
    const base = /^https?:$/.test(location.protocol) ? location.origin + location.pathname : WD.GAME_URL;
    return `${base}?join=${code}`;
  }

  async function copyInvite() {
    const code = Net.code;
    if (!code) return;
    const url = inviteUrl(code);
    try {
      await navigator.clipboard.writeText(url);
      toast("Invite link copied. Paste it to your friends.", "good");
    } catch {
      toast(`Invite link: ${url}`);
    }
  }

  // Opened from an invite link: fill in the room code and point at the Join button.
  function acceptInvite() {
    const code = String(new URLSearchParams(location.search).get("join") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (code.length !== 6) return;
    $("mpCode").value = code;
    const box = $("btnJoin").closest(".box");
    box.classList.add("invited");
    box.scrollIntoView({ block: "center" });
    $("mpName").focus();
    $("mpName").select();
    toast(Bootcamp.status() ? `You're invited to room ${code}. Type your name and press Join.`
      : `You're invited to room ${code}. New here? Do the 3-minute Boot Camp first; the code stays filled in.`, "good");
  }

  // ---------- modals ----------
  function openModal(name, html) {
    S.modal = name;
    S.modalPause = true;
    document.body.classList.add("modal-open");
    $("modalCard").innerHTML = html;
    $("modal").hidden = false;
    $("tooltip").hidden = true;
  }
  function closeModal() {
    S.modal = null;
    S.modalPause = false;
    document.body.classList.remove("modal-open");
    $("modal").hidden = true;
    Replay.stop();
  }

  function openGameMenu() {
    const items = isClient()
      ? `<button data-m="resume">▶ Back to the war</button>
         <button data-m="settings">⚙ Settings</button>
         <button data-m="help">⌨ Controls</button>
         <button data-m="quit">🏳 Leave the game</button>`
      : `<button data-m="resume">▶ ${online() ? "Back to the war" : "Resume"}</button>
         ${S.bootcamp ? "" : `<button data-m="saves">💾 ${online() ? "Save game" : "Save or load"}</button>`}
         <button data-m="settings">⚙ Settings</button>
         <button data-m="help">${S.touch ? "👆" : "⌨"} Controls</button>
         <button data-m="howto">❓ How to play</button>
         <button data-m="quit">🏳 ${online() ? "End the game for everyone" : "Quit to main menu"}</button>`;
    const full = canFullscreen() ? `<button data-m="fullscreen">⛶ ${isFullscreen() ? "Leave fullscreen" : "Fullscreen"}</button>` : "";
    const lead = online() ? "The war keeps going while this menu is open." : "The war waits for you.";
    openModal("menu", `<h2>${online() ? "Command menu" : "Paused"}</h2><p class="lead">${lead}</p><div class="menu-list">${items}${full}</div>`);
  }

  function openSaves() {
    if (isClient()) return;
    const rows = readSaves().map(s => {
      const canSave = s.slot !== "auto";
      return `<div class="save-row">${saveLabel(s)}
        ${canSave ? `<button class="ghost" data-save="${s.slot}">Save here</button>` : ""}
        ${online() ? "" : loadButtons(s)}</div>`;
    }).join("");
    const lead = online()
      ? "Saves stay in this browser. To continue later, load the save, click Host, and your friends join with the same names."
      : `Saves stay in this browser on this computer.${WD.MODES[Game.state.settings.mode].autosave ? " Long Campaign also autosaves every minute." : ""}`;
    openModal("saves", `<h2>${online() ? "Save game" : "Save or load"}</h2><p class="lead">${lead}</p>
      <div class="box">${rows}</div><div class="foot"><button class="ghost" data-m="close">Close</button></div>`);
  }

  function openHowTo() {
    openModal("howto", `<h2>How to play</h2>${document.querySelector(".howto ul").outerHTML}<div class="foot"><button class="ghost" data-m="close">Close</button></div>`);
  }

  function openHelp() {
    if (S.touch) {
      const taps = [
        ["Select one of your nations", "Tap it"], ["See the odds, then attack", "Tap a target · ⚔ Attack"],
        ["Zoom · move the map", "Pinch · drag"], ["Buy units", "Tap a unit card"],
        ["Buy 5 or 10 per tap", "×5 · ×10"], ["Send part of the army", "Deploy · 25% to All"],
        ["Air strike · bombard · missile", "Orders, then the target"], ["Cancel an order", "✕ on the gold bar"],
        ["Deselect", "Tap the sea"], ["Shrink the panel", "Tap its title"],
        ["Pause · game speed", "❚❚ · 1×"], ["Shop · Autopilot · Diplomacy", "🛒 · 🛡 · 🤝"],
        ["Chat (online)", "💬"], ["Menu, saves and settings", "☰"],
      ];
      const grid = taps.map(([what, how]) => `<div><span>${what}</span><b>${how}</b></div>`).join("");
      openModal("help", `<h2>Controls</h2><div class="keys-grid">${grid}</div><div class="foot"><button class="ghost" data-m="close">Close</button></div>`);
      return;
    }
    const keys = [
      ["Select a country", "Left-click"], ["Move or attack", "Right-click"],
      ["Preview route & odds", "Hover"], ["Zoom / pan", "Scroll / drag"],
      ["Buy infantry · tanks", "Q · W"], ["Buy artillery · warships", "E · R"],
      ["Buy aircraft · missiles", "T · Y"], ["Buy 5 at once", "Shift + key"],
      ["Send 25 · 50 · 75 · 100%", "1 · 2 · 3 · 4"], ["Pick a target by clicking", "G"],
      ["Air strike", "A"], ["Artillery bombard", "B"],
      ["Missile strike", "M"], ["Nuclear strike", "N"],
      ["Shop", "U"], ["Autopilot", "P"],
      ["Diplomacy", "D"], ["Controls", "H"],
      ["Pause (solo or host)", "Space"], ["Game speed", "+ / −"],
      ["Chat (online)", "Enter"], ["Cancel / deselect / menu", "Esc"],
    ];
    const grid = keys.map(([what, key]) => `<div><span>${what}</span>${key.split(" · ").map(k => `<kbd>${esc(k)}</kbd>`).join(" ")}</div>`).join("");
    openModal("help", `<h2>Controls</h2><p class="lead">Press H any time to see this again.</p><div class="keys-grid">${grid}</div><div class="foot"><button class="ghost" data-m="close">Close</button></div>`);
  }

  function openSettings() {
    const snd = Sound.settings;
    const row = (id, title, desc, on) => `<label class="set-row"><div><b>${title}</b><span>${desc}</span></div><input type="checkbox" class="switch" data-set="${id}" ${on ? "checked" : ""}></label>`;
    openModal("settings", `<h2>Settings</h2><p class="lead">Saved in this browser.</p>
      <div class="settings-list">
        ${row("sound", "Sound effects", "Clicks, explosions, alarms and fanfares.", !snd.muted)}
        <label class="set-row"><div><b>Volume</b><span>Master volume for sounds and ambience.</span></div><input type="range" min="0" max="1" step="0.05" value="${snd.volume}" data-set="volume"></label>
        ${row("ambience", "War-room ambience", "A low command-room hum with radar pings.", snd.ambience)}
        ${row("effects", "Visual effects", "Scanlines, glowing borders, animated routes, battle sparks and debris. Turn off for more speed.", settings.effects)}
        ${row("lanes", "Sea lanes", "Dashed lines showing which coasts connect by sea.", settings.lanes)}
        ${row("tips", "Tips and missions", "First-game missions that teach the controls. Turning this on restarts them.", settings.tips && !Guide.finished())}
      </div>
      <div class="foot"><button class="primary" data-m="close">Done</button></div>`);
  }

  function onSettingChange(el) {
    const key = el.dataset.set;
    if (key === "sound") Sound.set({ muted: !el.checked });
    else if (key === "volume") Sound.set({ volume: +el.value });
    else if (key === "ambience") Sound.set({ ambience: el.checked });
    else if (key === "tips") {
      settings.tips = el.checked;
      if (el.checked) { Guide.reset(); if (S.phase === "game") Guide.start({ force: true, onComplete: () => Sound.play("capture") }); }
      else Guide.stop();
    } else settings[key] = el.checked;
    saveSettings();
    applySettings();
    Sound.play("click");
  }

  // ---------- shop: research tiers and the arsenal ----------
  const SHOP_TABS = [...WD.TECH_TIERS.map((t, tier) => ({ id: "t" + tier, name: t.name, tier })), { id: "arsenal", name: "Arsenal" }];

  function techCards(me, tier) {
    const base = Math.round(WD.TECH_TIERS[tier].cost * WD.MODES[Game.state.settings.mode].income / 10) * 10;
    return WD.TECH_IDS.filter(id => WD.TECHS[id].tier === tier).map(id => {
      const t = WD.TECHS[id], owned = me.tech.includes(id), locked = !owned && !!Game.techLocked(S.me, id), cost = Game.techCost(S.me, id);
      const price = owned ? `<span class="s-stamp">Owned</span>` : `<span class="s-price">${coin("sm")} ${cost < base ? `<s>${fmt(base)}</s> ` : ""}${fmt(cost)}</span>`;
      const action = owned ? "" : locked ? `<span class="s-lock"><i>🔒</i>Locked</span>` : `<button class="primary" data-tech="${id}" data-cost="${cost}">Buy</button>`;
      return `<div class="shop-card${owned ? " owned" : ""}${locked ? " locked" : ""}"><span class="s-name">${t.name}</span>
        <span class="s-art"><span>${t.icon}</span></span><span class="s-desc">${t.desc}</span>${price}${action}</div>`;
    }).join("");
  }

  function arsenalCards(me) {
    const packs = Object.entries(WD.PACKS).map(([id, p]) => {
      const cost = Game.packCost(S.me, id);
      return `<div class="shop-card"><span class="s-name">${p.name}</span><span class="s-art"><span>${p.icon}</span></span>
        <span class="s-desc">${p.desc} Delivered to your capital.</span>
        <span class="s-price">${coin("sm")} ${fmt(cost)}</span><button class="primary" data-pack="${id}" data-cost="${cost}">Buy</button></div>`;
    }).join("");
    const nuclear = !!Game.mods(S.me).nuclear;
    const desc = nuclear ? `In your silos: ${me.nukes}/${WD.RULES.nukeMax}. Destroys 90% of a nation's forces. The whole world will hate you.`
      : "Needs the Nuclear Program from Tier III.";
    return packs + `<div class="shop-card${nuclear ? "" : " locked"}"><span class="s-name">Nuclear warhead</span><span class="s-art"><span>☢️</span></span>
      <span class="s-desc">${desc}</span><span class="s-price">${coin("sm")} ${fmt(Game.nukeCost())}</span>
      ${nuclear ? `<button class="primary" data-m="buildnuke">Buy</button>` : `<span class="s-lock"><i>🔒</i>Locked</span>`}</div>`;
  }

  function openResearch(tab = S.shopTab || "t0") {
    const G = Game.state, me = G.empires[S.me];
    let i = SHOP_TABS.findIndex(t => t.id === tab);
    if (i < 0) i = 0;
    S.shopTab = SHOP_TABS[i].id;
    const sel = SHOP_TABS[i];
    const tabs = SHOP_TABS.map(t => {
      const locked = t.tier !== undefined && me.tech.length < WD.TECH_TIERS[t.tier].needs;
      return `<button class="tab${t === sel ? " on" : ""}" data-tab="${t.id}">${t.name}${locked ? ' <span class="lock">🔒</span>' : ""}</button>`;
    }).join("");
    let note = `Research works instantly and lasts all war. You have ${me.tech.length} of ${WD.TECH_IDS.length}.`;
    if (sel.tier !== undefined && me.tech.length < WD.TECH_TIERS[sel.tier].needs) note = `${sel.name} opens once you've researched ${WD.TECH_TIERS[sel.tier].needs} technologies. You have ${me.tech.length}.`;
    if (sel.id === "arsenal") note = me.nukes > 0 ? `<button class="danger" data-m="launch">☢ Launch a warhead (N)</button>` : "Supplies arrive at your capital straight away, with veteran crews where noted.";
    openModal("research", `<div class="shop"><h2 class="ribbon">Shop</h2>
      <div class="shop-wallet">${coin()}<span id="shopMoney">${fmt(me.money)}</span></div>
      <div class="tabs">${tabs}</div>
      <div class="shop-body">
        <button class="shop-arrow left" data-tabstep="-1" ${i === 0 ? "disabled" : ""} aria-label="Previous tab">◀</button>
        <div class="shop-grid">${sel.tier !== undefined ? techCards(me, sel.tier) : arsenalCards(me)}</div>
        <button class="shop-arrow right" data-tabstep="1" ${i === SHOP_TABS.length - 1 ? "disabled" : ""} aria-label="Next tab">▶</button>
      </div>
      <p class="shop-note">${note}</p>
      <div class="foot"><button class="ghost" data-m="close">Close</button></div></div>`);
    updateResearch();
  }

  // Keep the shop's buttons in step with the treasury while it's open.
  function updateResearch() {
    const me = Game.state.empires[S.me], card = $("modalCard");
    const money = $("shopMoney");
    if (money) money.textContent = fmt(me.money);
    for (const b of card.querySelectorAll("[data-tech], [data-pack]")) b.disabled = me.money < +b.dataset.cost;
    const build = card.querySelector('[data-m="buildnuke"]');
    if (build) build.disabled = me.money < Game.nukeCost() || me.nukes >= WD.RULES.nukeMax;
    const launch = card.querySelector('[data-m="launch"]');
    if (launch) launch.disabled = me.nukes < 1;
  }

  // ---------- autopilot ----------
  function openAutopilot() {
    const me = Game.state.empires[S.me];
    if (!me.auto) return;
    const a = me.auto, st = me.autoStats || {};
    const row = (id, title, desc, on) => `<label class="set-row"><div><b>${title}</b><span>${desc}</span></div><input type="checkbox" class="switch" data-auto="${id}" ${on ? "checked" : ""}></label>`;
    openModal("autopilot", `<h2>Autopilot</h2>
      <p class="lead">How your nations look after themselves between your orders. It leaves alone any nation you gave orders in during the last ${WD.RULES.touchSecs} seconds.</p>
      <div class="auto-list">
        <div class="set-row always"><div><b>🛡 Local militia</b><span>Every nation raises free defenders up to a safe level, more once it has settled in. They never leave home.</span></div><span class="on-tag">Always on</span></div>
        <div class="set-row"><div style="flex:1"><b>💰 Defense budget</b><span>Share of your income spent on infantry wherever an attack is coming.</span>
          <div class="auto-budget"><input type="range" min="0" max="0.5" step="0.05" value="${a.budget}" data-auto="budget" aria-label="Defense budget"><b id="autoBudget"></b></div></div></div>
        ${row("reinforce", "🚚 Auto-reinforce", "Idle troops in nations with no enemy next door march to threatened borders.", a.reinforce)}
        ${row("retake", "⚔ Auto-retake", "When you lose a nation, nearby troops strike back if they can win it.", a.retake)}
        ${row("caretaker", "🏦 Caretaker", "If you give no orders for a minute, the autopilot may also spend your savings on defense.", a.caretaker)}
      </div>
      <div class="auto-stats"><div><b>$${fmt(st.spent || 0)}</b><span>Spent</span></div><div><b>${fmt(st.recruited || 0)}</b><span>Recruited</span></div>
        <div><b>${fmt(st.moved || 0)}</b><span>Troops sent</span></div><div><b>${st.retaken || 0}</b><span>Won back</span></div></div>
      <div class="foot"><button class="primary" data-m="close">Done</button></div>`);
    autoBudgetLabel(a.budget);
  }

  function autoBudgetLabel(budget) {
    const el = $("autoBudget");
    if (el) el.textContent = budget > 0 ? `${Math.round(budget * 100)}% · $${fmtRate(Game.incomeOf(S.me) * budget)}/s` : "Off";
  }

  function onAutoChange() {
    const card = $("modalCard");
    const cfg = {
      budget: +card.querySelector('[data-auto="budget"]').value,
      reinforce: card.querySelector('[data-auto="reinforce"]').checked,
      retake: card.querySelector('[data-auto="retake"]').checked,
      caretaker: card.querySelector('[data-auto="caretaker"]').checked,
    };
    act("setAutopilot", cfg).then(r => {
      if (!r.ok) { toast(r.reason, "bad"); return; }
      if (!isClient()) updateHud();
    });
  }

  // ---------- yes / no questions ----------
  let confirmDone = null;
  // tone: "danger" (red yes, for leaving or ending things) or "primary" (gold yes, for an invitation).
  function confirmBox({ title, text, yes = "Yes", no = "No", tone = "danger" }) {
    $("confirmTitle").textContent = title;
    $("confirmText").textContent = text;
    $("confirmYes").className = tone === "primary" ? "primary" : "danger";
    $("confirmYes").textContent = yes;
    $("confirmNo").textContent = no;
    $("confirm").hidden = false;
    $("confirmNo").focus();
    return new Promise(resolve => { confirmDone = resolve; });
  }
  function closeConfirm(answer) {
    $("confirm").hidden = true;
    const done = confirmDone;
    confirmDone = null;
    if (done) done(answer);
  }

  function attitude(op) {
    if (op > 30) return ["Friendly", "friendly"];
    if (op > 5) return ["Cordial", "friendly"];
    if (op > -10) return ["Neutral", ""];
    if (op > -30) return ["Wary", "wary"];
    return ["Hostile", "hostile"];
  }

  function renderDiplomacy() {
    const G = Game.state;
    const coop = G.settings.teams === "coop";
    const others = G.empires.filter(e => e.alive && e.id !== S.me).sort((a, b) => Game.worldShare(b.id) - Game.worldShare(a.id));
    const okBtn = /<button class="okb"[^>]*>[^<]*<\/button>/;
    const rows = others.map(e => {
      const rel = Game.relation(S.me, e.id);
      const teammate = coop && e.human && G.empires[S.me].human;
      const [att, attCls] = e.human && !e.away ? ["Player", ""] : attitude(Game.opinion(e.id, S.me));
      const border = Game.shareBorder(S.me, e.id) ? " · borders you" : "";
      let acts = "";
      if (teammate) acts = `<span class="tag">Teammate</span>`;
      else {
        if (rel === "war") acts = `<button class="okb" data-dip="peace" data-e="${+e.id}">Offer peace</button>`;
        if (rel === "peace") acts = `<button class="okb" data-dip="alliance" data-e="${+e.id}">Offer alliance</button>`;
        if (rel !== "war") acts += `<button class="danger" data-dip="war" data-e="${+e.id}">Declare war</button>`;
        const cool = 30 - (G.time - (e.refused[S.me] ?? -999));
        if (G.proposals.some(p => p.from === S.me && p.to === e.id)) acts = acts.replace(okBtn, `<button class="okb" disabled>Offer sent…</button>`);
        else if (e.isAI && cool > 0 && rel !== "alliance") acts = acts.replace(okBtn, `<button class="okb" disabled>Refused · retry in ${Math.ceil(cool)}s</button>`);
      }
      const player = e.human && e.playerName ? ` <small style="color:var(--muted);font-weight:500">(${esc(who(e))})</small>` : "";
      const perk = WD.PERKS[e.perk];
      const P = e.leader && !e.human ? WD.PERSONAS[e.leader.persona] : null;
      const ldr = P ? `<br><small class="ldr" title="${esc(P.desc)}">${e.leader.face} ${esc(leaderName(e))} · ${P.icon} ${P.name}</small>` : "";
      const team = e.team ? ` · ${esc(WD.SCENARIOS[G.settings.scenario]?.teams?.[e.team] || "")}` : "";
      const held = Game.cache.owned[e.id].length;
      return `<tr><td class="nm">${flag(e.start)}<span>${esc(e.name)} <span class="perk-ic" title="${esc(perk.name)}: ${esc(perk.desc)}">${perk.icon}</span>${e.nukes > 0 ? ' <span title="Has nuclear warheads">☢</span>' : ""}${player}${ldr}<br><small style="color:var(--muted);font-weight:400">${held} nation${held === 1 ? "" : "s"}${border}${team}</small></span></td>
        <td class="num">${Game.worldShare(e.id).toFixed(1)}%</td>
        <td><span class="attitude ${attCls}">${att}</span></td>
        <td><span class="rel ${rel}">${REL_ICON[rel]} ${rel}</span></td>
        <td><div class="acts-cell">${acts}</div></td></tr>`;
    }).join("");
    const lead = "Everyone starts at war. Peace stops the fighting between you. An alliance also lets your armies march through each other's land. Breaking a treaty makes every empire trust you less." +
      (online() ? " Offers to other players wait 25 seconds for an answer." : "") + (coop && online() ? " Co-op teammates are allied for good." : "");
    openModal("diplomacy", `<h2>Diplomacy</h2><p class="lead">${lead}</p>
      <table class="dip-table"><tr><th>Empire</th><th>World</th><th>Attitude</th><th>Status</th><th></th></tr>${rows || `<tr><td colspan="5">No rivals left.</td></tr>`}</table>
      <div class="foot"><button class="ghost" data-m="close">Close</button></div>`);
  }

  function showGameOver(over) {
    const G = Game.state, won = over.winners.includes(S.me);
    const career = bankCareer(true);
    // A Boot Camp sandbox played to the end is still practice: it adds no war, win or stars.
    if (!G.settings.tutorial) Progress.finishWar(G.id, won, G.settings.scenario, G.settings.difficulty);
    S.overInfo = { over, career, fresh: true };
    Sound.play(won ? "victory" : "defeat");
    if (career?.promoted) setTimeout(() => Sound.play("rankup"), 1800);
    renderOver();
  }

  // A score for bragging rights: conquests, kills, capitals, contracts, medals and land, scaled by difficulty.
  function warScore(e, won) {
    const s = e.stats;
    let score = s.captures * 120 + s.kills * 3 + s.capitals * 1500 + s.bounties * 600 + Object.keys(e.medals || {}).length * 2000 + Game.worldShare(e.id) * 400;
    score *= { easy: 0.8, normal: 1, hard: 1.5 }[Game.state.settings.difficulty] || 1;
    if (won) score *= 1.5;
    return Math.round(score / 10) * 10;
  }

  // The RESULT screen: stars, a laurel wreath, the war score and your rank's progress bar.
  function renderOver() {
    const info = S.overInfo, { over, career } = info;
    const G = Game.state, me = G.empires[S.me];
    const won = over.winners.includes(S.me);
    const coop = G.settings.teams === "coop" && over.winners.length > 1;
    const share = (won ? over.winners.reduce((s, id) => s + Game.worldShare(id), 0) : Game.worldShare(S.me)).toFixed(1);
    const names = over.winners.map(id => G.empires[id].playerName || G.empires[id].name).join(" and ");
    const sub = won ? (coop ? `Your team holds ${share}% of the world` : `${me.name} · ${share}% of the world`)
      : over.winners.length ? `${names} conquered the world` : "Your empire has fallen";
    const ais = G.empires.filter(e => !e.human);
    const stats = `<div class="stats-grid"><div><b>${fmtTime(over.time)}</b><span>Time</span></div><div><b>${Game.cache.owned[S.me].length}</b><span>Nations held</span></div><div><b>${ais.filter(e => !e.alive).length}/${ais.length}</b><span>AI empires destroyed</span></div>
      <div><b>${fmt(me.stats.kills)}</b><span>Enemy troops destroyed</span></div><div><b>${me.stats.capitals}</b><span>Capitals taken</span></div><div><b>${me.stats.bounties}</b><span>Contracts done</span></div></div>`;
    const medals = Object.keys(me.medals || {}).filter(id => WD.MEDALS[id]);
    const medalsHtml = medals.length
      ? `<div class="won-medals"><h5>Medals this war</h5>${medals.map(id => `<span class="medal-chip" title="${esc(WD.MEDALS[id].desc)}">${WD.MEDALS[id].icon} ${WD.MEDALS[id].name}</span>`).join("")}</div>` : "";
    const xp = Progress.data.xp, r = Progress.rank(), rank = WD.RANKS[r], next = WD.RANKS[r + 1];
    const pctOf = v => (next ? Math.max(0, Math.min(100, (v - rank.xp) / (next.xp - rank.xp) * 100)) : 100);
    // The bar fills from where it stood before this war (from empty after a promotion).
    const from = info.fresh && career && !career.promoted ? pctOf(career.before) : pctOf(xp);
    let promo = "";
    if (career?.promoted) {
      const gains = [];
      for (let i = Progress.rankAt(career.before) + 1; i <= r; i++) gains.push(...Progress.unlocks(i));
      promo = `<div class="promo">🎖 Promoted to <b>${rank.name}</b>!${gains.length ? ` Unlocked ${gains.join(", ")}.` : ""}</div>`;
    }
    const score = warScore(me, won);
    const nextBtn = online()
      ? `<button class="primary" data-m="close">${won ? "Keep conquering" : "Keep watching"}</button>`
      : `<button class="primary" data-m="nextwar">Next war ▶</button>`;
    const keep = !online() && won ? `<button class="keep" data-m="close">Keep conquering this war</button>` : "";
    openModal("over", `<div class="result">
      <h2 class="ribbon">Result</h2>
      <div class="result-stars">${starRow(Progress.warStars(won, G.settings.difficulty))}</div>
      <div class="wreath ${won ? "win" : "lose"}">${laurel(!won)}<div class="plaque"><b>${won ? "You win" : "Defeat"}</b><span>${esc(sub)}</span></div></div>
      <div class="result-score" id="resultScore">${info.fresh ? 0 : score.toLocaleString()}</div><div class="result-score-label">War score</div>
      <div class="result-lv"><span class="lv">${rank.pin} ${rank.name}</span><div class="xp-bar"><i id="resultXp" style="width:${from.toFixed(1)}%"></i></div><small>+${fmt(career?.add || 0)} XP</small></div>
      <div class="result-xp-note">${next ? `${fmt(next.xp - xp)} XP to ${next.name}` : "Highest rank reached"}</div>
      ${promo}${stats}${medalsHtml}
      <div class="foot"><button class="ghost" data-m="quit">Exit</button><button class="ghost" data-m="replay">Replay</button>${nextBtn}</div>
      ${keep}</div>`);
    // Count the score up and fill the bar, the first time only.
    if (!info.fresh) return;
    info.fresh = false;
    requestAnimationFrame(() => { const bar = $("resultXp"); if (bar) bar.style.width = pctOf(xp).toFixed(1) + "%"; });
    const el = $("resultScore"), t0 = performance.now();
    const step = now => {
      if (!el.isConnected) return;
      const f = Math.min(1, (now - t0) / 1400);
      el.textContent = (Math.round(score * (1 - Math.pow(1 - f, 3)) / 10) * 10).toLocaleString();
      if (f < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function openReplay() {
    const G = Game.state;
    const history = G.history || Net.history;
    if (!history) { toast("The replay is still on its way from the host. Try again in a moment.", "bad"); return; }
    const end = G.over ? G.over.time : G.time;
    openModal("replay", `<h2>The war in ${fmtTime(end)}</h2><p class="lead">Every conquest from the first shot to the last. Drag the slider to scrub through the war.</p>
      <div id="replayBox" class="replay"></div>
      <div class="foot"><button class="primary" data-m="backover">Back</button></div>`);
    Replay.mount($("replayBox"), { world, history, empires: G.empires.map(e => ({ name: e.name, color: col(e.color) })), end, me: S.me });
  }

  function showFallen() {
    Sound.play("defeat");
    openModal("over", `<div class="result"><h2 class="ribbon">Result</h2><div class="result-stars">${starRow(0)}</div>
      <div class="wreath lose">${laurel(true)}<div class="plaque"><b>Fallen</b><span>Your empire has been wiped out</span></div></div>
      <p class="lead" style="margin-top:12px">You can keep watching the war or leave the game.</p>
      <div class="foot"><button class="ghost" data-m="quit">${isHost() ? "End game" : "Leave game"}</button><button class="primary" data-m="close">Keep watching</button></div></div>`);
  }

  function onModalClick(ev) {
    const b = ev.target.closest("button");
    if (ev.target === $("modal") && S.modal !== "over" && S.modal !== "replay") { closeModal(); return; }
    if (!b) return;
    if (b.dataset.tech) {
      const id = b.dataset.tech;
      b.disabled = true;
      act("research", id).then(r => {
        if (!r.ok) { toast(r.reason, "bad"); Sound.play("error"); }
        if (S.modal === "research") openResearch();
      });
      return;
    }
    if (b.dataset.pack) {
      const p = WD.PACKS[b.dataset.pack];
      b.disabled = true;
      act("buyPack", b.dataset.pack).then(r => {
        if (!r.ok) { toast(r.reason, "bad"); Sound.play("error"); }
        else {
          toast(`📦 ${p.name} delivered to ${nameOf(r.at)}.`, "good");
          Sound.play("cash");
          Map.flash(r.at);
        }
        if (S.modal === "research") openResearch();
      });
      return;
    }
    if (b.dataset.tab) { openResearch(b.dataset.tab); return; }
    if (b.dataset.tabstep) {
      const i = SHOP_TABS.findIndex(t => t.id === S.shopTab) + +b.dataset.tabstep;
      if (SHOP_TABS[i]) openResearch(SHOP_TABS[i].id);
      return;
    }
    if (b.dataset.save) {
      const slot = b.dataset.save;
      if (readSaves().find(s => s.slot === slot).meta && !b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Overwrite?"; return; }
      if (writeSave(slot)) openSaves();
      return;
    }
    if (b.dataset.load) { loadSave(b.dataset.load, b.dataset.how); return; }
    if (b.dataset.dip) {
      const e = +b.dataset.e, kind = b.dataset.dip;
      if (kind === "war" && !b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Confirm war?"; return; }
      b.disabled = true;
      const req = kind === "war" ? act("declareWar", e) : act("propose", e, kind);
      req.then(r => {
        const target = Game.state.empires[e];
        if (!r.ok) { toast(r.reason, "bad"); Sound.play("error"); }
        else if (r.pending) toast(`Offer sent to ${who(target)}. They have 25 seconds to answer.`, "good");
        else if (kind !== "war") {
          toast(`${target.name} accepted your ${kind === "peace" ? "peace offer" : "alliance"}!${r.quote ? " " + r.quote : ""}`, "good");
          Sound.play("notify");
        } else Sound.play("alert");
        if (S.modal === "diplomacy") renderDiplomacy();
      });
      return;
    }
    switch (b.dataset.m) {
      case "resume": case "close": closeModal(); break;
      case "saves": openSaves(); break;
      case "howto": openHowTo(); break;
      case "help": openHelp(); break;
      case "settings": openSettings(); break;
      case "replay": openReplay(); break;
      case "fullscreen": closeModal(); toggleFullscreen(); break;
      case "backover": if (S.overInfo) renderOver(); else closeModal(); break;
      case "launch": closeModal(); trySetAction("nuke"); break;
      case "buildnuke":
        b.disabled = true;
        act("buildNuke").then(r => {
          if (!r.ok) { toast(r.reason, "bad"); Sound.play("error"); }
          else { toast("☢ Warhead ready. Press N to launch it.", "bad"); Sound.play("research"); }
          if (S.modal === "research") openResearch();
          updateHud();
        });
        break;
      case "nextwar":
        // Another war with the same nation and rules.
        bankCareer(true);
        closeModal();
        startGame();
        break;
      case "quit": {
        // Leaving a finished war needs no second thought; leaving a running one does.
        if (S.modal === "over" && Game.state?.over) { showMenu(); break; }
        const text = isClient() ? "Leave the war? The AI will run your empire until you rejoin."
          : online() ? "End the war? Everyone goes back to the menu."
          : "Are you sure you want to exit? Unsaved progress will be lost.";
        confirmBox({ title: "Exit", text, yes: "Yes", no: "No" }).then(yes => { if (yes) showMenu(); });
        break;
      }
    }
  }

  // ---------- input wiring ----------
  function setSpeed(v) {
    if (isClient()) { toast("Only the host can pause or change the speed."); return; }
    if (v === 0) S.paused = !S.paused;
    else { S.speed = v; S.paused = false; }
    updateHud();
  }

  // Touch or mouse: whichever the player used last. Phones start in touch mode, and a laptop with a
  // touchscreen switches back to mouse controls as soon as the mouse moves.
  function setTouch(on) {
    if (S.touch === on) return;
    S.touch = on;
    document.body.classList.toggle("touch", on);
    closeTargetCard();
    if (S.action) setAction(S.action);
    if (on) { $("tooltip").hidden = true; if (S.hover >= 0) { S.hover = -1; Map.hover(-1); updatePreview(-1); } }
  }

  // Fullscreen hides the browser's bars on phones. iPhones can't do it for a web page, but the game
  // runs fullscreen there once it's added to the home screen.
  const canFullscreen = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function toggleFullscreen() {
    const d = document, el = d.documentElement;
    const req = isFullscreen() ? (d.exitFullscreen || d.webkitExitFullscreen).call(d)
      : (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: "hide" });
    Promise.resolve(req).catch(() => toast("This browser won't go fullscreen here.", "bad"));
  }
  const standalone = () => matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches || navigator.standalone === true;
  const iOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // The part of the screen where the map shows: below the top bar and above the news ticker (and on
  // upright phones above the sheet). The map centers what it jumps to and places attack arrows inside it.
  function mapInsets() {
    const ticker = $("ticker");
    let top = 0;
    for (const id of ["hud", "coach", "mission"]) if (!$(id).hidden) top = Math.max(top, $(id).getBoundingClientRect().bottom);
    let bottom = ticker.hidden ? 0 : innerHeight - ticker.getBoundingClientRect().top;
    if (sheetMq.matches) for (const id of ["panel", "targetCard"]) if (!$(id).hidden) bottom = Math.max(bottom, innerHeight - $(id).getBoundingClientRect().top);
    return { top, bottom };
  }

  // Phones stack things: the coach under the top bar, chips under the coach, the log over the sheet.
  // The stylesheet places them with these sizes, kept current as the elements change size.
  function watchSizes() {
    const root = document.documentElement.style;
    const update = () => {
      const coach = $("coach").offsetHeight, mission = $("mission").offsetHeight;
      root.setProperty("--coach-h", coach ? coach + 6 + "px" : "0px");
      root.setProperty("--top-h", coach || mission ? (coach || mission) + 6 + "px" : "0px");
      const sheet = sheetMq.matches ? Math.max($("panel").offsetHeight, $("targetCard").offsetHeight) : 0;
      root.setProperty("--sheet-h", sheet ? sheet + 4 + "px" : "0px");
    };
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(update);
      for (const id of ["coach", "mission", "panel", "targetCard"]) ro.observe($(id));
    }
    compactMq.addEventListener?.("change", update);
    sheetMq.addEventListener?.("change", update);
    update();
  }

  function bindUI() {
    // Browsers only allow sound after the first click or key press.
    addEventListener("pointerdown", () => Sound.unlock(), true);
    addEventListener("keydown", () => Sound.unlock(), true);
    document.body.classList.toggle("touch", S.touch);
    addEventListener("pointerdown", ev => setTouch(ev.pointerType !== "mouse"), true);
    addEventListener("pointermove", ev => { if (ev.pointerType === "mouse" && (ev.movementX || ev.movementY)) setTouch(false); }, true);
    watchSizes();
    document.addEventListener("click", ev => {
      const b = ev.target.closest("button");
      if (b && !b.disabled && !b.closest("#panel .units-grid")) Sound.play("click");
    });

    $("panel").addEventListener("click", onPanelClick);
    $("modal").addEventListener("click", onModalClick);
    $("modal").addEventListener("change", ev => {
      if (ev.target.dataset.set) onSettingChange(ev.target);
      if (ev.target.dataset.auto) onAutoChange();
    });
    $("modal").addEventListener("input", ev => {
      if (ev.target.dataset.set === "volume") Sound.set({ volume: +ev.target.value });
      if (ev.target.dataset.auto === "budget") autoBudgetLabel(+ev.target.value);
    });
    // On phones the rankings and the contracts are chips: tapping the title unfolds them.
    const fold = (box, ev, head) => {
      if (!compact() || !ev.target.closest(head)) return false;
      box.classList.toggle("open");
      return true;
    };
    $("leaderboard").addEventListener("click", ev => { if (!fold($("leaderboard"), ev, ".lb-h") && ev.target.closest(".lb-row")) renderDiplomacy(); });
    $("targetCard").addEventListener("click", onTargetClick);
    $("modeHint").addEventListener("click", ev => { if (ev.target.closest(".mh-x")) setAction(null); });
    $("btnChat").addEventListener("click", openChat);
    $("btnFull").hidden = !canFullscreen();
    $("btnFull").addEventListener("click", toggleFullscreen);
    // iPhones can't go fullscreen from the browser: suggest the home screen instead.
    $("installTip").hidden = !iOS() || standalone();
    let installPrompt = null;
    addEventListener("beforeinstallprompt", ev => { ev.preventDefault(); installPrompt = ev; $("btnInstall").hidden = false; });
    $("btnInstall").addEventListener("click", () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      installPrompt = null;
      $("btnInstall").hidden = true;
    });
    $("alerts").addEventListener("click", ev => { const r = ev.target.closest(".alert-row"); if (r) Map.focus(+r.dataset.c); });
    $("btnDiplomacy").addEventListener("click", renderDiplomacy);
    $("btnTech").addEventListener("click", () => openResearch());
    $("btnAuto").addEventListener("click", openAutopilot);
    $("btnNukes").addEventListener("click", () => trySetAction("nuke"));
    $("confirmYes").addEventListener("click", () => closeConfirm(true));
    $("confirmNo").addEventListener("click", () => closeConfirm(false));
    $("confirm").addEventListener("click", ev => { if (ev.target === $("confirm")) closeConfirm(false); });
    $("hudPerk").addEventListener("click", () => {
      const perk = WD.PERKS[Game.state.empires[S.me].perk];
      toast(`${perk.icon} ${perk.name}: ${perk.desc}`);
    });
    $("bounties").addEventListener("click", ev => {
      if (fold($("bounties"), ev, "h4")) return;
      const row = ev.target.closest("[data-c]");
      if (row) Map.focus(+row.dataset.c);
    });
    $("careerBox").addEventListener("click", ev => {
      const b = ev.target.closest("button");
      if (!b || b.disabled) return;
      if (b.dataset.m === "medals") openMedals();
      if (b.dataset.color && Progress.choose("color", b.dataset.color)) {
        renderCareer();
        if (S.setup.country >= 0) Globe.focus(S.setup.country);
      }
    });
    $("careerBox").addEventListener("change", ev => { if (ev.target.id === "titlePick") Progress.choose("title", ev.target.value); });
    $("bootBox").addEventListener("click", ev => { if (ev.target.closest("[data-boot]")) startBootcamp(); });
    $("scenarioCards").addEventListener("click", ev => {
      const ids = Object.keys(WD.SCENARIOS);
      const arrow = ev.target.closest("[data-car]");
      if (arrow) {
        const i = ids.indexOf(S.setup.scenario);
        pickScenario(ids[(i + +arrow.dataset.car + ids.length) % ids.length]);
        return;
      }
      const card = ev.target.closest("[data-scenario]");
      if (card && card.dataset.scenario !== S.setup.scenario) pickScenario(card.dataset.scenario);
    });
    $("scenarioDots").addEventListener("click", ev => {
      const dot = ev.target.closest("[data-scenario]");
      if (dot) pickScenario(dot.dataset.scenario);
    });
    $("fogToggle").addEventListener("change", ev => { S.setup.fog = ev.target.checked; settingsChanged(); });
    $("btnSave").addEventListener("click", openSaves);
    $("btnMenu").addEventListener("click", openGameMenu);
    $("btnHelp").addEventListener("click", openHelp);
    $("btnMenuSettings").addEventListener("click", openSettings);
    $("btnSound").addEventListener("click", () => { Sound.unlock(); Sound.set({ muted: !Sound.settings.muted }); applySettings(); });
    $("btnRoom").addEventListener("click", copyInvite);
    for (const b of document.querySelectorAll(".hud-speed button[data-speed]")) b.addEventListener("click", () => setSpeed(+b.dataset.speed));
    document.querySelector(".hud-speed .spd-cycle").addEventListener("click", () => setSpeed({ 1: 2, 2: 4, 4: 1 }[clockNow().speed] || 1));

    $("selCountry").addEventListener("change", ev => { const c = +ev.target.value; if (c >= 0) chooseCountry(c); });
    $("btnRandom").addEventListener("click", () => {
      const underdog = S.setup.scenario === "underdog";
      const free = world.countries.filter(c => (underdog ? c.value < WD.UNDERDOG_MAX && c.value >= 0.6 : c.value >= 1) &&
        !(S.phase === "lobby" && Net.lobby.players.some(p => p.country === c.id && p.id !== Net.me)));
      chooseCountry(free[Math.floor(Math.random() * free.length)].id);
    });
    $("modeCards").addEventListener("click", ev => {
      const b = ev.target.closest("[data-mode]");
      if (!b) return;
      const m = WD.MODES[b.dataset.mode];
      Object.assign(S.setup, { mode: b.dataset.mode, rivals: m.rivals, victory: m.victory });
      settingsChanged();
    });
    $("rivals").addEventListener("input", ev => { S.setup.rivals = +ev.target.value; $("rivalsVal").textContent = S.setup.rivals; });
    $("rivals").addEventListener("change", settingsChanged);
    $("victory").addEventListener("change", ev => { S.setup.victory = +ev.target.value; settingsChanged(); });
    $("diffSeg").addEventListener("click", ev => {
      const b = ev.target.closest("[data-diff]");
      if (b) { S.setup.difficulty = b.dataset.diff; settingsChanged(); }
    });
    $("teamsSeg").addEventListener("click", ev => {
      const b = ev.target.closest("[data-teams]");
      if (b) { S.setup.teams = b.dataset.teams; settingsChanged(); }
    });
    $("btnStart").addEventListener("click", startGame);
    $("savesList").addEventListener("click", ev => {
      const b = ev.target.closest("[data-load]");
      if (b) loadSave(b.dataset.load, b.dataset.how);
    });

    let saved = "";
    try { saved = localStorage.getItem(NAME_KEY) || ""; } catch { /* storage blocked */ }
    $("mpName").value = saved || `Commander ${Math.floor(100 + Math.random() * 900)}`;
    $("mpName").addEventListener("change", () => { try { localStorage.setItem(NAME_KEY, myName()); } catch { /* storage blocked */ } });
    $("btnHost").addEventListener("click", hostGame);
    $("btnJoin").addEventListener("click", joinGame);
    $("mpCode").addEventListener("keydown", ev => { if (ev.key === "Enter") joinGame(); });
    $("btnLobbyStart").addEventListener("click", startOnline);
    $("btnLeaveLobby").addEventListener("click", () => showMenu());
    $("btnCopyCode").addEventListener("click", copyCode);
    $("btnCopyInvite").addEventListener("click", copyInvite);

    $("chatInput").addEventListener("keydown", ev => {
      ev.stopPropagation();
      if (ev.key === "Escape") closeChat();
      if (ev.key !== "Enter") return;
      const text = $("chatInput").value.trim();
      if (text) Net.say(text);
      closeChat();
    });

    document.addEventListener("keydown", ev => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      // A yes/no question takes every key until it's answered.
      if (!$("confirm").hidden) {
        if (ev.key === "Escape") closeConfirm(false);
        else if (ev.key === "Enter") { ev.preventDefault(); closeConfirm(true); }
        return;
      }
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName)) return;
      const k = ev.key.toLowerCase();
      if (S.phase !== "game") {
        if (ev.key === "Escape" && S.modal) closeModal();
        return;
      }
      if (ev.key === "Escape") {
        if (S.modal === "replay" && S.overInfo) renderOver();
        else if (S.modal) { if (S.modal !== "over") closeModal(); }
        else if (S.action) setAction(null);
        else if (S.selected >= 0) select(-1);
        else openGameMenu();
        return;
      }
      if (k === "h" || k === "?") { if (S.modal === "help") closeModal(); else openHelp(); return; }
      if (S.modal) return;
      if (ev.key === "Enter" && online()) { ev.preventDefault(); openChat(); return; }
      if (k === " ") { ev.preventDefault(); setSpeed(0); return; }
      if (BUY_KEYS[k] && S.selected >= 0 && isMine(S.selected)) { buy(S.selected, BUY_KEYS[k], ev.shiftKey ? 5 : 1); return; }
      if ("1234".includes(k) && k.length === 1) { S.frac = [0.25, 0.5, 0.75, 1][+k - 1]; renderPanel(); updatePreview(S.hover); return; }
      const actions = { g: "move", a: "air", b: "bombard", m: "missile", n: "nuke" };
      if (actions[k]) { trySetAction(actions[k]); renderPanel(); return; }
      if (k === "d") { renderDiplomacy(); return; }
      if (k === "u") { openResearch(); return; }
      if (k === "p") { openAutopilot(); return; }
      if (k === "+" || k === "=") setSpeed(Math.min(4, clockNow().speed * 2));
      if (k === "-" || k === "_") setSpeed(Math.max(1, clockNow().speed / 2));
    });

    let resizeTimer = 0;
    addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        Map.build();
        if (S.phase === "game") { Map.select(S.selected, S.selected >= 0 && isMine(S.selected)); Map.recolorAll(); }
        S.bountyH = undefined;   // the radar may have changed size
        S.bountyKey = "";
      }, 250);
    });
  }

  function bindGameEvents() {
    const forMe = ev => S.phase === "game" && ev.for === S.me;
    // Effects can arrive from the host's game, so check the country before drawing anything.
    const validC = c => Number.isInteger(c) && c >= 0 && c < world.countries.length;
    Game.on("reset", () => { if (Map.ready()) Map.reset(); });
    Game.on("capture", ({ country: c, from, to, cause }) => {
      if (S.phase !== "game") return;
      const G = Game.state;
      Map.recolor(c);
      Map.markBorders(from, to);
      S.vision = null;
      // Civil wars, revolutions, handovers and defections are reported by their own news.
      if (cause && cause !== "capture") {
        Map.capture(c, to >= 0 ? G.empires[to].color : "#8d8d86");
        if (c === S.selected) renderPanel();
        return;
      }
      if (to === S.me) {
        Map.capture(c, G.empires[to].color, "CAPTURED", "good");
        Sound.play("capture");
        Guide.event("capture");
        log(`🏴 You captured ${nameOf(c)}!`, "good", c);
      } else if (from === S.me) {
        Map.capture(c, G.empires[to].color, "LOST", "bad");
        Sound.play("lost");
        log(`💀 You lost ${nameOf(c)} to ${G.empires[to].name}.`, "bad", c);
      } else {
        Map.capture(c, G.empires[to].color);
        if (world.countries[c].value >= 4) log(`${G.empires[to].name} conquered ${nameOf(c)}.`, "info", c);
      }
      if (c === S.selected) renderPanel();
    });
    Game.on("log", ev => {
      if (S.phase !== "game") return;
      if (ev.for === S.me || (ev.for === undefined && !(ev.skip || []).includes(S.me))) {
        log(ev.text, ev.cls, ev.country, undefined, ev.cls === "comms" ? ev.leader : undefined);
        if (ev.cls === "comms") Sound.play("radio");
      }
    });
    Game.on("explosion", ({ country, big }) => {
      if (S.phase !== "game" || !validC(country)) return;
      const visible = Map.boom(country, big);
      const mine = Game.state.owner[country] === S.me;
      if (mine || (visible && (big || Map.zoomK >= 2.5))) Sound.play(big ? "bigBoom" : "boom");
    });
    Game.on("news", ev => {
      if (S.phase !== "game") return;
      News.push({ text: String(ev.text || ""), country: Number.isInteger(ev.country) ? ev.country : -1, cls: ev.cls });
      if (ev.cls !== "info") Sound.play("news");
    });
    Game.on("banner", ev => {
      if (!forMe(ev)) return;
      showBanner(String(ev.text || ""), String(ev.sub || ""), ev.cls === "good" ? "good" : "bad");
      Sound.play(ev.cls === "good" ? "capture" : "alarm");
    });
    Game.on("medal", ev => {
      if (!forMe(ev) || !WD.MEDALS[ev.id]) return;
      const m = WD.MEDALS[ev.id];
      Progress.medal(Game.state.id, ev.id);
      toast(`🎖 Medal earned: ${m.icon} ${m.name}. ${m.desc}`, "good");
      Sound.play("medal");
    });
    Game.on("bounty", ev => {
      if (!forMe(ev)) return;
      const title = String(ev.title || "");
      if (ev.kind === "new") log(`🎯 New contract: ${title} (+$${fmt(+ev.reward || 0)}).`, "info");
      else if (ev.kind === "done") {
        toast(`🎯 Contract complete: ${title} · +$${fmt(+ev.reward || 0)}`, "good");
        Sound.play("cash");
      } else log(`Contract failed: ${title}.`, "bad");
      S.bountyKey = "";
    });
    Game.on("research", ev => {
      if (!forMe(ev) || !WD.TECHS[ev.id]) return;
      const t = WD.TECHS[ev.id];
      S.panelKey = "";
      S.vision = null;
      toast(`🔬 ${t.icon} ${t.name} researched. ${t.desc}`, "good");
      Sound.play("research");
    });
    Game.on("nukeLaunch", ev => {
      if (S.phase !== "game" || !validC(ev.to)) return;
      Sound.play("siren");
      if (ev.victim === S.me) {
        showBanner("Nuclear launch detected", `A warhead is heading for ${nameOf(ev.to)}!`, "bad");
        Map.focus(ev.to);
      }
    });
    Game.on("nuke", ev => {
      if (S.phase !== "game" || !validC(ev.country)) return;
      Sound.play("nuke");
      if (Map.nuke(ev.country)) {
        const fl = $("flash");
        fl.classList.remove("on");
        void fl.offsetWidth;
        fl.classList.add("on");
      }
    });
    Game.on("intercept", ev => {
      if (S.phase !== "game" || !validC(ev.country)) return;
      Map.intercept(ev.country);
      Sound.play("boom");
    });
    Game.on("eventFx", ev => {
      if (S.phase !== "game" || !validC(ev.country)) return;
      Map.eventFx(ev.country, String(ev.icon || ""), String(ev.text || ""), ev.cls === "good" ? "good" : ev.cls === "bad" ? "bad" : "");
      if (Game.state.owner[ev.country] === S.me) Sound.play("event");
    });
    Game.on("offer", () => { if (S.phase === "game") renderOffers(); });
    Game.on("proposal", () => { if (S.phase === "game") renderProposals(); });
    Game.on("relations", () => {
      S.panelKey = "";
      S.vision = null;
      if (S.phase === "game" && S.selected >= 0) Map.select(S.selected, isMine(S.selected));
      if (S.modal === "diplomacy") renderDiplomacy();
    });
    Game.on("eliminated", id => { if (S.phase === "game" && online() && id === S.me && !Game.state.over) showFallen(); });
    Game.on("over", over => { if (S.phase === "game") showGameOver(over); });
    Game.on("autosave", () => writeSave("auto"));
  }

  function bindNetEvents() {
    Net.on("lobby", () => {
      if (S.phase !== "lobby") return;
      if (isClient() && Net.lobby.settings) Object.assign(S.setup, Net.lobby.settings);
      const me = lobbyMe();
      if (me) S.setup.country = me.country;
      renderSetup();
      renderLobby();
    });
    Net.on("start", ({ you }) => {
      S.me = you;
      const rejoin = Game.state.time > 5;
      enterGame();
      const me = Game.state.empires[S.me];
      const owned = Game.cache.owned[S.me];
      Map.focus(owned.length ? owned[0] : me.start, 3);
      if (rejoin) log(`🌐 You're back in command of ${me.name}.`, "good");
      else introLogs();
    });
    Net.on("chat", m => { if (S.phase === "game") { log(m.text, "chat", undefined, m); Sound.play("chat"); } });
    Net.on("closed", reason => {
      showMenu();
      toast(reason, "bad");
    });
    Net.on("error", err => toast(err.message, "bad"));
    Net.on("roster", () => { $("leaderboard").__rows = null; });
  }

  return { init };
})();

WD.UI.init();
