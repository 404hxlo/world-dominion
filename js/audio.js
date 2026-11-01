// Sound effects and war-room ambience, all synthesized with the Web Audio API (no sound files).
// Browsers only allow audio after the player clicks or presses a key, so unlock() runs on the first input.
window.WD = window.WD || {};

WD.Sound = (() => {
  const KEY = "worldDominion.audio";
  const settings = { volume: 0.7, muted: false, ambience: true };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* storage blocked */ }

  let ctx = null, master = null, sfx = null, amb = null, noiseBuf = null, ambNodes = null, pingTimer = 0;
  const last = {};
  // Minimum gap between two plays of the same sound, so busy wars don't turn into noise.
  const GAP = {
    boom: 140, bigBoom: 300, capture: 250, lost: 400, alert: 1500, march: 120, buy: 60, jet: 400, missile: 250, notify: 400, chat: 300, error: 250, click: 40, select: 60,
    siren: 3000, nuke: 1500, news: 8000, medal: 600, cash: 300, radio: 500, research: 300, rankup: 1000, event: 800, alarm: 1500,
  };

  function save() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage blocked */ } }

  function unlock() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.connect(comp);
    sfx = ctx.createGain();
    sfx.connect(master);
    amb = ctx.createGain();
    amb.gain.value = 0;
    amb.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    applyVolume();
    if (settings.ambience) startAmbience();
  }

  function applyVolume() {
    if (!master) return;
    master.gain.setTargetAtTime(settings.muted ? 0 : settings.volume, ctx.currentTime, 0.05);
  }

  // ---------- building blocks ----------
  function tone({ type = "sine", freq = 440, to = null, dur = 0.15, vol = 0.2, attack = 0.005, delay = 0, bus = sfx }) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noise({ dur = 0.3, vol = 0.3, type = "lowpass", freq = 1000, to = null, q = 1, delay = 0, attack = 0.005 }) {
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    src.loop = true;
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  const notes = (list, opts) => list.forEach((freq, i) => tone({ ...opts, freq, delay: (opts.delay || 0) + i * (opts.step || 0.08) }));

  const SOUNDS = {
    click: () => tone({ type: "triangle", freq: 1400, to: 900, dur: 0.045, vol: 0.06 }),
    select: () => tone({ type: "sine", freq: 620, to: 930, dur: 0.09, vol: 0.09 }),
    buy: () => { tone({ type: "square", freq: 1320, dur: 0.05, vol: 0.035 }); tone({ type: "square", freq: 1975, dur: 0.08, vol: 0.035, delay: 0.05 }); },
    march: () => {
      tone({ type: "sine", freq: 110, to: 55, dur: 0.22, vol: 0.35 });
      noise({ dur: 0.16, vol: 0.18, freq: 500, to: 120 });
      tone({ type: "sine", freq: 110, to: 55, dur: 0.18, vol: 0.22, delay: 0.16 });
    },
    capture: () => {
      notes([523.25, 659.25, 783.99, 1046.5], { type: "triangle", dur: 0.32, vol: 0.12, step: 0.07 });
      notes([1046.5, 1318.5], { type: "sine", dur: 0.5, vol: 0.05, step: 0.06, delay: 0.25 });
    },
    lost: () => notes([392, 311.1, 246.9], { type: "sawtooth", dur: 0.38, vol: 0.06, step: 0.14 }),
    boom: () => {
      noise({ dur: 0.9, vol: 0.5, freq: 1400, to: 60, attack: 0.002 });
      tone({ type: "sine", freq: 70, to: 30, dur: 0.6, vol: 0.4 });
    },
    bigBoom: () => {
      noise({ dur: 1.8, vol: 0.7, freq: 2200, to: 40, attack: 0.002 });
      tone({ type: "sine", freq: 55, to: 22, dur: 1.4, vol: 0.55 });
      noise({ dur: 1.2, vol: 0.25, type: "bandpass", freq: 300, to: 80, q: 0.7, delay: 0.15 });
    },
    missile: () => noise({ dur: 0.9, vol: 0.28, type: "bandpass", freq: 300, to: 2600, q: 1.2, attack: 0.05 }),
    jet: () => noise({ dur: 1.3, vol: 0.18, type: "bandpass", freq: 1600, to: 450, q: 0.8, attack: 0.25 }),
    alert: () => {
      for (let i = 0; i < 2; i++) {
        tone({ type: "square", freq: 880, dur: 0.12, vol: 0.05, delay: i * 0.3 });
        tone({ type: "square", freq: 660, dur: 0.12, vol: 0.05, delay: i * 0.3 + 0.14 });
      }
    },
    notify: () => notes([987.8, 1318.5], { type: "sine", dur: 0.25, vol: 0.09, step: 0.1 }),
    chat: () => tone({ type: "sine", freq: 1250, to: 1500, dur: 0.12, vol: 0.06 }),
    error: () => tone({ type: "square", freq: 180, dur: 0.14, vol: 0.05 }),
    victory: () => {
      notes([523.25, 659.25, 783.99, 1046.5, 1318.5], { type: "triangle", dur: 0.45, vol: 0.13, step: 0.13 });
      notes([523.25, 659.25, 783.99], { type: "sawtooth", dur: 1.6, vol: 0.035, step: 0, delay: 0.7 });
      notes([1046.5, 1568], { type: "sine", dur: 1.4, vol: 0.06, step: 0.02, delay: 0.72 });
    },
    defeat: () => {
      notes([392, 349.2, 311.1, 233.1], { type: "sawtooth", dur: 0.7, vol: 0.06, step: 0.32 });
      tone({ type: "sine", freq: 58, dur: 2.2, vol: 0.25, delay: 1 });
    },
    ceasefire: () => notes([440, 440, 349.2], { type: "square", dur: 0.18, vol: 0.05, step: 0.2 }),
    // An air-raid siren: one long rise and fall.
    siren: () => {
      const t = ctx.currentTime, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(280, t);
      o.frequency.linearRampToValueAtTime(880, t + 1.2);
      o.frequency.linearRampToValueAtTime(300, t + 2.6);
      f.type = "lowpass";
      f.frequency.value = 1700;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.7);
      o.connect(f);
      f.connect(g);
      g.connect(sfx);
      o.start(t);
      o.stop(t + 2.8);
    },
    nuke: () => {
      noise({ dur: 4.2, vol: 0.9, freq: 3200, to: 28, attack: 0.002 });
      tone({ type: "sine", freq: 46, to: 17, dur: 3.6, vol: 0.75 });
      noise({ dur: 3.2, vol: 0.35, type: "bandpass", freq: 220, to: 45, q: 0.6, delay: 0.4 });
    },
    news: () => notes([880, 1174.7, 1568], { type: "triangle", dur: 0.18, vol: 0.045, step: 0.07 }),
    medal: () => {
      notes([784, 987.8, 1174.7, 1568], { type: "triangle", dur: 0.4, vol: 0.1, step: 0.09 });
      tone({ type: "sine", freq: 2093, dur: 0.9, vol: 0.04, delay: 0.36 });
    },
    cash: () => {
      tone({ type: "square", freq: 1568, dur: 0.06, vol: 0.04 });
      tone({ type: "square", freq: 2093, dur: 0.2, vol: 0.04, delay: 0.07 });
      noise({ dur: 0.25, vol: 0.06, type: "highpass", freq: 5000, delay: 0.02 });
    },
    radio: () => {
      noise({ dur: 0.12, vol: 0.08, type: "bandpass", freq: 2200, q: 2 });
      tone({ type: "square", freq: 1200, dur: 0.05, vol: 0.03, delay: 0.12 });
      tone({ type: "square", freq: 1600, dur: 0.05, vol: 0.03, delay: 0.19 });
    },
    research: () => notes([659.25, 987.8, 1318.5], { type: "sine", dur: 0.35, vol: 0.09, step: 0.06 }),
    rankup: () => {
      notes([523.25, 659.25, 783.99, 1046.5], { type: "square", dur: 0.22, vol: 0.05, step: 0.12 });
      notes([1046.5, 1318.5, 1568], { type: "triangle", dur: 1.3, vol: 0.06, step: 0, delay: 0.5 });
    },
    event: () => notes([440, 554.4], { type: "triangle", dur: 0.25, vol: 0.06, step: 0.12 }),
    alarm: () => { for (let i = 0; i < 3; i++) tone({ type: "sawtooth", freq: 520, to: 380, dur: 0.22, vol: 0.05, delay: i * 0.26 }); },
  };

  function play(name) {
    if (!ctx || settings.muted || !SOUNDS[name]) return;
    if (ctx.state === "suspended") ctx.resume();
    const now = performance.now();
    if (now - (last[name] || 0) < (GAP[name] || 80)) return;
    last[name] = now;
    SOUNDS[name]();
  }

  // ---------- ambience: a low command-room hum with an occasional radar ping ----------
  function startAmbience() {
    if (!ctx || ambNodes) return;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 220;
    filter.connect(amb);
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    const oscs = [55, 55.3, 82.4].map((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = i === 2 ? "triangle" : "sawtooth";
      o.frequency.value = f;
      g.gain.value = i === 2 ? 0.25 : 0.4;
      o.connect(g);
      g.connect(filter);
      o.start();
      return o;
    });
    lfo.start();
    ambNodes = { oscs, lfo, filter };
    amb.gain.setTargetAtTime(0.09, ctx.currentTime, 2);
    const ping = () => {
      if (!ambNodes) return;
      if (!settings.muted) tone({ type: "sine", freq: 1480, to: 1460, dur: 1.6, vol: 0.05, attack: 0.002, bus: amb });
      pingTimer = setTimeout(ping, 7000 + Math.random() * 6000);
    };
    pingTimer = setTimeout(ping, 3000);
  }

  function stopAmbience() {
    if (!ambNodes) return;
    clearTimeout(pingTimer);
    const nodes = ambNodes;
    ambNodes = null;
    amb.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    setTimeout(() => { nodes.oscs.forEach(o => o.stop()); nodes.lfo.stop(); }, 1500);
  }

  function set(changes) {
    Object.assign(settings, changes);
    save();
    applyVolume();
    if (ctx) settings.ambience ? startAmbience() : stopAmbience();
  }

  return { unlock, play, set, get settings() { return { ...settings }; } };
})();
