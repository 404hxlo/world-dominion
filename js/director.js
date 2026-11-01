// The war director keeps every war interesting: surprise world events, contracts that reward
// players for short-term goals, and medals for feats that build up over time. It only runs
// where the war is simulated (solo games and the multiplayer host).
window.WD = window.WD || {};

WD.Director = (() => {
  const Game = WD.Game, U = Game.U;
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const round = (n, to) => Math.max(to, Math.round(n / to) * to);
  let clock = 0;

  // Weighted random choice from [thing, weight] pairs.
  function weighted(items) {
    const total = items.reduce((s, [, w]) => s + Math.max(0, w), 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const [x, w] of items) { r -= Math.max(0, w); if (r <= 0) return x; }
    return items[items.length - 1][0];
  }

  function tick(dt) {
    const G = Game.state;
    if (G.time >= G.eventAt) {
      G.eventAt = G.time + (45 + Math.random() * 35) / (G.settings.mode === "quick" ? 1.3 : 1);
      worldEvent();
    }
    clock += dt;
    if (clock >= 1) {
      clock = 0;
      contracts();
      medals();
      coalition();
    }
  }

  // When an AI runs away with the world, everyone else gangs up on it.
  function coalition() {
    const G = G_(), { e: lead, share } = topAI();
    if (!lead || share < 38 || G.time - (lead.coalitionAt ?? -1e9) < 240) return;
    lead.coalitionAt = G.time;
    const others = living().filter(e => e.id !== lead.id && !e.human);
    for (const a of others) {
      for (const b of others) {
        if (a.id < b.id && Game.relation(a.id, b.id) === "war" && !Game.locked(a.id, b.id)) Game.setRelation(a.id, b.id, "peace");
      }
      if (Game.relation(a.id, lead.id) !== "war" && !Game.locked(a.id, lead.id)) Game.setRelation(a.id, lead.id, "war");
      Game.addOpinion(a.id, lead.id, -25);
      a.rage = { target: lead.id, until: G.time + 150 };
    }
    Game.news(`🤝 The world unites against the ${lead.name}! A grand coalition of ${others.length} empires declares war.`, lead.capital, "bad");
    Game.announce(`🤝 Every AI empire has turned on the ${lead.name}. Strike while it's surrounded!`, { cls: "good", country: lead.capital });
  }

  // ---------- world events ----------
  // Good luck tends to find the underdogs and disasters the leaders, so wars stay close.
  const G_ = () => Game.state;
  const name = c => Game.world.countries[c].name;
  const value = c => Game.world.countries[c].value;
  const living = () => G_().empires.filter(e => e.alive && Game.cache.owned[e.id]?.length);
  const lucky = () => weighted(living().map(e => [e, 1 / (1 + Game.worldShare(e.id) / 6)]));
  const unlucky = () => weighted(living().map(e => [e, 0.3 + Game.worldShare(e.id) / 10]));
  const ownedPick = (e, weight) => weighted(Game.cache.owned[e.id].map(c => [c, weight(c)]));
  const income = () => WD.MODES[G_().settings.mode].income;
  const graceOver = () => G_().time >= WD.MODES[G_().settings.mode].grace;
  const fx = (country, icon, text, cls = "") => Game.emit("eventFx", { country, icon, text, cls });
  // The biggest AI empire, and how much of the world it holds.
  function topAI() {
    let best = null, share = 0;
    for (const e of living()) if (!e.human && Game.worldShare(e.id) > share) { share = Game.worldShare(e.id); best = e; }
    return { e: best, share };
  }

  const EVENTS = [
    { weight: 3, run() {
      const e = lucky(); if (!e) return false;
      const c = ownedPick(e, c => value(c) + 0.3);
      const cash = round((80 + value(c) * 40) * income(), 10);
      e.money += cash;
      Game.news(`🛢 Oil discovered in ${name(c)}! The ${e.name} pockets $${cash}.`, c, "good");
      Game.tell(e.id, `🛢 Oil was discovered in ${name(c)}: +$${cash}.`, "good", c);
      fx(c, "💰", `+$${cash}`, "good");
      return true;
    } },
    { weight: 3, run() {
      const e = unlucky(); if (!e) return false;
      const c = ownedPick(e, c => 1 + U.count(G_().units[c], WD.ARMY_TYPES));
      const kind = pick([["🌋", "A massive earthquake strikes"], ["🌊", "Catastrophic floods hit"], ["🔥", "Wildfires rage across"],
        ...(Game.world.countries[c].coastal ? [["🌀", "A monster hurricane batters"]] : [])]);
      U.scale(G_().units[c], 0.65);
      Game.news(`${kind[0]} ${kind[1]} ${name(c)}. A third of the troops there are lost.`, c, "bad");
      Game.tell(e.id, `${kind[0]} ${kind[1]} ${name(c)}! You lost a third of the troops there.`, "bad", c);
      fx(c, kind[0], "−35%", "bad");
      return true;
    } },
    { weight: 2.5, run() {
      if (!graceOver()) return false;
      const big = living().filter(e => Game.cache.owned[e.id].length >= 6);
      const e = weighted(big.map(e => [e, 0.3 + Game.worldShare(e.id) / 10]));
      if (!e) return false;
      const calm = Game.mods(e.id).calm || 0;
      const c = ownedPick(e, c => (c === e.capital || G_().sieges[c].length ? 0
        : (1.2 - Game.integration(c)) / (1 + U.count(G_().units[c], WD.ARMY_TYPES) / 15)));
      if (c === null || c === undefined) return false;
      if (Math.random() < calm) {
        Game.tell(e.id, `📣 Propaganda kept the people of ${name(c)} from revolting.`, "good", c);
        return true;
      }
      const base = { inf: Math.round((5 + value(c) * 4) * 1.3), tank: Math.floor(value(c) / 2) };
      G_().units[c] = { ...U.empty(), ...base };
      G_().vet[c] = 0.5;
      Game.setOwner(c, -1, "revolution");
      Game.news(`✊ Revolution in ${name(c)}! The people throw off the rule of the ${e.name}.`, c, "bad");
      Game.tell(e.id, `✊ Revolution! ${name(c)} broke free of your empire.`, "bad", c);
      fx(c, "✊", "REVOLT", "bad");
      return true;
    } },
    // Coups split overgrown AI empires; the bigger the empire, the likelier.
    { weight: () => (topAI().share >= 15 ? 0.6 + Math.max(0, topAI().share - 30) / 8 : 0), run() {
      if (!graceOver()) return false;
      const e = weighted(living().filter(e => !e.human && Game.worldShare(e.id) >= 15 && Game.cache.owned[e.id].length >= 8).map(e => [e, Game.worldShare(e.id) ** 2]));
      if (!e) return false;
      const r = Game.civilWar(e.id, Math.round(Game.cache.owned[e.id].length * 0.35));
      if (r < 0) return false;
      Game.news(`🎖 Military coup in the ${e.name}! Rebel generals seize power as the ${G_().empires[r].name}.`, G_().empires[r].capital, "bad");
      return true;
    } },
    { weight: 2.5, run() {
      const players = living().filter(e => e.human && !e.away);
      const e = players.length && Math.random() < 0.8 ? pick(players) : pick(living());
      if (!e) return false;
      const deals = [{ tank: 12 }, { inf: 30, tank: 6 }, { air: 5 }, { mis: 3 }, { art: 10, inf: 10 }];
      const units = pick(deals);
      let full = 0;
      for (const t in units) full += Game.unitCost(e.id, t) * units[t];
      const cost = round(full * 0.5, 10);
      if (!e.human) {
        if (e.money < cost * 2 || !Game.ownedBy(e.id).includes(e.capital)) return false;
        e.money -= cost;
        Game.addTroops(e.capital, units, 1);
        return true;
      }
      if (G_().offers.some(o => o.to === e.id && o.kind === "arms")) return false;
      Game.offer({ kind: "arms", from: -1, to: e.id, units, cost, full });
      return true;
    } },
    { weight: 2.5, run() {
      const e = lucky(); if (!e || !Game.ownedBy(e.id).includes(e.capital)) return false;
      const n = Math.round(12 + Math.random() * 18);
      Game.addTroops(e.capital, { inf: n });
      Game.news(`🙋 Volunteers flock to the ${e.name}: +${n} infantry in ${name(e.capital)}.`, e.capital, "good");
      Game.tell(e.id, `🙋 ${n} volunteers joined your army in ${name(e.capital)}.`, "good", e.capital);
      fx(e.capital, "🙋", `+${n}`, "good");
      return true;
    } },
    { weight: 2, run() {
      const e = lucky(); if (!e) return false;
      G_().fx.push({ kind: "boom", empire: e.id, until: G_().time + 60 });
      Game.news(`📈 Economic boom in the ${e.name}! Income +50% for 60 seconds.`, e.capital, "good");
      Game.tell(e.id, "📈 Your economy is booming: +50% income for 60 seconds!", "good", e.capital);
      return true;
    } },
    { weight: 0.8, run() {
      if (G_().fx.some(f => f.kind === "plague")) return false;
      G_().fx.push({ kind: "plague", until: G_().time + 45 });
      Game.news("🦠 A pandemic sweeps the globe. Every economy slows down for 45 seconds.", undefined, "bad");
      Game.announce("🦠 Pandemic! Everyone's income is 30% lower for 45 seconds.", { cls: "bad" });
      return true;
    } },
    { weight: 2, run() {
      const G = G_(), W = Game.world;
      const cands = [];
      for (const e of living()) {
        const luck = 1 / (1 + Game.worldShare(e.id) / 5);
        for (const c of Game.cache.owned[e.id]) {
          for (const nb of W.countries[c].edges.keys()) if (G.owner[nb] < 0 && !G.sieges[nb].length) cands.push([[e, nb], luck / (1 + value(nb))]);
        }
      }
      const got = weighted(cands);
      if (!got) return false;
      const [e, c] = got;
      Game.setOwner(c, e.id, "defect");
      G.capturedAt[c] = G.time - WD.RULES.integrationTime / 2;
      Game.news(`🗳 The people of ${name(c)} vote to join the ${e.name}!`, c, "good");
      Game.tell(e.id, `🗳 ${name(c)} voted to join your empire, army and all!`, "good", c);
      fx(c, "🗳", "JOINED", "good");
      return true;
    } },
    { weight: 1.5, run() {
      const e = unlucky(); if (!e) return false;
      const c = ownedPick(e, c => G_().units[c].mis * 3 + G_().units[c].art);
      if (c === null || c === undefined || G_().units[c].mis + G_().units[c].art < 3) return false;
      G_().units[c].mis = 0;
      U.scale(G_().units[c], 0.8);
      Game.emit("explosion", { country: c, big: true });
      Game.news(`💥 An ammunition depot explodes in ${name(c)}.`, c, "bad");
      Game.tell(e.id, `💥 An ammunition depot blew up in ${name(c)}. Its missiles are gone.`, "bad", c);
      return true;
    } },
    { weight: 1.2, run() {
      const e = lucky(); if (!e) return false;
      const c = ownedPick(e, c => value(c));
      const cash = round((150 + value(c) * 30) * income(), 10);
      e.money += cash;
      for (const o of G_().empires) if (o.alive) Game.addOpinion(o.id, e.id, 8);
      Game.news(`⚽ ${name(c)} hosts the World Cup! Tourism brings $${cash} to the ${e.name}.`, c, "good");
      Game.tell(e.id, `⚽ ${name(c)} hosts the World Cup: +$${cash}, and the world likes you a little more.`, "good", c);
      fx(c, "⚽", `+$${cash}`, "good");
      return true;
    } },
    { weight: 1.5, run() {
      const e = pick(living().filter(e => e.isAI && e.leader && !e.human));
      if (!e) return false;
      const old = e.leader.persona;
      WD.AI.setup(e, pick(Object.keys(WD.PERSONAS).filter(p => p !== old)));
      const P = WD.PERSONAS[e.leader.persona];
      Game.news(`🗳 New leader in the ${e.name}: ${e.leader.title} ${e.leader.name}, a ${P.name.toLowerCase()}.`, e.capital);
      return true;
    } },
    { weight: 1.5, run() {
      const e = unlucky(); if (!e) return false;
      const c = ownedPick(e, c => value(c));
      U.scale(G_().units[c], 0.75);
      G_().fx.push({ kind: "famine", country: c, until: G_().time + 60 });
      Game.news(`🌾 Famine in ${name(c)}. Its economy collapses for a minute.`, c, "bad");
      Game.tell(e.id, `🌾 Famine in ${name(c)}: no income from it for 60 seconds, and a quarter of the troops deserted.`, "bad", c);
      fx(c, "🌾", "FAMINE", "bad");
      return true;
    } },
    { weight: 1.5, run() {
      const G = G_();
      if (!G.settings.fog) return false;
      const e = pick(living().filter(e => e.human && !e.away));
      const foe = e && pick(living().filter(o => o.id !== e.id && Game.relation(e.id, o.id) === "war"));
      if (!foe) return false;
      G.fx.push({ kind: "intel", for: e.id, empire: foe.id, until: G.time + 60 });
      Game.tell(e.id, `🕵 Leaked war plans reveal every nation and army of the ${foe.name} for 60 seconds.`, "good", foe.capital);
      return true;
    } },
    { weight: 0.4, run() {
      const G = G_();
      const c = weighted(G.owner.map((o, c) => [c, value(c)]));
      U.scale(G.units[c], 0.4);
      for (const s of G.sieges[c]) U.scale(s.units, 0.4);
      Game.emit("explosion", { country: c, big: true });
      Game.news(`☄ A meteor slams into ${name(c)}! Most of the troops there are gone.`, c, "bad");
      Game.tell(G.owner[c], `☄ A meteor struck ${name(c)}! You lost most of the troops there.`, "bad", c);
      return true;
    } },
    { weight: 1, run() {
      // AI rivals at war make peace, or friends fall out, so the alliances keep shifting.
      const G = G_();
      const pairs = [];
      for (const a of living()) for (const b of living()) {
        if (a.id >= b.id || a.human || b.human || !Game.shareBorder(a.id, b.id) || Game.locked(a.id, b.id)) continue;
        pairs.push([a, b]);
      }
      const p = pick(pairs);
      if (!p || !graceOver()) return false;
      const [a, b] = p;
      if (Game.relation(a.id, b.id) === "war") {
        Game.setRelation(a.id, b.id, "peace");
        Game.news(`🕊 A peace conference ends the war between the ${a.name} and the ${b.name}.`);
      } else {
        Game.setRelation(a.id, b.id, "war");
        Game.news(`💥 A border incident sparks war between the ${a.name} and the ${b.name}!`);
      }
      return true;
    } },
  ];

  function worldEvent() {
    for (let tries = 0; tries < 6; tries++) {
      const ev = weighted(EVENTS.map(e => [e, typeof e.weight === "function" ? e.weight() : e.weight]));
      if (ev && ev.run()) return;
    }
  }

  // ---------- contracts ----------
  const KINDS = {
    take: { icon: "🎯", time: 150 },
    capital: { icon: "👑", time: 300 },
    expand: { icon: "🗺️", time: 180 },
    kill: { icon: "💀", time: 120 },
    hold: { icon: "🛡️", time: 120 },
    strike: { icon: "💥", time: 120 },
    research: { icon: "🔬", time: 180 },
  };

  function makeContract(e) {
    const G = G_(), W = Game.world, k = income();
    const mine = G.bounties.filter(b => b.for === e.id);
    const used = new Set(mine.map(b => b.kind));
    const targeted = new Set(G.bounties.map(b => b.target));
    const owned = Game.cache.owned[e.id];
    const near = new Set();
    for (const c of owned) for (const nb of W.countries[c].edges.keys()) {
      if (Game.isHostile(e.id, nb) && !targeted.has(nb)) near.add(nb);
    }
    const options = [];
    if (near.size) {
      const list = [...near].filter(c => graceOver() || G.owner[c] < 0);
      const t = weighted(list.map(c => [c, value(c) + 0.5]));
      if (t !== null && t !== undefined) {
        const enemy = G.owner[t] >= 0;
        options.push({ kind: "take", target: t, title: `Take ${name(t)}`, reward: round((100 + value(t) * 60) * k * (enemy ? 1.5 : 1), 25) });
      }
    }
    if (graceOver()) {
      const caps = G.empires.filter(o => o.alive && o.id !== e.id && o.capital >= 0 && Game.relation(e.id, o.id) === "war" && Game.shareBorder(e.id, o.id) && !targeted.has(o.capital));
      const o = pick(caps);
      if (o) options.push({ kind: "capital", target: o.capital, title: `Seize ${name(o.capital)}, capital of the ${o.name}`, reward: round((500 + value(o.capital) * 80) * k, 50) });
      const enemies = G.empires.some(o => o.alive && o.id !== e.id && Game.relation(e.id, o.id) === "war" && Game.shareBorder(e.id, o.id));
      if (enemies) options.push({ kind: "hold", title: "Lose no nations for 2 minutes", reward: round(250 * k, 25), base: e.lost });
      const troops = owned.reduce((s, c) => s + U.count(G.units[c], WD.ARMY_TYPES), 0);
      const goal = Math.min(400, round(troops * 0.5, 10));
      options.push({ kind: "kill", title: `Destroy ${goal} enemy troops`, goal, base: e.stats.kills, reward: round(goal * 3 * k, 25) });
    }
    options.push({ kind: "expand", title: `Rule ${owned.length + 3} nations`, goal: owned.length + 3, reward: round(300 * k, 25) });
    if (e.tech.length < WD.TECH_IDS.length) options.push({ kind: "research", title: "Research a technology", base: e.tech.length, reward: round(200 * k, 25) });
    const air = owned.some(c => G.units[c].air >= 1 || G.units[c].mis >= 1);
    if (air) {
      const t = weighted(G.owner.map((o, c) => [c, o >= 0 && o !== e.id && Game.isHostile(e.id, c) && !targeted.has(c) &&
        owned.some(m => Game.dist(m, c) < WD.RULES.airRangeKm) ? 1 : 0]));
      if (t !== null && t !== undefined && Game.isHostile(e.id, t) && G.owner[t] >= 0) options.push({ kind: "strike", target: t, title: `Bomb ${name(t)} with aircraft or a missile`, reward: round(150 * k, 25) });
    }
    const fresh = options.filter(o => !used.has(o.kind));
    const b = pick(fresh.length ? fresh : options);
    if (!b) return null;
    const time = KINDS[b.kind].time / (G.settings.mode === "quick" ? 1.25 : 1);
    return { id: G.nextId++, for: e.id, icon: KINDS[b.kind].icon, start: G.time, expires: G.time + time, ...b };
  }

  function contracts() {
    const G = G_();
    for (const e of G.empires) {
      if (!e.human) continue;
      for (const b of G.bounties.filter(x => x.for === e.id)) checkContract(b, e);
      if (!e.alive || e.away) continue;
      const open = G.bounties.filter(b => b.for === e.id).length;
      if (open < 3 && G.time >= (e.nextBounty ?? 2)) {
        const b = makeContract(e);
        e.nextBounty = G.time + (open < 1 ? 3 : 25);
        if (b) {
          G.bounties.push(b);
          Game.emit("bounty", { for: e.id, kind: "new", title: b.title, icon: b.icon, reward: b.reward });
        }
      }
    }
  }

  function done(b, e) {
    const G = G_();
    if (b.kind === "take" || b.kind === "capital") return G.owner[b.target] === e.id;
    if (b.kind === "expand") return Game.cache.owned[e.id].length >= b.goal;
    if (b.kind === "kill") return e.stats.kills - b.base >= b.goal;
    if (b.kind === "strike") return !!b.hit;
    if (b.kind === "research") return e.tech.length > b.base;
    return false;
  }

  function checkContract(b, e) {
    const G = G_();
    const close = () => G.bounties.splice(G.bounties.indexOf(b), 1);
    if (!e.alive) { close(); return; }
    if (b.kind === "hold" && e.lost > b.base) {
      close();
      Game.emit("bounty", { for: e.id, kind: "failed", title: b.title });
      return;
    }
    const won = done(b, e) || (b.kind === "hold" && G.time >= b.expires);
    if (won) {
      close();
      e.money += b.reward;
      e.stats.bounties++;
      Game.addXp(e.id, WD.XP.bounty + b.reward / 20);
      if (e.stats.bounties >= 10) Game.award(e.id, "hunter");
      Game.emit("bounty", { for: e.id, kind: "done", title: b.title, icon: b.icon, reward: b.reward });
      return;
    }
    // Out of time, or the target can no longer be attacked (a treaty, or someone else took it).
    const blocked = (b.kind === "take" || b.kind === "capital" || b.kind === "strike") && G.owner[b.target] !== e.id && !Game.isHostile(e.id, b.target);
    if (G.time >= b.expires || blocked) {
      close();
      Game.emit("bounty", { for: e.id, kind: "failed", title: b.title });
    }
  }

  Game.on("strike", ({ owner, country }) => {
    const G = Game.state;
    if (G) for (const b of G.bounties) if (b.kind === "strike" && b.for === owner && b.target === country) b.hit = true;
  });

  // ---------- medals that build up over time ----------
  function medals() {
    const G = G_();
    const graceDone = graceOver();
    for (const e of G.empires) {
      if (!e.human || !e.alive) continue;
      const share = Game.worldShare(e.id);
      if (graceDone) e.stats.minShare = Math.min(e.stats.minShare, share);
      if (share >= 99.9) Game.award(e.id, "conqueror");
      if (e.money >= 10000) Game.award(e.id, "tycoon");
      if (G.empires.filter(o => o.alive && o.id !== e.id && Game.relation(e.id, o.id) === "alliance").length >= 3) Game.award(e.id, "diplomat");
      if (e.medals.elite === undefined) {
        const elite = Game.cache.owned[e.id].some(c => G.vet[c] >= 2.99 && U.count(G.units[c], WD.ARMY_TYPES) >= 20) ||
          G.armies.some(a => a.owner === e.id && a.vet >= 2.99 && U.count(a.units, WD.ARMY_TYPES) >= 20);
        if (elite) Game.award(e.id, "elite");
      }
    }
  }

  return { tick };
})();
