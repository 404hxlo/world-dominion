// Core simulation: economy, armies, battles, air/missile/nuclear strikes, bombardment, capitals
// and civil wars, research, deals and ultimatums, diplomacy, fog of war, saving.
// Empires flagged `human` belong to players; seat 0 is the solo player or the multiplayer host.
// Country owner -1 means an independent (neutral) nation.
window.WD = window.WD || {};

WD.Game = (() => {
  const R = WD.RULES, UNITS = WD.UNITS;
  const SAVE_VERSION = 4;
  const SAMPLE_EVERY = 10;   // seconds between world-share samples for the war replay
  let W = null;   // world (static map + graph)
  let G = null;   // game state (plain data, saved as JSON)
  const listeners = {};
  const NO_MODS = { cheap: {} };
  const cache = { owned: [], value: [], income: [], military: [], borders: new Set(), base: [], mods: [], landMods: [], radar: [], rad: new Set(), blight: new Set() };

  const on = (type, fn) => (listeners[type] ||= []).push(fn);
  const emit = (type, data) => (listeners[type] || []).forEach(fn => fn(data));
  const ok = extra => ({ ok: true, ...extra });
  const fail = reason => ({ ok: false, reason });
  const pick = list => list[Math.floor(Math.random() * list.length)];

  // News for players: tell() reaches one empire's player, announce() everyone except `skip`,
  // news() is a headline on everyone's world news ticker.
  function tell(e, text, cls = "info", country) {
    if (e >= 0 && G.empires[e].human) emit("log", { text, cls, country, for: e });
  }
  function announce(text, { cls = "info", country, skip = [] } = {}) {
    emit("log", { text, cls, country, skip });
  }
  const news = (text, country, cls = "info") => emit("news", { text, country, cls });
  const banner = (e, text, sub, cls = "bad") => { if (e >= 0 && G.empires[e].human) emit("banner", { for: e, text, sub, cls }); };
  // A key moment for the end-of-war replay.
  const mark = (icon, text) => G.history?.marks.push([Math.round(G.time), icon, text]);

  // ---------- unit bundles ----------
  // Bundles may lack a type (partial bundles like { inf: 5 }), so missing counts read as zero.
  const U = {
    empty: () => ({ inf: 0, tank: 0, art: 0, ship: 0, air: 0, mis: 0, mil: 0 }),
    add(a, b, k = 1) { for (const t of WD.ALL_TYPES) a[t] = Math.max(0, (a[t] || 0) + (b[t] || 0) * k); return a; },
    count(u, types = WD.UNIT_TYPES) { let s = 0; for (const t of types) s += u[t] || 0; return s; },
    attack(u) { let s = 0; for (const t of WD.ARMY_TYPES) s += (u[t] || 0) * UNITS[t].att; return s; },
    defense(u) { let s = 0; for (const t of WD.COMBAT_TYPES) s += (u[t] || 0) * UNITS[t].def; return s; },
    hp(u, types = WD.COMBAT_TYPES) { let s = 0; for (const t of types) s += (u[t] || 0) * UNITS[t].hp; return s; },
    // Damage removes the same fraction of every unit type (bigger units soak more because they have more hp).
    damage(u, dmg, types = WD.COMBAT_TYPES) {
      const hp = U.hp(u, types);
      if (hp <= 0 || dmg <= 0) return;
      const f = Math.min(1, dmg / hp);
      for (const t of types) { if (!u[t]) continue; u[t] -= u[t] * f; if (u[t] < 0.01) u[t] = 0; }
    },
    scale(u, k, types = WD.ALL_TYPES) { for (const t of types) { if (!u[t]) continue; u[t] *= Math.max(0, k); if (u[t] < 0.01) u[t] = 0; } },
  };
  // What bombs hit: everything on the ground.
  const GROUND = [...WD.ARMY_TYPES, "mil"];

  // ---------- helpers ----------
  const country = c => W.countries[c];
  const empire = e => G.empires[e];
  const nameOf = c => W.countries[c].name;
  const edgeOf = (a, b) => W.countries[a].edges.get(b);
  const dist = (a, b) => WD.World.haversine(W.countries[a].anchor, W.countries[b].anchor);
  const mode = () => WD.MODES[G.settings.mode];
  const diff = () => WD.DIFFICULTY[G.settings.difficulty];
  const ownedBy = e => { const list = []; G.owner.forEach((o, c) => { if (o === e) list.push(c); }); return list; };
  const richest = list => list.reduce((a, b) => (W.countries[b].value > W.countries[a].value ? b : a));

  const SHORT_NAMES = {
    "United States of America": "America", "United Kingdom": "Britain", "Dem. Rep. Congo": "the Congo",
    "Central African Rep.": "Central Africa", "United Arab Emirates": "the Emirates", "Bosnia and Herz.": "Bosnia",
    "Dominican Rep.": "Santo Domingo", "Eq. Guinea": "Equatoria", "S. Sudan": "South Sudan",
  };
  const shortName = c => SHORT_NAMES[W.countries[c].name] || W.countries[c].name;

  function baseGarrison(c) {
    const k = mode().neutral * c.mil;
    return { inf: Math.round((5 + c.value * 4) * k), tank: Math.floor(c.value * k / 3), art: 0, ship: 0, air: 0, mis: 0, mil: 0 };
  }

  // ---------- relations & opinion ----------
  const relKey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
  function relation(a, b) {
    if (a === b) return "self";
    if (a < 0 || b < 0) return "war";
    return G.relations[relKey(a, b)]?.state || "war";
  }
  const relSince = (a, b) => G.relations[relKey(a, b)]?.since ?? 0;
  const locked = (a, b) => !!G.relations[relKey(a, b)]?.locked;
  function isHostile(o, c) { const w = G.owner[c]; return w !== o && relation(o, w) === "war"; }
  function isFriendly(o, c) { const w = G.owner[c]; return w === o || (w >= 0 && relation(o, w) === "alliance"); }
  const opinion = (a, b) => G.opinion[a + ">" + b] || 0;
  function addOpinion(a, b, d) {
    if (a < 0 || b < 0 || a === b) return;
    const k = a + ">" + b;
    G.opinion[k] = Math.max(-100, Math.min(100, (G.opinion[k] || 0) + d));
  }

  // ---------- national superpowers and research ----------
  function buildMods(perk, tech) {
    const m = { cheap: {} };
    const add = fx => {
      for (const k in fx) {
        if (k === "cheap") for (const t in fx.cheap) m.cheap[t] = (m.cheap[t] || 0) + fx.cheap[t];
        else m[k] = (m[k] || 0) + fx[k];
      }
    };
    if (WD.PERKS[perk]) add(WD.PERKS[perk].fx);
    for (const id of tech) if (WD.TECHS[id]) add(WD.TECHS[id].fx);
    return m;
  }
  const mods = e => (e >= 0 && cache.mods[e]) || NO_MODS;
  // Whoever holds a country defends it with their bonuses; independent nations use their own perk.
  const landMods = c => (G.owner[c] >= 0 ? mods(G.owner[c]) : cache.landMods[c]);
  const has = (e, key) => !!mods(e)[key];
  const discount = k => 1 - Math.min(0.6, k || 0);

  const unitCost = (e, type) => Math.max(1, Math.round(UNITS[type].cost * discount(mods(e).cheap[type])));
  const techCost = (e, id) => Math.round(WD.TECH_TIERS[WD.TECHS[id].tier].cost * mode().income * discount(mods(e).research) / 10) * 10;
  const nukeCost = () => Math.round(R.nukeCost * mode().income / 10) * 10;
  const airRange = e => R.airRangeKm * (1 + (mods(e).airRange || 0));
  const missileRange = e => (has(e, "satellites") ? Infinity : R.missileRangeKm);
  const vetMult = v => 1 + R.vetBonus * Math.min(R.vetMax, v || 0);
  const vetGain = e => 1 + (mods(e).vetGain || 0);

  // Fighting strength, including veterans, perks and research.
  function attackOf(units, owner, vet) {
    const m = mods(owner);
    const a = U.attack(units) + units.tank * UNITS.tank.att * (m.tank || 0) + units.ship * UNITS.ship.att * (m.ship || 0);
    return a * (1 + (m.attack || 0)) * vetMult(vet);
  }
  function defenseOf(c) {
    const u = G.units[c], o = G.owner[c], m = landMods(c);
    const d = U.defense(u) + u.tank * UNITS.tank.def * (m.tank || 0) + u.ship * UNITS.ship.def * (m.ship || 0);
    let k = (1 + (m.defense || 0)) * vetMult(G.vet[c]);
    if (o >= 0 && G.empires[o].capital === c) k *= 1 + R.capitalDefense;
    return d * k;
  }

  // Troops joining a garrison: veteran stars blend by headcount, so fresh recruits dilute them.
  function addTroops(c, units, vet = 0) {
    const n0 = U.count(G.units[c], WD.ARMY_TYPES), n1 = U.count(units, WD.ARMY_TYPES);
    if (n0 + n1 > 0.01) G.vet[c] = (G.vet[c] * n0 + vet * n1) / (n0 + n1);
    U.add(G.units[c], units);
  }

  // ---------- medals, experience and stats ----------
  const newStats = () => ({ kills: 0, captures: 0, capitals: 0, repelled: 0, seaWins: 0, missiles: 0, missilesFired: 0, nukesFired: 0, bounties: 0, minShare: 100, capTimes: [] });
  // Boot Camp is practice: it earns no medals or experience (it pays its own reward when finished).
  function addXp(e, n) { if (e >= 0 && G.empires[e].human && !G.settings.tutorial) G.empires[e].xp += Math.round(n); }
  function award(e, id) {
    if (e < 0 || !WD.MEDALS[id] || G.settings.tutorial) return;
    const emp = G.empires[e];
    if (!emp.human || emp.medals[id] !== undefined) return;
    emp.medals[id] = Math.round(G.time);
    addXp(e, WD.XP.medal);
    emit("medal", { for: e, id });
  }
  function credit(e, troops) { if (e >= 0 && troops > 0) G.empires[e].stats.kills += troops; }

  // ---------- setup ----------
  // settings.humans lists the players as [{ country, name, color, title }]; solo games pass playerCountry instead.
  function newGame(world, settings) {
    W = world;
    const humans = settings.humans || [{ country: settings.playerCountry, name: null, color: settings.playerColor || WD.PLAYER_COLOR, title: settings.playerTitle }];
    G = {
      version: SAVE_VERSION, id: Math.random().toString(36).slice(2, 10),
      settings: {
        mode: settings.mode, difficulty: settings.difficulty, rivals: settings.rivals, victory: settings.victory,
        teams: settings.teams === "coop" ? "coop" : "ffa", multiplayer: !!settings.multiplayer,
        scenario: WD.SCENARIOS[settings.scenario] ? settings.scenario : "classic", fog: !!settings.fog,
        tutorial: !!settings.tutorial,
      },
      // Boot Camp has no ceasefire to count down: its rivals never attack anyway.
      time: 0, nextId: 1, over: null, autosaveAt: 60, dipClock: 0, graceOver: !!settings.tutorial,
      empires: [], owner: [], units: [], vet: [], sieges: [], armies: [], missions: [], bombards: [],
      relations: {}, opinion: {}, proposals: [], capturedAt: [],
      offers: [], bounties: [], fx: [], eventAt: 35, sampleAt: 0, history: null,
    };
    computeBase();
    W.countries.forEach(c => {
      G.owner.push(-1);
      G.units.push({ ...cache.base[c.id] });
      G.vet.push(0);
      G.sieges.push([]);
      G.capturedAt.push(-1e9);
    });
    humans.forEach(h => addEmpire(h.country, h.color, h.name, h.title));
    setupRivals(humans);
    // Co-op teammates are allied for good.
    if (G.settings.teams === "coop") {
      for (let a = 0; a < humans.length; a++) {
        for (let b = a + 1; b < humans.length; b++) G.relations[relKey(a, b)] = { state: "alliance", since: 0, locked: true };
      }
    }
    G.history = { start: G.owner.slice(), caps: [], shares: [], marks: [] };
    refreshCache();
    emit("reset");
    return G;
  }

  function computeBase() {
    cache.base = W.countries.map(baseGarrison);
    cache.landMods = W.countries.map(c => buildMods(c.perk, []));
    cache.radar = [];
  }

  // Scenario rivals: a fixed cast with teams and extra territory, or rivals placed around the world.
  function setupRivals(humans) {
    const id = G.settings.scenario, sc = WD.SCENARIOS[id];
    const colors = WD.AI_COLORS.filter(c => !G.empires.some(e => e.color === c));
    const addAI = c => G.empires[addEmpire(c, colors.length ? colors.shift() : freeColor())];
    if (G.settings.tutorial) {
      // Boot Camp: two far-off rivals who never move, and weak neighbors to practise on.
      for (const name of ["Japan", "Brazil"]) {
        const c = W.byName.get(name);
        if (c && G.owner[c.id] < 0) addAI(c.id);
      }
      for (const [name, inf] of [["Belgium", 10], ["Luxembourg", 5]]) {
        const c = W.byName.get(name);
        if (!c || G.owner[c.id] >= 0) continue;
        cache.base[c.id] = { ...U.empty(), inf };
        G.units[c.id] = { ...U.empty(), inf };
      }
      return;
    }
    if (sc.empires) {
      for (const s of sc.empires) {
        const c = W.byName.get(s.start);
        if (!c) continue;
        const e = G.empires.find(x => x.start === c.id) || addAI(c.id);
        e.team = s.team || null;
        for (const name of s.own || []) {
          const k = W.byName.get(name);
          if (k && G.owner[k.id] < 0) G.owner[k.id] = e.id;
        }
        if (s.nukes) e.nukes = s.nukes;
        for (const t of s.tech || []) if (!e.tech.includes(t)) e.tech.push(t);
      }
      for (const a of G.empires) {
        for (const b of G.empires) {
          if (a.id >= b.id) continue;
          const state = a.team && a.team === b.team ? "alliance" : a.team && b.team ? sc.rivalTeams : sc.nonAligned;
          if (state !== "war") G.relations[relKey(a.id, b.id)] = { state, since: 0 };
        }
      }
      return;
    }
    const taken = humans.map(h => h.country);
    const starts = id === "superpowers" ? biggest(G.settings.rivals, taken) : pickStarts(G.settings.rivals, taken);
    for (const c of starts) {
      const e = addAI(c);
      if (id === "superpowers") { U.add(G.units[c], R.startForce); e.money += R.startMoney; }
    }
    if (id === "underdog") {
      for (const e of G.empires) {
        if (!e.human) continue;
        e.money += 1500;
        U.add(G.units[e.start], R.startForce);
        G.vet[e.start] = 2;
      }
    }
  }

  // playerName is undefined for AI empires and null for the solo player.
  function addEmpire(cid, color, playerName, title) {
    const human = playerName !== undefined;
    const c = country(cid);
    const name = human ? `${title || "Empire"} of ${shortName(cid)}` : `${pick(WD.EMPIRE_TITLES)} of ${shortName(cid)}`;
    const e = makeEmpire({ human, playerName: human ? playerName : null, color, start: cid, name });
    G.owner[cid] = e.id;
    // The nation's own army joins its new ruler, plus a starting strike force.
    G.units[cid] = U.add({ ...cache.base[cid] }, { ...R.startForce, ship: c.coastal ? R.startForce.ship : 0 });
    G.vet[cid] = 0;
    return e.id;
  }

  function makeEmpire({ human = false, playerName = null, color, start, name, money = R.startMoney, rebel = false }) {
    const e = {
      id: G.empires.length, human, isAI: !human, away: false, playerName,
      color, alive: true, money, start, capital: start, perk: country(start).perk, name,
      tech: [], nukes: 0, team: null, rebel,
      aggression: 1, loyalty: 0.5, aiTimer: 1 + Math.random() * 2, dipTimer: 15 + Math.random() * 15, refused: {},
      captured: 0, lost: 0, stats: newStats(), medals: {}, xp: 0,
    };
    if (human) Object.assign(e, autopilotDefaults());
    else WD.AI.setup(e);
    G.empires.push(e);
    return e;
  }

  // ---------- autopilot (players) ----------
  // Its decisions live in autopilot.js; the settings and bookkeeping are part of the saved game.
  const autopilotDefaults = () => ({
    auto: { budget: R.autoBudget, reinforce: true, retake: true, caretaker: true },
    autoStats: { spent: 0, recruited: 0, moved: 0, retaken: 0 },
    autoFund: 0, retake: [], touched: {}, lastOrder: 0,
  });

  function setAutopilot(owner, cfg) {
    const e = empire(owner);
    if (!e.human) return fail("Only players have an autopilot.");
    if (!cfg || typeof cfg !== "object") return fail("Those autopilot settings don't make sense.");
    const budget = Number(cfg.budget);
    e.auto = {
      budget: Number.isFinite(budget) ? Math.min(0.5, Math.max(0, budget)) : e.auto.budget,
      reinforce: !!cfg.reinforce, retake: !!cfg.retake, caretaker: !!cfg.caretaker,
    };
    return ok();
  }

  // The player is at the controls: any order they give resets the caretaker clock.
  function noteOrder(owner) {
    const e = empire(owner);
    if (e && e.human && !autoActing) e.lastOrder = G.time;
  }

  // Orders the autopilot gives don't count as the player's own (see touch()).
  let autoActing = false;
  function asAutopilot(fn) {
    autoActing = true;
    try { fn(); } finally { autoActing = false; }
  }
  // Remember where a player gave orders, so the autopilot leaves those nations alone for a while.
  function touch(owner, ...cs) {
    const e = empire(owner);
    if (!e.human || autoActing) return;
    e.touched ||= {};
    for (const c of cs) if (c >= 0) e.touched[c] = G.time;
    e.lastOrder = G.time;
  }

  function freeColor() {
    const used = new Set(G.empires.filter(e => e.alive).map(e => e.color));
    return WD.AI_COLORS.find(c => !used.has(c)) || d3.hsl(Math.random() * 360, 0.6, 0.55).formatHex();
  }

  function pickStarts(n, taken) {
    const chosen = [...taken];
    const cands = W.countries.filter(c => c.value >= 2 && !taken.includes(c.id));
    const out = [];
    while (out.length < n && cands.length) {
      const scored = cands.map(c => ({ c, d: Math.min(...chosen.map(k => dist(c.id, k))) }));
      scored.sort((a, b) => b.d - a.d);
      const choice = scored[Math.floor(Math.random() * Math.min(4, scored.length))].c;
      out.push(choice.id);
      chosen.push(choice.id);
      cands.splice(cands.indexOf(choice), 1);
    }
    return out;
  }

  const biggest = (n, taken) => W.countries.filter(c => !taken.includes(c.id)).sort((a, b) => b.value - a.value).slice(0, n).map(c => c.id);

  function refreshCache() {
    const n = G.empires.length;
    cache.mods = G.empires.map(e => buildMods(e.perk, e.tech));
    cache.rad = new Set();
    cache.blight = new Set();
    for (const f of G.fx) {
      if (f.kind === "rad") { cache.rad.add(f.country); cache.blight.add(f.country); }
      if (f.kind === "famine") cache.blight.add(f.country);
    }
    cache.owned = Array.from({ length: n }, () => []);
    cache.value = new Array(n).fill(0);
    cache.income = new Array(n).fill(0);
    cache.military = new Array(n).fill(0);
    G.owner.forEach((o, c) => {
      if (o < 0) return;
      cache.owned[o].push(c);
      cache.value[o] += W.countries[c].value;
      if (!cache.blight.has(c)) cache.income[o] += W.countries[c].value * integration(c);
      cache.military[o] += U.defense(G.units[c]);
    });
    for (const a of G.armies) cache.military[a.owner] += U.attack(a.units);
    cache.borders = new Set();
    for (const c of W.countries) {
      const o = G.owner[c.id];
      if (o < 0) continue;
      for (const nb of c.edges.keys()) {
        const p = G.owner[nb];
        if (p >= 0 && p !== o) cache.borders.add(o + ">" + p);
      }
    }
  }
  // 0..1: how far a recently conquered country is toward paying full income.
  const integration = c => Math.min(1, Math.max(0, (G.time - G.capturedAt[c]) * (1 + (mods(G.owner[c]).integrate || 0)) / R.integrationTime));
  const power = e => cache.value[e] + cache.military[e] / 25;
  const shareBorder = (a, b) => cache.borders.has(a + ">" + b);
  const worldShare = e => (cache.value[e] || 0) / W.totalValue * 100;

  // Big empires are harder to run: each extra point of value pays a little less.
  const efficiency = e => 1 / (1 + Math.max(0, cache.value[e] - R.overextendFrom) / R.overextendScale);

  // Opening boost so the war gets going fast: double income at first, fading back to normal.
  function mobilization() {
    const [full, end] = mode().mobilize || [0, 0];
    return 1 + Math.max(0, Math.min(1, (end - G.time) / Math.max(1, end - full)));
  }

  function incomeOf(e) {
    const k = empire(e).human ? 1 : diff().income;
    let boost = 1 + (mods(e).income || 0);
    for (const f of G.fx) {
      if (f.kind === "boom" && f.empire === e) boost *= 1.5;
      else if (f.kind === "plague") boost *= 0.7;
    }
    return (R.baseIncome + cache.income[e] * efficiency(e) * R.incomePerValue) * mode().income * k * boost * mobilization();
  }

  // ---------- pathfinding ----------
  // Dijkstra from `from` until `stop(node)` is true. Only own/allied countries can be passed through.
  function findPathTo(from, owner, ships, stop) {
    const n = W.countries.length;
    const d = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    d[from] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && d[i] < best) { best = d[i]; u = i; }
      if (u < 0) return null;
      if (u !== from && stop(u)) {
        const path = [u];
        while (path[0] !== from) path.unshift(prev[path[0]]);
        return path;
      }
      done[u] = 1;
      if (u !== from && !isFriendly(owner, u)) continue;
      for (const e of W.countries[u].edges.values()) {
        if (ships && !e.shipOk) continue;
        if (best + e.km < d[e.to]) { d[e.to] = best + e.km; prev[e.to] = u; }
      }
    }
  }
  const findPath = (from, to, owner, ships) => (from === to ? null : findPathTo(from, owner, ships, u => u === to));

  // ---------- armies ----------
  function armySpeed(units, edge, owner) {
    const m = mods(owner), fast = 1 + (m.speed || 0);
    let slow = Infinity;
    for (const t of ["inf", "tank", "art"]) if (units[t] > 0.01) slow = Math.min(slow, UNITS[t].speed);
    if (units.ship > 0.01) return edge.sea ? UNITS.ship.speed : Math.min(UNITS.ship.speed, slow * fast);
    if (slow === Infinity) slow = 1;
    slow *= fast;
    return edge.sea && !m.marines ? Math.min(slow, R.seaTransportSpeed) : slow;
  }

  const hopTime = (units, edge, owner) => Math.max(1.2, edge.km / (armySpeed(units, edge, owner) * R.baseSpeedKm * mode().speed));
  const legTime = a => hopTime(a.units, edgeOf(a.path[a.leg], a.path[a.leg + 1]), a.owner);

  function takeUnits(from, fraction, types) {
    const g = G.units[from];
    const take = U.empty();
    for (const t of types) {
      if (WD.ARMY_TYPES.includes(t)) take[t] = fraction >= 1 ? g[t] : Math.min(g[t], Math.round(g[t] * fraction));
    }
    return take;
  }

  // Ships sail with the army when they can make the whole trip; otherwise they stay home.
  function routeFor(owner, from, to, take) {
    let path = take.ship > 0.01 ? findPath(from, to, owner, true) : null;
    if (!path) { take.ship = 0; path = findPath(from, to, owner, false); }
    return path;
  }

  function sendArmy(owner, from, to, fraction = 1, types = WD.ARMY_TYPES) {
    if (G.owner[from] !== owner) return fail("You don't control " + nameOf(from) + ".");
    if (from === to) return fail("Pick a different country as the target.");
    const target = G.owner[to];
    if (target !== owner && !isHostile(owner, to)) {
      return fail(`${nameOf(to)} belongs to ${empire(target).name}, and you have a ${relation(owner, target)} treaty with them.`);
    }
    const take = takeUnits(from, fraction, types);
    const path = routeFor(owner, from, to, take);
    if (U.count(take) < 0.5) return fail("Not enough troops in " + nameOf(from) + " to send.");
    if (!path) return fail("No route to " + nameOf(to) + ". You need a land border or a sea lane through your own or allied land.");
    U.add(G.units[from], take, -1);
    const army = { id: G.nextId++, owner, units: take, path, leg: 0, t: 0, legTime: 0, seaborne: false, retreat: false, vet: G.vet[from] };
    if (autoActing) army.auto = true;
    army.legTime = legTime(army);
    G.armies.push(army);
    touch(owner, from, to);
    return ok({ army });
  }

  // Seconds until an army reaches the end of its path at its current speed.
  function armyEta(a) {
    let eta = (1 - a.t) * a.legTime;
    for (let i = a.leg + 1; i < a.path.length - 1; i++) eta += hopTime(a.units, edgeOf(a.path[i], a.path[i + 1]), a.owner);
    return eta;
  }

  // What sendArmy() would do, without doing it: route, travel time and the strength on each side.
  function preview(owner, from, to, fraction = 1, types = WD.ARMY_TYPES) {
    if (G.owner[from] !== owner || from === to) return null;
    const take = takeUnits(from, fraction, types);
    const path = routeFor(owner, from, to, take);
    if (!path) return { path: null };
    let eta = 0;
    for (let i = 0; i < path.length - 1; i++) eta += hopTime(take, edgeOf(path[i], path[i + 1]), owner);
    const target = G.owner[to];
    const blocked = target !== owner && !isHostile(owner, to);
    return {
      path, eta, blocked, hostile: target !== owner && !blocked,
      count: U.count(take, WD.ARMY_TYPES), attack: attackOf(take, owner, G.vet[from]), defense: defenseOf(to),
    };
  }

  function moveArmies(dt) {
    for (const a of [...G.armies]) {
      a.t += dt / a.legTime;
      if (a.t < 1) continue;
      const edge = edgeOf(a.path[a.leg], a.path[a.leg + 1]);
      const node = a.path[a.leg + 1];
      a.leg++;
      a.t = 0;
      a.seaborne = edge.sea;
      const last = a.leg >= a.path.length - 1;
      if (!last && isFriendly(a.owner, node)) { a.legTime = legTime(a); continue; }
      arrive(a, node);
    }
  }

  function removeArmy(a) { const i = G.armies.indexOf(a); if (i >= 0) G.armies.splice(i, 1); }

  function arrive(a, c) {
    removeArmy(a);
    if (G.owner[c] === a.owner) { addTroops(c, a.units, a.vet); return; }
    if (!isHostile(a.owner, c)) { retreat(a, c); return; }
    joinSiege(c, a.owner, a.units, a.seaborne, a.vet);
  }

  function retreat(a, at) {
    const path = findPathTo(at, a.owner, false, u => G.owner[u] === a.owner);
    if (!path) {
      tell(a.owner, `An army near ${nameOf(at)} had no way home and disbanded.`, "bad", at);
      return;
    }
    Object.assign(a, { path: [at, ...path.slice(1)], leg: 0, t: 0, retreat: true });
    if (a.path.length < 2) { addTroops(at, a.units, a.vet); return; }
    a.legTime = legTime(a);
    G.armies.push(a);
  }

  function retreatUnits(owner, units, at, vet = 0) {
    retreat({ id: G.nextId++, owner, units, path: [at], leg: 0, t: 0, legTime: 1, seaborne: false, retreat: true, vet }, at);
  }

  // Turn an army around mid-march and head back to where the current leg began.
  function turnBack(a) {
    a.path = [a.path[a.leg + 1], a.path[a.leg]];
    a.leg = 0;
    a.t = Math.max(0, 1 - a.t);
    a.retreat = true;
    a.legTime = legTime(a);
  }

  // ---------- battles ----------
  function joinSiege(c, owner, units, seaborne, vet = 0) {
    let s = G.sieges[c].find(x => x.owner === owner);
    const fresh = !s;
    if (!s) { s = { owner, units: U.empty(), landing: 0, vet: 0, sea: false }; G.sieges[c].push(s); }
    const n0 = U.count(s.units, WD.ARMY_TYPES), n1 = U.count(units, WD.ARMY_TYPES);
    if (n0 + n1 > 0.01) s.vet = (s.vet * n0 + vet * n1) / (n0 + n1);
    U.add(s.units, units);
    if (seaborne) { s.landing = R.landingSeconds * (landMods(c).island ? 2 : 1); s.sea = true; }
    const def = G.owner[c];
    if (fresh && def >= 0) {
      addOpinion(def, owner, -6);
      tell(def, `⚠ ${empire(owner).name} is invading ${nameOf(c)}!`, "bad", c);
    }
  }

  function battles(dt) {
    for (let c = 0; c < G.sieges.length; c++) {
      const list = G.sieges[c];
      if (!list.length) continue;
      const def = G.units[c], holder = G.owner[c], lm = landMods(c);
      const landing = list.some(s => s.landing > 0);
      const D = defenseOf(c) + (landing ? def.ship * UNITS.ship.def : 0);   // warships shred landing craft
      const penalty = lm.island ? 0.5 : R.landingPenalty;
      const powers = list.map(s => {
        const a = attackOf(s.units, s.owner, s.vet);
        return s.landing > 0 && s.units.ship < def.ship && !has(s.owner, "marines") ? a * penalty : a;
      });
      const A = powers.reduce((x, y) => x + y, 0);
      const before = U.count(def, WD.COMBAT_TYPES);
      U.damage(def, A * R.combatRate * dt);
      const killed = before - U.count(def, WD.COMBAT_TYPES);
      list.forEach((s, i) => {
        const share = A > 0 ? powers[i] / A : 1 / list.length;
        credit(s.owner, killed * share);
        const n0 = U.count(s.units, WD.ARMY_TYPES);
        U.damage(s.units, D * R.combatRate * dt * share, WD.ARMY_TYPES);
        // Winter, jungle and other home advantages wear invaders down.
        if (lm.attrition) U.scale(s.units, 1 - lm.attrition * dt, WD.ARMY_TYPES);
        credit(holder, n0 - U.count(s.units, WD.ARMY_TYPES));
        s.landing = Math.max(0, s.landing - dt);
      });
      for (let i = list.length - 1; i >= 0; i--) {
        if (U.hp(list[i].units, WD.ARMY_TYPES) >= 0.05) continue;
        const s = list.splice(i, 1)[0];
        tell(s.owner, `Your attack on ${nameOf(c)} was defeated.`, "bad", c);
        tell(holder, `${nameOf(c)} held off ${empire(s.owner).name}.`, "good", c);
        repelled(c);
      }
      if (list.length && U.hp(def) < 0.05) capture(c);
    }
  }

  // Defenders who beat off an attack gain experience.
  function repelled(c) {
    const o = G.owner[c];
    G.vet[c] = Math.min(R.vetMax, G.vet[c] + 0.5 * vetGain(o));
    if (o < 0) return;
    const e = empire(o);
    e.stats.repelled++;
    addXp(o, WD.XP.repel);
    if (e.stats.repelled >= 15) award(o, "wall");
  }

  function capture(c) {
    const list = G.sieges[c];
    list.sort((a, b) => U.hp(b.units) - U.hp(a.units));
    const win = list.shift();
    const prev = G.owner[c], w = win.owner, we = empire(w);
    G.units[c] = U.add(U.empty(), win.units);
    G.vet[c] = Math.min(R.vetMax, win.vet + (prev >= 0 ? 1 : 0.5) * vetGain(w));
    for (const s of [...list]) {
      if (relation(s.owner, w) === "war") continue;
      list.splice(list.indexOf(s), 1);
      retreatUnits(s.owner, s.units, c, s.vet);
    }
    if (prev < 0) {
      // Liberated nations send volunteers.
      addTroops(c, { inf: cache.base[c].inf * R.militiaShare * (1 + (mods(w).militia || 0)) });
    } else {
      const pm = mods(prev);
      if (pm.partisan) {
        U.scale(G.units[c], 1 - pm.partisan);
        tell(w, `🔥 Partisans in ${nameOf(c)} ambushed your troops.`, "bad", c);
      }
    }
    we.captured++;
    we.stats.captures++;
    we.stats.capTimes.push(G.time);
    if (we.stats.capTimes.length > 10) we.stats.capTimes.shift();
    if (we.stats.capTimes.length >= 10 && G.time - we.stats.capTimes[0] <= 60) award(w, "blitz");
    if (win.sea && ++we.stats.seaWins >= 10) award(w, "admiral");
    addXp(w, (WD.XP.capture + WD.XP.perValue * country(c).value) * (prev >= 0 ? 1.5 : 1));
    setOwner(c, w, "capture");
    if (prev < 0) return;
    empire(prev).lost++;
    addOpinion(prev, w, -12);
    if (empire(prev).capital === c) capitalFalls(c, prev, w);
    WD.AI.react("capture", { country: c, from: prev, to: w });
    WD.Autopilot.lost(prev, c);
  }

  // Every change of hands goes through here, so the map and the war replay hear about it.
  // cause: capture | rebels | revolution | ceded | defect
  function setOwner(c, o, cause = "capture", integrated = false) {
    const prev = G.owner[c];
    if (prev === o) return;
    G.owner[c] = o;
    G.capturedAt[c] = integrated ? -1e9 : G.time;
    G.bombards = G.bombards.filter(b => b.from !== c);
    if (prev >= 0) empire(prev).lastHit = o;
    G.history?.caps.push([Math.round(G.time), c, o]);
    emit("capture", { country: c, from: prev, to: o, cause });
  }

  // ---------- capitals & civil wars ----------
  function capitalFalls(c, loser, winner) {
    const L = empire(loser), Wn = empire(winner);
    const loot = Math.round(L.money * R.capitalLoot);
    L.money -= loot;
    Wn.money += loot;
    Wn.stats.capitals++;
    addXp(winner, WD.XP.capital);
    award(winner, "kingslayer");
    // (The share cache still counts the capital as the loser's until the next refresh.)
    if (L.human || Wn.human || (!L.rebel && worldShare(loser) >= 4)) {
      news(`👑 ${nameOf(c)}, capital of the ${L.name}, has fallen to the ${Wn.name}!`, c, "bad");
      mark("👑", `${nameOf(c)} falls to the ${Wn.name}`);
    }
    tell(winner, `👑 You took the capital of the ${L.name} and looted $${loot.toLocaleString()}!`, "good", c);
    banner(winner, "Capital captured", `${nameOf(c)} is yours · looted $${loot.toLocaleString()}`, "good");
    tell(loser, `👑 ${nameOf(c)} has fallen! The ${Wn.name} looted $${loot.toLocaleString()} from your treasury.`, "bad", c);
    const rest = ownedBy(loser);
    if (!rest.length) { L.capital = -1; return; }
    L.capital = richest(rest);
    tell(loser, `Your government fled to ${nameOf(L.capital)}, the new capital.`, "info", L.capital);
    // Rebel factions are too young to split again.
    const split = !L.rebel && rest.length >= R.civilWarMin ? civilWar(loser, Math.round(rest.length * R.civilWarShare)) : -1;
    banner(loser, "Your capital has fallen", split >= 0 ? `Civil war! ${empire(split).name} breaks away` : `The government flees to ${nameOf(L.capital)}`);
    WD.AI.react("capital", { country: c, from: loser, to: winner });
  }

  // Part of an empire breaks away as a new rebel empire: one connected region far from the
  // capital, with the troops stationed there. Returns the rebel empire's id, or -1.
  function civilWar(e, n) {
    const E = empire(e);
    const own = ownedBy(e).filter(c => c !== E.capital);
    if (own.length < 2 || n < 1 || E.capital < 0 || G.time - (E.civilAt ?? -1e9) < R.civilWarGap) return -1;
    E.civilAt = G.time;
    const far = own.reduce((a, b) => (dist(b, E.capital) > dist(a, E.capital) ? b : a));
    const region = own.filter(c => dist(c, far) < dist(c, E.capital))
      .sort((a, b) => dist(a, far) - dist(b, far)).slice(0, Math.max(1, n));
    const center = richest(region);
    const r = makeEmpire({ color: freeColor(), start: center, name: pick(WD.REBEL_NAMES).replace("{c}", shortName(center)), money: 300, rebel: true });
    for (const c of region) {
      U.add(G.units[c], { inf: cache.base[c].inf * 0.3 });   // local militia rise with the rebels
      setOwner(c, r.id, "rebels", true);
    }
    news(`🔥 Civil war! ${region.length} nations break away from the ${E.name} as the ${r.name}.`, center, "bad");
    mark("🔥", `Civil war splits the ${E.name}`);
    tell(e, `🔥 Civil war! ${region.length} of your nations broke away as the ${r.name}.`, "bad", center);
    refreshCache();
    return r.id;
  }

  function neutralRegen(dt) {
    for (const c of W.countries) {
      if (G.owner[c.id] !== -1 || G.sieges[c.id].length) continue;
      const base = cache.base[c.id], u = G.units[c.id];
      for (const t of ["inf", "tank"]) {
        if (u[t] < base[t]) u[t] = Math.min(base[t], u[t] + Math.max(0.05, base[t] * R.neutralRegen) * dt);
      }
    }
  }

  // Every empire's nations raise free militia up to a safe level, more as they settle in.
  // Militia only defend: they never march, so they can't be farmed for armies.
  const militiaCap = c => (R.militiaBase + R.militiaPerValue * W.countries[c].value) * (0.4 + 0.6 * integration(c)) * mode().neutral;
  function militia(dt) {
    for (let c = 0; c < G.owner.length; c++) {
      if (G.owner[c] < 0 || G.sieges[c].length || cache.rad.has(c)) continue;
      const u = G.units[c], cap = militiaCap(c);
      if ((u.mil || 0) < cap) u.mil = Math.min(cap, (u.mil || 0) + Math.max(0.08, cap * R.militiaRate) * dt);
    }
  }

  // ---------- recruiting & research ----------
  function buy(owner, c, type, n = 1) {
    const e = empire(owner), unit = UNITS[type];
    if (G.owner[c] !== owner) return fail("You can only recruit in your own countries.");
    if (type === "ship" && !country(c).coastal) return fail(nameOf(c) + " has no coastline for warships.");
    if (cache.rad.has(c)) return fail(`${nameOf(c)} is radioactive. Nobody can recruit there for now.`);
    const cost = unitCost(owner, type) * n;
    if (e.money < cost) return fail(`Not enough money: ${n} ${unit.name} costs $${cost}.`);
    e.money -= cost;
    addTroops(c, { [type]: n }, mods(owner).recruitVet || 0);
    touch(owner, c);
    return ok();
  }

  // Shop packs: forces delivered straight to the capital (or the first nation left).
  function packCost(owner, id) {
    const p = WD.PACKS[id];
    let full = 0;
    for (const t in p.units) full += unitCost(owner, t) * p.units[t];
    return Math.round(full * p.markup / 10) * 10;
  }

  function buyPack(owner, id) {
    const e = empire(owner), p = Object.prototype.hasOwnProperty.call(WD.PACKS, id) ? WD.PACKS[id] : null;
    if (!p) return fail("That isn't for sale.");
    const own = ownedBy(owner);
    const at = own.includes(e.capital) ? e.capital : own[0];
    if (at === undefined) return fail("You have no territory left to receive it.");
    if (cache.rad.has(at)) return fail(`${nameOf(at)} is radioactive. Deliveries can't land there.`);
    const cost = packCost(owner, id);
    if (e.money < cost) return fail(`Not enough money: the ${p.name} costs $${cost.toLocaleString()}.`);
    e.money -= cost;
    addTroops(at, p.units, p.vet);
    return ok({ at });
  }

  function techLocked(e, id) {
    const need = WD.TECH_TIERS[WD.TECHS[id].tier].needs - empire(e).tech.length;
    return need > 0 ? `Research ${need} more ${need === 1 ? "technology" : "technologies"} to unlock ${WD.TECH_TIERS[WD.TECHS[id].tier].name}.` : "";
  }

  function research(owner, id) {
    const e = empire(owner), t = WD.TECHS[id];
    if (!t) return fail("Unknown technology.");
    if (e.tech.includes(id)) return fail(`You already have ${t.name}.`);
    const lock = techLocked(owner, id);
    if (lock) return fail(lock);
    const cost = techCost(owner, id);
    if (e.money < cost) return fail(`Not enough money: ${t.name} costs $${cost.toLocaleString()}.`);
    e.money -= cost;
    e.tech.push(id);
    emit("research", { for: owner, id });
    if (id === "nuclear") {
      news(`☢ The ${e.name} has built the bomb. The world holds its breath.`, e.capital, "bad");
      mark("☢", `The ${e.name} goes nuclear`);
    }
    if (e.tech.length === WD.TECH_IDS.length) award(owner, "scientist");
    refreshCache();
    return ok();
  }

  // ---------- aircraft, missiles, nukes, artillery ----------
  function launchAir(owner, from, to) {
    const g = G.units[from];
    if (G.owner[from] !== owner) return fail("You don't control " + nameOf(from) + ".");
    if (g.air < 0.5) return fail("No aircraft stationed in " + nameOf(from) + ".");
    if (from === to) return fail("Pick a different country for your aircraft.");
    const km = dist(from, to), range = airRange(owner);
    if (km > range) return fail(`${nameOf(to)} is ${Math.round(km)} km away. Aircraft range is ${Math.round(range)} km.`);
    const own = G.owner[to] === owner;
    if (!own && !isHostile(owner, to)) return fail("You have a treaty with the owner of " + nameOf(to) + ".");
    const count = g.air;
    g.air = 0;
    G.missions.push({ id: G.nextId++, kind: own ? "rebase" : "strike", owner, from, to, count, t: 0, dur: Math.max(1, km / (R.airSpeedKm * mode().speed)), back: false });
    return ok({ rebase: own });
  }

  function launchMissile(owner, from, to) {
    const g = G.units[from];
    if (G.owner[from] !== owner) return fail("You don't control " + nameOf(from) + ".");
    if (g.mis < 1) return fail("No missiles stored in " + nameOf(from) + ".");
    if (!isHostile(owner, to)) return fail("Missiles can only target enemy or independent countries.");
    const km = dist(from, to);
    if (km > missileRange(owner)) return fail(`${nameOf(to)} is ${Math.round(km)} km away. Missile range is ${R.missileRangeKm} km.`);
    g.mis -= 1;
    empire(owner).stats.missilesFired++;
    G.missions.push({ id: G.nextId++, kind: "missile", owner, from, to, count: 1, t: 0, dur: Math.max(0.8, km / (R.missileSpeedKm * mode().speed)), back: false });
    return ok();
  }

  function buildNuke(owner) {
    const e = empire(owner);
    if (!has(owner, "nuclear")) return fail("Research the Nuclear Program first.");
    if (e.nukes >= R.nukeMax) return fail(`Your silos are full (${R.nukeMax} warheads).`);
    const cost = nukeCost();
    if (e.money < cost) return fail(`Not enough money: a warhead costs $${cost.toLocaleString()}.`);
    e.money -= cost;
    e.nukes++;
    return ok();
  }

  function launchNuke(owner, to) {
    const e = empire(owner);
    if (e.nukes < 1) return fail("You have no nuclear warheads. Build them in Research (U).");
    if (G.owner[to] === owner) return fail("You can't nuke your own nation.");
    if (!isHostile(owner, to)) return fail(`You have a treaty with the owner of ${nameOf(to)}.`);
    if (G.time < mode().grace) return fail("Nuclear weapons stay locked until the opening ceasefire ends.");
    const own = ownedBy(owner);
    if (!own.length) return fail("You have no territory left to launch from.");
    const from = own.reduce((a, b) => (dist(b, to) < dist(a, to) ? b : a));
    e.nukes--;
    e.stats.nukesFired++;
    G.missions.push({ id: G.nextId++, kind: "nuke", owner, from, to, count: 1, t: 0, dur: Math.max(8, dist(from, to) / (R.nukeSpeedKm * mode().speed)), back: false });
    award(owner, "doomsday");
    // The whole world sees the launch and turns against the attacker.
    for (const o of G.empires) if (o.alive && o.id !== owner) addOpinion(o.id, owner, -30);
    news(`☢ NUCLEAR LAUNCH DETECTED: the ${e.name} fired a warhead at ${nameOf(to)}!`, to, "bad");
    mark("☢", `The ${e.name} fires a nuke at ${nameOf(to)}`);
    emit("nukeLaunch", { owner, from, to, victim: G.owner[to] });
    return ok();
  }

  function landPlanes(owner, home, count) {
    if (G.owner[home] === owner) { G.units[home].air += count; return; }
    let best = -1, bd = Infinity;
    for (const c of cache.owned[owner] || []) { const d = dist(home, c); if (d < bd) { bd = d; best = c; } }
    if (best >= 0 && bd <= airRange(owner)) G.units[best].air += count;
    else tell(owner, "Your aircraft had nowhere to land and were lost.", "bad");
  }

  function airStrike(m) {
    const g = G.units[m.to], am = mods(m.owner);
    const interceptors = g.air;
    const lostAtt = am.stealth ? 0 : Math.min(m.count, interceptors * 0.5);
    const lostDef = Math.min(interceptors, m.count * 0.35);
    m.count = (m.count - lostAtt) * (am.stealth ? 1 : 0.95);   // flak
    g.air -= lostDef;
    const before = U.count(g, GROUND);
    U.damage(g, m.count * R.airBombDamage * (1 + (am.airDamage || 0)), GROUND);
    credit(m.owner, before - U.count(g, GROUND));
    const def = G.owner[m.to];
    if (def >= 0) addOpinion(def, m.owner, -4);
    emit("explosion", { country: m.to });
    emit("strike", { owner: m.owner, country: m.to });
    tell(def, `✈ ${empire(m.owner).name} bombed ${nameOf(m.to)}.`, "bad", m.to);
  }

  function missileHit(m) {
    const def = G.owner[m.to];
    if (Math.random() < Math.min(0.9, landMods(m.to).shield || 0)) {
      emit("intercept", { country: m.to });
      tell(def, `🛰 Your missile defenses shot down a missile over ${nameOf(m.to)}.`, "good", m.to);
      tell(m.owner, `Your missile was shot down over ${nameOf(m.to)}.`, "bad", m.to);
      return;
    }
    const g = G.units[m.to], before = U.count(g, WD.COMBAT_TYPES);
    U.damage(g, R.missileDamage * (1 + (mods(m.owner).missile || 0)));
    credit(m.owner, before - U.count(g, WD.COMBAT_TYPES));
    const e = empire(m.owner);
    if (++e.stats.missiles >= 15) award(m.owner, "rocket");
    if (def >= 0) addOpinion(def, m.owner, -8);
    emit("explosion", { country: m.to, big: true });
    emit("strike", { owner: m.owner, country: m.to });
    tell(def, `🚀 ${e.name} hit ${nameOf(m.to)} with a missile!`, "bad", m.to);
  }

  function nukeHit(m) {
    const c = m.to, victim = G.owner[c], nuker = empire(m.owner);
    if (Math.random() < Math.min(0.9, landMods(c).nukeShield || 0)) {
      emit("intercept", { country: c, nuke: true });
      news(`🛰 Missile defenses over ${nameOf(c)} shot down a nuclear warhead!`, c, "good");
      return;
    }
    // Ground zero loses almost everything, besiegers included. Fallout drifts over the borders.
    const blast = (k, at) => {
      const before = U.count(G.units[at]);
      U.scale(G.units[at], 1 - k);
      credit(m.owner, before - U.count(G.units[at]));
      for (const s of G.sieges[at]) U.scale(s.units, 1 - k);
    };
    blast(R.nukeKill, c);
    for (const [nb, edge] of country(c).edges) if (!edge.sea) blast(R.falloutKill, nb);
    G.fx = G.fx.filter(f => !(f.kind === "rad" && f.country === c));
    G.fx.push({ kind: "rad", country: c, until: G.time + R.radTime });
    emit("nuke", { country: c, owner: m.owner });
    news(`☢ A nuclear blast devastates ${nameOf(c)}. The world condemns the ${nuker.name}.`, c, "bad");
    mark("☢", `Nuclear strike on ${nameOf(c)}`);
    tell(victim, `☢ ${nameOf(c)} was hit by a nuclear strike! Nobody can recruit there for ${R.radTime} seconds.`, "bad", c);
    for (const o of G.empires) {
      if (!o.alive || o.id === m.owner) continue;
      addOpinion(o.id, m.owner, o.id === victim ? -60 : -20);
      if (!o.isAI || locked(o.id, m.owner)) continue;
      const rel = relation(o.id, m.owner);
      if (rel === "peace" && Math.random() < 0.5) declareWar(o.id, m.owner, "the nuclear attack");
      else if (rel === "alliance" && opinion(o.id, m.owner) < -40) {
        setRelation(o.id, m.owner, "peace");
        news(`💔 The ${o.name} broke its alliance with the ${nuker.name} over the nuclear attack.`);
      }
    }
    refreshCache();
    if (victim >= 0) {
      award(victim, "survivor");
      WD.AI.react("nuked", { country: c, by: m.owner, victim });
    }
  }

  function updateMissions(dt) {
    for (const m of [...G.missions]) {
      m.t += dt;
      if (m.t < m.dur) continue;
      const done = () => G.missions.splice(G.missions.indexOf(m), 1);
      if (m.kind === "missile" || m.kind === "nuke") {
        done();
        if (m.kind === "nuke") nukeHit(m);
        else if (isHostile(m.owner, m.to)) missileHit(m);
        continue;
      }
      if (m.kind === "rebase") { done(); landPlanes(m.owner, G.owner[m.to] === m.owner ? m.to : m.from, m.count); continue; }
      if (!m.back) {
        if (isHostile(m.owner, m.to)) airStrike(m);
        m.back = true;
        m.t = 0;
        if (m.count < 0.05) done();
        continue;
      }
      done();
      landPlanes(m.owner, m.from, m.count);
    }
  }

  function toggleBombard(owner, from, to) {
    const i = G.bombards.findIndex(b => b.from === from && b.to === to);
    if (i >= 0) { G.bombards.splice(i, 1); return ok({ stopped: true }); }
    if (G.owner[from] !== owner) return fail("You don't control " + nameOf(from) + ".");
    if (G.units[from].art < 0.5) return fail("No artillery in " + nameOf(from) + ".");
    if (!edgeOf(from, to)) return fail("Artillery can only hit countries next to " + nameOf(from) + " (border or sea lane).");
    if (!isHostile(owner, to)) return fail("Artillery can only hit enemy or independent countries.");
    G.bombards.push({ owner, from, to });
    return ok({ stopped: false });
  }

  function updateBombards(dt) {
    G.bombards = G.bombards.filter(b => G.owner[b.from] === b.owner && G.units[b.from].art >= 0.5 && isHostile(b.owner, b.to));
    for (const b of G.bombards) {
      const g = G.units[b.to], before = U.count(g, WD.COMBAT_TYPES);
      U.damage(g, G.units[b.from].art * R.bombardRate * (1 + (mods(b.owner).bombard || 0)) * dt);
      credit(b.owner, before - U.count(g, WD.COMBAT_TYPES));
      const enemyArt = g.art;
      if (enemyArt > 0 && G.owner[b.to] >= 0) U.damage(G.units[b.from], enemyArt * R.counterBattery * dt);
    }
  }

  // ---------- offers: arms deals and ultimatums waiting for a player's answer ----------
  function offer(o) {
    Object.assign(o, { id: G.nextId++, expires: G.time + R.offerTime });
    G.offers.push(o);
    emit("offer");
    return o;
  }

  function answerOffer(by, id, accept) {
    const o = G.offers.find(x => x.id === id && x.to === by);
    if (!o) return fail("That offer has expired.");
    G.offers.splice(G.offers.indexOf(o), 1);
    emit("offer");
    if (o.kind === "ultimatum") return resolveUltimatum(o, accept);
    if (!accept) return ok();
    const e = empire(by);
    if (e.money < o.cost) return fail(`Not enough money: the deal costs $${o.cost}.`);
    const own = ownedBy(by);
    const at = own.includes(e.capital) ? e.capital : own[0];
    if (at === undefined) return fail("You have no territory left to receive the shipment.");
    e.money -= o.cost;
    addTroops(at, o.units, 1);   // dealers sell battle-tested gear and crews
    tell(by, `📦 The arms shipment arrived in ${nameOf(at)}.`, "good", at);
    return ok({ delivered: at });
  }

  function resolveUltimatum(o, accept) {
    const ai = empire(o.from), p = empire(o.to);
    if (!ai.alive || !p.alive) return ok();
    if (accept) {
      if (o.country >= 0) {
        const c = o.country;
        if (G.owner[c] !== o.to) return fail("You no longer hold " + nameOf(c) + ".");
        // Your forces pull out to your capital (the local militia stay home), and the demanding empire moves in.
        const home = ownedBy(o.to).filter(k => k !== c);
        const dest = home.includes(p.capital) ? p.capital : home[0];
        if (dest !== undefined) addTroops(dest, { ...G.units[c], mil: 0 }, G.vet[c]);
        G.units[c] = { ...U.empty(), inf: 8 };
        G.vet[c] = 0;
        G.sieges[c].forEach(s => retreatUnits(s.owner, s.units, c, s.vet));
        G.sieges[c] = [];
        setOwner(c, o.from, "ceded");
        news(`🏳 The ${p.name} handed ${nameOf(c)} to the ${ai.name} to avoid war.`, c);
      } else {
        const pay = Math.min(p.money, o.money);
        p.money -= pay;
        ai.money += pay;
      }
      addOpinion(o.from, o.to, 25);
      ai.spare = { ...(ai.spare || {}), [o.to]: G.time + 180 };
      if (relation(o.from, o.to) === "war") { setRelation(o.from, o.to, "peace"); treatyNews(o.from, o.to, "peace"); }
      WD.AI.say(o.from, o.to, "accepted");
      return ok();
    }
    addOpinion(o.from, o.to, -15);
    WD.AI.say(o.from, o.to, "refused");
    if (relation(o.from, o.to) !== "war" && !locked(o.from, o.to)) declareWar(o.from, o.to, "a refused ultimatum");
    ai.rage = { target: o.to, until: G.time + 90 };
    return ok();
  }

  // ---------- diplomacy ----------
  function setRelation(a, b, state) {
    const was = G.relations[relKey(a, b)];
    G.relations[relKey(a, b)] = { state, since: G.time, ...(was?.locked ? { locked: true } : {}) };
    if (state !== "war") {
      const between = (x, y) => (x === a && y === b) || (x === b && y === a);
      for (let c = 0; c < G.sieges.length; c++) {
        for (const s of [...G.sieges[c]]) {
          if (!between(s.owner, G.owner[c])) continue;
          G.sieges[c].splice(G.sieges[c].indexOf(s), 1);
          retreatUnits(s.owner, s.units, c, s.vet);
        }
      }
      for (const ar of G.armies) if (!ar.retreat && between(ar.owner, G.owner[ar.path[ar.path.length - 1]])) turnBack(ar);
      for (const m of G.missions) {
        if (m.kind === "strike" && !m.back && between(m.owner, G.owner[m.to])) { m.back = true; m.t = Math.max(0, m.dur - m.t); }
      }
      G.bombards = G.bombards.filter(b => !between(b.owner, G.owner[b.to]));
    }
    emit("relations", { a, b, state });
  }

  // Only treaties and wars involving a player or a real power make the world news.
  const major = id => empire(id).human || worldShare(id) >= 8;

  function treatyNews(a, b, kind) {
    const text = `${kind === "peace" ? "🕊" : "🤝"} ${empire(a).name} and ${empire(b).name} signed ${kind === "peace" ? "a peace treaty" : "an alliance"}.`;
    tell(a, text, "good");
    tell(b, text, "good");
    announce(text, { skip: [a, b] });
    if (kind === "alliance" && (empire(a).human || empire(b).human || (major(a) && major(b)))) news(text);
  }

  // AI empires answer at once; players get an offer to accept or decline.
  function propose(from, to, kind) {
    if (!empire(to) || to === from || !empire(to).alive) return fail("That empire is gone.");
    if (kind !== "peace" && kind !== "alliance") return fail("Unknown treaty.");
    const rel = relation(from, to);
    if (kind === "peace" && rel !== "war") return fail("You are not at war.");
    if (kind === "alliance" && rel !== "peace") return fail("You need a peace treaty before an alliance.");
    if (empire(to).isAI) {
      const res = WD.AI.considerTreaty(to, from, kind);
      if (!res.accept) return fail(res.reason);
      setRelation(from, to, kind);
      treatyNews(from, to, kind);
      return ok({ quote: res.quote });
    }
    if (G.proposals.some(p => p.from === from && p.to === to)) return fail(`Your offer to ${empire(to).name} is still waiting for an answer.`);
    G.proposals.push({ id: G.nextId++, from, to, kind, expires: G.time + 25 });
    emit("proposal");
    return ok({ pending: true });
  }

  function answerProposal(by, id, accept) {
    const p = G.proposals.find(x => x.id === id && x.to === by);
    if (!p) return fail("That offer has expired.");
    G.proposals.splice(G.proposals.indexOf(p), 1);
    const still = empire(p.from).alive && relation(p.from, by) === (p.kind === "peace" ? "war" : "peace");
    if (accept && still) {
      setRelation(p.from, by, p.kind);
      addOpinion(p.from, by, 10);
      treatyNews(p.from, by, p.kind);
    } else {
      addOpinion(p.from, by, -5);
      empire(p.from).refused[by] = G.time;
      if (!accept) tell(p.from, `${empire(by).name} turned down your ${p.kind} offer.`, "bad");
    }
    emit("proposal");
    return ok();
  }

  // why: a reason the rest of the world accepts (an ultimatum, a nuke); without one, everyone
  // trusts the treaty breaker less.
  function declareWar(a, b, why) {
    if (!empire(b) || a === b) return fail("Pick another empire.");
    const was = relation(a, b);
    if (was === "war") return fail("Already at war.");
    if (locked(a, b)) return fail("Co-op teammates can't declare war on each other.");
    setRelation(a, b, "war");
    addOpinion(b, a, -40);
    if (!why) for (const e of G.empires) if (e.alive && e.id !== a && e.id !== b) addOpinion(e.id, a, -8);
    if (was === "alliance") award(a, "backstab");
    const text = why
      ? `⚔ ${empire(a).name} declared war on ${empire(b).name} over ${why}!`
      : `⚔ ${empire(a).name} broke its treaty and declared war on ${empire(b).name}!`;
    tell(a, text, "info");
    tell(b, text, "bad");
    announce(text, { skip: [a, b] });
    if (major(a) || major(b)) news(text);
    return ok();
  }

  function diplomacyDrift(dt) {
    G.dipClock += dt;
    if (G.dipClock < 1) return;
    G.dipClock -= 1;
    for (const k in G.opinion) G.opinion[k] *= 0.997;   // grudges slowly fade
    for (const k in G.relations) {
      if (G.relations[k].state === "war") continue;
      const [a, b] = k.split("|").map(Number);
      addOpinion(a, b, 0.15);
      addOpinion(b, a, 0.15);
    }
    for (const p of [...G.proposals]) {
      if (G.time <= p.expires && empire(p.from).alive && empire(p.to).alive) continue;
      G.proposals.splice(G.proposals.indexOf(p), 1);
      tell(p.from, `${empire(p.to).name} didn't answer your ${p.kind} offer in time.`, "bad");
      emit("proposal");
    }
    for (const o of [...G.offers]) {
      if (G.time <= o.expires) continue;
      G.offers.splice(G.offers.indexOf(o), 1);
      emit("offer");
      if (o.kind === "ultimatum") {
        tell(o.to, `You ignored the ultimatum from the ${empire(o.from).name}.`, "bad");
        resolveUltimatum(o, false);
      }
    }
    G.fx = G.fx.filter(f => f.until > G.time);
  }

  // ---------- fog of war ----------
  // The countries an empire can see right now: its land and everything next to it, radar circles
  // around its airbases and wherever its armies are marching. Allies share what they see.
  const radarOf = c => (cache.radar[c] ||= W.countries.filter(k => dist(c, k.id) <= R.radarKm).map(k => k.id));
  function vision(e) {
    const n = W.countries.length, v = new Uint8Array(n);
    if (!G.settings.fog || G.over || !empire(e)) return v.fill(1);
    const team = new Set(G.empires.filter(o => o.alive && (o.id === e || relation(e, o.id) === "alliance")).map(o => o.id));
    for (const id of team) if (has(id, "satellites")) return v.fill(1);
    for (let c = 0; c < n; c++) {
      if (!team.has(G.owner[c])) continue;
      v[c] = 1;
      for (const nb of W.countries[c].edges.keys()) v[nb] = 1;
      if (G.units[c].air >= 1) for (const k of radarOf(c)) v[k] = 1;
    }
    for (const a of G.armies) if (team.has(a.owner)) { v[a.path[a.leg]] = 1; v[a.path[a.leg + 1]] = 1; }
    for (const m of G.missions) if (team.has(m.owner)) v[m.to] = 1;
    for (const f of G.fx) {
      if (f.kind === "intel" && team.has(f.for)) G.owner.forEach((o, c) => { if (o === f.empire) v[c] = 1; });
    }
    return v;
  }

  // ---------- end of game ----------
  // G.over becomes { winners: [empire ids], time }. No winners means every player was wiped out.
  function checkEnd() {
    for (const e of G.empires) {
      if (!e.alive || cache.owned[e.id].length || G.armies.some(a => a.owner === e.id)) continue;
      e.alive = false;
      G.missions = G.missions.filter(m => m.owner !== e.id);
      G.proposals = G.proposals.filter(p => p.from !== e.id && p.to !== e.id);
      G.offers = G.offers.filter(o => o.from !== e.id && o.to !== e.id);
      tell(e.id, "☠ Your empire has fallen.", "bad");
      if (!e.rebel || e.human) {
        announce(`☠ ${e.name} has been wiped off the map!`, { skip: [e.id] });
        news(`☠ The ${e.name} has been wiped off the map!`, e.start, "bad");
        mark("☠", `The ${e.name} falls`);
      }
      if (e.lastHit >= 0) { addXp(e.lastHit, WD.XP.kill); WD.AI.react("fallen", { dead: e.id, by: e.lastHit }); }
      emit("eliminated", e.id);
    }
    if (G.over) return;
    const players = G.empires.filter(e => e.human && e.alive);
    const target = G.settings.victory - 0.01;
    let winners = null;
    if (!players.length) winners = [];
    else if (G.settings.teams === "coop") {
      const share = players.reduce((s, e) => s + worldShare(e.id), 0);
      if (share >= target || !G.empires.some(e => e.alive && !e.human)) winners = players.map(e => e.id);
    } else {
      const w = players.find(e => worldShare(e.id) >= target || !G.empires.some(o => o.alive && o.id !== e.id));
      if (w) winners = [w.id];
    }
    if (!winners) return;
    for (const id of winners) victoryMedals(id);
    G.over = { winners, time: G.time };
    mark("🏆", winners.length ? `${winners.map(id => empire(id).name).join(" and ")} win the war` : "The AI empires win");
    sampleShares();
    emit("over", G.over);
  }

  function victoryMedals(id) {
    const e = empire(id);
    addXp(id, WD.XP.win + (WD.XP.winDiff[G.settings.difficulty] || 0));
    award(id, "victory");
    if (worldShare(id) >= 99.9) award(id, "conqueror");
    if (G.settings.difficulty === "hard") award(id, "hard");
    if (G.settings.mode === "quick" && G.time < 720) award(id, "speed");
    if (!e.stats.missilesFired && !e.stats.nukesFired) award(id, "pacifist");
    if (e.stats.minShare < 3) award(id, "comeback");
    if (G.settings.scenario === "underdog" || country(e.start).value < WD.UNDERDOG_MAX) award(id, "giant");
  }

  function sampleShares() {
    G.sampleAt = G.time + SAMPLE_EVERY;
    G.history?.shares.push([Math.round(G.time), G.empires.map(e => Math.round(worldShare(e.id) * 10))]);
  }

  // ---------- main tick ----------
  function tick(dt) {
    if (!G || (G.over && !G.over.winners.length)) return;
    G.time += dt;
    refreshCache();
    for (const e of G.empires) {
      if (!e.alive) continue;
      e.money += incomeOf(e.id) * dt;
      const rate = mods(e.id).interest;
      if (rate) e.money += Math.min(3, e.money * rate) * dt;
    }
    moveArmies(dt);
    updateMissions(dt);
    updateBombards(dt);
    battles(dt);
    neutralRegen(dt);
    militia(dt);
    diplomacyDrift(dt);
    WD.AI.tick(dt);
    WD.Autopilot.tick(dt);
    WD.Director.tick(dt);
    refreshCache();
    if (!G.graceOver && G.time >= mode().grace) {
      G.graceOver = true;
      announce("⚔ The opening ceasefire is over. Rival empires may now attack you!", { cls: "bad" });
      news("⚔ The opening ceasefire is over. The great powers turn on each other.");
    }
    if (G.time >= G.sampleAt) sampleShares();
    checkEnd();
    if (mode().autosave && G.time >= G.autosaveAt) { G.autosaveAt += 60; emit("autosave"); }
  }

  // ---------- saving ----------
  const serialize = () => JSON.stringify(G);
  // Smaller copy for the network: decimals rounded to hundredths, and no replay history.
  const serializeCompact = () => JSON.stringify(G, (k, v) => (k === "history" ? undefined : typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v));

  function migrate(data) {
    if (data.version === 1) {
      data.empires.forEach(e => { e.human = !e.isAI; e.away = false; e.playerName = null; });
      data.proposals.forEach(p => { p.to = 0; });
      if (typeof data.over === "string") data.over = { winners: data.over === "win" ? [0] : [], time: data.time };
      data.settings.teams = "ffa";
      data.version = 2;
    }
    if (data.version === 2) {
      // Version 3 added capitals, veterans, research, nukes, leaders, events and the replay.
      data.id ||= Math.random().toString(36).slice(2, 10);
      data.settings.scenario ||= "classic";
      data.settings.fog = false;
      data.vet = data.owner.map(() => 0);
      data.armies.forEach(a => { a.vet = 0; });
      data.sieges.forEach(list => list.forEach(s => { s.vet = 0; s.sea = false; }));
      data.empires.forEach(e => {
        e.capital = data.owner[e.start] === e.id ? e.start : data.owner.indexOf(e.id);
        e.perk = W.countries[e.start].perk;
        Object.assign(e, { tech: [], nukes: 0, team: null, rebel: false, stats: newStats(), medals: {}, xp: 0 });
        if (!e.human) WD.AI.setup(e);
      });
      Object.assign(data, { offers: [], bounties: [], fx: [], eventAt: data.time + 30, sampleAt: data.time });
      data.history = { start: data.owner.slice(), caps: [], shares: [], marks: [] };
      data.version = 3;
    }
    if (data.version === 3) {
      // Version 4 added militia and the players' autopilot.
      const addMil = u => { if (u && u.mil === undefined) u.mil = 0; };
      data.units.forEach(addMil);
      data.armies.forEach(a => addMil(a.units));
      data.sieges.forEach(list => list.forEach(s => addMil(s.units)));
      data.empires.forEach(e => { if (e.human && !e.auto) Object.assign(e, autopilotDefaults(), { lastOrder: data.time }); });
      data.version = 4;
    }
    return data;
  }

  function load(world, json) {
    W = world;
    const data = migrate(typeof json === "string" ? JSON.parse(json) : json);
    if (!data || data.version !== SAVE_VERSION || data.owner?.length !== world.countries.length) throw new Error("This save is from a different version of the game.");
    G = data;
    // A loaded war starts with the player at the controls, not in caretaker mode.
    for (const e of G.empires) if (e.human) e.lastOrder = G.time;
    computeBase();
    refreshCache();
    emit("reset");
    return G;
  }

  // ---------- multiplayer ----------
  // A player who leaves keeps their empire: the AI runs it until they come back.
  function setAway(e, away) {
    const emp = empire(e);
    emp.away = away;
    emp.isAI = away;
    if (away) { emp.aiTimer = 1; emp.dipTimer = 15; }
  }

  // Clients never simulate. They mirror the host's snapshots and fire the same events the
  // host's own UI gets, so the interface works identically on both sides.
  function applySnapshot(world, data) {
    W = world;
    const prev = G;
    G = data;
    if (!prev) computeBase();
    refreshCache();
    if (!prev) { emit("reset"); return; }
    G.owner.forEach((o, c) => { if (prev.owner[c] !== o) emit("capture", { country: c, from: prev.owner[c], to: o, cause: "capture" }); });
    if (JSON.stringify(prev.relations) !== JSON.stringify(G.relations)) emit("relations", {});
    if (prev.proposals.map(p => p.id).join() !== G.proposals.map(p => p.id).join()) emit("proposal");
    if (prev.offers.map(o => o.id).join() !== G.offers.map(o => o.id).join()) emit("offer");
    G.empires.forEach((e, i) => { if (prev.empires[i]?.alive && !e.alive) emit("eliminated", e.id); });
    if (!prev.over && G.over) emit("over", G.over);
  }

  // Move armies, aircraft and the clock forward between snapshots so motion stays smooth.
  function extrapolate(dt) {
    if (!G || dt <= 0) return;
    G.time += dt;
    for (const a of G.armies) a.t = Math.min(0.995, a.t + dt / a.legTime);
    for (const m of G.missions) m.t = Math.min(m.dur * 0.995, m.t + dt);
    for (const e of G.empires) if (e.alive) e.money += incomeOf(e.id) * dt;
  }

  const clear = () => { G = null; };

  return {
    U, on, emit, newGame, load, serialize, serializeCompact, tick, clear,
    setAway, applySnapshot, extrapolate, announce, tell, news, banner, mark,
    sendArmy, buy, launchAir, launchMissile, toggleBombard, preview, armyEta,
    research, buildNuke, launchNuke, answerOffer, offer, buyPack, packCost, setAutopilot, asAutopilot, noteOrder, militiaCap,
    propose, answerProposal, declareWar, setRelation,
    relation, relSince, isHostile, isFriendly, opinion, addOpinion, locked,
    power, shareBorder, worldShare, incomeOf, efficiency, integration, mobilization, findPath, findPathTo, edgeOf, dist,
    mods, landMods, unitCost, techCost, techLocked, nukeCost, airRange, missileRange, attackOf, defenseOf, vision,
    addTroops, setOwner, civilWar, ownedBy, award, addXp, credit, shortName,
    cache,
    get state() { return G; },
    get world() { return W; },
  };
})();
