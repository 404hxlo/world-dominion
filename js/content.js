// Content for the systems that make each war different: national superpowers, research,
// AI leaders and what they say, scenarios, medals and commander ranks. Pure data; the rules
// that use it live in game.js, ai.js, director.js and progress.js.
window.WD = window.WD || {};

// ---------- national superpowers ----------
// fx keys: numbers add up across a perk and research (cheap is per unit type, as a share off the price).
WD.PERKS = {
  winter:    { icon: "❄️", name: "General Winter", desc: "Invaders besieging your nations lose 3% of their troops every second.", fx: { attrition: 0.03 } },
  graveyard: { icon: "🪦", name: "Graveyard of Empires", desc: "Invaders lose 3% of their troops every second, and your nations defend 15% harder.", fx: { attrition: 0.03, defense: 0.15 } },
  jungle:    { icon: "🌴", name: "Jungle Warfare", desc: "Invaders lose 2% of their troops every second, and your nations defend 10% harder.", fx: { attrition: 0.02, defense: 0.1 } },
  mountain:  { icon: "⛰️", name: "Mountain Fortress", desc: "Your nations defend 35% harder.", fx: { defense: 0.35 } },
  island:    { icon: "🏝️", name: "Island Fortress", desc: "Enemy landings on your coasts fight at half strength for twice as long.", fx: { island: 1 } },
  homeguard: { icon: "🏰", name: "Home Guard", desc: "Your nations defend 20% harder.", fx: { defense: 0.2 } },
  mass:      { icon: "🪖", name: "Mass Mobilization", desc: "Infantry costs 40% less.", fx: { cheap: { inf: 0.4 } } },
  oil:       { icon: "🛢️", name: "Oil Wealth", desc: "+25% income.", fx: { income: 0.25 } },
  mineral:   { icon: "💎", name: "Mineral Riches", desc: "+20% income.", fx: { income: 0.2 } },
  trade:     { icon: "💰", name: "Trade Empire", desc: "+15% income, and conquered nations pay full income twice as fast.", fx: { income: 0.15, integrate: 1 } },
  bank:      { icon: "🏦", name: "Banking Haven", desc: "Your treasury earns 1% interest every 10 seconds (up to $30).", fx: { interest: 0.001 } },
  navy:      { icon: "⚓", name: "Rule the Waves", desc: "Warships cost 35% less and fight 25% harder.", fx: { cheap: { ship: 0.35 }, ship: 0.25 } },
  air:       { icon: "🦅", name: "Air Supremacy", desc: "Aircraft cost 30% less and fly 50% farther.", fx: { cheap: { air: 0.3 }, airRange: 0.5 } },
  armor:     { icon: "🛡️", name: "Armored Might", desc: "Tanks cost 25% less and fight 15% harder.", fx: { cheap: { tank: 0.25 }, tank: 0.15 } },
  rapid:     { icon: "🐎", name: "Rapid Maneuver", desc: "Land armies march 35% faster.", fx: { speed: 0.35 } },
  desert:    { icon: "🐪", name: "Desert Raiders", desc: "Land armies march 25% faster and attack 10% harder.", fx: { speed: 0.25, attack: 0.1 } },
  warrior:   { icon: "⚔️", name: "Warrior Tradition", desc: "Armies earn veteran stars twice as fast and attack 10% harder.", fx: { vetGain: 1, attack: 0.1 } },
  spartan:   { icon: "🏛️", name: "Spartan Discipline", desc: "Your nations defend 20% harder and your armies attack 10% harder.", fx: { defense: 0.2, attack: 0.1 } },
  tech:      { icon: "🔬", name: "Tech Leader", desc: "Research costs 35% less.", fx: { research: 0.35 } },
  missiles:  { icon: "🚀", name: "Missile Arsenal", desc: "Missiles cost 40% less and hit 30% harder.", fx: { cheap: { mis: 0.4 }, missile: 0.3 } },
  dome:      { icon: "🛰️", name: "Iron Dome", desc: "Shoots down 60% of missiles and 30% of nukes aimed at you.", fx: { shield: 0.6, nukeShield: 0.3 } },
  legion:    { icon: "🎖️", name: "Foreign Legion", desc: "Conquered nations send twice as many volunteers to your army.", fx: { militia: 1 } },
  partisan:  { icon: "🔥", name: "Partisan Resistance", desc: "When an enemy takes one of your nations, partisans destroy 30% of the troops that took it.", fx: { partisan: 0.3 } },
};

WD.PERK_OF = {
  "United States of America": "air", "China": "mass", "Russia": "winter", "India": "mass", "Germany": "armor",
  "Japan": "tech", "United Kingdom": "navy", "France": "legion", "Italy": "trade", "Brazil": "jungle",
  "Canada": "winter", "Mexico": "partisan", "South Korea": "tech", "Australia": "island", "Spain": "navy",
  "Indonesia": "jungle", "Turkey": "warrior", "Netherlands": "trade", "Saudi Arabia": "oil", "Switzerland": "mountain",
  "Poland": "partisan", "Taiwan": "tech", "Belgium": "trade", "Argentina": "rapid", "Sweden": "winter",
  "Ireland": "trade", "Austria": "mountain", "Thailand": "jungle", "Israel": "dome", "Norway": "oil",
  "United Arab Emirates": "oil", "Singapore": "bank", "Philippines": "island", "Vietnam": "partisan", "Iran": "missiles",
  "Bangladesh": "mass", "Malaysia": "trade", "Denmark": "navy", "Egypt": "desert", "Nigeria": "oil",
  "Hong Kong": "bank", "South Africa": "mineral", "Colombia": "jungle", "Pakistan": "mountain", "Chile": "mineral",
  "Romania": "mountain", "Czechia": "armor", "Finland": "winter", "Iraq": "oil", "Portugal": "navy",
  "Kazakhstan": "rapid", "Peru": "mountain", "Algeria": "desert", "New Zealand": "island", "Greece": "spartan",
  "Qatar": "oil", "Hungary": "rapid", "Ukraine": "partisan", "Kuwait": "oil", "Morocco": "desert",
  "Ethiopia": "mountain", "Slovakia": "mountain", "Venezuela": "oil", "Cuba": "partisan", "North Korea": "mass",
  "Afghanistan": "graveyard", "Mongolia": "rapid", "Libya": "oil", "Angola": "oil", "Nepal": "warrior",
  "Serbia": "partisan", "Belarus": "partisan", "Myanmar": "jungle", "Dem. Rep. Congo": "jungle", "Iceland": "winter",
  "Greenland": "winter", "Bolivia": "mountain", "Georgia": "mountain", "Armenia": "mountain", "Azerbaijan": "oil",
  "Turkmenistan": "oil", "Uzbekistan": "rapid", "Sudan": "desert", "Chad": "desert", "Niger": "desert", "Mali": "desert",
  "Mauritania": "desert", "Somalia": "desert", "Brunei": "oil", "Bahrain": "oil", "Oman": "oil", "Luxembourg": "bank",
  "Monaco": "bank", "Liechtenstein": "bank", "Cayman Is.": "bank", "Bermuda": "bank", "Andorra": "mountain",
  "Bhutan": "mountain", "Tajikistan": "mountain", "Kyrgyzstan": "mountain", "Lesotho": "mountain", "Montenegro": "mountain",
  "Bosnia and Herz.": "partisan", "Albania": "mountain", "Kosovo": "mountain", "Macedonia": "mountain", "Croatia": "navy",
  "Lithuania": "partisan", "Latvia": "partisan", "Estonia": "partisan", "Botswana": "mineral", "Zambia": "mineral",
  "Gabon": "oil", "Eq. Guinea": "oil", "Trinidad and Tobago": "oil", "Kenya": "rapid", "Syria": "desert", "Yemen": "graveyard",
  "Jordan": "desert", "Tunisia": "desert", "Laos": "jungle", "Cambodia": "jungle", "Papua New Guinea": "jungle",
  "Sri Lanka": "island", "Madagascar": "island", "Cyprus": "island", "Malta": "island", "Jamaica": "island",
  "Uruguay": "rapid", "Paraguay": "jungle", "Ecuador": "jungle", "Bulgaria": "mountain", "Slovenia": "mountain",
  "Moldova": "partisan", "Lebanon": "mountain", "Palestine": "partisan", "Haiti": "partisan", "Dominican Rep.": "island",
  "Guatemala": "jungle", "Honduras": "jungle", "Nicaragua": "partisan", "El Salvador": "partisan", "Costa Rica": "trade",
  "Panama": "trade", "Ghana": "mineral", "Côte d'Ivoire": "jungle", "Tanzania": "jungle", "Uganda": "jungle",
  "Rwanda": "mountain", "Mozambique": "jungle", "Zimbabwe": "mineral", "Namibia": "desert", "Cameroon": "jungle",
  "Senegal": "desert",
};

// Nations without a hand-picked perk get one from their geography.
WD.perkFor = c => {
  const id = WD.PERK_OF[c.name];
  if (id) return id;
  const [lon, lat] = c.anchor;
  if (![...c.edges.values()].some(e => !e.sea)) return "island";
  if (Math.abs(lat) >= 55) return "winter";
  if (Math.abs(lat) < 12) return "jungle";
  if (lat >= 12 && lat <= 35 && lon >= -20 && lon <= 65) return "desert";
  return "homeguard";
};

// ---------- research ----------
// Research is a tree: six branches of up to four tiers. A technology opens once everything in its
// `needs` is researched, and its tier sets the price (scaled by the game mode's economy).
// players: only human players research it. The AI keeps to the original twelve, whose needs stay
// among themselves.
WD.TECH_TIERS = [
  { name: "Tier I", cost: 450 },
  { name: "Tier II", cost: 900 },
  { name: "Tier III", cost: 1600 },
  { name: "Tier IV", cost: 2600 },
];
WD.TECH_BRANCHES = [
  { icon: "🪖", name: "Army" }, { icon: "⚡", name: "Armor" }, { icon: "✈️", name: "Air & Sea" },
  { icon: "🛰️", name: "Intel" }, { icon: "🏭", name: "Economy" }, { icon: "🏰", name: "Defense" },
];
WD.TECHS = {
  conscription:  { tier: 0, col: 0, needs: [], icon: "🪖", name: "Conscription", desc: "Infantry costs 30% less.", fx: { cheap: { inf: 0.3 } } },
  blitz:         { tier: 0, col: 1, needs: [], icon: "⚡", name: "Blitzkrieg", desc: "Land armies march 30% faster.", fx: { speed: 0.3 } },
  artillery:     { tier: 0, col: 2, needs: [], icon: "💥", name: "Precision Artillery", desc: "Artillery bombardment does twice the damage.", fx: { bombard: 1 } },
  propaganda:    { tier: 0, col: 4, needs: [], icon: "📣", name: "Propaganda", desc: "Conquered nations pay full income twice as fast and rarely revolt.", fx: { integrate: 1, calm: 0.6 } },
  drill:         { tier: 0, col: 5, needs: [], icon: "🎓", name: "Drill Sergeants", desc: "Your nations train troops 50% faster.", fx: { train: 0.5 }, players: true },
  academy:       { tier: 1, col: 0, needs: ["conscription"], icon: "🎖️", name: "Military Academy", desc: "New recruits arrive as 1-star veterans.", fx: { recruitVet: 1 } },
  armor:         { tier: 1, col: 1, needs: ["blitz"], icon: "🛡️", name: "Heavy Armor", desc: "Tanks attack and defend 35% harder.", fx: { tank: 0.35 } },
  marines:       { tier: 1, col: 2, needs: ["artillery"], icon: "⚓", name: "Marines", desc: "Your sea landings fight at full strength, and troop transports sail at full speed.", fx: { marines: 1 } },
  economy:       { tier: 1, col: 4, needs: ["propaganda"], icon: "🏭", name: "War Economy", desc: "+20% income.", fx: { income: 0.2 } },
  fortify:       { tier: 1, col: 5, needs: ["drill"], icon: "🏰", name: "Fortifications", desc: "All your nations defend 20% harder.", fx: { defense: 0.2 }, players: true },
  hospitals:     { tier: 2, col: 0, needs: ["academy"], icon: "🏥", name: "Field Hospitals", desc: "Your troops take 25% less damage in battle.", fx: { tough: 0.25 }, players: true },
  supply:        { tier: 2, col: 1, needs: ["armor"], icon: "🚚", name: "Supply Lines", desc: "A big empire loses only half as much income and training to overstretch.", fx: { logistics: 1 }, players: true },
  stealth:       { tier: 2, col: 2, needs: ["marines"], icon: "🛩️", name: "Stealth Bombers", desc: "Air strikes slip past interceptors, hit 50% harder and fly 50% farther.", fx: { stealth: 1, airDamage: 0.5, airRange: 0.5 } },
  satellites:    { tier: 2, col: 3, needs: ["economy"], icon: "📡", name: "Spy Satellites", desc: "See through the fog of war everywhere, and missiles reach any target on Earth.", fx: { satellites: 1 } },
  nuclear:       { tier: 2, col: 4, needs: ["economy"], icon: "☢️", name: "Nuclear Program", desc: "Build nuclear warheads that can strike anywhere on Earth.", fx: { nuclear: 1 } },
  shield:        { tier: 2, col: 5, needs: ["economy"], icon: "🛰️", name: "Missile Shield", desc: "Shoots down 75% of missiles and 50% of nukes aimed at your land.", fx: { shield: 0.75, nukeShield: 0.5 } },
  supersoldiers: { tier: 3, col: 0, needs: ["hospitals"], icon: "🦾", name: "Super Soldiers", desc: "Infantry attack and defend 50% harder.", fx: { inf: 0.5 }, players: true },
  mobilization:  { tier: 3, col: 1, needs: ["supply"], icon: "📯", name: "Total Mobilization", desc: "Each of your nations trains up to twice as many troops.", fx: { trainCap: 1 }, players: true },
  orbital:       { tier: 3, col: 2, needs: ["stealth", "satellites"], icon: "🔆", name: "Orbital Laser", desc: "Unlocks the Orbital Strike special op: a beam from space that can hit anywhere on Earth.", fx: { orbital: 1 }, players: true },
  cyber:         { tier: 3, col: 3, needs: ["satellites"], icon: "💻", name: "Cyber Warfare", desc: "Spy missions steal twice as much, and sabotage destroys 60% instead of 40%.", fx: { cyber: 1 }, players: true },
  ironcurtain:   { tier: 3, col: 5, needs: ["shield"], icon: "🧱", name: "Iron Curtain", desc: "Invaders in your land lose 3% of their troops every second.", fx: { attrition: 0.03 }, players: true },
};
WD.TECH_IDS = Object.keys(WD.TECHS);

// Shop packs: ready-made forces delivered to your capital, at a markup over the units' price.
// Like everything in the shop you can buy again, each one costs more every time you buy it.
// players: human players only. coastal: delivered to a coastal nation.
WD.PACKS = {
  battalion: { icon: "🎖️", name: "Veteran Battalion", desc: "20 infantry and 5 tanks with 2-star crews.", units: { inf: 20, tank: 5 }, vet: 2, markup: 1.25 },
  airwing:   { icon: "✈️", name: "Air Wing", desc: "6 aircraft with veteran pilots.", units: { air: 6 }, vet: 1, markup: 1.15 },
  battery:   { icon: "🚀", name: "Missile Battery", desc: "3 long-range missiles, ready to fire.", units: { mis: 3 }, vet: 0, markup: 1.1 },
  armored:   { icon: "🛡️", name: "Armored Division", desc: "15 tanks with 1-star crews.", units: { tank: 15 }, vet: 1, markup: 1.2, players: true },
  brigade:   { icon: "💥", name: "Artillery Brigade", desc: "12 artillery guns to shell your neighbors.", units: { art: 12 }, vet: 0, markup: 1.15, players: true },
  fleet:     { icon: "⚓", name: "Battle Fleet", desc: "8 warships with 1-star crews, delivered to a coastal nation.", units: { ship: 8 }, vet: 1, markup: 1.15, coastal: true, players: true },
  mercs:     { icon: "💰", name: "Mercenary Legion", desc: "50 infantry at a bargain price. No questions asked.", units: { inf: 50 }, vet: 0, markup: 0.85, players: true },
  grandarmy: { icon: "🏆", name: "Grand Army", desc: "80 infantry, 25 tanks and 10 artillery with 2-star crews.", units: { inf: 80, tank: 25, art: 10 }, vet: 2, markup: 1.3, players: true },
};

// Special ops: one-shot moves aimed at a nation on the map (human players only).
// cost: the first price (scaled by the game mode's economy). needs: a research that unlocks it.
WD.OPS = {
  sabotage:     { icon: "🧨", name: "Sabotage", cost: 500, desc: "Blow up 40% of the troops in an enemy or independent nation, anywhere in the world.", hint: "an enemy or independent nation to sabotage" },
  paratroopers: { icon: "🪂", name: "Paratroopers", cost: 600, desc: "Drop 25 veteran infantry on an enemy or independent nation within air range of your land. They attack at once.", hint: "a nation within air range to drop paratroopers on" },
  spy:          { icon: "🕵️", name: "Spy Mission", cost: 400, desc: "Steal 20% of an enemy empire's treasury and see all its land through the fog of war for 2 minutes.", hint: "a nation of an empire you're at war with to spy on" },
  coup:         { icon: "🎭", name: "Coup", cost: 300, desc: "An independent nation and its army switch to your side. Bigger economies cost more.", hint: "an independent nation to take over (bigger ones cost more)" },
  orbital:      { icon: "🔆", name: "Orbital Strike", cost: 1500, needs: "orbital", desc: "A laser from space destroys 70% of everything in any enemy nation on Earth. Nothing can stop it.", hint: "any enemy nation on Earth for the orbital strike" },
};

// Boosts: timed bonuses for your whole empire (buying one again adds time), plus the emergency
// draft, which fills every barracks at once. Human players only.
WD.BOOSTS = {
  income:  { icon: "💰", name: "Income Rush", cost: 500, secs: 120, desc: "+50% income for 2 minutes.", fx: { income: 0.5 } },
  train:   { icon: "🪖", name: "Double Training", cost: 400, secs: 180, desc: "Your nations train troops twice as fast for 3 minutes.", fx: { train: 1 } },
  fortify: { icon: "🏰", name: "Hold the Line", cost: 500, secs: 120, desc: "All your nations defend 30% harder for 2 minutes.", fx: { defense: 0.3 } },
  march:   { icon: "🥾", name: "Forced March", cost: 350, secs: 120, desc: "Your armies march 50% faster for 2 minutes.", fx: { speed: 0.5 } },
  draft:   { icon: "📯", name: "Emergency Draft", cost: 600, desc: "Every one of your nations trains up to its limit right now." },
};

// The mystery crate: one random reward. chance: how often each kind turns up.
WD.CRATE = {
  icon: "🎁", name: "Mystery Crate", cost: 500,
  desc: "A random reward: cash or troops, a boost, a free supply pack, or (rarely) free research.",
  odds: [
    { rarity: "Epic", chance: 0.07 },        // free research of a technology you can open
    { rarity: "Rare", chance: 0.18 },        // a free supply pack
    { rarity: "Uncommon", chance: 0.30 },    // a random boost
    { rarity: "Common", chance: 0.45 },      // cash or reinforcements
  ],
};

// ---------- AI leaders ----------
// research: the order a personality likes to research in (anything else comes after).
WD.PERSONAS = {
  warmonger:    { icon: "⚔️", name: "Warmonger", desc: "Attacks constantly, taunts rivals and isn't afraid of nukes.", weight: 3, aggression: 1.35, loyalty: 0.3, betray: 1.2, chatty: 1.3, nuke: 1, demand: 0.6, peace: -15, research: ["blitz", "armor", "conscription", "academy", "nuclear", "stealth"] },
  schemer:      { icon: "🐍", name: "Schemer", desc: "Makes friends, then stabs them in the back when they look weak.", weight: 2, aggression: 0.9, loyalty: 0.1, betray: 2, chatty: 1, nuke: 0.5, demand: 1, peace: 5, research: ["economy", "propaganda", "marines", "satellites", "artillery"] },
  turtle:       { icon: "🐢", name: "Turtle", desc: "Builds huge defenses and rarely starts wars with other empires.", weight: 2, aggression: 0.65, loyalty: 0.8, betray: 0.2, chatty: 0.6, nuke: 0.2, demand: 0.1, peace: 15, research: ["artillery", "academy", "economy", "shield"] },
  opportunist:  { icon: "🦊", name: "Opportunist", desc: "Picks on whoever is weakest or already busy fighting.", weight: 3, aggression: 1.0, loyalty: 0.45, betray: 1, chatty: 0.9, nuke: 0.6, demand: 0.6, peace: 0, research: ["blitz", "economy", "marines", "stealth"] },
  peacemaker:   { icon: "🕊️", name: "Peacemaker", desc: "Seeks peace and alliances, and stands up to runaway empires.", weight: 2, aggression: 0.75, loyalty: 0.95, betray: 0.1, chatty: 0.8, nuke: 0.1, demand: 0, peace: 25, research: ["economy", "propaganda", "academy", "shield"] },
  expansionist: { icon: "🗺️", name: "Expansionist", desc: "Grabs land fast and demands territory from its neighbors.", weight: 3, aggression: 1.15, loyalty: 0.5, betray: 0.8, chatty: 1, nuke: 0.5, demand: 1.2, peace: 0, research: ["propaganda", "blitz", "conscription", "marines"] },
};
WD.LEADER_TITLES = ["President", "Premier", "Chancellor", "Marshal", "General", "Admiral", "Prime Minister", "Supreme Leader", "Grand Vizier", "Director", "Consul", "Commander", "High Regent"];
WD.LEADER_FIRST = ["Viktor", "Ilse", "Dana", "Marco", "Aiko", "Rafael", "Yara", "Bogdan", "Lena", "Omar", "Sven", "Mei", "Kofi", "Ines", "Tariq", "Freya", "Anton", "Zara", "Hugo", "Nadia", "Dmitri", "Leila", "Pablo", "Sakura", "Emeka", "Astrid", "Cyrus", "Talia", "Bruno", "Esme", "Idris", "Katya", "Mateo", "Soren", "Amara", "Ruslan", "Noor", "Felix", "Ayla", "Gustav"];
WD.LEADER_LAST = ["Kane", "Varga", "Okafor", "Strand", "Moreau", "Ivanov", "Castell", "Nakamura", "Rahimi", "Lindqvist", "Abara", "Petrov", "Silva", "Haddad", "Volkov", "Brandt", "Achebe", "Kovac", "Ferreira", "Tanaka", "Novak", "Rostova", "Mensah", "Duarte", "Kessler", "Arslan", "Ortega", "Hale", "Sato", "Draganov", "Quinlan", "Vasquez", "Halvorsen", "Okonkwo", "Marchetti", "Steiner", "Khalil", "Orlov", "Asante", "Valdez"];
WD.LEADER_FACES = ["🧔", "👩‍✈️", "👨‍✈️", "🧑‍✈️", "👴", "👵", "👩", "👨", "🧑‍💼", "👩‍💼", "👨‍💼", "🕵️", "🤴", "👸", "🧕", "👱"];
WD.REBEL_NAMES = ["Free State of {c}", "{c} Liberation Front", "Rebels of {c}", "Provisional Government of {c}", "{c} Resistance"];

// What AI leaders say to players. {c} = a nation, {me} = the speaker's empire, {you} = the player's empire.
// A situation is either one list for everyone or a list per personality.
WD.LINES = {
  tookYours: {
    warmonger: ["{c} is mine now. You're next.", "Did you really think {c} could stop me?", "Your armies crumble. Surrender while you still can."],
    schemer: ["{c} needed better management. I've taken care of it.", "Nothing personal. {c} was simply too tempting."],
    turtle: ["You left {c} wide open. We merely closed the gap.", "We take {c} for our own security. Stay back."],
    opportunist: ["You were distracted. {c} was easy pickings.", "Thanks for {c}. You should really watch your back."],
    peacemaker: ["{c} is under our protection now. We take no joy in this.", "End this war, and {c} will be treated fairly."],
    expansionist: ["{c} belongs to the {me} now. The map is ours to redraw.", "Another flag for our collection: {c}."],
  },
  lostToYou: {
    warmonger: ["You'll pay for {c} in blood!", "Enjoy {c} while it lasts. I'm coming back for it."],
    schemer: ["Take {c}. I'll remember this.", "A clever move. Let's see how long you keep {c}."],
    turtle: ["{c} has fallen. We will not forget this aggression.", "Our walls hold elsewhere. Taking {c} was a mistake."],
    opportunist: ["Fine, keep {c}. There's plenty of world left.", "{c}? I never liked it anyway."],
    peacemaker: ["Why spill blood over {c}? Let us talk about peace.", "Taking {c} solves nothing. Make peace with us."],
    expansionist: ["{c} was ours! We'll take it back, and more.", "You've drawn our attention. A big mistake."],
  },
  threat: {
    warmonger: ["Your borders look... vulnerable.", "My generals have drawn up plans for your capital.", "I can smell your fear from here."],
    schemer: ["It would be a shame if something happened to your empire.", "Friends today, who knows tomorrow?"],
    turtle: ["Our defenses are ready. Don't test them."],
    opportunist: ["You look busy. Too busy to watch every border?"],
    peacemaker: ["We have no quarrel with you. Let's keep it that way."],
    expansionist: ["The world is big, but not big enough for both of us.", "Your land would look better in our colors."],
  },
  warOnYou: {
    warmonger: ["Peace was boring. Prepare for war!", "Our treaty is ash. My armies are already moving."],
    schemer: ["Nothing personal. Just strategy.", "Did you really think our friendship would last?"],
    turtle: ["You leave us no choice. To arms!"],
    opportunist: ["You look weak. That's all the reason I need.", "An opportunity is an opportunity. Sorry."],
    peacemaker: ["You've grown too dangerous. The world must stop you."],
    expansionist: ["Our destiny needs more room. Yours will do."],
  },
  ultimatum: {
    warmonger: ["Hand over {c} or I burn your empire to the ground.", "{c}. Now. Or war."],
    schemer: ["Give me {c}, and we can stay such good friends.", "A small gift, {c}, would keep my armies at home."],
    turtle: ["{c} threatens our security. Withdraw from it."],
    opportunist: ["I'll take {c} the easy way or the hard way. Your choice."],
    peacemaker: ["Return {c} to us and we'll forget this war."],
    expansionist: ["{c} rightfully belongs to the {me}. Hand it over."],
  },
  tribute: {
    warmonger: ["Pay ${n} tribute, or my tanks collect it in person."],
    schemer: ["A little ${n} would buy a lot of my patience."],
    turtle: ["${n} for our defense costs, or we stop being patient."],
    opportunist: ["${n}, and I'll look the other way. For a while."],
    peacemaker: ["Pay ${n} to rebuild what your war destroyed."],
    expansionist: ["Our empire demands ${n} in tribute. Pay it."],
  },
  accepted: ["A wise choice. Our armies stand down... for now.", "Good. Reasonable rulers live longer.", "Smart. We'll remember your cooperation."],
  refused: ["Then we'll take it by force!", "You'll regret this. Our armies march at dawn.", "So be it. War it is."],
  peaceYes: ["Peace serves us both, for now.", "Very well. Let the guns fall silent.", "Agreed. Don't make me regret this."],
  allyYes: ["Together, no one can stop us.", "An alliance, then. Watch my back and I'll watch yours."],
  nuked: ["Monsters! The world will never forgive you!", "You've unleashed hell. Now face it.", "History will curse your name."],
  capital: ["Our capital has fallen, but the {me} fights on!", "You took our capital. We will take everything from you."],
  fallen: ["You may have won, but history will remember us.", "This isn't over. Someday our flag will rise again."],
};

// ---------- scenarios ----------
// empires: AI empires to create (a player who picks one of these nations takes its place).
// own: extra nations it starts with. team: empires on the same team start allied.
// rivalTeams / nonAligned: starting relation between rival teams, and between teams and everyone else.
WD.SCENARIOS = {
  classic: { icon: "🌍", name: "Classic", desc: "Rival empires rise at random around the world.", rivals: true },
  worldwar: {
    icon: "⚔️", name: "World War", desc: "Two great alliances fight for the planet. Pick a member nation to join one, or stay non-aligned.",
    teams: { atlantic: "Atlantic Pact", eastern: "Eastern Coalition" },
    rivalTeams: "war", nonAligned: "peace",
    empires: [
      ["United States of America", "atlantic"], ["United Kingdom", "atlantic"], ["France", "atlantic"], ["Germany", "atlantic"],
      ["Canada", "atlantic"], ["Italy", "atlantic"], ["Japan", "atlantic"], ["Australia", "atlantic"],
      ["Russia", "eastern"], ["China", "eastern"], ["Iran", "eastern"], ["North Korea", "eastern"],
      ["Belarus", "eastern"], ["Pakistan", "eastern"], ["Venezuela", "eastern"], ["Cuba", "eastern"],
      ["India"], ["Brazil"], ["Turkey"], ["Saudi Arabia"], ["South Africa"], ["Indonesia"], ["Mexico"], ["Nigeria"],
    ].map(([start, team]) => ({ start, team })),
  },
  coldwar: {
    icon: "☢️", name: "Cold War", desc: "Two nuclear superpowers and their blocs race to win over the rest of the world. Both start with warheads.",
    teams: { west: "Western Bloc", east: "Eastern Bloc" },
    rivalTeams: "peace", nonAligned: "war",
    empires: [
      { start: "United States of America", team: "west", nukes: 2, tech: ["nuclear"] },
      { start: "Russia", team: "east", nukes: 2, tech: ["nuclear"],
        own: ["Ukraine", "Belarus", "Kazakhstan", "Uzbekistan", "Turkmenistan", "Kyrgyzstan", "Tajikistan", "Georgia", "Armenia", "Azerbaijan", "Moldova", "Lithuania", "Latvia", "Estonia"] },
      { start: "United Kingdom", team: "west" }, { start: "France", team: "west" }, { start: "Germany", team: "west" },
      { start: "Turkey", team: "west" }, { start: "Japan", team: "west" },
      { start: "Poland", team: "east" }, { start: "Cuba", team: "east" }, { start: "Vietnam", team: "east" },
      { start: "North Korea", team: "east" }, { start: "Mongolia", team: "east" },
      { start: "China" }, { start: "India" },
    ],
  },
  superpowers: { icon: "🦾", name: "Superpowers", desc: "Every rival is one of the world's biggest powers, starting with double forces.", rivals: true },
  underdog: { icon: "🐭", name: "Underdog", desc: "Start as a small nation with a war chest and elite troops. Can David beat the Goliaths?", rivals: true },
};
WD.UNDERDOG_MAX = 1.5;   // largest economy a nation can have to play Underdog

// ---------- medals ----------
WD.MEDALS = {
  victory:    { icon: "🏆", name: "Victor", desc: "Win a war." },
  conqueror:  { icon: "🌍", name: "World Conqueror", desc: "Control 100% of the world." },
  blitz:      { icon: "⚡", name: "Lightning War", desc: "Capture 10 nations within 60 seconds." },
  kingslayer: { icon: "👑", name: "Kingslayer", desc: "Capture an enemy capital." },
  doomsday:   { icon: "☢️", name: "Doomsday", desc: "Launch a nuclear strike." },
  survivor:   { icon: "🪖", name: "Survivor", desc: "Survive a nuclear strike on your empire." },
  wall:       { icon: "🧱", name: "Iron Wall", desc: "Repel 15 attacks in one war." },
  elite:      { icon: "⭐", name: "Elite Corps", desc: "Field a 3-star army of at least 20 troops." },
  admiral:    { icon: "⚓", name: "Admiral", desc: "Conquer 10 nations from the sea in one war." },
  rocket:     { icon: "🚀", name: "Rocket Barrage", desc: "Land 15 missile strikes in one war." },
  diplomat:   { icon: "🤝", name: "Grand Diplomat", desc: "Hold 3 alliances at the same time." },
  backstab:   { icon: "🗡️", name: "Backstabber", desc: "Declare war on an ally." },
  scientist:  { icon: "🔬", name: "Mad Scientist", desc: "Research every technology." },
  tycoon:     { icon: "💰", name: "Tycoon", desc: "Hold $10,000 at once." },
  hunter:     { icon: "🎯", name: "Bounty Hunter", desc: "Complete 10 contracts in one war." },
  comeback:   { icon: "🔥", name: "Comeback Kid", desc: "Win after falling below 3% of the world once the ceasefire ended." },
  giant:      { icon: "🐭", name: "Giant Slayer", desc: "Win as a small nation." },
  speed:      { icon: "⏱️", name: "Speedrun", desc: "Win a Quick Match in under 12 minutes." },
  pacifist:   { icon: "🕊️", name: "Clean Hands", desc: "Win without firing a missile or a nuke." },
  hard:       { icon: "💀", name: "Hard as Nails", desc: "Win on Hard difficulty." },
};

// ---------- commander ranks ----------
WD.RANKS = [
  { xp: 0, name: "Recruit", pin: "•" },
  { xp: 500, name: "Private", pin: "❯" },
  { xp: 1300, name: "Corporal", pin: "❯❯" },
  { xp: 2500, name: "Sergeant", pin: "❯❯❯" },
  { xp: 4000, name: "Lieutenant", pin: "◆" },
  { xp: 6000, name: "Captain", pin: "◆◆" },
  { xp: 8500, name: "Major", pin: "✦" },
  { xp: 11500, name: "Colonel", pin: "✦✦" },
  { xp: 15000, name: "Brigadier", pin: "★" },
  { xp: 19500, name: "General", pin: "★★" },
  { xp: 25000, name: "Marshal", pin: "★★★" },
  { xp: 32000, name: "Supreme Commander", pin: "★★★★" },
];
// [rank needed, value, label]
WD.UNLOCK_COLORS = [
  [0, "#3d8bfd", "Command Blue"], [1, "#e5484d", "Crimson"], [2, "#30a46c", "Emerald"], [3, "#8e4ec6", "Royal Violet"],
  [4, "#12a594", "Teal"], [5, "#f5a524", "Amber"], [6, "#e93d82", "Magenta"], [7, "#7fd8f5", "Arctic"],
  [8, "#d4a72c", "Imperial Gold"], [10, "#e8e8e8", "Ivory"], [11, "#ff6b1a", "Inferno"],
];
WD.UNLOCK_TITLES = [
  [0, "Empire"], [1, "Republic"], [2, "Federation"], [3, "Kingdom"], [4, "Union"], [5, "Commonwealth"],
  [6, "Dominion"], [7, "Hegemony"], [8, "Imperium"], [9, "Grand Empire"], [10, "Eternal Empire"], [11, "Galactic Empire"],
];
// Experience: a typical full war earns a few thousand.
WD.XP = { capture: 3, perValue: 1.5, capital: 100, repel: 5, medal: 100, bounty: 25, kill: 75, win: 500, winDiff: { easy: 0, normal: 150, hard: 400 } };
