/* Modelo de pronósticos y parleys. Funciona en navegador (window.SportsModel) y en Node (module.exports). */
(function (root) {
  const LEAGUES = {
    nhl:        { name: "NHL",            sport: "hockey",     path: "hockey/nhl",            adv: 0.03, unit: "goles" },
    nba:        { name: "NBA",            sport: "basketball", path: "basketball/nba",        adv: 0.05, unit: "puntos" },
    nfl:        { name: "NFL",            sport: "football",   path: "football/nfl",          adv: 0.03, unit: "puntos" },
    ligamx:     { name: "Liga MX",        sport: "soccer",     path: "soccer/mex.1",          adv: 0.07, unit: "goles" },
    premier:    { name: "Premier League", sport: "soccer",     path: "soccer/eng.1",          adv: 0.05, unit: "goles" },
    champions:  { name: "Champions",      sport: "soccer",     path: "soccer/uefa.champions", adv: 0.05, unit: "goles" },
    laliga:     { name: "LaLiga",         sport: "soccer",     path: "soccer/esp.1",          adv: 0.05, unit: "goles" },
    seriea:     { name: "Serie A",        sport: "soccer",     path: "soccer/ita.1",          adv: 0.05, unit: "goles" },
    bundesliga: { name: "Bundesliga",     sport: "soccer",     path: "soccer/ger.1",          adv: 0.05, unit: "goles" },
  };

  const dec = (a) => (a == null ? null : a > 0 ? 1 + a / 100 : 1 + 100 / -a);
  const r2 = (x) => Math.round(x * 100) / 100;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const toAmerican = (d) => (d >= 2 ? "+" + Math.round((d - 1) * 100) : "-" + Math.round(100 / (d - 1)));
  const fmtLine = (x) => (x > 0 ? "+" + x : String(x));

  function strength(rec, soccer) {
    if (!rec) return null;
    const n = rec.split("-").map(Number);
    if (n.some(isNaN)) return null;
    const games = n.reduce((a, b) => a + b, 0);
    if (games < 3) return null;
    if (soccer && n.length === 3) return (3 * n[0] + n[1]) / (3 * games); // G-E-P
    return n[0] / games; // G-P o G-P-OT
  }

  function predict(g) {
    const L = LEAGUES[g.lg] || { sport: "", adv: 0.04, unit: "puntos" };
    const soccer = L.sport === "soccer";
    const o = g.odds || {};
    // Probabilidad del mercado sin margen de la casa
    let market = null;
    if (o.mlH != null && o.mlA != null) {
      const h = 1 / dec(o.mlH), a = 1 / dec(o.mlA), d = o.mlD != null ? 1 / dec(o.mlD) : 0;
      const s = h + a + d;
      market = { H: h / s, A: a / s, D: d / s };
    }
    // Probabilidad por récord de la temporada + localía
    const sh = strength(g.home.rec, soccer), sa = strength(g.away.rec, soccer);
    let rec = null;
    if (sh != null && sa != null) {
      const diff = sh - sa + L.adv;
      if (soccer) {
        const D = 0.26, h = clamp(0.5 + diff * 0.9, 0.08, 0.92);
        rec = { H: (1 - D) * h, A: (1 - D) * (1 - h), D };
      } else {
        const h = clamp(0.5 + diff * 0.9, 0.08, 0.92);
        rec = { H: h, A: 1 - h, D: 0 };
      }
    }
    let probs, source;
    if (market && rec) {
      probs = { H: 0.85 * market.H + 0.15 * rec.H, A: 0.85 * market.A + 0.15 * rec.A, D: 0.85 * market.D + 0.15 * rec.D };
      source = "momios + récord";
    } else if (market) { probs = market; source = "momios"; }
    else if (rec) { probs = rec; source = "récord"; }
    else { probs = { H: 0.5 + L.adv, A: 0.5 - L.adv, D: 0 }; source = "localía"; }
    if (!soccer) { const s = probs.H + probs.A; probs = { H: probs.H / s, A: probs.A / s, D: 0 }; }

    const pick = probs.D > probs.H && probs.D > probs.A ? "D" : probs.H >= probs.A ? "H" : "A";
    const match = `${g.away.ab} @ ${g.home.ab}`;
    const base = { gid: g.id, lg: g.lg, match, start: g.date };
    const legs = [];
    const tilt = market ? probs.H - market.H : 0;
    if (o.mlH != null) legs.push({ ...base, type: "ml", side: "H", label: `Gana ${g.home.n}`, dec: r2(dec(o.mlH)), p: probs.H });
    if (o.mlA != null) legs.push({ ...base, type: "ml", side: "A", label: `Gana ${g.away.n}`, dec: r2(dec(o.mlA)), p: probs.A });
    if (o.spH != null && o.spHo != null && o.spAo != null && o.spH !== 0) {
      const h = 1 / dec(o.spHo), a = 1 / dec(o.spAo), q = h / (h + a);
      legs.push({ ...base, type: "sp", side: "H", line: o.spH, label: `${g.home.n} ${fmtLine(o.spH)}`, dec: r2(dec(o.spHo)), p: clamp(q + tilt * 0.5, 0.02, 0.98) });
      legs.push({ ...base, type: "sp", side: "A", line: -o.spH, label: `${g.away.n} ${fmtLine(-o.spH)}`, dec: r2(dec(o.spAo)), p: clamp(1 - q - tilt * 0.5, 0.02, 0.98) });
    }
    if (o.ou != null && o.ovO != null && o.unO != null) {
      const ov = 1 / dec(o.ovO), un = 1 / dec(o.unO), q = ov / (ov + un);
      legs.push({ ...base, type: "tot", side: "O", line: o.ou, label: `Más de ${o.ou} ${L.unit} (${match})`, dec: r2(dec(o.ovO)), p: q });
      legs.push({ ...base, type: "tot", side: "U", line: o.ou, label: `Menos de ${o.ou} ${L.unit} (${match})`, dec: r2(dec(o.unO)), p: 1 - q });
    }
    legs.forEach((l) => { l.p = r2(l.p * 100) / 100; l.ev = r2(l.p * l.dec - 1); });
    return { probs, pick, conf: Math.max(probs.H, probs.A, probs.D), source, legs, hasOdds: !!market };
  }

  // Elige parleys: "seguro" (2 selecciones, máxima probabilidad con momio >= 1.70)
  // y "valor" (3 selecciones, momio >= 2.50). Una selección por partido.
  function buildParlays(games, minOdds = 1.7) {
    const cands = [];
    for (const g of games) {
      for (const l of predict(g).legs) if (l.dec >= 1.15 && l.dec <= 2.6 && l.p >= 0.5 && l.ev >= -0.06) cands.push(l);
    }
    cands.sort((a, b) => b.p - a.p || b.ev - a.ev);
    const top = cands.slice(0, 40);
    const score = (legs) => ({ legs, dec: r2(legs.reduce((x, l) => x * l.dec, 1)), p: legs.reduce((x, l) => x * l.p, 1) });
    const better = (a, b) => !b || a.p > b.p + 1e-9 || (Math.abs(a.p - b.p) < 1e-9 && a.dec > b.dec);
    let safe = null, value = null;
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
      if (top[i].gid === top[j].gid) continue;
      const c = score([top[i], top[j]]);
      if (c.dec >= minOdds && better(c, safe)) safe = c;
    }
    const t = top.slice(0, 25);
    for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) for (let k = j + 1; k < t.length; k++) {
      const ids = new Set([t[i].gid, t[j].gid, t[k].gid]);
      if (ids.size < 3) continue;
      const c = score([t[i], t[j], t[k]]);
      if (c.dec >= 2.5 && better(c, value)) value = c;
    }
    if (!safe && value && value.dec >= minOdds) { safe = value; value = null; }
    const pack = (c) => c && { legs: c.legs, dec: c.dec, p: r2(c.p * 1000) / 1000 };
    return { safe: pack(safe), value: pack(value), candidates: cands.length };
  }

  function evalLeg(l, g) {
    if (!g) return "pending";
    if (g.state === "pre") return "pending";
    const h = +g.home.score, a = +g.away.score;
    const live = g.state !== "post";
    let r;
    if (l.type === "ml") r = l.side === "H" ? (h > a ? "win" : "loss") : (a > h ? "win" : "loss");
    else if (l.type === "sp") { const m = l.side === "H" ? h + l.line - a : a + l.line - h; r = m > 0 ? "win" : m < 0 ? "loss" : "push"; }
    else { const t = h + a; r = t === l.line ? "push" : (t > l.line) === (l.side === "O") ? "win" : "loss"; }
    return live ? "live-" + r : r;
  }

  function evalParlay(parlay, gamesById) {
    const res = parlay.legs.map((l) => evalLeg(l, gamesById[l.gid]));
    if (res.includes("loss")) return { res, overall: "loss" };
    if (res.every((x) => x === "win" || x === "push")) return { res, overall: "win" };
    return { res, overall: res.some((x) => x.startsWith("live")) ? "live" : "pending" };
  }

  const api = { LEAGUES, dec, toAmerican, predict, buildParlays, evalLeg, evalParlay, r2 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SportsModel = api;
})(typeof window !== "undefined" ? window : globalThis);
