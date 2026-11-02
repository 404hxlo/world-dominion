// Builds share/World-Dominion.html: the whole game in one file, so friends can play from a single
// download instead of unzipping a folder. Run it after changing the game: node tools/bundle.js
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
// A script can't contain "</script" or the browser would end it early.
const safe = code => code.replace(/<\/script/gi, "<\\/script");

let html = read("index.html");
let styles = 0, scripts = 0;
html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, file) => { styles++; return `<style>\n${read(file)}\n</style>`; });
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, file) => { scripts++; return `<script>\n${safe(read(file))}\n</script>`; });
// A file opened from disk can't be installed as an app, so the manifest and home-screen icon go;
// the tab icon is kept, inlined.
html = html.replace(/\s*<link rel="(manifest|apple-touch-icon)" href="[^"]+">/g, "");
html = html.replace(/<link rel="icon" type="image\/png" href="(icons\/[^"]+)">/g, (_, file) =>
  `<link rel="icon" type="image/png" href="data:image/png;base64,${fs.readFileSync(path.join(root, file)).toString("base64")}">`);

const left = html.match(/(src|href)="(js|css|icons)\/|manifest\.webmanifest/g);
if (left) throw new Error("Some local files weren't inlined: " + left.join(", "));

fs.mkdirSync(path.join(root, "share"), { recursive: true });
const out = path.join(root, "share", "World-Dominion.html");
fs.writeFileSync(out, html);
console.log(`Wrote ${out}: ${styles} stylesheet, ${scripts} scripts, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
