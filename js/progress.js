// Your commander career across wars, kept in this browser: experience and rank, the medals
// you've earned, and the empire colors and titles that ranks unlock.
window.WD = window.WD || {};

WD.Progress = (() => {
  const KEY = "worldDominion.career";
  // banked: experience already counted per war id; seen: medals already counted per war id;
  // stars: the best result per scenario (1 played to the end, 2 won, 3 won on Hard).
  const data = { xp: 0, medals: {}, wars: 0, wins: 0, color: WD.PLAYER_COLOR, title: "Empire", banked: {}, seen: {}, stars: {} };
  try { Object.assign(data, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* storage blocked */ }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage blocked */ } }

  function rankAt(xp) {
    let i = 0;
    WD.RANKS.forEach((r, k) => { if (xp >= r.xp) i = k; });
    return i;
  }
  const rank = () => rankAt(data.xp);

  // Keep the per-war bookkeeping small: only the most recent wars matter.
  function prune() {
    for (const map of [data.banked, data.seen]) {
      const keys = Object.keys(map);
      if (keys.length > 80) keys.slice(0, keys.length - 80).forEach(k => delete map[k]);
    }
  }

  // Bank the experience earned in a war so far. Each war counts once, even across saves and rejoins.
  function bank(warId, total) {
    const before = data.xp;
    const add = Math.max(0, Math.round(total - (data.banked[warId] || 0)));
    if (add) {
      data.banked[warId] = total;
      data.xp += add;
      prune();
      save();
    }
    return { add, before, after: data.xp, promoted: rankAt(data.xp) > rankAt(before) };
  }

  // Returns true the first time a medal is earned in a given war.
  function medal(warId, id) {
    const seen = (data.seen[warId] ||= []);
    if (seen.includes(id)) return false;
    seen.push(id);
    data.medals[id] = (data.medals[id] || 0) + 1;
    prune();
    save();
    return true;
  }

  const warStars = (won, difficulty) => (won ? (difficulty === "hard" ? 3 : 2) : 1);
  const starsFor = scenario => data.stars[scenario] || 0;

  function finishWar(warId, won, scenario, difficulty) {
    const key = "end:" + warId;
    if (data.banked[key]) return;
    data.banked[key] = 1;
    data.wars++;
    if (won) data.wins++;
    if (scenario) data.stars[scenario] = Math.max(starsFor(scenario), warStars(won, difficulty));
    save();
  }

  const colors = () => WD.UNLOCK_COLORS.map(([r, value, label]) => ({ value, label, rank: r, open: rank() >= r }));
  const titles = () => WD.UNLOCK_TITLES.map(([r, value]) => ({ value, rank: r, open: rank() >= r }));
  // The chosen color and title, if still unlocked.
  const color = () => colors().find(c => c.value === data.color && c.open)?.value || WD.PLAYER_COLOR;
  const title = () => titles().find(t => t.value === data.title && t.open)?.value || "Empire";
  function choose(kind, value) {
    const list = kind === "color" ? colors() : titles();
    if (!list.some(x => x.value === value && x.open)) return false;
    data[kind] = value;
    save();
    return true;
  }
  // What reaching rank `i` unlocks, for the promotion message.
  const unlocks = i => [
    ...WD.UNLOCK_COLORS.filter(([r]) => r === i).map(([, , label]) => `the ${label} color`),
    ...WD.UNLOCK_TITLES.filter(([r]) => r === i).map(([, t]) => `the “${t}” title`),
  ];

  return { get data() { return data; }, rank, rankAt, bank, medal, finishWar, warStars, starsFor, colors, titles, color, title, choose, unlocks };
})();
