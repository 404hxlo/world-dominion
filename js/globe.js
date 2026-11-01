// The spinning 3D globe behind the main menu and lobby. Drag to turn it, click a country to pick it.
// Drawn on a canvas from a simplified copy of the map so it stays smooth.
window.WD = window.WD || {};

WD.Globe = (() => {
  const MENU_W = 422;
  let canvas, ctx, world, features = [], bounds = [], radii = [], proj, path;
  const sphere = { type: "Sphere" }, grat = d3.geoGraticule10();
  let hooks = { colorOf: () => "#2a3646", chosen: () => -1, labels: () => [], onPick() {}, onHover() {} };
  let running = false, raf = 0, last = 0, lastDraw = 0, w = 0, h = 0, dpr = 1, cx = 0, cy = 0, r = 0;
  let rot = [-15, -22, 0], anim = null, drag = null, idleUntil = 0, hover = -1, lastPick = 0;
  const SPIN = 5;   // degrees per second

  function init(worldData, options) {
    world = worldData;
    Object.assign(hooks, options);
    canvas = document.getElementById("globe");
    ctx = canvas.getContext("2d");
    features = world.simplify(0.12).features;   // about 15% of the full detail
    bounds = features.map(f => d3.geoBounds(f));
    radii = world.countries.map((c, i) => {
      const [[x0, y0], [x1, y1]] = bounds[i];
      return Math.max(...[[x0, y0], [x0, y1], [x1, y0], [x1, y1]].map(p => d3.geoDistance(c.anchor, p)));
    });
    proj = d3.geoOrthographic().clipAngle(90).precision(0.7);
    path = d3.geoPath(proj, ctx);

    canvas.addEventListener("pointerdown", ev => {
      drag = { x: ev.clientX, y: ev.clientY, rot: rot.slice(), moved: false };
      anim = null;
      canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener("pointermove", ev => {
      if (drag) {
        const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        const k = 70 / r;
        rot = [drag.rot[0] + dx * k, Math.max(-75, Math.min(75, drag.rot[1] - dy * k)), 0];
        idleUntil = performance.now() + 4000;
        return;
      }
      const now = performance.now();
      if (now - lastPick < 40) return;
      lastPick = now;
      hover = pick(ev);
      canvas.style.cursor = hover >= 0 ? "pointer" : "grab";
      hooks.onHover(hover, ev);
    });
    canvas.addEventListener("pointerup", ev => {
      if (drag && !drag.moved) {
        const c = pick(ev);
        if (c >= 0) hooks.onPick(c);
      }
      drag = null;
      idleUntil = performance.now() + 5000;
    });
    canvas.addEventListener("pointerleave", () => { hover = -1; hooks.onHover(-1); });
    addEventListener("resize", () => { if (running) resize(); });
  }

  function resize() {
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    w = innerWidth;
    h = innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const side = w >= 760 ? MENU_W : 0;
    cx = side + (w - side) / 2;
    cy = h / 2 + 10;
    r = side ? Math.min((w - side) * 0.4, h * 0.38) : Math.min(w, h) * 0.46;
    proj.translate([cx, cy]).scale(r);
  }

  // Which country is under the pointer, if any.
  function pick(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return -1;
    const p = proj.invert([x, y]);
    if (!p) return -1;
    let best = -1, bestArea = Infinity;
    for (let i = 0; i < features.length; i++) {
      const [[x0, y0], [x1, y1]] = bounds[i];
      if (p[1] < y0 - 0.5 || p[1] > y1 + 0.5) continue;
      const inLon = x0 <= x1 ? p[0] >= x0 - 0.5 && p[0] <= x1 + 0.5 : p[0] >= x0 - 0.5 || p[0] <= x1 + 0.5;
      if (!inLon || !d3.geoContains(features[i], p)) continue;
      if (world.countries[i].areaKm < bestArea) { bestArea = world.countries[i].areaKm; best = i; }
    }
    return best;
  }

  // Turn the globe so a country faces the viewer.
  function focus(c) {
    if (c < 0 || !world) return;
    const [lon, lat] = world.countries[c].anchor;
    let target = -lon;
    while (target - rot[0] > 180) target -= 360;
    while (target - rot[0] < -180) target += 360;
    anim = { from: rot.slice(), to: [target, Math.max(-60, Math.min(60, -lat)), 0], t0: performance.now(), dur: 1100 };
    idleUntil = performance.now() + 7000;
  }

  function draw() {
    const c = ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    proj.rotate(rot);

    const halo = c.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.32);
    halo.addColorStop(0, "rgba(70, 170, 255, 0.32)");
    halo.addColorStop(0.35, "rgba(57, 208, 224, 0.08)");
    halo.addColorStop(1, "rgba(57, 208, 224, 0)");
    c.fillStyle = halo;
    c.beginPath();
    c.arc(cx, cy, r * 1.32, 0, Math.PI * 2);
    c.fill();

    const ocean = c.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r);
    ocean.addColorStop(0, "#173a5e");
    ocean.addColorStop(1, "#050d19");
    c.fillStyle = ocean;
    c.beginPath();
    path(sphere);
    c.fill();

    c.strokeStyle = "rgba(57, 208, 224, 0.13)";
    c.lineWidth = 0.6;
    c.beginPath();
    path(grat);
    c.stroke();

    const center = [-rot[0], -rot[1]];
    const chosen = hooks.chosen();
    // Countries that share a color are filled together: a handful of canvas calls instead of 233.
    const groups = new Map();
    for (let i = 0; i < features.length; i++) {
      if (i === chosen || d3.geoDistance(center, world.countries[i].anchor) - radii[i] > Math.PI / 2) continue;
      const color = hooks.colorOf(i) || "#2a3646";
      let list = groups.get(color);
      if (!list) groups.set(color, list = []);
      list.push(i);
    }
    c.lineWidth = 0.5;
    c.strokeStyle = "rgba(0, 0, 0, 0.55)";
    for (const [color, list] of groups) {
      c.beginPath();
      for (const i of list) path(features[i]);
      c.fillStyle = color;
      c.fill();
      c.stroke();
    }

    // Radar sweep across the globe.
    if (c.createConicGradient) {
      const sweep = c.createConicGradient(performance.now() / 1100, cx, cy);
      sweep.addColorStop(0, "rgba(63, 212, 230, 0)");
      sweep.addColorStop(0.9, "rgba(63, 212, 230, 0)");
      sweep.addColorStop(1, "rgba(63, 212, 230, 0.2)");
      c.fillStyle = sweep;
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fill();
    }
    if (hover >= 0 && hover !== chosen) {
      c.beginPath();
      path(features[hover]);
      c.fillStyle = "rgba(255, 255, 255, 0.14)";
      c.fill();
      c.strokeStyle = "rgba(255, 255, 255, 0.8)";
      c.lineWidth = 1;
      c.stroke();
    }
    if (chosen >= 0) {
      c.save();
      c.shadowColor = "rgba(106, 168, 255, 0.95)";
      c.shadowBlur = 18 + Math.sin(performance.now() / 300) * 6;
      c.beginPath();
      path(features[chosen]);
      c.fillStyle = hooks.colorOf(chosen) || "#3d8bfd";
      c.fill();
      c.lineWidth = 1.6;
      c.strokeStyle = "#ffffff";
      c.stroke();
      c.restore();
    }

    // Light from the upper left, shadow toward the edge.
    const shade = c.createRadialGradient(cx - r * 0.45, cy - r * 0.5, r * 0.1, cx, cy, r * 1.02);
    shade.addColorStop(0, "rgba(255, 255, 255, 0.10)");
    shade.addColorStop(0.55, "rgba(0, 0, 0, 0)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0.55)");
    c.fillStyle = shade;
    c.beginPath();
    path(sphere);
    c.fill();
    c.strokeStyle = "rgba(120, 210, 255, 0.55)";
    c.lineWidth = 1.2;
    c.beginPath();
    path(sphere);
    c.stroke();

    // Name tags for picked nations that face the viewer.
    c.font = "700 12px Oxanium, Inter, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (const tag of hooks.labels()) {
      const a = world.countries[tag.country].anchor;
      if (d3.geoDistance(center, a) > 1.45) continue;
      const [x, y] = proj(a);
      const tw = c.measureText(tag.text).width + 14;
      c.fillStyle = "rgba(6, 11, 19, 0.85)";
      c.strokeStyle = tag.color;
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(x - tw / 2, y - 26, tw, 18, 4);
      c.fill();
      c.stroke();
      c.beginPath();
      c.moveTo(x, y - 8);
      c.lineTo(x, y - 2);
      c.stroke();
      c.fillStyle = "#e6ecf5";
      c.fillText(tag.text, x, y - 17);
    }
  }

  function frame(t) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    // About 30 fps while it just spins; full speed while dragged or turning to a country.
    if (!drag && !anim && hover < 0 && t - lastDraw < 30) return;
    lastDraw = t;
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    if (anim) {
      const k = Math.min(1, (t - anim.t0) / anim.dur), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      rot = anim.from.map((v, i) => v + (anim.to[i] - v) * e);
      if (k >= 1) anim = null;
    } else if (!drag && t > idleUntil) rot[0] += SPIN * dt;
    draw();
  }

  function show() {
    if (!canvas) return;
    canvas.hidden = false;
    if (running) return;
    running = true;
    resize();
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function hide() {
    running = false;
    cancelAnimationFrame(raf);
    if (canvas) canvas.hidden = true;
  }

  return { init, show, hide, focus };
})();
