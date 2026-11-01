// The war replay: a timelapse of the map, every empire's share of the world charted underneath,
// and the big moments captioned as they happen.
window.WD = window.WD || {};

WD.Replay = (() => {
  const LENGTH_MS = 24000;   // the whole war plays in this long at 1×
  const SPEEDS = [1, 2, 4];
  let raf = 0;

  // war = { world, history: { start, caps, shares, marks }, empires: [{ name, color }], end, me }
  function mount(box, { world, history, empires, end, me }) {
    stop();
    end = Math.max(1, end);
    box.innerHTML = `
      <div class="rp-stage"><canvas></canvas><div class="rp-clock"></div><div class="rp-caption"></div></div>
      <svg class="rp-chart" aria-label="Share of the world over time"></svg>
      <div class="rp-controls">
        <button class="rp-play primary" title="Play or pause">❚❚</button>
        <input class="rp-scrub" type="range" min="0" max="1000" value="0" aria-label="Replay position">
        <button class="rp-speed ghost" title="Playback speed">1×</button>
      </div>
      <div class="rp-legend"></div>`;
    const $ = sel => box.querySelector(sel);
    const W = Math.max(320, $(".rp-stage").clientWidth || 600), H = Math.round(W * 0.5);
    const dpr = Math.min(2, devicePixelRatio || 1);
    const canvas = $("canvas");
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    // ---- the map ----
    const projection = d3.geoNaturalEarth1().fitExtent([[4, 4], [W - 4, H - 4]], { type: "Sphere" });
    const geo = d3.geoPath(projection);
    const shapes = world.simplify(0.12).features.map(f => new Path2D(geo(f) || ""));
    const sphere = new Path2D(geo({ type: "Sphere" }));
    const outlines = new Path2D();
    shapes.forEach(s => outlines.addPath(s));
    const caps = history.caps;
    let owner = history.start.slice(), ci = 0, t = 0;

    // Returns true when time went backwards (the map must be repainted from scratch).
    function seek(to) {
      const back = to < t;
      if (back) { owner = history.start.slice(); ci = 0; }
      while (ci < caps.length && caps[ci][0] <= to) { owner[caps[ci][1]] = caps[ci][2]; ci++; }
      t = to;
      return back;
    }

    // Only countries that changed hands since the last frame are repainted; going back in time
    // repaints everything.
    let painted = [];
    function draw(full) {
      ctx.lineWidth = 0.35;
      ctx.strokeStyle = "rgba(4, 9, 17, 0.85)";
      if (full) {
        painted = [];
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = "#071528";
        ctx.fill(sphere);
      }
      const changed = [];
      owner.forEach((o, c) => {
        const color = o >= 0 ? empires[o]?.color || "#888" : "#25303f";
        if (painted[c] === color) return;
        painted[c] = color;
        ctx.fillStyle = color;
        ctx.fill(shapes[c]);
        changed.push(c);
      });
      if (full) ctx.stroke(outlines);
      else for (const c of changed) ctx.stroke(shapes[c]);
    }

    // ---- the chart: empires that ever held 2% of the world, the rest grouped ----
    const CH = 110;
    const svg = d3.select($(".rp-chart")).attr("viewBox", `0 0 ${W} ${CH}`).attr("width", W).attr("height", CH);
    const rows = history.shares;
    const peak = empires.map((_, i) => d3.max(rows, r => r[1][i] || 0) || 0);
    const keys = empires.map((_, i) => i).filter(i => peak[i] >= 20);
    const data = rows.map(([time, s]) => {
      const d = { time, other: 0 };
      empires.forEach((_, i) => { if (keys.includes(i)) d[i] = (s[i] || 0) / 10; else d.other += (s[i] || 0) / 10; });
      return d;
    });
    const x = d3.scaleLinear([0, end], [0, W]), y = d3.scaleLinear([0, 100], [CH - 4, 2]);
    if (data.length > 1) {
      const series = d3.stack().keys([...keys, "other"])(data);
      const area = d3.area().x(d => x(d.data.time)).y0(d => y(d[0])).y1(d => y(d[1])).curve(d3.curveMonotoneX);
      svg.selectAll("path.rp-layer").data(series).join("path")
        .attr("class", s => "rp-layer" + (s.key === me ? " me" : ""))
        .attr("fill", s => (s.key === "other" ? "#3a4658" : empires[s.key].color))
        .attr("d", area);
    }
    const marks = history.marks.slice().sort((a, b) => a[0] - b[0]);
    svg.selectAll("circle.rp-mark").data(marks).join("circle").attr("class", "rp-mark")
      .attr("cx", m => x(m[0])).attr("cy", CH - 3).attr("r", 2.5)
      .append("title").text(m => `${m[1]} ${m[2]}`);
    const cursor = svg.append("line").attr("class", "rp-cursor").attr("y1", 0).attr("y2", CH);

    // ---- legend ----
    const final = rows.length ? rows[rows.length - 1][1] : [];
    $(".rp-legend").innerHTML = keys.slice().sort((a, b) => (final[b] || 0) - (final[a] || 0)).map(i => {
      const label = String(empires[i].name).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
      const color = /^#[0-9a-f]{3,8}$/i.test(empires[i].color) ? empires[i].color : "#888";
      return `<span class="rp-chip${i === me ? " me" : ""}"><i style="background:${color}"></i>${label}${i === me ? " (you)" : ""} · ${((final[i] || 0) / 10).toFixed(1)}%</span>`;
    }).join("");

    // ---- playback ----
    const playBtn = $(".rp-play"), scrub = $(".rp-scrub"), speedBtn = $(".rp-speed"), clock = $(".rp-clock"), caption = $(".rp-caption");
    let playing = true, speed = 0, last = performance.now(), mi = 0, captionTimer = 0;
    const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

    function setTime(v, quiet) {
      const back = seek(v);
      if (back) mi = marks.findIndex(m => m[0] > v);
      if (mi < 0) mi = marks.length;
      let shown = null;
      while (mi < marks.length && marks[mi][0] <= v) shown = marks[mi++];
      if (shown && !quiet) {
        caption.textContent = `${shown[1]} ${shown[2]}`;
        caption.classList.remove("in");
        void caption.offsetWidth;
        caption.classList.add("in");
        clearTimeout(captionTimer);
        captionTimer = setTimeout(() => caption.classList.remove("in"), 2400);
      }
      draw(back || !painted.length);
      cursor.attr("x1", x(v)).attr("x2", x(v));
      clock.textContent = fmt(v);
      scrub.value = Math.round(v / end * 1000);
    }

    function frame(now) {
      if (!box.isConnected) { stop(); return; }
      const dt = Math.min(500, now - last);
      last = now;
      if (playing) {
        let next = t + dt / LENGTH_MS * end * SPEEDS[speed];
        if (next >= end) { next = end; playing = false; playBtn.textContent = "↻"; }
        setTime(next);
      }
      raf = requestAnimationFrame(frame);
    }

    playBtn.addEventListener("click", () => {
      if (!playing && t >= end) setTime(0, true);
      playing = !playing;
      playBtn.textContent = playing ? "❚❚" : "▶";
    });
    scrub.addEventListener("input", () => {
      playing = false;
      playBtn.textContent = "▶";
      setTime(+scrub.value / 1000 * end, true);
    });
    speedBtn.addEventListener("click", () => {
      speed = (speed + 1) % SPEEDS.length;
      speedBtn.textContent = SPEEDS[speed] + "×";
    });
    setTime(0, true);
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  return { mount, stop };
})();
