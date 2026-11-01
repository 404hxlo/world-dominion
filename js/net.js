// Online multiplayer over WebRTC using PeerJS (its free public server only introduces the players).
// The host's browser runs the whole simulation. Clients send orders to the host and mirror its
// state from compressed snapshots. Players who drop out can rejoin with the same name.
window.WD = window.WD || {};

WD.Net = (() => {
  const Game = WD.Game;
  const PREFIX = "world-dominion-";
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no 0/O or 1/I mix-ups
  const SNAPSHOT_MS = 250;
  const COMMANDS = ["sendArmy", "buy", "launchAir", "launchMissile", "toggleBombard", "propose", "answerProposal", "declareWar", "research", "buildNuke", "launchNuke", "answerOffer", "buyPack", "setAutopilot"];
  // Game events the host passes on: to the player they're meant for, or to everyone.
  const TARGETED = ["log", "medal", "bounty", "research", "banner"];
  const BROADCAST = ["news", "explosion", "nuke", "nukeLaunch", "intercept", "eventFx"];

  const listeners = {};
  const on = (type, fn) => (listeners[type] ||= []).push(fn);
  const emit = (type, data) => (listeners[type] || []).forEach(fn => fn(data));

  // Public state the UI reads.
  const N = {
    role: null,            // null (solo), "host" or "client"
    code: null,            // room code
    me: null,              // my lobby player id ("host" or my peer id)
    inGame: false,
    joined: false,
    speed: 1, paused: false,   // clients: the host's clock
    lobby: { players: [], settings: null },
    history: null,             // clients: the war replay, sent by the host when the war ends
  };

  let world = null;
  let clock = () => ({ speed: 1, paused: false });
  let peer = null, hostConn = null, snapTimer = 0, cmdId = 0;
  const clients = new Map();   // host only: peer id -> { conn, player }
  const pending = new Map();   // client only: command id -> { resolve, timer }
  let inbox = Promise.resolve(), outbox = Promise.resolve();

  const available = () => typeof window.Peer === "function";

  function init(w, clockFn) {
    world = w;
    clock = clockFn;
    // The host forwards each player's news, medals and contracts to the right clients, and the
    // world news and big effects to everyone.
    for (const type of TARGETED) {
      Game.on(type, ev => {
        if (N.role !== "host" || !N.inGame) return;
        for (const { conn, player } of clients.values()) {
          if (ev.for === player.seat || (ev.for === undefined && !(ev.skip || []).includes(player.seat))) send(conn, { t: "ev", type, ev });
        }
      });
    }
    for (const type of BROADCAST) {
      Game.on(type, ev => {
        if (N.role === "host" && N.inGame) for (const { conn } of clients.values()) send(conn, { t: "ev", type, ev });
      });
    }
    // The replay history is too big for every snapshot, so it travels once, when the war ends.
    Game.on("over", () => {
      if (N.role !== "host" || !N.inGame || !Game.state.history) return;
      const str = JSON.stringify(Game.state.history);
      outbox = outbox.then(async () => {
        const msg = { t: "history", z: await pack(str) };
        for (const { conn } of clients.values()) send(conn, msg);
      }).catch(err => console.error(err));
    });
  }

  // ---------- helpers ----------
  function send(conn, msg) {
    try { if (conn && conn.open) conn.send(msg); } catch { /* connection is closing */ }
  }

  function randomCode() {
    let s = "";
    for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }

  const cleanName = s => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 20) || "Commander";
  const cleanCode = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  // A player's career picks travel with them: only known titles and colors, and a rank in range.
  const cleanTitle = s => (WD.UNLOCK_TITLES.some(([, t]) => t === s) ? s : "Empire");
  const cleanRank = r => (Number.isInteger(r) && r >= 0 && r < WD.RANKS.length ? r : 0);
  const knownColor = c => WD.UNLOCK_COLORS.some(([, v]) => v === c);
  function pickColor(pref) {
    const used = new Set(N.lobby.players.map(p => p.color));
    return knownColor(pref) && !used.has(pref) ? pref : WD.HUMAN_COLORS.find(c => !used.has(c)) || WD.AI_COLORS.find(c => !used.has(c));
  }

  function friendly(err) {
    const type = err && err.type;
    if (type === "peer-unavailable") return new Error("No game found with that code. Check the code, and make sure the host is still waiting.");
    if (type === "browser-incompatible") return new Error("This browser can't play online. Try Chrome, Edge or Firefox.");
    if (type === "network" || type === "server-error" || type === "socket-error" || type === "socket-closed") {
      return new Error("Couldn't reach the matchmaking server. Check your internet connection.");
    }
    return new Error((err && err.message) || "Connection problem.");
  }

  // Snapshots are gzip-compressed when the browser supports it (about 6x smaller).
  const canZip = typeof CompressionStream === "function" && typeof DecompressionStream === "function";
  async function pack(str) {
    if (!canZip) return str;
    return new Response(new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  }
  async function unpack(z) {
    if (typeof z === "string") return z;
    return new Response(new Blob([z]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  }

  // ---------- hosting ----------
  function openPeer() {
    return new Promise((resolve, reject) => {
      const code = randomCode();
      const p = new Peer(PREFIX + code, { debug: 1 });
      let opened = false;
      p.on("open", () => { opened = true; resolve({ p, code }); });
      p.on("error", err => {
        if (opened) { emit("error", friendly(err)); return; }
        p.destroy();
        if (err.type === "unavailable-id") openPeer().then(resolve, reject);   // code already in use: roll again
        else reject(friendly(err));
      });
    });
  }

  // prefs: { color, title, rank } from the player's commander career.
  async function host(name, prefs = {}) {
    if (!available()) throw new Error("Online play couldn't load. Check your internet connection and reload the page.");
    leave();
    const { p, code } = await openPeer();
    peer = p;
    N.role = "host";
    N.code = code;
    N.me = "host";
    N.lobby = { players: [], settings: null };
    N.lobby.players.push({ id: "host", name: cleanName(name), country: -1, color: pickColor(prefs.color), title: cleanTitle(prefs.title), rank: cleanRank(prefs.rank) });
    peer.on("connection", conn => {
      conn.on("data", msg => onClientMessage(conn, msg));
      conn.on("close", () => dropClient(conn));
      conn.on("error", () => dropClient(conn));
    });
    peer.on("disconnected", () => { if (N.role === "host") try { peer.reconnect(); } catch { /* already gone */ } });
    emit("lobby");
    return code;
  }

  // Host a war loaded from a save: the host plays `seat`, other players rejoin by name.
  async function hostSaved(name, seat, prefs = {}) {
    await host(name, prefs);
    const e = Game.state.empires[seat];
    N.lobby.players = [{ id: "host", name: cleanName(name), country: e.start, color: e.color, seat, title: cleanTitle(prefs.title), rank: cleanRank(prefs.rank) }];
    N.inGame = true;
    startSnapshots();
    return N.code;
  }

  function onClientMessage(conn, msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "hello") { hello(conn, msg); return; }
    const c = clients.get(conn.peer);
    if (!c) return;
    if (msg.t === "pick") pick(c.player, msg.country);
    else if (msg.t === "cmd") runCommand(c, msg);
    else if (msg.t === "chat") chat(c.player, msg.text);
  }

  function reject(conn, reason) {
    send(conn, { t: "reject", reason });
    setTimeout(() => conn.close(), 800);
  }

  function hello(conn, msg) {
    if (clients.has(conn.peer)) return;
    if (msg.version !== WD.VERSION) {
      reject(conn, `Your game is version ${msg.version}, but the host has version ${WD.VERSION}. Reload the game page, or get the newest copy from the host.`);
      return;
    }
    const name = cleanName(msg.name);
    if (N.inGame) {
      // Only players returning to a war in progress can join it: they take back an empire the AI was minding.
      const G = Game.state;
      const seat = G.empires.find(e => e.human && e.away && e.playerName === name) || G.empires.find(e => e.human && e.away && e.alive);
      if (!seat) { reject(conn, "This war has already started and every player seat is taken."); return; }
      seat.playerName = name;
      Game.setAway(seat.id, false);
      const player = { id: conn.peer, name, country: seat.start, color: seat.color, seat: seat.id, title: cleanTitle(msg.title), rank: cleanRank(msg.rank) };
      clients.set(conn.peer, { conn, player });
      Game.announce(`👋 ${name} joined and took command of ${seat.name}.`, { cls: "good" });
      queueStart(conn, seat.id);
      emit("roster");
      return;
    }
    if (N.lobby.players.length >= WD.MAX_PLAYERS) { reject(conn, "This room is full."); return; }
    let unique = name;
    for (let n = 2; N.lobby.players.some(p => p.name === unique); n++) unique = `${name} ${n}`;
    const player = { id: conn.peer, name: unique, country: -1, color: pickColor(msg.color), title: cleanTitle(msg.title), rank: cleanRank(msg.rank) };
    N.lobby.players.push(player);
    clients.set(conn.peer, { conn, player });
    broadcastLobby();
  }

  function pick(player, country) {
    if (N.inGame || !Number.isInteger(country) || country < -1 || country >= world.countries.length) return;
    const taken = country >= 0 && N.lobby.players.some(p => p !== player && p.country === country);
    if (!taken) player.country = country;
    broadcastLobby();
  }

  function setSettings(settings) {
    if (N.role !== "host" || N.inGame) return;
    N.lobby.settings = { ...settings };
    broadcastLobby();
  }

  function broadcastLobby() {
    for (const { conn, player } of clients.values()) {
      send(conn, { t: "lobby", code: N.code, you: player.id, players: N.lobby.players, settings: N.lobby.settings });
    }
    emit("lobby");
  }

  function dropClient(conn) {
    const c = clients.get(conn.peer);
    if (!c) return;
    clients.delete(conn.peer);
    if (!N.inGame) {
      N.lobby.players = N.lobby.players.filter(p => p !== c.player);
      broadcastLobby();
      return;
    }
    const e = Game.state && Game.state.empires[c.player.seat];
    if (e && e.alive) {
      Game.setAway(e.id, true);
      Game.announce(`🔌 ${c.player.name} disconnected. The AI commands ${e.name} until they return.`, { cls: "bad" });
    }
    emit("roster");
  }

  // Called by the host's UI right after Game.newGame(): lobby order = empire seats.
  function beginGame() {
    N.inGame = true;
    N.lobby.players.forEach((p, i) => { p.seat = i; });
    for (const { conn, player } of clients.values()) queueStart(conn, player.seat);
    startSnapshots();
  }

  function queueStart(conn, seat) {
    const str = Game.serializeCompact();
    const ck = clock();
    outbox = outbox.then(async () => send(conn, { t: "start", you: seat, code: N.code, z: await pack(str), speed: ck.speed, paused: ck.paused }))
      .catch(err => console.error(err));
  }

  function startSnapshots() {
    clearInterval(snapTimer);
    snapTimer = setInterval(() => {
      if (N.role !== "host" || !N.inGame || !clients.size || !Game.state) return;
      const str = Game.serializeCompact();
      const ck = clock();
      outbox = outbox.then(async () => {
        const msg = { t: "snap", z: await pack(str), speed: ck.speed, paused: ck.paused };
        for (const { conn } of clients.values()) send(conn, msg);
      }).catch(err => console.error(err));
    }, SNAPSHOT_MS);
  }

  // Never trust what arrives over the network: check every argument before the game sees it.
  function validOrder(op, a) {
    const n = world.countries.length;
    const isCountry = v => Number.isInteger(v) && v >= 0 && v < n;
    const isEmpire = v => Number.isInteger(v) && v >= 0 && v < Game.state.empires.length;
    switch (op) {
      case "sendArmy":
        return isCountry(a[0]) && isCountry(a[1]) && typeof a[2] === "number" && a[2] > 0 && a[2] <= 1 &&
          Array.isArray(a[3]) && a[3].every(t => WD.ARMY_TYPES.includes(t));
      case "buy": return isCountry(a[0]) && WD.UNIT_TYPES.includes(a[1]) && Number.isInteger(a[2]) && a[2] >= 1 && a[2] <= 10;
      case "launchAir": case "launchMissile": case "toggleBombard": return isCountry(a[0]) && isCountry(a[1]);
      case "propose": return isEmpire(a[0]) && (a[1] === "peace" || a[1] === "alliance");
      case "answerProposal": case "answerOffer": return Number.isInteger(a[0]) && typeof a[1] === "boolean";
      case "declareWar": return isEmpire(a[0]);
      case "research": return WD.TECH_IDS.includes(a[0]);
      case "buildNuke": return a.length === 0;
      case "launchNuke": return isCountry(a[0]);
      case "buyPack": return typeof a[0] === "string" && Object.prototype.hasOwnProperty.call(WD.PACKS, a[0]);
      case "setAutopilot": {
        const cfg = a[0];
        return !!cfg && typeof cfg === "object" && typeof cfg.budget === "number" && cfg.budget >= 0 && cfg.budget <= 0.5 &&
          typeof cfg.reinforce === "boolean" && typeof cfg.retake === "boolean" && typeof cfg.caretaker === "boolean";
      }
    }
    return false;
  }

  function runCommand(c, msg) {
    const reply = r => send(c.conn, { t: "res", id: msg.id, r: { ok: !!r.ok, reason: r.reason, pending: r.pending, stopped: r.stopped, rebase: r.rebase, quote: r.quote, delivered: r.delivered, at: r.at } });
    const seat = c.player.seat;
    if (!N.inGame || seat == null || !COMMANDS.includes(msg.op) || !Array.isArray(msg.args) || !validOrder(msg.op, msg.args)) {
      reply({ ok: false, reason: "The host couldn't accept that order." });
      return;
    }
    try {
      Game.noteOrder(seat);
      reply(Game[msg.op](seat, ...msg.args));
    } catch (err) {
      console.error(err);
      reply({ ok: false, reason: "The host couldn't carry out that order." });
    }
  }

  function chat(player, text) {
    text = String(text || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200);
    if (!text) return;
    const color = player.seat != null && Game.state ? Game.state.empires[player.seat].color : player.color;
    const msg = { t: "chat", name: player.name, color, text };
    for (const { conn } of clients.values()) send(conn, msg);
    emit("chat", msg);
  }

  // ---------- joining ----------
  function join(code, name, prefs = {}) {
    return new Promise((resolve, reject) => {
      if (!available()) { reject(new Error("Online play couldn't load. Check your internet connection and reload the page.")); return; }
      leave();
      code = cleanCode(code);
      if (code.length !== 6) { reject(new Error("Room codes are 6 letters and numbers.")); return; }
      N.role = "client";
      N.code = code;
      let settled = false;
      const fail = err => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        leave();
        reject(err);
      };
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        N.joined = true;
        resolve();
      };
      const timer = setTimeout(() => fail(new Error("Couldn't connect to that game. Check the code and try again.")), 20000);
      peer = new Peer({ debug: 1 });
      peer.on("error", err => (settled ? emit("error", friendly(err)) : fail(friendly(err))));
      peer.on("open", () => {
        hostConn = peer.connect(PREFIX + code, { reliable: true });
        hostConn.on("open", () => send(hostConn, { t: "hello", name: cleanName(name), version: WD.VERSION, color: prefs.color, title: prefs.title, rank: prefs.rank }));
        hostConn.on("data", msg => {
          inbox = inbox.then(() => onHostMessage(msg, done, fail)).catch(err => console.error(err));
        });
        hostConn.on("close", hostLost);
        hostConn.on("error", hostLost);
      });
    });
  }

  async function onHostMessage(msg, done, fail) {
    if (!msg || typeof msg !== "object" || N.role !== "client") return;
    switch (msg.t) {
      case "reject":
        fail(new Error(msg.reason));
        return;
      case "lobby":
        N.lobby = { players: msg.players, settings: msg.settings };
        N.me = msg.you;
        done();
        emit("lobby");
        return;
      case "start": {
        const state = JSON.parse(await unpack(msg.z));
        N.inGame = true;
        N.speed = msg.speed;
        N.paused = msg.paused;
        N.history = null;
        Game.clear();
        Game.applySnapshot(world, state);
        done();
        emit("start", { you: msg.you });
        return;
      }
      case "snap": {
        if (!N.inGame) return;
        const state = JSON.parse(await unpack(msg.z));
        N.speed = msg.speed;
        N.paused = msg.paused;
        Game.applySnapshot(world, state);
        return;
      }
      case "res": {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        p.resolve(msg.r);
        return;
      }
      case "ev":
        if (N.inGame && (TARGETED.includes(msg.type) || BROADCAST.includes(msg.type))) Game.emit(msg.type, msg.ev);
        return;
      case "history":
        if (N.inGame) N.history = JSON.parse(await unpack(msg.z));
        return;
      case "chat": emit("chat", msg); return;
    }
  }

  function hostLost() {
    if (N.role !== "client") return;
    const wasIn = N.joined;
    leave();
    if (wasIn) emit("closed", "The host closed the game or lost their connection.");
  }

  // Orders from a client: the host runs them and answers with the game's { ok, reason } result.
  function command(op, args) {
    return new Promise(resolve => {
      if (N.role !== "client" || !hostConn || !hostConn.open) { resolve({ ok: false, reason: "Not connected to the host." }); return; }
      const id = ++cmdId;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, reason: "The host didn't answer. Your connection may be slow." });
      }, 8000);
      pending.set(id, { resolve, timer });
      send(hostConn, { t: "cmd", id, op, args });
    });
  }

  // ---------- shared ----------
  function pickNation(country) {
    if (N.role === "host") pick(N.lobby.players[0], country);
    else if (N.role === "client") send(hostConn, { t: "pick", country });
  }

  function say(text) {
    if (N.role === "host") chat(N.lobby.players[0], text);
    else if (N.role === "client") send(hostConn, { t: "chat", text });
  }

  const connectedSeats = () => new Set([...clients.values()].map(c => c.player.seat));

  function leave() {
    N.role = null;
    N.code = null;
    N.me = null;
    N.inGame = false;
    N.joined = false;
    N.speed = 1;
    N.paused = false;
    N.lobby = { players: [], settings: null };
    N.history = null;
    clearInterval(snapTimer);
    for (const p of pending.values()) { clearTimeout(p.timer); p.resolve({ ok: false, reason: "Disconnected." }); }
    pending.clear();
    clients.clear();
    const old = peer;
    peer = null;
    hostConn = null;
    inbox = Promise.resolve();
    outbox = Promise.resolve();
    if (old) try { old.destroy(); } catch { /* already closed */ }
  }

  addEventListener("beforeunload", () => leave());

  return Object.assign(N, {
    on, init, available, host, hostSaved, join, leave, setSettings, beginGame, pickNation, command, say, connectedSeats,
  });
})();
