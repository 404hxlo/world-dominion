// The battle map, drawn as five stacked SVGs for speed, each on its own graphics layer:
//  #map      the heavy world (countries, coastline), redrawn only when a country changes color,
//  #fog      the fog of war, redrawn at most about once a second,
//  #marks    empire borders, radiation and the selection, redrawn about once a second,
//  #hover    the outline under the mouse, so hovering never redraws anything else, and
//  #overlay  everything that moves (badges, armies, routes, effects), redrawn every frame.
// While you pan or zoom, the first four are moved as pictures by the graphics card and redrawn
// sharp once the gesture settles. Zoomed out, they use a lighter copy of the geometry.
window.WD = window.WD || {};

WD.Map = (() => {
  const Game = WD.Game, U = Game.U;
  const NEUTRAL = ["#19222f", "#2d3a4c"];
  const PLANE = "M11 0 L4 -1.6 L-1 -1.6 L-5 -9 L-7.6 -9 L-4.2 -1.6 L-8.2 -1.6 L-10.2 -4.6 L-11.8 -4.6 L-10.8 0 L-11.8 4.6 L-10.2 4.6 L-8.2 1.6 L-4.2 1.6 L-7.6 9 L-5 9 L-1 1.6 L4 1.6 Z";
  const STAR = "M0,-7.5 L2.2,-2.4 L7.6,-2.3 L3.4,1.1 L4.7,6.4 L0,3.4 L-4.7,6.4 L-3.4,1.1 L-7.6,-2.3 L-2.2,-2.4 Z";
  const DETAIL_K = 2.4;          // zoom level where full-detail borders take over
  const LIGHT_SHARE = 0.25;      // share of the geometry kept for zoomed-out views
  const BORDER_EVERY = 1000;     // ms between empire-border redraws
  const FOG_EVERY = 900;         // ms between fog redraws

  let world = null, hooks = null;
  let svgMap, svgFog, svgMarks, svgHover, svgTop, gWorld, gCountries, gLanes, coastEl;
  let gFogWorld, fogEls = [], fogShown = [], gMarksWorld, gBorders, radEl, reachEl, selectGlowEl, selectEl, gHoverWorld, hoverEl;
  let gTopWorld, gFlash, gRoutes, gFx, gDots, gPins, gCaps, gBadges, gArmies, gMissions, gEffects;
  let zoom, projection, geoPath, light = null;
  // A phone shows the whole world a few hundred pixels wide, a desktop well over a thousand. Zoom
  // levels asked for by the game are scaled up by this much on small screens, so countries look
  // about as big as on a desktop.
  let zoomScale = 1;
  let countryEls = [], dotEls = [], badgeEls = [], anchorPx = [], areaPx = [], markEls = [];
  const shapes = { light: [], full: [] }, coastShape = { light: "", full: "" };
  let detail = "light";
  const armyEls = new Map(), missionEls = new Map(), borderEls = new Map(), routeEls = new Map(), pinEls = new Map(), edgeEls = new Map(), bountyEls = new Map();
  let live = d3.zoomIdentity, drawn = d3.zoomIdentity;
  let dirty = new Set(), allDirty = true, lastBorders = 0, lastFog = 0, marksKey = "", radKey = "";
  let previewEl = null, previewPin = null, previewKey = "", beaconEl = null, beaconCountry = -1;
  let hoverC = -1, selectC = -1, reachOn = false;
  const fillCache = new Map();

  function init(w, h) {
    world = w;
    hooks = h;
    light = world.simplify(LIGHT_SHARE);
    build();
  }

  const shapeOf = c => shapes[detail][c];
  const stretched = () => [svgMap, svgFog, svgMarks, svgHover];
  // Fog of war: what the player can see right now (null when everything is visible).
  const seen = c => { const v = hooks.vision(); return !v || !!v[c]; };
  const armySeen = a => { const v = hooks.vision(); return !v || !!v[a.path[a.leg]] || !!v[a.path[Math.min(a.leg + 1, a.path.length - 1)]]; };

  // ---------- building ----------
  function build() {
    const w = innerWidth, h = innerHeight;
    svgMap = d3.select("#map");
    svgFog = d3.select("#fog");
    svgMarks = d3.select("#marks");
    svgHover = d3.select("#hover");
    svgTop = d3.select("#overlay");
    for (const s of [...stretched(), svgTop]) s.selectAll("*").remove();
    for (const s of stretched()) s.node().style.transform = "";
    armyEls.clear(); missionEls.clear(); borderEls.clear(); routeEls.clear(); pinEls.clear(); bountyEls.clear();
    previewEl = previewPin = beaconEl = null;
    previewKey = marksKey = radKey = "";
    markEls = [];

    const fc = { type: "FeatureCollection", features: world.countries.map(c => c.feature) };
    projection = d3.geoNaturalEarth1().fitExtent([[12, 70], [w - 12, h - 40]], fc);
    geoPath = d3.geoPath(projection);
    shapes.full = world.countries.map(c => geoPath(c.feature));
    shapes.light = light.features.map(f => geoPath(f) || "");
    coastShape.full = geoPath(world.coast);
    coastShape.light = geoPath(light.coast);
    const [[x0], [x1]] = geoPath.bounds({ type: "Sphere" });
    zoomScale = Math.min(3.5, Math.max(1, 1400 / (x1 - x0)));
    live = drawn = d3.zoomIdentity;
    detail = "light";

    // --- layer 1: the heavy, mostly static world ---
    const ocean = svgMap.append("defs").append("radialGradient").attr("id", "wdOcean").attr("cx", "50%").attr("cy", "45%").attr("r", "70%");
    ocean.append("stop").attr("offset", "0%").attr("stop-color", "#0c2240");
    ocean.append("stop").attr("offset", "100%").attr("stop-color", "#040a14");
    gWorld = svgMap.append("g");
    gWorld.append("path").attr("class", "sphere").attr("d", geoPath({ type: "Sphere" }));
    gWorld.append("path").attr("class", "graticule").attr("d", geoPath(d3.geoGraticule10()));
    gCountries = gWorld.append("g");
    countryEls = world.countries.map(c => {
      const el = gCountries.append("path").attr("class", "country").attr("d", shapeOf(c.id)).node();
      el.__cid = c.id;
      return el;
    });
    coastEl = gWorld.append("path").attr("class", "coast-line").attr("d", coastShape[detail]).node();
    gLanes = gWorld.append("g").attr("class", "lanes");
    world.lanes.forEach(l => gLanes.append("path").attr("d", geoPath(l.line)));

    // --- layer 2: the fog of war, one shape per country so a change only repaints that country ---
    gFogWorld = svgFog.append("g").attr("class", "fog");
    fogEls = world.countries.map(c => {
      const el = gFogWorld.append("path").attr("d", shapeOf(c.id)).node();
      el.style.display = "none";
      return el;
    });
    fogShown = world.countries.map(() => false);

    // --- layer 3: empire borders, radiation and highlights ---
    gMarksWorld = svgMarks.append("g");
    gBorders = gMarksWorld.append("g");
    radEl = gMarksWorld.append("path").attr("class", "hl-rad").node();
    reachEl = gMarksWorld.append("path").attr("class", "hl-reach").node();
    selectGlowEl = gMarksWorld.append("path").attr("class", "hl-selected-glow").node();
    selectEl = gMarksWorld.append("path").attr("class", "hl-selected").node();
    gHoverWorld = svgHover.append("g");
    hoverEl = gHoverWorld.append("path").attr("class", "hl-hover").node();

    // --- layer 4: everything that moves ---
    gTopWorld = svgTop.append("g");
    gFlash = gTopWorld.append("g");
    gRoutes = gTopWorld.append("g");
    gFx = gTopWorld.append("g").attr("class", "fx");
    gDots = svgTop.append("g");
    gPins = svgTop.append("g");
    gBadges = svgTop.append("g");
    gCaps = svgTop.append("g");
    gArmies = svgTop.append("g");
    gMissions = svgTop.append("g");
    gEffects = svgTop.append("g");

    anchorPx = world.countries.map(c => projection(c.anchor));
    areaPx = world.countries.map(c => geoPath.area(c.feature));
    dotEls = [];
    world.countries.forEach(c => {
      if (areaPx[c.id] >= 30) return;
      const el = gDots.append("circle").attr("class", "dot").attr("r", 4).node();
      el.__cid = c.id;
      dotEls[c.id] = el;
    });
    badgeEls = world.countries.map(c => {
      const g = gBadges.append("g").attr("class", "badge").style("display", "none");
      g.append("rect").attr("class", "bg").attr("y", -8).attr("height", 16).attr("rx", 3);
      g.append("rect").attr("class", "stripe").attr("y", -8).attr("width", 3).attr("height", 16).attr("rx", 1.5);
      g.append("text");
      const bar = g.append("g").style("display", "none");
      bar.append("rect").attr("y", 10).attr("height", 3);
      bar.append("rect").attr("y", 10).attr("height", 3);
      g.append("circle").attr("class", "ring").attr("r", 9).style("display", "none");
      g.append("text").attr("class", "stars").attr("y", -13);
      const el = g.node();
      el.__dy = dotEls[c.id] ? -13 : 0;
      return el;
    });

    zoom = d3.zoom()
      .scaleExtent([1, 60 * zoomScale])
      .translateExtent([[-w * 0.2, -h * 0.2], [w * 1.2, h * 1.2]])
      .on("zoom", ev => { live = ev.transform; stretch(); })
      .on("end", commit);
    svgMap.call(zoom).on("dblclick.zoom", null);

    const cidOf = ev => ev.target.__cid;
    for (const s of [svgMap, svgTop]) {
      s.on("click", ev => { const c = tapped(ev); if (c !== undefined) hooks.onLeft(c); else hooks.onEmpty(); });
      s.on("contextmenu", ev => {
        ev.preventDefault();
        const c = tapped(ev);
        if (c !== undefined) hooks.onRight(c); else hooks.onEmptyRight();
      });
      s.on("mousemove", ev => hooks.onHover(cidOf(ev) ?? -1, ev));
    }
    svgMap.on("mouseleave", () => hooks.onHover(-1));

    allDirty = true;
    hoverC = -1;
    setLanes(hooks.lanes());
    recolorAll();
    position(true);
    if (selectC >= 0) select(selectC, reachOn);
  }

  // A fingertip covers more than a small island or Luxembourg, so on a touchscreen a tap close to
  // a small nation's dot picks that nation, even if it landed on the sea or a big neighbor.
  function tapped(ev) {
    let c = ev.target.__cid;
    if (!hooks.touch()) return c;
    // A tap on the sea snaps to a dot up to 28px away; a tap on a country only to one close beside it.
    let best = c === undefined ? 28 : 16;
    dotEls.forEach((el, id) => {
      const d = Math.hypot(el.getAttribute("cx") - ev.clientX, el.getAttribute("cy") - ev.clientY);
      if (d < best) { best = d; c = id; }
    });
    return c;
  }

  // ---------- panning & zooming ----------
  // During a gesture the drawn layers are only stretched (cheap); the moving pieces are redrawn exactly.
  function stretch() {
    const a = live.k / drawn.k, tx = live.x - a * drawn.x, ty = live.y - a * drawn.y;
    if (a > 1.8 || a < 0.55 || Math.abs(tx) > innerWidth * 0.4 || Math.abs(ty) > innerHeight * 0.4) { commit(); return; }
    const css = `matrix(${a},0,0,${a},${tx.toFixed(1)},${ty.toFixed(1)})`;
    for (const s of stretched()) s.node().style.transform = css;
    gTopWorld.attr("transform", live);
    position(true);
  }

  // Redraw the drawn layers sharp at the current view (and switch detail level if needed).
  function commit() {
    drawn = live;
    for (const s of stretched()) s.node().style.transform = "";
    for (const g of [gWorld, gFogWorld, gMarksWorld, gHoverWorld, gTopWorld]) g.attr("transform", drawn);
    const want = drawn.k >= DETAIL_K * zoomScale ? "full" : "light";
    if (want !== detail) setDetail(want);
    position(true);
  }

  function setDetail(level) {
    detail = level;
    countryEls.forEach((el, c) => el.setAttribute("d", shapeOf(c)));
    fogEls.forEach((el, c) => el.setAttribute("d", shapeOf(c)));
    coastEl.setAttribute("d", coastShape[detail]);
    allDirty = true;
    lastBorders = 0;
    radKey = "";
    lastFog = 0;
    if (hoverC >= 0) hoverEl.setAttribute("d", shapeOf(hoverC));
    if (selectC >= 0) select(selectC, reachOn);
    if (Game.state && hooks.phase() === "game") { updateBorders(true); updateFog(true); updateRadiation(); }
  }

  const sx = c => live.applyX(anchorPx[c][0]);
  const sy = c => live.applyY(anchorPx[c][1]);
  function placeAt(el, c, dy = 0) {
    el.setAttribute("transform", `translate(${sx(c).toFixed(1)},${(sy(c) + dy).toFixed(1)})`);
  }
  const onScreen = c => { const x = sx(c), y = sy(c); return x > -40 && y > 20 && x < innerWidth + 40 && y < innerHeight + 40; };

  function position(all) {
    dotEls.forEach((el, c) => {
      el.setAttribute("cx", sx(c).toFixed(1));
      el.setAttribute("cy", sy(c).toFixed(1));
    });
    for (const el of pinEls.values()) placeAt(el, el.__c);
    for (const el of bountyEls.values()) placeAt(el, el.__c);
    for (const el of markEls) placeAt(el, el.__c, el.__dy);
    if (previewPin) placeAt(previewPin, previewPin.__c);
    if (beaconEl) placeAt(beaconEl, beaconCountry);
    updateBadges(all);
    if (Game.state && hooks.phase() === "game") frame();
  }

  function show() { for (const s of [...stretched(), svgTop]) s.attr("hidden", null); }
  function hide() { for (const s of [...stretched(), svgTop]) s.attr("hidden", true); }
  function setLanes(on) { if (gLanes) gLanes.classed("off", !on); }

  // ---------- colors ----------
  const neutralShade = c => d3.interpolateRgb(NEUTRAL[0], NEUTRAL[1])(Math.min(1, world.countries[c].value / 8));
  function territory(color) {
    let f = fillCache.get(color);
    if (!f) { f = d3.interpolateRgb(color, "#08101c")(0.32); fillCache.set(color, f); }
    return f;
  }
  function colorOf(c) {
    const G = Game.state;
    const o = G ? G.owner[c] : -1;
    return o < 0 ? neutralShade(c) : territory(G.empires[o].color);
  }
  function recolor(c) {
    const col = colorOf(c);
    if (countryEls[c].__fill === col) return;
    countryEls[c].__fill = col;
    countryEls[c].style.fill = col;
    if (dotEls[c]) dotEls[c].style.fill = col;
  }
  const recolorAll = () => world.countries.forEach(c => recolor(c.id));

  // ---------- empire borders: one glowing outline per empire ----------
  function markBorders(...ids) { ids.forEach(id => { if (id >= 0) dirty.add(id); }); }

  function updateBorders(force) {
    if (!force && performance.now() - lastBorders < BORDER_EVERY) return;
    if (!allDirty && !dirty.size) return;
    lastBorders = performance.now();
    const G = Game.state;
    const topo = detail === "full" ? world.topo : light.topo;
    const ids = allDirty ? G.empires.map(e => e.id) : [...dirty];
    if (allDirty) { gBorders.selectAll("*").remove(); borderEls.clear(); }
    allDirty = false;
    dirty.clear();
    const me = hooks.me();
    for (const e of ids) {
      const geoms = [];
      G.owner.forEach((o, c) => { if (o === e) geoms.push(world.geoms[c]); });
      let el = borderEls.get(e);
      if (!geoms.length) {
        if (el) { el.glow.remove(); el.line.remove(); borderEls.delete(e); }
        continue;
      }
      if (!el) {
        el = { glow: gBorders.append("path").attr("class", "border-glow").node(), line: gBorders.append("path").attr("class", "border-line").node() };
        borderEls.set(e, el);
      }
      const d = geoPath(topojson.merge(topo, geoms)) || "";
      const color = G.empires[e].color;
      el.glow.setAttribute("d", d);
      el.glow.style.stroke = color;
      el.line.setAttribute("d", d);
      el.line.style.stroke = color;
      el.line.classList.toggle("mine", e === me);
    }
  }

  // ---------- fog of war ----------
  function updateFog(force) {
    if (!force && performance.now() - lastFog < FOG_EVERY) return;
    lastFog = performance.now();
    const v = hooks.vision();
    for (let c = 0; c < fogEls.length; c++) {
      const fogged = !!v && !v[c];
      if (fogged === fogShown[c]) continue;
      fogShown[c] = fogged;
      fogEls[c].style.display = fogged ? "" : "none";
    }
  }

  // ---------- radiation, capitals and contract targets ----------
  function updateRadiation() {
    const list = [...Game.cache.rad].sort((a, b) => a - b);
    const key = list.join(",");
    if (key === radKey) return;
    radKey = key;
    radEl.setAttribute("d", list.map(shapeOf).join(""));
  }

  // Stars over every capital (gold for yours) and ☢ over radioactive nations.
  function updateMarks() {
    const G = Game.state, me = hooks.me();
    const caps = G.empires.filter(e => e.alive && e.capital >= 0);
    const key = caps.map(e => `${e.id}:${e.capital}:${e.color}`).join("|") + "#" + [...Game.cache.rad].join(",");
    if (key === marksKey) return;
    marksKey = key;
    gCaps.selectAll("*").remove();
    markEls = [];
    for (const e of caps) {
      const g = gCaps.append("g").attr("class", "capital" + (e.id === me ? " mine" : ""));
      g.append("path").attr("d", STAR).style("fill", e.id === me ? null : e.color);
      const el = g.node();
      el.__c = e.capital;
      el.__dy = (dotEls[e.capital] ? -13 : 0) - 17;
      markEls.push(el);
    }
    for (const c of Game.cache.rad) {
      const g = gCaps.append("g").attr("class", "rad-mark");
      g.append("text").text("☢");
      const el = g.node();
      el.__c = c;
      el.__dy = 16;
      markEls.push(el);
    }
    for (const el of markEls) placeAt(el, el.__c, el.__dy);
  }

  function setBounties(list) {
    const want = new Set(list);
    for (const [c, el] of bountyEls) if (!want.has(c)) { el.remove(); bountyEls.delete(c); }
    for (const c of want) {
      if (bountyEls.has(c)) continue;
      const g = gPins.append("g").attr("class", "reticle bounty");
      g.append("circle").attr("r", 13);
      g.append("path").attr("d", "M-19,0H-10M10,0H19M0,-19V-10M0,10V19");
      const el = g.node();
      el.__c = c;
      placeAt(el, c);
      bountyEls.set(c, el);
    }
  }

  // ---------- troop badges ----------
  function updateBadges(all) {
    const G = hooks.phase() === "game" ? Game.state : null;
    const k2 = live.k * live.k, sel = hooks.selected(), hov = hooks.hover(), me = hooks.me();
    const v = G ? hooks.vision() : null;
    for (const c of world.countries) {
      const el = badgeEls[c.id];
      const visible = !v || !!v[c.id];
      const siege = !!G && visible && G.sieges[c.id].length > 0;
      const show = !!G && (areaPx[c.id] * k2 > 220 || c.id === sel || c.id === hov || siege);
      if (!show) { if (el.style.display !== "none") el.style.display = "none"; continue; }
      if (el.style.display === "none") { el.style.display = ""; placeAt(el, c.id, el.__dy); }
      else if (all) placeAt(el, c.id, el.__dy);
      const o = G.owner[c.id];
      const def = Math.round(U.count(G.units[c.id], WD.COMBAT_TYPES));
      let text = visible ? String(def) : "?", share = 0, attColor = "";
      if (siege) {
        let att = 0, A = 0;
        for (const s of G.sieges[c.id]) { att += U.count(s.units, WD.ARMY_TYPES); A += Game.attackOf(s.units, s.owner, s.vet); }
        const D = Game.defenseOf(c.id);
        text = `${def} ⚔ ${Math.round(att)}`;
        share = D / (D + A + 0.01);
        attColor = G.empires[G.sieges[c.id][0].owner].color;
      }
      const stars = visible ? Math.floor((G.vet[c.id] || 0) + 0.01) : 0;
      const color = o < 0 ? "#6b7a90" : G.empires[o].color;
      const key = `${text}|${color}|${Math.round(share * 40)}|${attColor}|${o === me}|${stars}`;
      if (el.__key === key) continue;
      el.__key = key;
      const [bg, stripe, label, bar, ring, starsEl] = el.childNodes;
      label.textContent = text;
      starsEl.textContent = "★".repeat(stars);
      const wpx = 13 + text.length * 6.9;
      bg.setAttribute("x", -wpx / 2);
      bg.setAttribute("width", wpx);
      stripe.setAttribute("x", -wpx / 2);
      stripe.style.fill = color;
      label.setAttribute("x", 1.5);
      el.classList.toggle("siege", siege);
      el.classList.toggle("mine", o === me);
      el.classList.toggle("unknown", !visible);
      bar.style.display = siege ? "" : "none";
      ring.style.display = siege ? "" : "none";
      if (siege) {
        const [defBar, attBar] = bar.childNodes;
        const dw = Math.max(1, wpx * share);
        defBar.setAttribute("x", -wpx / 2);
        defBar.setAttribute("width", dw);
        defBar.style.fill = color;
        attBar.setAttribute("x", -wpx / 2 + dw);
        attBar.setAttribute("width", Math.max(1, wpx - dw));
        attBar.style.fill = attColor;
      }
    }
  }

  // ---------- armies & missions (every frame) ----------
  function edgePoint(edge, t) {
    let d = Math.min(1, Math.max(0, t)) * edge.km;
    const n = edge.segKm.length;
    for (let i = 0; i < n; i++) {
      if (d <= edge.segKm[i] || i === n - 1) {
        const f = edge.segKm[i] > 0 ? Math.min(1, d / edge.segKm[i]) : 1;
        return d3.geoInterpolate(edge.waypoints[i], edge.waypoints[i + 1])(f);
      }
      d -= edge.segKm[i];
    }
  }

  function frame() {
    const G = Game.state;
    if (!G) return;
    drawArmies(G);
    drawMissions(G);
  }

  function drawArmies(G) {
    const me = hooks.me();
    const shown = new Set();
    for (const a of G.armies) {
      if (!armySeen(a)) continue;
      shown.add(a.id);
      let el = armyEls.get(a.id);
      if (!el) {
        const dest = a.path[a.path.length - 1];
        const kind = a.owner === me ? " mine" : G.owner[dest] === me ? " threat" : "";
        const g = gArmies.append("g").attr("class", "army" + kind);
        g.append("path").attr("class", "chev").attr("d", "M-8,-7 L9,0 L-8,7 L-4,0 Z").attr("fill", G.empires[a.owner].color);
        const tag = g.append("g").attr("class", "tag").attr("transform", "translate(0,14)");
        tag.append("rect").attr("y", -6).attr("height", 12).attr("rx", 3);
        tag.append("text");
        el = g.node();
        armyEls.set(a.id, el);
      }
      const edge = world.countries[a.path[a.leg]].edges.get(a.path[a.leg + 1]);
      const tt = Math.min(1, a.t);
      const pa = projection(edgePoint(edge, tt)), pb = projection(edgePoint(edge, Math.min(1, tt + 0.02)));
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
      if (tt < 0.98 && dx * dx + dy * dy > 1e-6 && Math.abs(dx) < 400) el.__ang = Math.atan2(dy, dx) * 180 / Math.PI;
      el.setAttribute("transform", `translate(${live.applyX(pa[0]).toFixed(1)},${live.applyY(pa[1]).toFixed(1)})`);
      const ang = (el.__ang || 0).toFixed(0);
      if (el.__shown !== ang) { el.__shown = ang; el.firstChild.setAttribute("transform", `rotate(${ang})`); }
      const label = "★".repeat(Math.floor((a.vet || 0) + 0.01)) + (a.units.ship > 0.01 ? "⚓" : "") + Math.max(1, Math.round(U.count(a.units, WD.ARMY_TYPES)));
      if (el.__n !== label) {
        el.__n = label;
        const [rect, text] = el.lastChild.childNodes;
        text.textContent = label;
        const wpx = 9 + label.length * 6.4;
        rect.setAttribute("x", -wpx / 2);
        rect.setAttribute("width", wpx);
      }
      if (el.__r !== !!a.retreat) { el.__r = !!a.retreat; el.classList.toggle("retreat", el.__r); }
    }
    for (const [id, el] of armyEls) if (!shown.has(id)) { el.remove(); armyEls.delete(id); }
  }

  function drawMissions(G) {
    const shown = new Set();
    for (const m of G.missions) {
      if (m.kind !== "nuke" && !seen(m.to) && !seen(m.from)) continue;
      shown.add(m.id);
      let el = missionEls.get(m.id);
      if (!el) {
        const g = gMissions.append("g").attr("class", "mission " + m.kind);
        g.append("line").attr("class", "trail");
        if (m.kind === "missile" || m.kind === "nuke") g.append("circle").attr("class", "warhead").attr("r", m.kind === "nuke" ? 5 : 3);
        else g.append("path").attr("class", "plane").attr("d", PLANE).attr("fill", G.empires[m.owner].color);
        el = g.node();
        missionEls.set(m.id, el);
      }
      let f = Math.min(1, m.t / m.dur);
      if (m.back) f = 1 - f;
      const interp = d3.geoInterpolate(world.countries[m.from].anchor, world.countries[m.to].anchor);
      const tail = m.kind === "nuke" ? 0.12 : 0.07;
      const behind = Math.max(0, Math.min(1, m.back ? f + tail : f - tail));
      const p = projection(interp(f)), q = projection(interp(behind));
      const x = live.applyX(p[0]), y = live.applyY(p[1]);
      let dx = live.applyX(q[0]) - x, dy = live.applyY(q[1]) - y;
      if (Math.abs(dx) > 300) dx = dy = 0;
      el.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)})`);
      const [trail, body] = el.childNodes;
      trail.setAttribute("x2", dx.toFixed(1));
      trail.setAttribute("y2", dy.toFixed(1));
      if (m.kind !== "missile" && m.kind !== "nuke" && (dx || dy)) body.setAttribute("transform", `rotate(${(Math.atan2(-dy, -dx) * 180 / Math.PI).toFixed(0)})`);
    }
    for (const [id, el] of missionEls) if (!shown.has(id)) { el.remove(); missionEls.delete(id); }
  }

  // ---------- routes, target pins and previews ----------
  function routeLine(path, from = 0) {
    const coords = [];
    for (let i = from; i < path.length - 1; i++) {
      const e = world.countries[path[i]].edges.get(path[i + 1]);
      e.waypoints.forEach((p, j) => { if (j || !coords.length) coords.push(p); });
    }
    return { type: "LineString", coordinates: coords };
  }

  function pin(cls, c) {
    const g = gPins.append("g").attr("class", "reticle " + cls);
    g.append("circle").attr("r", 11);
    g.append("path").attr("d", "M-17,0H-8M8,0H17M0,-17V-8M0,8V17");
    const el = g.node();
    el.__c = c;
    placeAt(el, c);
    return el;
  }

  function updateRoutes() {
    const G = Game.state, me = hooks.me();
    const keep = new Set(), pins = new Map();
    for (const a of G.armies) {
      const dest = a.path[a.path.length - 1];
      const mine = a.owner === me, threat = !mine && G.owner[dest] === me && !a.retreat && armySeen(a);
      if (!mine && !threat) continue;
      keep.add(a.id);
      pins.set(dest + (mine ? "m" : "t"), { c: dest, kind: mine ? "mine" : "threat" });
      const key = `${a.leg}|${a.path.join(",")}|${mine}|${!!a.auto}`;
      let el = routeEls.get(a.id);
      if (el && el.__key === key) continue;
      if (!el) { el = gRoutes.append("path").node(); routeEls.set(a.id, el); }
      el.__key = key;
      // Autopilot moves get their own dotted style so you can tell them from your own orders.
      el.setAttribute("class", "route " + (mine ? (a.auto ? "mine auto" : "mine") : "threat"));
      el.style.stroke = mine && !a.auto ? G.empires[me].color : "";
      el.setAttribute("d", geoPath(routeLine(a.path, a.leg)) || "");
    }
    for (const [id, el] of routeEls) if (!keep.has(id)) { el.remove(); routeEls.delete(id); }
    for (const [k, el] of pinEls) if (!pins.has(k)) { el.remove(); pinEls.delete(k); }
    for (const [k, p] of pins) if (!pinEls.has(k)) pinEls.set(k, pin(p.kind, p.c));
  }

  // A dotted line showing where an order would send troops. kind: ok | risky | bad | move.
  function setPreview(path, kind = "move") {
    const key = path && path.length > 1 ? path.join(",") + "|" + kind : "";
    if (key === previewKey) return;
    previewKey = key;
    if (previewEl) { previewEl.remove(); previewEl = null; }
    if (previewPin) { previewPin.remove(); previewPin = null; }
    if (!key) return;
    previewEl = gFx.append("path").attr("class", "preview " + kind).attr("d", geoPath(routeLine(path))).node();
    previewPin = pin("preview " + kind, path[path.length - 1]);
  }

  function setRange(from, km, kind) {
    gFx.selectAll(".range").remove();
    if (from < 0 || !(km < Infinity)) return;
    gFx.insert("path", ":first-child").attr("class", "range " + kind)
      .attr("d", geoPath(d3.geoCircle().center(world.countries[from].anchor).radius(km / 111.2)()));
  }

  function drawBombards() {
    const G = Game.state, me = hooks.me();
    const visible = G.bombards.filter(b => b.owner === me || G.owner[b.to] === me);
    const sel = gFx.selectAll("path.bombard").data(visible, b => b.from + "-" + b.to);
    sel.exit().remove();
    sel.enter().append("path")
      .attr("class", b => "bombard" + (b.owner === me ? "" : " enemy"))
      .attr("d", b => geoPath({ type: "LineString", coordinates: [world.countries[b.from].anchor, world.countries[b.to].anchor] }));
  }

  // ---------- highlights (on their own layers, so the heavy map never repaints for them) ----------
  function select(c, reach) {
    selectC = c;
    reachOn = !!reach;
    const d = c >= 0 ? shapeOf(c) : "";
    selectEl.setAttribute("d", d);
    selectGlowEl.setAttribute("d", d);
    reachEl.setAttribute("d", c >= 0 && reach ? [...world.countries[c].edges.keys()].map(shapeOf).join("") : "");
    for (const el of gDots.node().querySelectorAll(".selected")) el.classList.remove("selected");
    if (c >= 0) dotEls[c]?.classList.add("selected");
  }

  function hover(c) {
    if (c === hoverC) return;
    hoverC = c;
    hoverEl.setAttribute("d", c >= 0 ? shapeOf(c) : "");
  }

  // ---------- effects ----------
  function fxAt(c, cls, life) {
    const g = gEffects.append("g").attr("class", cls);
    placeAt(g.node(), c);
    setTimeout(() => g.remove(), life);
    return g;
  }

  function flash(c) {
    if (!onScreen(c)) return;
    const el = gFlash.append("path").attr("class", "hl-flash").attr("d", shapeOf(c));
    setTimeout(() => el.remove(), 850);
  }

  function boom(c, big) {
    if (!onScreen(c) || !seen(c)) return false;
    const g = fxAt(c, "fx-boom" + (big ? " big" : ""), 1600);
    g.append("circle").attr("class", "flash").attr("r", big ? 16 : 10);
    g.append("circle").attr("class", "wave").attr("r", 3);
    g.append("circle").attr("class", "wave w2").attr("r", 3);
    if (hooks.effects()) {
      for (let i = 0; i < (big ? 12 : 7); i++) {
        const a = Math.random() * Math.PI * 2, d = (big ? 30 : 16) + Math.random() * 16;
        g.append("circle").attr("class", "debris").attr("r", 1.7)
          .style("--dx", `${(Math.cos(a) * d).toFixed(1)}px`).style("--dy", `${(Math.sin(a) * d).toFixed(1)}px`);
      }
    }
    return true;
  }

  // A blinding flash, shockwaves and a mushroom cloud. Returns whether it was on screen.
  function nuke(c) {
    if (!onScreen(c)) return false;
    const g = fxAt(c, "fx-nuke", 6000);
    g.append("circle").attr("class", "core").attr("r", 34);
    for (let i = 0; i < 3; i++) g.append("circle").attr("class", "shock s" + i).attr("r", 8);
    const cloud = g.append("g").attr("class", "cloud");
    cloud.append("rect").attr("class", "stem").attr("x", -6).attr("y", -44).attr("width", 12).attr("height", 44).attr("rx", 5);
    cloud.append("ellipse").attr("class", "ring").attr("cy", -28).attr("rx", 22).attr("ry", 5);
    cloud.append("ellipse").attr("class", "cap").attr("cy", -52).attr("rx", 32).attr("ry", 17);
    cloud.append("ellipse").attr("class", "cap2").attr("cy", -58).attr("rx", 20).attr("ry", 10);
    return true;
  }

  function intercept(c) {
    if (!onScreen(c) || !seen(c)) return;
    const g = fxAt(c, "fx-intercept", 1800);
    g.append("circle").attr("class", "burst").attr("cy", -30).attr("r", 4);
    g.append("text").attr("class", "float").attr("y", -42).text("INTERCEPTED");
  }

  // A world event at a country: a big icon and a short label floating up.
  function eventFx(c, icon, text, cls = "") {
    if (!onScreen(c) || !seen(c)) return;
    const g = fxAt(c, "fx-event " + cls, 2600);
    g.append("circle").attr("class", "wave").attr("r", 6);
    g.append("text").attr("class", "icon").attr("y", -14).text(icon);
    if (text) g.append("text").attr("class", "float").attr("y", -34).text(text);
  }

  // A ring in the new owner's color; your own wins and losses also flash and get a label.
  function capture(c, color, text, cls) {
    if (text) flash(c);
    if (!onScreen(c)) return;
    const g = fxAt(c, "fx-capture", 2000);
    g.append("circle").attr("class", "wave").attr("r", 5).style("stroke", color);
    g.append("circle").attr("class", "wave w2").attr("r", 5).style("stroke", color);
    if (text) g.append("text").attr("class", "float " + (cls || "")).attr("y", -16).text(text);
  }

  function sparks() {
    const G = Game.state;
    let n = 0;
    G.sieges.forEach((list, c) => {
      if (!list.length || n > 12 || !onScreen(c) || !seen(c)) return;
      n++;
      const g = fxAt(c, "fx-spark", 500);
      g.append("circle").attr("cx", (Math.random() * 16 - 8).toFixed(1)).attr("cy", (Math.random() * 12 - 6).toFixed(1)).attr("r", 1);
    });
  }

  // A pulsing marker that draws the eye to a country (the player's capital at the start).
  function beacon(c) {
    if (beaconEl) { beaconEl.remove(); beaconEl = null; }
    beaconCountry = c;
    if (c < 0) return;
    const g = gPins.append("g").attr("class", "beacon");
    g.append("circle").attr("r", 6);
    g.append("circle").attr("class", "b2").attr("r", 6);
    g.append("circle").attr("class", "core").attr("r", 3.5);
    beaconEl = g.node();
    placeAt(beaconEl, c);
  }

  // ---------- incoming attacks ----------
  function threats() {
    const G = Game.state, me = hooks.me();
    const list = [];
    for (const a of G.armies) {
      const dest = a.path[a.path.length - 1];
      if (a.owner === me || G.owner[dest] !== me || a.retreat || !armySeen(a)) continue;
      list.push({ id: a.id, owner: a.owner, dest, eta: Game.armyEta(a), size: U.count(a.units, WD.ARMY_TYPES) });
    }
    return list.sort((x, y) => x.eta - y.eta);
  }

  // Arrows at the screen edge pointing at threatened countries that are out of view.
  function updateEdges(list) {
    const box = document.getElementById("edgeAlerts");
    const { top, bottom } = hooks.insets();
    const w = innerWidth, h = innerHeight, pad = 30;
    const shown = new Set();
    for (const th of list) {
      if (shown.has(th.dest)) continue;
      const x = sx(th.dest), y = sy(th.dest);
      if (x > pad && x < w - pad && y > top + pad && y < h - bottom - pad) continue;
      shown.add(th.dest);
      let el = edgeEls.get(th.dest);
      if (!el) {
        el = document.createElement("div");
        el.className = "edge-arrow";
        el.innerHTML = `<span class="ea-arrow">➤</span><span class="ea-text"></span>`;
        const c = th.dest;
        el.addEventListener("click", () => hooks.onAlert(c));
        box.appendChild(el);
        edgeEls.set(th.dest, el);
      }
      const cx = w / 2, cy = (h + top) / 2, dx = x - cx, dy = y - cy;
      const kx = dx ? Math.abs(((dx > 0 ? w - pad - 40 : pad + 40) - cx) / dx) : Infinity;
      const ky = dy ? Math.abs(((dy > 0 ? h - bottom - pad : top + pad) - cy) / dy) : Infinity;
      const k = Math.min(kx, ky, 1);
      el.style.transform = `translate(${(cx + dx * k).toFixed(0)}px, ${(cy + dy * k).toFixed(0)}px)`;
      el.firstChild.style.transform = `rotate(${Math.atan2(dy, dx).toFixed(2)}rad)`;
      el.lastChild.textContent = `${world.countries[th.dest].name} · ${Math.max(0, Math.ceil(th.eta))}s`;
    }
    for (const [c, el] of edgeEls) if (!shown.has(c)) { el.remove(); edgeEls.delete(c); }
  }

  // ---------- refresh (several times a second) ----------
  function refresh() {
    if (!Game.state || hooks.phase() !== "game") return [];
    updateBorders(false);
    updateFog(false);
    updateRadiation();
    updateMarks();
    updateBadges(false);
    updateRoutes();
    drawBombards();
    if (hooks.effects()) sparks();
    const list = threats();
    updateEdges(list);
    return list;
  }

  // Forget everything drawn for the previous game.
  function reset() {
    for (const g of [gArmies, gMissions, gRoutes, gPins, gCaps, gEffects, gFx, gFlash, gBorders]) g.selectAll("*").remove();
    armyEls.clear(); missionEls.clear(); routeEls.clear(); pinEls.clear(); borderEls.clear(); bountyEls.clear();
    previewEl = previewPin = beaconEl = null;
    previewKey = marksKey = radKey = "";
    markEls = [];
    fogEls.forEach((el, c) => { el.style.display = "none"; fogShown[c] = false; });
    radEl.setAttribute("d", "");
    beaconCountry = -1;
    for (const el of edgeEls.values()) el.remove();
    edgeEls.clear();
    allDirty = true;
    lastBorders = lastFog = 0;
    select(-1);
    hover(-1);
    recolorAll();
  }

  // Center a spot in the part of the screen the map really shows (phones cover some of it with panels).
  function focusPx([x, y], k) {
    const { top, bottom } = Game.state && hooks.phase() === "game" ? hooks.insets() : { top: 0, bottom: 0 };
    const cy = (top + innerHeight - bottom) / 2;
    svgMap.transition().duration(700).call(zoom.transform, d3.zoomIdentity.translate(innerWidth / 2 - x * k, cy - y * k).scale(k));
  }
  // k is a desktop zoom level (see zoomScale). Without one the view zooms in to at least 3, or stays closer.
  const focus = (c, k) => focusPx(anchorPx[c], k ? k * zoomScale : Math.max(live.k, 3 * zoomScale));
  // Jump to a longitude/latitude (from the minimap).
  function focusAt(ll, k) {
    const p = projection(ll);
    if (p) focusPx(p, k ? k * zoomScale : Math.max(live.k, 2.5 * zoomScale));
  }

  // What's on screen in longitude/latitude: the center and an outline around the edges.
  function view() {
    const w = innerWidth, top = 62, bottom = innerHeight - 30;
    const toLL = (x, y) => {
      const p = live.invert([x, y]);
      const ll = projection.invert(p);
      if (!ll || !isFinite(ll[0]) || !isFinite(ll[1]) || Math.abs(ll[0]) > 180 || Math.abs(ll[1]) > 90) return null;
      const back = projection(ll);
      return back && Math.hypot(back[0] - p[0], back[1] - p[1]) < 1 ? ll : null;
    };
    const N = 8, ring = [];
    for (let i = 0; i <= N; i++) ring.push(toLL(w * i / N, top));
    for (let i = 1; i <= N; i++) ring.push(toLL(w, top + (bottom - top) * i / N));
    for (let i = N - 1; i >= 0; i--) ring.push(toLL(w * i / N, bottom));
    for (let i = N - 1; i >= 1; i--) ring.push(toLL(0, top + (bottom - top) * i / N));
    return { center: toLL(w / 2, (top + bottom) / 2), ring: ring.filter(Boolean) };
  }

  const ready = () => !!svgMap;

  return {
    init, build, show, hide, ready, setLanes, recolor, recolorAll, colorOf, markBorders, reset, select, hover, setPreview, setRange,
    focus, focusAt, view, frame, refresh, flash, boom, nuke, intercept, eventFx, capture, beacon, threats, onScreen, setBounties,
    get zoomK() { return live.k / zoomScale; },   // as a desktop zoom level (see zoomScale)
  };
})();
