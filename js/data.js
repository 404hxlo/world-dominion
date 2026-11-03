// Static game data: unit stats, country economies, game modes and difficulty.
window.WD = window.WD || {};

// Multiplayer only connects players whose game files have the same version.
WD.VERSION = "1.4";
WD.MAX_PLAYERS = 8;
// Where the game is published online. Invite links point here when the game was opened from disk.
WD.GAME_URL = "https://404hxlo.github.io/world-dominion/";

WD.UNITS = {
  inf:  { name: "Infantry",  short: "INF", icon: "🪖", cost: 10, att: 1.0, def: 2.0, hp: 1.0, speed: 1.0, key: "Q" },
  tank: { name: "Tanks",     short: "TNK", icon: "🛡️", cost: 30, att: 3.0, def: 2.5, hp: 2.5, speed: 1.5, key: "W" },
  art:  { name: "Artillery", short: "ART", icon: "💥", cost: 25, att: 0.8, def: 1.5, hp: 1.0, speed: 0.8, key: "E" },
  ship: { name: "Warships",  short: "SHP", icon: "⚓", cost: 35, att: 2.0, def: 2.5, hp: 3.0, speed: 1.3, key: "R" },
  air:  { name: "Aircraft",  short: "AIR", icon: "✈️", cost: 40, att: 0.0, def: 1.0, hp: 2.0, speed: 5.0, key: "T" },
  mis:  { name: "Missiles",  short: "MSL", icon: "🚀", cost: 60, att: 0.0, def: 0.0, hp: 0.0, speed: 10,  key: "Y" },
  // Free local defenders every nation raises by itself. They never march and can't be bought.
  mil:  { name: "Militia",   short: "MIL", icon: "🛡", cost: 0,  att: 0.0, def: 1.5, hp: 1.0, speed: 0,   key: "" },
};
WD.UNIT_TYPES = ["inf", "tank", "art", "ship", "air", "mis"];   // types you can buy
WD.ALL_TYPES = [...WD.UNIT_TYPES, "mil"];
WD.ARMY_TYPES = ["inf", "tank", "art", "ship"];   // types that march in armies
WD.COMBAT_TYPES = ["inf", "tank", "art", "ship", "air", "mil"];

WD.RULES = {
  baseSpeedKm: 80,         // km per game-second at unit speed 1.0
  seaTransportSpeed: 0.6,  // land units crossing a sea lane without warships
  combatRate: 0.07,        // damage per point of attack per second
  integrationTime: 90,     // seconds before a conquered country pays full income
  overextendFrom: 30,      // empire value where income efficiency starts to drop
  overextendScale: 120,    // efficiency = 1 / (1 + (value - from) / scale)
  baseIncome: 3,           // flat income every empire gets
  incomePerValue: 1,       // income per point of country value
  bombardRate: 0.25,       // damage per artillery per second
  counterBattery: 0.15,
  airRangeKm: 3500,
  airSpeedKm: 500,
  airBombDamage: 1.2,      // damage per surviving plane per strike
  missileRangeKm: 6000,
  missileSpeedKm: 1000,
  missileDamage: 10,
  landingSeconds: 6,       // seaborne attackers fight at a penalty this long
  landingPenalty: 0.6,
  neutralRegen: 0.03,      // fraction of base garrison regained per second
  startMoney: 400,
  startForce: { inf: 30, tank: 8, art: 3, ship: 3, air: 2, mis: 0 },   // ships only for coastal nations
  militiaShare: 0.2,       // share of a liberated nation's garrison that volunteers for its conqueror
  vetBonus: 0.15,          // attack and defense per veteran star
  vetMax: 3,
  capitalDefense: 0.5,     // capitals defend this much harder
  capitalLoot: 0.5,        // share of the treasury taken with a capital
  civilWarMin: 6,          // nations an empire must keep for a civil war to break out when its capital falls
  civilWarShare: 0.3,      // share of those nations that break away
  civilWarGap: 240,        // seconds before the same empire can split again
  nukeCost: 1200,
  nukeMax: 3,
  nukeSpeedKm: 700,
  nukeKill: 0.9,           // share of everything at ground zero that is destroyed
  falloutKill: 0.25,       // share lost in neighboring nations
  radTime: 120,            // seconds a nuked nation pays no income and can't recruit
  radarKm: 1500,           // fog of war: how far aircraft let you see
  offerTime: 30,           // seconds a player has to answer an arms deal or an ultimatum
  militiaBase: 3,          // militia a nation raises: (base + perValue * value), less while it integrates
  militiaPerValue: 3,
  militiaRate: 0.025,      // share of the militia cap raised per second
  recruitBase: 3,          // troops a nation trains on its own, up to (base + perValue * value)
  recruitPerValue: 4,
  recruitTime: 240,        // seconds an empty nation takes to train up to that limit
  recruitTanks: 0.2,       // share of those recruits that are tanks, in nations worth recruitTankValue or more
  recruitTankValue: 4,
  autoBudget: 0.2,         // default share of income the autopilot may spend on defenders
  autoFundSecs: 40,        // the autopilot saves at most this many seconds of its budget
  touchSecs: 45,           // the autopilot leaves nations you gave orders in alone this long
  retakeWindow: 75,        // seconds the autopilot keeps trying to win back a lost nation
};

WD.MODES = {
  // grace: seconds of opening ceasefire during which AI empires only grab independent nations
  // mobilize: [full, end] seconds of the opening income boost (double income, fading out by `end`)
  quick:    { name: "Quick Match",   desc: "Fast economy and armies. About 15 minutes.", income: 1.6, speed: 1.5, neutral: 0.7, rivals: 4,  victory: 50,  grace: 120, mobilize: [60, 150],  autosave: false },
  standard: { name: "Standard War",  desc: "Balanced pace. About 30–45 minutes.",        income: 1.0, speed: 1.0, neutral: 1.0, rivals: 6,  victory: 75,  grace: 180, mobilize: [90, 240],  autosave: false },
  campaign: { name: "Long Campaign", desc: "Slow and epic. Autosaves every minute.",     income: 0.8, speed: 0.9, neutral: 1.2, rivals: 10, victory: 100, grace: 300, mobilize: [120, 360], autosave: true },
};

WD.DIFFICULTY = {
  easy:   { name: "Easy",   income: 0.8,  think: 3.0, margin: 1.6, spend: 0.7, betray: 0.3 },
  normal: { name: "Normal", income: 1.0,  think: 2.0, margin: 1.3, spend: 0.9, betray: 0.6 },
  hard:   { name: "Hard",   income: 1.25, think: 1.2, margin: 1.1, spend: 1.0, betray: 1.0 },
};

// Countries and territories left off the map (uninhabited or too tiny to play).
WD.EXCLUDE = new Set([
  "Antarctica", "Fr. S. Antarctic Lands", "Heard I. and McDonald Is.", "S. Geo. and the Is.",
  "Br. Indian Ocean Ter.", "Indian Ocean Ter.", "Ashmore and Cartier Is.", "Siachen Glacier",
]);

// Approximate GDP in billions of USD. Country value = sqrt(GDP) / 10, plus a bit for land area.
WD.GDP = {
  "United States of America": 27000, "China": 17800, "Germany": 4500, "Japan": 4200, "India": 3600,
  "United Kingdom": 3300, "France": 3000, "Italy": 2250, "Brazil": 2170, "Canada": 2140, "Russia": 2000,
  "Mexico": 1790, "South Korea": 1710, "Australia": 1720, "Spain": 1580, "Indonesia": 1370, "Turkey": 1110,
  "Netherlands": 1120, "Saudi Arabia": 1070, "Switzerland": 880, "Poland": 810, "Taiwan": 760, "Belgium": 630,
  "Argentina": 640, "Sweden": 590, "Ireland": 550, "Austria": 520, "Thailand": 510, "Israel": 510, "Norway": 490,
  "United Arab Emirates": 500, "Singapore": 500, "Philippines": 440, "Vietnam": 430, "Iran": 400,
  "Bangladesh": 450, "Malaysia": 400, "Denmark": 400, "Egypt": 390, "Nigeria": 360, "Hong Kong": 380,
  "South Africa": 380, "Colombia": 360, "Pakistan": 340, "Chile": 330, "Romania": 350, "Czechia": 330,
  "Finland": 300, "Iraq": 250, "Portugal": 290, "Kazakhstan": 260, "Peru": 270, "Algeria": 240,
  "New Zealand": 250, "Greece": 240, "Qatar": 210, "Hungary": 210, "Ukraine": 180, "Kuwait": 160,
  "Morocco": 140, "Ethiopia": 160, "Slovakia": 130, "Ecuador": 120, "Puerto Rico": 110, "Dominican Rep.": 120,
  "Kenya": 105, "Oman": 105, "Cuba": 100, "Guatemala": 100, "Bulgaria": 100, "Venezuela": 95, "Uzbekistan": 90,
  "Luxembourg": 85, "Costa Rica": 86, "Angola": 85, "Sri Lanka": 84, "Panama": 83, "Croatia": 80,
  "Tanzania": 79, "Ghana": 76, "Côte d'Ivoire": 79, "Lithuania": 77, "Uruguay": 77, "Serbia": 75,
  "Dem. Rep. Congo": 67, "Myanmar": 65, "Belarus": 70, "Azerbaijan": 72, "Slovenia": 68, "Turkmenistan": 60,
  "Jordan": 50, "Tunisia": 48, "Cameroon": 48, "Uganda": 49, "Libya": 50, "Bolivia": 45, "Bahrain": 44,
  "Paraguay": 43, "Latvia": 43, "Nepal": 41, "Estonia": 41, "Macao": 47, "Cambodia": 31, "Sudan": 30,
  "Zimbabwe": 33, "Senegal": 31, "Cyprus": 32, "Iceland": 31, "Georgia": 30, "Honduras": 34, "El Salvador": 34,
  "Bosnia and Herz.": 27, "Zambia": 28, "Papua New Guinea": 31, "Trinidad and Tobago": 28, "Afghanistan": 17,
  "Mozambique": 21, "Mali": 21, "Burkina Faso": 20, "Botswana": 20, "Albania": 23, "Gabon": 20, "Armenia": 24,
  "Mongolia": 20, "Jamaica": 19, "Nicaragua": 17, "Lebanon": 18, "Syria": 20, "Yemen": 21, "North Korea": 20,
  "Laos": 15, "Madagascar": 16, "Chad": 13, "Congo": 15, "Niger": 16, "Benin": 19, "Guinea": 23,
  "Kyrgyzstan": 12, "Tajikistan": 12, "Rwanda": 14, "Malawi": 13, "Moldova": 16, "Haiti": 20, "Macedonia": 15,
  "Namibia": 12, "Mauritius": 14, "Brunei": 15, "Bahamas": 14, "Malta": 20, "Eq. Guinea": 12, "Mauritania": 10,
  "Togo": 9, "Somalia": 11, "Kosovo": 10, "Montenegro": 7, "Fiji": 5, "Greenland": 3, "Palestine": 18,
  "Sierra Leone": 4, "Liberia": 4, "Burundi": 3, "Eritrea": 2.5, "S. Sudan": 5, "Central African Rep.": 2.8,
  "Lesotho": 2.3, "eSwatini": 4.6, "Djibouti": 3.9, "Bhutan": 2.7, "Guyana": 16, "Suriname": 3.5, "Belize": 3,
  "Gambia": 2.3, "Guinea-Bissau": 2, "Somaliland": 3, "N. Cyprus": 4, "Timor-Leste": 2, "Maldives": 6.6,
  "Barbados": 6, "Andorra": 3.7, "Liechtenstein": 7, "Monaco": 8, "San Marino": 2, "Bermuda": 7.5,
  "Cayman Is.": 6.5, "Aruba": 3.5, "Curaçao": 3, "Seychelles": 2, "Cabo Verde": 2.5, "New Caledonia": 10,
  "Fr. Polynesia": 6, "Guam": 6.5, "Faeroe Is.": 3.5, "Isle of Man": 8, "Jersey": 6, "Guernsey": 3.5,
};

// Countries whose independent armies are much bigger than their economy suggests.
WD.MILITARY = {
  "Russia": 2.5, "China": 1.5, "India": 1.5, "North Korea": 6, "Iran": 2, "Pakistan": 2, "Israel": 1.8,
  "Turkey": 1.5, "Egypt": 1.5, "United States of America": 1.3, "South Korea": 1.4, "Vietnam": 1.5,
  "Ukraine": 2, "Saudi Arabia": 1.3, "Afghanistan": 2,
};

WD.PLAYER_COLOR = "#3d8bfd";
// Human players take these first (the host or solo player is always blue); AIs get the rest.
WD.HUMAN_COLORS = ["#3d8bfd", "#f5a524", "#30a46c", "#e93d82", "#8e4ec6", "#12a594", "#e5484d", "#cfa30a"];
WD.AI_COLORS = [
  "#e5484d", "#f5a524", "#30a46c", "#8e4ec6", "#12a594", "#e93d82", "#d6409f", "#ad7f58",
  "#ff8b3e", "#7c66dc", "#46a758", "#cfa30a", "#c2298a", "#00a2c7", "#a35829", "#5b5bd6",
  "#e54666", "#3e9b4f", "#b8742b", "#8d8d86",
];
WD.NEUTRAL_COLOR = "#4a5160";

WD.EMPIRE_TITLES = ["Empire", "Federation", "Republic", "Union", "Dominion", "Coalition", "Commonwealth", "Directorate", "Hegemony", "Confederacy"];
