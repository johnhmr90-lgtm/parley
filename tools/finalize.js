// Une los datos nuevos con los guardados (conserva momios que ESPN borra al terminar el partido)
// y calcula/congela el parley del día.
// Uso: node finalize.js FRESH_DAYS_DIR PREV_DAYS_DIR OUT_DAYS_DIR
const fs = require("fs"), path = require("path");
const M = require(path.join(__dirname, "model.js"));
const [fresh, prev, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
// El parley del día se fija a partir de las 5:30 a.m. (hora CDMX), con los momios de la mañana
const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":").map(Number);
const lockOpen = hm[0] * 60 + hm[1] >= 5 * 60 + 30;
const readJson = (p) => { try { const j = JSON.parse(fs.readFileSync(p, "utf8")); return j.data && j.data.games ? j.data : j; } catch { return null; } };

for (const f of fs.readdirSync(fresh).filter((f) => f.endsWith(".json")).sort()) {
  const cur = readJson(path.join(fresh, f));
  const old = readJson(path.join(prev, f));
  const oldById = Object.fromEntries((old?.games || []).map((g) => [g.id, g]));
  const games = cur.games.map((g) => {
    const o = oldById[g.id];
    if (o && o.odds && (!g.odds || g.state !== "pre")) g.odds = o.odds; // momios congelados al inicio
    delete oldById[g.id];
    return g;
  });
  // Partidos guardados que ESPN ya no devuelve (raro): se conservan
  games.push(...Object.values(oldById));
  games.sort((a, b) => a.date.localeCompare(b.date));

  let parlay = old?.parlay || null;
  const day = cur.date;
  if (!parlay || !parlay.locked) {
    const pool = day >= today ? games.filter((g) => g.state === "pre") : games;
    const p = M.buildParlays(pool);
    parlay = { ...p, locked: day < today || (day === today && lockOpen), computedAt: cur.updated, pool: pool.length };
    delete parlay.candidates;
  }
  const doc = { date: day, updated: cur.updated, games, parlay };
  fs.writeFileSync(path.join(out, f), JSON.stringify(doc));
  const s = parlay.safe;
  console.log(day, games.length, "partidos |", s ? `parley ${s.dec} p=${s.p} ${parlay.locked ? "(fijo)" : "(provisional)"}: ` + s.legs.map((l) => l.label + " " + l.dec).join(" + ") : "sin parley");
}
