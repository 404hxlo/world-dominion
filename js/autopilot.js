// The autopilot looks after players' empires between their own orders: it spends a share of
// income on defenders wherever an attack is coming, moves idle troops from the safe interior to
// threatened borders, and strikes back to win lost nations back. Its smart troops also gather
// idle armies at the front, take weak neighbors (and, if the player wants, attack enemies) when
// they can win easily, and pull out of battles that are clearly lost. It only runs where the
// war is simulated (solo games and the multiplayer host), and leaves players who are away to the AI.
window.WD = window.WD || {};

WD.Autopilot = (() => {
  const Game = WD.Game, U = Game.U, R = WD.RULES;
  const EVERY = 2.5;          // seconds between decisions
  const REPORT_EVERY = 25;    // seconds between summaries in the player's log
  const IDLE_SECS = 60;       // no orders for this long and the caretaker may spend savings too
  const MOVERS = ["inf", "tank", "art"];
  let clock = 0;

  const active = e => !!e && e.human && e.alive && !e.away && !!e.auto;
  // Caretaker mode: the player hasn't given an order for a while, so their savings are fair game for defense.
  const caretaking = e => e.auto.caretaker && Game.state.time - (e.lastOrder || 0) > IDLE_SECS;

  function tick(dt) {
    const G = Game.state;
    for (const e of G.empires) {
      if (!active(e)) continue;
      const rate = Game.incomeOf(e.id) * e.auto.budget;
      e.autoFund = Math.min(rate * R.autoFundSecs, (e.autoFund || 0) + rate * dt);
    }
    clock += dt;
    if (clock < EVERY) return;
    clock = 0;
    for (const e of G.empires) if (active(e)) Game.asAutopilot(() => run(e));
  }

  // A nation a player just lost: keep trying to win it back for a while.
  function lost(id, c) {
    const G = Game.state, e = G.empires[id];
    if (!active(e) || !e.auto.retake) return;
    e.retake = (e.retake || []).filter(r => r.c !== c);
    e.retake.push({ c, until: G.time + R.retakeWindow, next: G.time + 3, tried: false });
  }

  function run(e) {
    const owned = Game.cache.owned[e.id];
    if (!owned || !owned.length) return;
    const threats = assess(e, owned);
    if (e.auto.budget > 0 || caretaking(e)) recruit(e, threats);
    if (e.auto.reinforce) reinforce(e, owned, threats);
    retake(e);
    // Smart troops. Not in Boot Camp, where the player is learning to give these orders.
    if (!Game.state.settings.tutorial) {
      if (e.auto.retreat) pullOut(e);
      if (e.auto.expand || e.auto.attack) advance(e, owned, threats);
      if (e.auto.front) gather(e, owned, threats);
      tally(e);
    }
    report(e);
  }

  // How much more defense each nation needs: against armies on the way and battles under way,
  // and (once the ceasefire is over) part of the strongest enemy force next door.
  function assess(e, owned) {
    const G = Game.state, W = Game.world;
    const graceOver = G.time >= WD.MODES[G.settings.mode].grace;
    const coming = new Map();
    for (const a of G.armies) {
      const dest = a.path[a.path.length - 1];
      if (a.retreat || a.owner === e.id || G.owner[dest] !== e.id || Game.relation(e.id, a.owner) !== "war") continue;
      coming.set(dest, (coming.get(dest) || 0) + Game.attackOf(a.units, a.owner, a.vet));
    }
    const list = [];
    for (const c of owned) {
      let danger = coming.get(c) || 0;
      for (const s of G.sieges[c]) danger += Game.attackOf(s.units, s.owner, s.vet);
      let next = 0;
      if (graceOver) {
        for (const n of W.countries[c].edges.keys()) {
          const o = G.owner[n];
          if (o >= 0 && o !== e.id && Game.relation(e.id, o) === "war") next = Math.max(next, Game.attackOf(G.units[n], o, G.vet[n]));
        }
      }
      const need = Math.max(danger * 1.2, next * 0.6) - Game.defenseOf(c);
      if (need > 1) list.push({ c, need, urgent: danger > 0 });
    }
    return list.sort((a, b) => (b.urgent - a.urgent) || b.need - a.need);
  }

  // Defense budget: infantry gives the most defense for the money, so that's what it buys.
  // In caretaker mode it may also spend most of the savings.
  function recruit(e, threats) {
    const cost = Game.unitCost(e.id, "inf");
    const per = WD.UNITS.inf.def * (1 + (Game.mods(e.id).defense || 0));
    const caretaker = caretaking(e);
    let savings = caretaker ? e.money * 0.6 : 0;
    for (const t of threats.slice(0, caretaker ? 8 : 4)) {
      const cash = Math.min(e.money, e.autoFund + savings);
      if (cash < cost) break;
      if (Game.cache.rad.has(t.c)) continue;
      const n = Math.min(caretaker ? 80 : 40, Math.ceil(t.need / per), Math.floor(cash / cost));
      if (n < 1 || !Game.buy(e.id, t.c, "inf", n).ok) continue;
      const spent = cost * n, fromFund = Math.min(e.autoFund, spent);
      e.autoFund -= fromFund;
      savings -= spent - fromFund;
      e.autoStats.spent += spent;
      e.autoStats.recruited += n;
      t.need -= n * per;
      note(e, caretaker && spent > fromFund ? "caretaker" : "recruited", t.c, n);
    }
  }

  // An empire at war with the player owns this nation.
  const enemyLand = (e, n) => { const o = Game.state.owner[n]; return o >= 0 && o !== e.id && Game.relation(e.id, o) === "war"; };

  // Idle troops in nations with no enemy next door march to a threatened border within a minute's reach.
  function reinforce(e, owned, threats) {
    const G = Game.state, W = Game.world;
    const targets = new Set(threats.filter(t => t.need > 1).map(t => t.c));
    if (!targets.size) return;
    const threatened = new Set(threats.map(t => t.c));
    let moves = 0;
    for (const c of owned) {
      if (moves >= 3) break;
      if (threatened.has(c) || G.time - (e.touched?.[c] ?? -1e9) < R.touchSecs) continue;
      if (U.count(G.units[c], MOVERS) < 4 || [...W.countries[c].edges.keys()].some(n => enemyLand(e, n))) continue;
      const path = Game.findPathTo(c, e.id, false, u => targets.has(u));
      if (!path) continue;
      const dest = path[path.length - 1];
      const plan = Game.preview(e.id, c, dest, 0.85, MOVERS);
      if (!plan || !plan.path || plan.eta > 60) continue;
      const res = Game.sendArmy(e.id, c, dest, 0.85, MOVERS);
      if (!res.ok) continue;
      moves++;
      const n = U.count(res.army.units, MOVERS);
      e.autoStats.moved += n;
      note(e, "moved", dest, n);
    }
  }

  // Strike back at a nation the player just lost, once its neighbors can win it with room to spare.
  function retake(e) {
    const G = Game.state, W = Game.world;
    const keep = [];
    for (const r of e.retake || []) {
      if (G.owner[r.c] === e.id) {
        if (r.tried) { e.autoStats.retaken++; note(e, "retook", r.c, 1); }
        continue;
      }
      if (!e.auto.retake || G.time > r.until || !Game.isHostile(e.id, r.c)) continue;
      keep.push(r);
      if (G.time < r.next) continue;
      r.next = G.time + 8;
      const busy = G.armies.some(a => a.owner === e.id && a.path[a.path.length - 1] === r.c) || G.sieges[r.c].some(s => s.owner === e.id);
      if (busy) continue;
      const need = Game.defenseOf(r.c) * 1.3 + 2;
      const sources = [...W.countries[r.c].edges.keys()]
        .filter(n => G.owner[n] === e.id && !G.sieges[n].length && G.time - (e.touched?.[n] ?? -1e9) >= R.touchSecs)
        .map(n => ({ n, power: Game.attackOf(G.units[n], e.id, G.vet[n]) * 0.75 }))
        .filter(s => s.power > 1)
        .sort((a, b) => b.power - a.power);
      let total = 0;
      const use = [];
      for (const s of sources) { use.push(s); total += s.power; if (total >= need) break; }
      if (total < need) continue;
      for (const s of use) {
        const res = Game.sendArmy(e.id, s.n, r.c, 0.75);
        if (!res.ok) continue;
        r.tried = true;
        e.autoStats.moved += U.count(res.army.units, WD.ARMY_TYPES);
      }
      if (r.tried) note(e, "striking", r.c, 1);
    }
    e.retake = keep;
  }

  // ---------- smart troops ----------
  // Nations the player gave orders in lately are left alone.
  const recent = (e, c) => Game.state.time - (e.touched?.[c] ?? -1e9) < R.touchSecs;
  // A share of a garrison's marching troops, as an army bundle.
  const share = (u, k) => ({ inf: u.inf * k, tank: u.tank * k, art: u.art * k, ship: 0 });

  // The strongest army of an empire at war with e next to nation c.
  function enemyNear(e, c) {
    const G = Game.state;
    let most = 0;
    for (const n of Game.world.countries[c].edges.keys()) {
      const o = G.owner[n];
      if (o >= 0 && o !== e.id && Game.relation(e.id, o) === "war") most = Math.max(most, Game.attackOf(G.units[n], o, G.vet[n]));
    }
    return most;
  }

  // Gather at the front: idle troops in the inland heartland march to the nearest border with an
  // enemy empire, where they're needed. (Not to quiet borders with independent nations: feeding
  // those drains the heartland.) Only nations surrounded by the player's own and allied land send
  // troops: one next to an empire at peace isn't safe, since peace can end. The capital keeps its
  // garrison, and troops only march to a border nation they can hold against the strongest enemy
  // army next door: in a losing war they hold the heartland instead.
  function gather(e, owned, threats) {
    const G = Game.state, W = Game.world;
    const threatened = new Set(threats.map(t => t.c)), need = new Map(threats.map(t => [t.c, t.need]));
    const front = new Set(owned.filter(c => [...W.countries[c].edges.keys()].some(n => G.owner[n] >= 0 && Game.isHostile(e.id, n))));
    if (!front.size) return;
    const inland = c => [...W.countries[c].edges.keys()].every(n => Game.isFriendly(e.id, n));
    // Overland only: shipping troops across the sea is slow and leaves the mainland thin.
    const overland = path => path.every((u, i) => i === 0 || !W.countries[path[i - 1]].edges.get(u).sea);
    let moves = 0;
    for (const c of owned) {
      if (moves >= 3) break;
      if (c === e.capital || !inland(c) || threatened.has(c) || recent(e, c) || G.sieges[c].length || U.count(G.units[c], MOVERS) < 6) continue;
      const bring = U.defense(share(G.units[c], 0.85));
      const holdable = u => enemyNear(e, u) <= Game.defenseOf(u) + bring && (need.get(u) || 0) <= bring;
      const path = Game.findPathTo(c, e.id, false, u => front.has(u) && holdable(u));
      if (!path || !overland(path)) continue;
      const dest = path[path.length - 1];
      const plan = Game.preview(e.id, c, dest, 0.85, MOVERS);
      if (!plan || !plan.path || !overland(plan.path) || plan.eta > 90) continue;
      const res = Game.sendArmy(e.id, c, dest, 0.85, MOVERS);
      if (!res.ok) continue;
      moves++;
      const n = U.count(res.army.units, MOVERS);
      e.autoStats.moved += n;
      note(e, "front", dest, n);
    }
  }

  // Take weak neighbors: a border army attacks the nation next door that's worth the most for its
  // defenses, but only with two and a half times the strength it needs, overland, in plain sight
  // (not through the fog), and one attack at a time. Independent nations with "expand", and only
  // from nations with no enemy empire next door, so the real front stays manned. Empires at war
  // with "attack", once the opening ceasefire is over. It sends just enough for a clear win, keeps
  // a quarter at home, and never leaves a nation too weak for the enemy armies next door.
  function advance(e, owned, threats) {
    const G = Game.state, W = Game.world;
    if (G.time < (e.autoNextAttack || 0)) return;
    const graceOver = G.time >= WD.MODES[G.settings.mode].grace;
    const seen = Game.vision(e.id);
    const threatened = new Set(threats.map(t => t.c));
    const busy = new Set(G.armies.filter(a => a.owner === e.id).map(a => a.path[a.path.length - 1]));
    // Nations someone else is attacking or marching on are left to them: joining in could start a
    // fight with the empire that takes it.
    const contested = new Set(G.armies.filter(a => a.owner !== e.id).map(a => a.path[a.path.length - 1]));
    for (const c of owned) {
      if (threatened.has(c) || recent(e, c) || G.sieges[c].length || U.count(G.units[c], MOVERS) < 5) continue;
      const enemy = enemyNear(e, c);
      const most = Game.attackOf(share(G.units[c], 0.75), e.id, G.vet[c]);
      let best = -1, bestScore = 0;
      for (const [n, edge] of W.countries[c].edges) {
        if (edge.sea || !seen[n] || busy.has(n) || contested.has(n) || G.sieges[n].length || !Game.isHostile(e.id, n)) continue;
        if (G.owner[n] < 0 ? !e.auto.expand || enemy > 0 : !e.auto.attack || !graceOver) continue;
        // ...nor a nation an enemy army next to it could take straight back.
        const D = Game.defenseOf(n);
        if (most < D * 2.5 + 2 || enemyNear(e, n) > most) continue;
        const score = (W.countries[n].value + 0.5) / (D + 5);
        if (score > bestScore) { bestScore = score; best = n; }
      }
      if (best < 0) continue;
      const frac = Math.min(0.75, Math.max(0.3, 0.75 * (Game.defenseOf(best) * 2.6 + 2) / most));
      // What stays behind (troops that don't march, plus the rest) must still match the strongest
      // enemy force next door.
      const u = G.units[c], all = U.defense(u);
      const left = Game.defenseOf(c) * (all > 0 ? 1 - U.defense(share(u, frac)) / all : 0);
      if (left < enemy) continue;
      const res = Game.sendArmy(e.id, c, best, frac, MOVERS);
      if (!res.ok) continue;
      e.autoNextAttack = G.time + 8;
      e.autoStats.moved += U.count(res.army.units, MOVERS);
      (e.autoHits ||= []).push({ c: best, until: G.time + 120 });
      note(e, "attack", best, 1);
      return;
    }
  }

  // Count the nations those attacks won.
  function tally(e) {
    const G = Game.state;
    if (!e.autoHits?.length) return;
    e.autoHits = e.autoHits.filter(h => {
      if (G.owner[h.c] === e.id) { e.autoStats.taken = (e.autoStats.taken || 0) + 1; note(e, "took", h.c, 1); return false; }
      return G.time < h.until;
    });
  }

  // Pull out of lost battles: an attack facing more than two and a half times its strength comes
  // home before it's wiped out. Attacks the player ordered in the last 45 seconds are left alone.
  function pullOut(e) {
    const G = Game.state;
    G.sieges.forEach((list, c) => {
      const s = list.find(x => x.owner === e.id);
      if (!s || recent(e, c)) return;
      const A = list.reduce((sum, x) => sum + Game.attackOf(x.units, x.owner, x.vet), 0);
      if (Game.defenseOf(c) < A * 2.5 + 3) return;
      const n = U.count(s.units, WD.ARMY_TYPES);
      if (Game.withdraw(e.id, c).ok) note(e, "retreat", c, n);
    });
  }

  // A short summary in the player's log now and then, instead of a line for every order.
  function note(e, kind, c, n) {
    const notes = (e.autoNote ||= {});
    const k = (notes[kind] ||= { n: 0, places: [] });
    k.n += n;
    if (!k.places.includes(c)) k.places.push(c);
  }

  function report(e) {
    const G = Game.state, W = Game.world;
    if (!e.autoNote || G.time < (e.autoReportAt || 0)) return;
    const r = e.autoNote, parts = [];
    const where = list => list.slice(0, 2).map(c => W.countries[c].name).join(" and ") + (list.length > 2 ? ` and ${list.length - 2} more` : "");
    if (r.retook) parts.push(`won back ${where(r.retook.places)}`);
    if (r.took) parts.push(`took ${where(r.took.places)}`);
    if (r.striking) parts.push(`struck back at ${where(r.striking.places)}`);
    if (r.attack) parts.push(`attacked ${where(r.attack.places)}`);
    if (r.retreat) parts.push(`pulled ${Math.round(r.retreat.n)} troops out of a lost battle in ${where(r.retreat.places)}`);
    if (r.caretaker) parts.push(`spent savings on ${Math.round(r.caretaker.n)} defenders in ${where(r.caretaker.places)} while you were away`);
    if (r.recruited) parts.push(`raised ${Math.round(r.recruited.n)} defenders in ${where(r.recruited.places)}`);
    if (r.moved) parts.push(`sent ${Math.round(r.moved.n)} troops to ${where(r.moved.places)}`);
    if (r.front) parts.push(`moved ${Math.round(r.front.n)} troops up to the front at ${where(r.front.places)}`);
    e.autoNote = null;
    e.autoReportAt = G.time + REPORT_EVERY;
    const first = (r.retook || r.took || r.striking || r.attack || r.retreat || r.caretaker || r.recruited || r.moved || r.front).places[0];
    Game.tell(e.id, `🛡 Autopilot ${parts.join(", ")}.`, r.retook || r.took ? "good" : "info", first);
  }

  return { tick, lost };
})();
