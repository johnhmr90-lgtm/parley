// Arma la página con los datos incrustados (funciona sin cuenta de Claude).
// Uso: node build.js PAGE_TEMPLATE MODEL_JS OUT_HTML DAYS_DIR [DAYS_DIR...]  (los últimos directorios mandan)
const fs = require("fs"), path = require("path");
const [tpl, model, outFile, ...dirs] = process.argv.slice(2);
const readJson = (p) => { try { const j = JSON.parse(fs.readFileSync(p, "utf8")); return j.data && j.data.games ? j.data : j; } catch { return null; } };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
const cutoff = new Date(Date.parse(today + "T12:00:00Z") - 3 * 864e5).toISOString().slice(0, 10);
const oldest = new Date(Date.parse(today + "T12:00:00Z") - 180 * 864e5).toISOString().slice(0, 10);
const days = {};
for (const d of dirs) if (fs.existsSync(d)) for (const f of fs.readdirSync(d).filter((f) => f.endsWith(".json"))) {
  const j = readJson(path.join(d, f)); if (j && j.date) days[j.date] = j;
}
for (const k of Object.keys(days)) {
  const d = days[k];
  if (k < oldest || !/^202[56]-/.test(k)) { delete days[k]; continue; }
  if (k < cutoff) { // días viejos: solo los partidos del parley, para el historial
    const ids = new Set([...(d.parlay?.safe?.legs || []), ...(d.parlay?.value?.legs || [])].map((l) => l.gid));
    days[k] = { date: d.date, updated: d.updated, parlay: d.parlay, props: d.props, games: (d.games || []).filter((g) => ids.has(g.id)) };
  }
}
const data = JSON.stringify({ built: new Date().toISOString(), days }).replace(/</g, "\\u003c");
let html = fs.readFileSync(tpl, "utf8");
html = html.replace("/*DATA*/", () => data).replace("/*MODEL*/", () => fs.readFileSync(model, "utf8"));
if (process.env.STANDALONE) html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style></head><body>' + html + "</body></html>";
fs.writeFileSync(outFile, html);
console.log("página:", outFile, Object.keys(days).length, "días,", (html.length / 1024).toFixed(0), "KB");
