// The round radar minimap: a small globe that turns to follow the battle map, with the area on
// screen outlined, your capital marked and incoming attacks blinking. Click it to jump there.
window.WD = window.WD || {};

WD.Minimap = (() => {
  const SIZE = 168;
  let world = null, hooks = null, el = null, ctx = null, projection = null, path = null, features = null;
  let rot = [0, -20], dpr = 1, shown = false;

  // hooks: view() -> { center, ring } in lon/lat, colorOf(c), threats() -> [country], capital(), onJump([lon, lat])
  function init(w, h) {
    world = w;
    hooks = h;
    el = document.getElementById("minimap");
    const canvas = el.querySelector("canvas");
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = canvas.height = Math.round(SIZE * dpr);
    canvas.style.width = canvas.style.height = SIZE + "px";
    ctx = canvas.getContext("2d");
    projection = d3.geoOrthographic().translate([SIZE / 2, SIZE / 2]).scale(SIZE / 2 - 2).clipAngle(90).precision(0.8);
    path = d3.geoPath(projection, ctx);
    features = world.simplify(0.08).features;
    canvas.addEventListener("click", ev => {
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (Math.hypot(x - SIZE / 2, y - SIZE / 2) > SIZE / 2 - 2) return;
      const ll = projection.invert([x, y]);
      if (ll) hooks.onJump(ll);
    });
  }

  function show() { shown = true; el.hidden = false; draw(); }
  function hide() { shown = false; el.hidden = true; }

  // The shortest way round from one longitude to another.
  const toward = (from, to) => from + ((((to - from) % 360) + 540) % 360 - 180);

  function draw() {
    if (!shown) return;
    const view = hooks.view();
    if (view.center) {
      // Ease toward the battle map's center rather than snapping to it.
      const lon = toward(rot[0], -view.center[0]), lat = Math.max(-55, Math.min(55, -view.center[1]));
      rot = [rot[0] + (lon - rot[0]) * 0.45, rot[1] + (lat - rot[1]) * 0.45];
    }
    projection.rotate(rot);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.beginPath();
    path({ type: "Sphere" });
    ctx.fillStyle = "#0b1f36";
    ctx.fill();
    // One fill per color, so a busy world is still only a handful of draws.
    const groups = new Map();
    features.forEach((f, c) => {
      const color = hooks.colorOf(c);
      let list = groups.get(color);
      if (!list) groups.set(color, list = []);
      list.push(f);
    });
    for (const [color, list] of groups) {
      ctx.beginPath();
      for (const f of list) path(f);
      ctx.fillStyle = color;
      ctx.fill();
    }
    // The part of the world on screen.
    if (view.ring.length > 2) {
      ctx.beginPath();
      path({ type: "LineString", coordinates: [...view.ring, view.ring[0]] });
      ctx.strokeStyle = "rgba(255, 233, 160, 0.95)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    const front = ll => d3.geoDistance(ll, [-rot[0], -rot[1]]) < Math.PI / 2 - 0.02;
    const cap = hooks.capital();
    if (cap >= 0 && front(world.countries[cap].anchor)) {
      const [x, y] = projection(world.countries[cap].anchor);
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd766";
      ctx.strokeStyle = "#3a2400";
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
    }
    // Incoming attacks blink.
    const pulse = 2.4 + 2.2 * Math.abs(Math.sin(performance.now() / 240));
    ctx.fillStyle = "#ff4b40";
    for (const c of hooks.threats()) {
      const ll = world.countries[c].anchor;
      if (!front(ll)) continue;
      const [x, y] = projection(ll);
      ctx.beginPath();
      ctx.arc(x, y, pulse, 0, Math.PI * 2);
      ctx.fill();
    }
    // Shade the rim so it reads as a ball.
    const shade = ctx.createRadialGradient(SIZE * 0.38, SIZE * 0.32, SIZE * 0.05, SIZE / 2, SIZE / 2, SIZE / 2);
    shade.addColorStop(0, "rgba(255, 255, 255, 0.1)");
    shade.addColorStop(0.65, "rgba(0, 0, 0, 0)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0.5)");
    ctx.beginPath();
    path({ type: "Sphere" });
    ctx.fillStyle = shade;
    ctx.fill();
  }

  return { init, show, hide, draw };
})();
