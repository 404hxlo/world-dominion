// Computer-controlled empires: leaders with personalities, recruiting, attacking, reinforcing,
// research, special weapons (nukes included), ultimatums, diplomacy, and what leaders say to players.
window.WD = window.WD || {};

WD.AI = (() => {
  const Game = WD.Game, U = Game.U;
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const persona = e => WD.PERSONAS[e.leader?.persona] || WD.PERSONAS.opportunist;
  const grace = () => WD.MODES[Game.state.settings.mode].grace;

  // ---------- leaders ----------
  function randomPersona(rebel) {
    if (rebel) return pick(["warmonger", "expansionist", "opportunist"]);
    const list = Object.entries(WD.PERSONAS);
    let r = Math.random() * list.reduce((s, [, p]) => s + p.weight, 0);
    for (const [id, p] of list) { r -= p.weight; if (r <= 0) return id; }
    return list[0][0];
  }

  // Give an AI empire (or a rebel faction) a leader with a name, a face and a personality.
  function setup(e, id = randomPersona(e.rebel)) {
    const p = WD.PERSONAS[id];
    e.leader = {
      name: `${pick(WD.LEADER_FIRST)} ${pick(WD.LEADER_LAST)}`,
      title: e.rebel ? pick(["General", "Commander", "Colonel"]) : pick(WD.LEADER_TITLES),
      face: pick(WD.LEADER_FACES), persona: id,
    };
    e.aggression = p.aggression * (0.85 + Math.random() * 0.3);
    e.loyalty = Math.min(1, Math.max(0, p.loyalty + (Math.random() - 0.5) * 0.2));
    e.talk ||= {};
    e.nextDemand ??= 200 + Math.random() * 120;
    e.nukeAt ??= 0;
    e.goal = null;
  }

  // ---------- what leaders say ----------
  function line(kind, id) {
    const set = WD.LINES[kind];
    if (!set) return "";
    return pick(Array.isArray(set) ? set : set[id] || set.warmonger);
  }

  // An AI leader speaks to a player. Rate limited so the comms channel stays readable;
  // `force` skips the limit for moments that always deserve a word.
  function say(from, to, kind, vars = {}, force = false) {
    const G = Game.state, e = G.empires[from], p = G.empires[to];
    if (!e || !p || !e.leader || !p.human || p.away) return;
    if (!e.alive && kind !== "fallen") return;
    const P = persona(e);
    if (!force && ((e.talk[to] || 0) > G.time || Math.random() > Math.min(1, 0.7 * P.chatty))) return;
    e.talk[to] = G.time + 25 / P.chatty;
    const text = line(kind, e.leader.persona)
      .replace(/\{c\}/g, vars.c ?? "").replace(/\{me\}/g, e.name).replace(/\{you\}/g, p.name).replace(/\{n\}/g, vars.n ?? "");
    if (!text) return;
    Game.emit("log", {
      text, cls: "comms", for: to, country: vars.country,
      leader: { face: e.leader.face, name: `${e.leader.title} ${e.leader.name}`, empire: e.name, color: e.color },
    });
  }

  // Reactions to big moments, called by the simulation.
  function react(kind, d) {
    const G = Game.state, W = Game.world;
    const human = id => id >= 0 && G.empires[id]?.human;
    if (kind === "capture") {
      const c = W.countries[d.country].name;
      if (human(d.from)) say(d.to, d.from, "tookYours", { c, country: d.country });
      else if (human(d.to)) say(d.from, d.to, "lostToYou", { c, country: d.country });
    } else if (kind === "capital") {
      if (human(d.to)) say(d.from, d.to, "capital", { country: d.country }, true);
    } else if (kind === "nuked") {
      const victim = G.empires[d.victim];
      if (victim?.isAI) victim.rage = { target: d.by, until: G.time + 120 };
      if (!human(d.by)) return;
      for (const e of G.empires) {
        if (e.alive && e.leader && (e.id === d.victim || Math.random() < 0.25)) say(e.id, d.by, "nuked", { country: d.country }, e.id === d.victim);
      }
    } else if (kind === "fallen") {
      if (human(d.by)) say(d.dead, d.by, "fallen", {}, true);
    }
  }

  // ---------- main loop ----------
  function tick(dt) {
    const G = Game.state;
    const diff = WD.DIFFICULTY[G.settings.difficulty];
    for (const e of G.empires) {
      if (!e.isAI || !e.alive) continue;
      e.aiTimer -= dt;
      if (e.aiTimer <= 0) {
        e.aiTimer = diff.think * (0.75 + Math.random() * 0.5);
        think(e, diff);
      }
      e.dipTimer -= dt;
      if (e.dipTimer <= 0) {
        e.dipTimer = 12 + Math.random() * 14;
        diplomacy(e, diff);
      }
    }
  }

  // During the opening ceasefire an AI only hits empires that attacked it first.
  function mayAttack(e, t) {
    const G = Game.state, o = G.owner[t];
    if (o < 0) return true;
    if (e.spare && e.spare[o] > G.time) return false;   // a met ultimatum buys a few minutes of peace
    if (G.time < grace()) return Game.opinion(e.id, o) < -5;
    // Turtles leave other empires alone unless provoked.
    if (e.leader?.persona === "turtle" && Game.opinion(e.id, o) > -15 && e.rage?.target !== o) return false;
    return true;
  }

  // The empire controlling the biggest share of the world, if it is big enough to worry about.
  function leader() {
    const G = Game.state;
    let best = null, share = 25;
    for (const e of G.empires) if (e.alive && Game.worldShare(e.id) > share) { share = Game.worldShare(e.id); best = e.id; }
    return best;
  }

  const strength = (units, owner, vet) => Game.attackOf(units, owner, vet);

  function think(e, diff) {
    const G = Game.state, W = Game.world;
    const owned = Game.cache.owned[e.id];
    if (!owned || !owned.length) return;

    const info = new Map();
    const frontier = [];
    for (const c of owned) {
      let threat = 0;
      const targets = [];
      for (const edge of W.countries[c].edges.values()) {
        const n = edge.to;
        if (!Game.isHostile(e.id, n)) continue;
        if (G.owner[n] >= 0) threat += strength(G.units[n], G.owner[n], G.vet[n]);
        targets.push(n);
      }
      info.set(c, { threat, targets });
      if (targets.length) frontier.push(c);
    }

    const planned = new Map();
    const addPlan = (c, p) => planned.set(c, (planned.get(c) || 0) + p);
    for (const a of G.armies) {
      const dest = a.path[a.path.length - 1];
      if (a.owner === e.id) addPlan(dest, strength(a.units, a.owner, a.vet));
      else if (G.owner[dest] === e.id && info.has(dest)) info.get(dest).threat += strength(a.units, a.owner, a.vet) * 1.2;
    }
    G.sieges.forEach((list, c) => list.forEach(s => { if (s.owner === e.id) addPlan(c, strength(s.units, s.owner, s.vet)); }));

    const reserve = invest(e, diff, frontier, info);
    recruit(e, diff, owned, frontier, info, reserve);
    attack(e, diff, frontier, info, planned);
    expedition(e, diff, owned, planned);
    reinforce(e, owned, frontier);
    specials(e, owned, frontier, info, planned);
  }

  // ---------- research and warheads: save up for a goal, unless the homeland is in danger ----------
  function nextTech(e) {
    const P = persona(e);
    const open = WD.TECH_IDS.filter(id => !e.tech.includes(id) && !Game.techLocked(e.id, id) && (id !== "nuclear" || P.nuke >= 0.5));
    return P.research.find(id => open.includes(id)) || pick(open) || null;
  }

  function invest(e, diff, frontier, info) {
    const G = Game.state, P = persona(e);
    const danger = frontier.some(c => info.get(c).threat > Game.defenseOf(c) * 1.1);
    if (e.goal && G.time > e.goal.until) e.goal = null;
    if (!e.goal) {
      const want = Game.mods(e.id).nuclear && e.nukes < (P.nuke >= 1 ? 2 : 1) && P.nuke >= 0.3;
      const chance = 0.03 * (diff.spend + 0.1);
      if (want && Math.random() < chance * 2) e.goal = { kind: "nuke", until: G.time + 150 };
      else if (Math.random() < chance) {
        const id = nextTech(e);
        if (id) e.goal = { kind: "tech", id, until: G.time + 150 };
      }
    }
    if (!e.goal) return 0;
    const cost = e.goal.kind === "nuke" ? Game.nukeCost() : Game.techCost(e.id, e.goal.id);
    if (e.money >= cost) {
      const res = e.goal.kind === "nuke" ? Game.buildNuke(e.id) : Game.research(e.id, e.goal.id);
      if (res.ok || !res.reason?.startsWith("Not enough")) e.goal = null;
      return 0;
    }
    return danger ? 0 : cost;
  }

  function recruit(e, diff, owned, frontier, info, reserve) {
    const G = Game.state, W = Game.world;
    let budget = Math.max(0, e.money - reserve) * diff.spend;
    if (budget < 10) return;
    const pool = frontier.length ? frontier : owned;
    let at = pool[0], best = -Infinity;
    for (const c of pool) {
      const i = info.get(c);
      const need = i.threat * 1.1 - Game.defenseOf(c);
      let opp = 0;
      for (const t of i.targets) opp = Math.max(opp, (W.countries[t].value + 0.5) / (Game.defenseOf(t) + 5));
      const score = need > 0 ? 1000 + need : opp * 100 + Math.random();
      if (score > best) { best = score; at = c; }
    }
    if (Game.cache.rad.has(at)) at = owned.find(c => !Game.cache.rad.has(c));
    if (at === undefined) return;
    const here = W.countries[at];
    const i = info.get(at);
    const seaTargets = i.targets.some(t => here.edges.get(t).sea);
    const enemies = i.threat > 0;
    const turtle = e.leader?.persona === "turtle";
    let guard = 400;
    while (budget >= 10 && guard--) {
      const r = Math.random();
      let type = "inf";
      if (r < (turtle ? 0.2 : 0.32)) type = "tank";
      else if (r < 0.42 && (enemies || turtle)) type = "art";
      else if (r < 0.52 && here.coastal && seaTargets) type = "ship";
      else if (r < 0.57 && G.units[at].air < 8) type = "air";
      else if (r < 0.59 && enemies && G.settings.difficulty !== "easy") type = "mis";
      const cost = Game.unitCost(e.id, type);
      if (cost > budget) type = "inf";
      if (!Game.buy(e.id, at, type, 1).ok) break;
      budget -= Game.unitCost(e.id, type);
    }
  }

  function atWar(o) {
    const G = Game.state;
    return G.empires.filter(x => x.alive && x.id !== o && Game.relation(o, x.id) === "war" && Game.shareBorder(o, x.id)).length;
  }

  function attack(e, diff, frontier, info, planned) {
    const G = Game.state, W = Game.world;
    const margin = diff.margin / Math.sqrt(e.aggression);
    const maxLaunch = G.settings.difficulty === "hard" ? 5 : 3;
    const style = e.leader?.persona;
    const rage = e.rage && e.rage.until > G.time ? e.rage.target : -1;
    let launches = 0;
    const sorted = frontier.slice().sort((a, b) => U.attack(G.units[b]) - U.attack(G.units[a]));
    for (const c of sorted) {
      if (launches >= maxLaunch) break;
      const i = info.get(c), g = G.units[c], value = W.countries[c].value;
      const total = strength(g, e.id, G.vet[c]);
      // Keep a home guard: more for rich countries and the capital, and much more for turtles.
      let keep = Math.max(i.threat * 0.9, 2 + value * 1.5);
      if (c === e.capital) keep = Math.max(keep, 10 + value * 3);
      if (style === "turtle") keep *= 1.6;
      const avail = total - keep;
      if (avail < 3) continue;
      let bestT = -1, bestScore = 0, bestNeed = 0;
      for (const t of i.targets) {
        if (!mayAttack(e, t)) continue;
        const D = Game.defenseOf(t);
        const need = D * margin + 1 - (planned.get(t) || 0);
        if (need <= 0 || avail < need) continue;
        const o = G.owner[t];
        let score = (W.countries[t].value + 0.5) / (D + 3);
        if (o >= 0) {
          score *= e.aggression * 1.2;
          if (o === rage) score *= 3;
          if (G.empires[o].capital === t) score *= 1.5;   // go for the head
          if (style === "warmonger") score *= 1.3;
          if (style === "opportunist") score *= 1 + atWar(o) * 0.3 + (Game.power(o) < Game.power(e.id) ? 0.5 : 0);
        }
        if (G.sieges[t].some(s => s.owner === e.id)) score *= 2;
        if (score > bestScore) { bestScore = score; bestT = t; bestNeed = need; }
      }
      if (bestT < 0) continue;
      const frac = Math.min(avail / total, Math.max(0.35, (bestNeed * 1.4) / total));
      const res = Game.sendArmy(e.id, c, bestT, frac);
      if (res.ok) {
        planned.set(bestT, (planned.get(bestT) || 0) + strength(res.army.units, e.id, res.army.vet));
        launches++;
      }
    }
  }

  // Send the biggest idle army through friendly land to the nearest enemy country it can beat.
  function expedition(e, diff, owned, planned) {
    const G = Game.state, W = Game.world;
    let src = -1, spare = 0;
    for (const c of owned) {
      const s = strength(G.units[c], e.id, G.vet[c]) - (12 + W.countries[c].value * 3);
      if (s > spare) { spare = s; src = c; }
    }
    if (src < 0 || spare < 25) return;
    const path = Game.findPathTo(src, e.id, false, u =>
      Game.isHostile(e.id, u) && mayAttack(e, u) && Game.defenseOf(u) * diff.margin - (planned.get(u) || 0) < spare * 0.8);
    if (!path) return;
    const t = path[path.length - 1];
    const res = Game.sendArmy(e.id, src, t, spare / strength(G.units[src], e.id, G.vet[src]));
    if (res.ok) planned.set(t, (planned.get(t) || 0) + strength(res.army.units, e.id, res.army.vet));
  }

  // Move idle troops from safe interior countries toward the nearest border.
  function reinforce(e, owned, frontier) {
    const G = Game.state;
    if (!frontier.length) return;
    const fset = new Set(frontier);
    let moves = 0;
    for (const c of owned) {
      if (moves >= 3) break;
      if (fset.has(c) || U.count(G.units[c], ["inf", "tank", "art"]) < 3) continue;
      const path = Game.findPathTo(c, e.id, false, u => fset.has(u));
      if (!path) continue;
      if (Game.sendArmy(e.id, c, path[path.length - 1], 0.9, ["inf", "tank", "art"]).ok) moves++;
    }
  }

  function specials(e, owned, frontier, info, planned) {
    const G = Game.state;
    const targets = new Set();
    for (const c of frontier) info.get(c).targets.forEach(t => targets.add(t));
    const pickTarget = (from, range, enemiesOnly) => {
      let best = -1, bestScore = 0;
      for (const t of targets) {
        if ((enemiesOnly && G.owner[t] < 0) || !mayAttack(e, t)) continue;
        if (Game.dist(from, t) > range) continue;
        const score = Game.defenseOf(t) * (planned.has(t) ? 2 : 1);
        if (score > bestScore) { bestScore = score; best = t; }
      }
      return best;
    };
    for (const c of owned) {
      const g = G.units[c];
      if (g.air >= 3) {
        const t = pickTarget(c, Game.airRange(e.id), false);
        if (t >= 0) Game.launchAir(e.id, c, t);
      }
      if (g.art >= 2 && info.get(c).targets.length && !G.bombards.some(b => b.from === c)) {
        let best = -1, bestD = 0;
        for (const t of info.get(c).targets) {
          const d = Game.defenseOf(t);
          if (d > bestD && mayAttack(e, t)) { bestD = d; best = t; }
        }
        if (best >= 0) Game.toggleBombard(e.id, c, best);
      }
      if (g.mis >= 1) {
        const t = pickTarget(c, Game.missileRange(e.id), true);
        if (t >= 0 && Game.defenseOf(t) >= 15) Game.launchMissile(e.id, c, t);
      }
    }
    nuclearStrike(e);
  }

  // Warmongers use nukes readily; everyone else only when their capital is under attack.
  function nuclearStrike(e) {
    const G = Game.state, P = persona(e);
    if (e.nukes < 1 || G.time < (e.nukeAt || 0) || G.time < grace()) return;
    const desperate = e.capital >= 0 && G.sieges[e.capital]?.some(s => Game.relation(e.id, s.owner) === "war");
    if (Math.random() > 0.04 * P.nuke + (desperate ? 0.3 : 0)) return;
    let best = -1, bestScore = 80;
    G.owner.forEach((o, c) => {
      if (o < 0 || o === e.id || !Game.isHostile(e.id, c) || !Game.shareBorder(e.id, o)) return;
      const besieging = desperate && G.sieges[e.capital].reduce((s, x) => s + (x.owner === o ? 1 : 0), 0);
      const score = Game.defenseOf(c) * (G.empires[o].capital === c ? 1.4 : 1) * (besieging ? 1.5 : 1);
      if (score > bestScore) { bestScore = score; best = c; }
    });
    if (best < 0) return;
    if (Game.launchNuke(e.id, best).ok) e.nukeAt = G.time + 90;
  }

  // ---------- diplomacy ----------
  function diplomacy(e, diff) {
    const G = Game.state;
    const top = leader();
    const P = persona(e);
    for (const o of G.empires) {
      if (o.id === e.id || !o.alive) continue;
      const rel = Game.relation(e.id, o.id);
      const border = Game.shareBorder(e.id, o.id);
      const ratio = Game.power(o.id) / Math.max(1, Game.power(e.id));
      const age = G.time - Game.relSince(e.id, o.id);
      if (rel === "war") {
        const unite = top !== null && top !== e.id && top !== o.id;   // stand together against a runaway leader
        const keen = P.peace > 10 ? 0.4 : P.peace < 0 ? 0.12 : 0.25;
        if (border && (ratio > 1.4 || unite) && Math.random() < keen) Game.propose(e.id, o.id, "peace");
        else if (border && o.human && ratio < 0.7 && Math.random() < 0.15) say(e.id, o.id, "threat");
        continue;
      }
      if (Game.locked(e.id, o.id)) continue;
      // Schemers and other disloyal leaders stab weaker neighbors in the back.
      if (border && ratio < 0.5 && age > 90 && Math.random() < (1 - e.loyalty) * diff.betray * 0.35 * P.betray) {
        if (Game.declareWar(e.id, o.id).ok && o.human) say(e.id, o.id, "warOnYou", {}, true);
        continue;
      }
      if (rel === "peace" && age > 60 && Game.opinion(e.id, o.id) > 20 - P.peace / 2 && Math.random() < 0.15) Game.propose(e.id, o.id, "alliance");
    }
    demand(e);
  }

  // Strong leaders bully weaker players next door: hand over a border nation, or pay up.
  function demand(e) {
    const G = Game.state, W = Game.world, P = persona(e);
    if (!e.leader || !P.demand || G.time < Math.max(e.nextDemand || 0, grace())) return;
    e.nextDemand = G.time + (150 + Math.random() * 150) / P.demand;
    // At most one ultimatum per player every two and a half minutes, from anyone.
    const target = G.empires.find(p => p.human && p.alive && !p.away && Game.shareBorder(e.id, p.id) && !Game.locked(e.id, p.id) &&
      Game.power(e.id) / Math.max(1, Game.power(p.id)) >= 1.4 && Game.cache.owned[p.id].length >= 3 &&
      G.time - (p.ultimatumAt ?? -1e9) > 150);
    if (!target) return;
    target.ultimatumAt = G.time;
    const border = Game.cache.owned[target.id].filter(c => c !== target.capital && [...W.countries[c].edges.keys()].some(n => G.owner[n] === e.id));
    const o = { kind: "ultimatum", from: e.id, to: target.id, country: -1, money: 0 };
    if (border.length && Math.random() < 0.65) {
      border.sort((a, b) => W.countries[a].value - W.countries[b].value);
      o.country = border[Math.floor(Math.random() * Math.ceil(border.length / 2))];
    } else o.money = Math.max(200, Math.round(target.money * 0.35 / 50) * 50);
    Game.offer(o);
    say(e.id, target.id, o.country >= 0 ? "ultimatum" : "tribute", { c: o.country >= 0 ? W.countries[o.country].name : "", n: o.money.toLocaleString(), country: o.country >= 0 ? o.country : undefined }, true);
  }

  // Decide whether AI empire `ai` accepts a treaty offered by empire `from`.
  function considerTreaty(ai, from, kind) {
    const G = Game.state;
    const e = G.empires[ai];
    if (G.time - (e.refused[from] ?? -999) < 30) return { accept: false, reason: `${e.name} refuses to talk again so soon.` };
    const ratio = Game.power(from) / Math.max(1, Game.power(ai));
    let wars = 0;
    for (const o of G.empires) if (o.alive && o.id !== ai && o.id !== from && Game.relation(ai, o.id) === "war" && Game.shareBorder(ai, o.id)) wars++;
    let score = Game.opinion(ai, from) + (ratio - 1) * 25 - e.aggression * 15 + wars * 8 + persona(e).peace + (Math.random() * 20 - 10);
    if (!Game.shareBorder(ai, from)) score += 12;
    if (kind === "alliance") score -= 25;
    const top = leader();
    if (top !== null && top !== ai && top !== from) score += 25;
    const who = e.leader ? `${e.leader.title} ${e.leader.name}` : e.name;
    if (score > 0) return { accept: true, quote: e.leader ? `${who}: “${line(kind === "peace" ? "peaceYes" : "allyYes")}”` : "" };
    e.refused[from] = G.time;
    const mood = Game.opinion(ai, from) < -20 ? "They don't trust you." : ratio < 1 ? "They think they can win." : "They aren't interested right now.";
    return { accept: false, reason: `${e.name} rejected your ${kind} offer. ${mood}` };
  }

  return { tick, setup, say, react, considerTreaty, leader };
})();
