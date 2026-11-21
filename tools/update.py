#!/usr/bin/env python3
"""Descarga marcadores y momios de ESPN para las 9 ligas y escribe un JSON por día
(zona horaria America/Mexico_City) en OUT_DIR/days/<YYYY-MM-DD>.json.
Uso: python3 -I update.py OUT_DIR [dias_atras] [dias_adelante]
Solo guarda fechas de 2025 y 2026."""
import json, os, sys, urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Mexico_City")
LEAGUES = {
    "nhl": "hockey/nhl", "nba": "basketball/nba", "nfl": "football/nfl",
    "ligamx": "soccer/mex.1", "premier": "soccer/eng.1", "champions": "soccer/uefa.champions",
    "laliga": "soccer/esp.1", "seriea": "soccer/ita.1", "bundesliga": "soccer/ger.1",
}

def ml(v):
    if v is None: return None
    try:
        s = str(v).replace("+", "").strip()
        if s.upper() in ("EVEN", "EV"): return 100
        return int(float(s))
    except ValueError:
        return None

def g(d, *path):
    for p in path:
        if not isinstance(d, dict): return None
        d = d.get(p)
    return d

def norm_odds(c):
    o = (c.get("odds") or [None])[0]
    if not o: return None
    out = {"prov": g(o, "provider", "name")}
    out["mlH"] = ml(g(o, "moneyline", "home", "close", "odds")) or ml(g(o, "homeTeamOdds", "moneyLine"))
    out["mlA"] = ml(g(o, "moneyline", "away", "close", "odds")) or ml(g(o, "awayTeamOdds", "moneyLine"))
    out["mlD"] = ml(g(o, "moneyline", "draw", "close", "odds")) or ml(g(o, "drawOdds", "moneyLine"))
    try: out["spH"] = float(g(o, "pointSpread", "home", "close", "line"))
    except (TypeError, ValueError): out["spH"] = o.get("spread")
    out["spHo"] = ml(g(o, "pointSpread", "home", "close", "odds"))
    out["spAo"] = ml(g(o, "pointSpread", "away", "close", "odds"))
    out["ou"] = o.get("overUnder")
    out["ovO"] = ml(g(o, "total", "over", "close", "odds"))
    out["unO"] = ml(g(o, "total", "under", "close", "odds"))
    return {k: v for k, v in out.items() if v is not None}

def norm_team(t):
    rec = next((r.get("summary") for r in t.get("records") or [] if r.get("type") == "total"), None)
    return {"n": g(t, "team", "displayName"), "ab": g(t, "team", "abbreviation"),
            "logo": g(t, "team", "logo"), "score": t.get("score"), "rec": rec, "form": t.get("form")}

def norm_event(lg, e):
    c = e["competitions"][0]
    teams = {t["homeAway"]: t for t in c["competitors"]}
    st = e["status"]["type"]
    out = {"id": e["id"], "lg": lg, "date": e["date"], "state": st.get("state"),
           "detail": st.get("shortDetail") or st.get("detail"),
           "home": norm_team(teams["home"]), "away": norm_team(teams["away"])}
    od = norm_odds(c)
    if od: out["odds"] = od
    return out

def fetch(path, day):
    url = f"https://site.api.espn.com/apis/site/v2/sports/{path}/scoreboard?dates={day}&limit=300"
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)

def main():
    out_dir = sys.argv[1]
    back = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    fwd = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    today = datetime.now(TZ).date()
    start, end = today - timedelta(days=back), today + timedelta(days=fwd)
    # ESPN agrupa por día de EE.UU.; pedimos un día extra por cada lado.
    qdays = [(start + timedelta(days=i)).strftime("%Y%m%d") for i in range(-1, (end - start).days + 2)]
    days = {}
    errors = []
    for lg, path in LEAGUES.items():
        events = {}
        for qd in qdays:
            try:
                for e in fetch(path, qd).get("events", []): events[e["id"]] = e
            except Exception as ex:  # noqa
                errors.append(f"{lg} {qd}: {ex}")
        for e in events.values():
            local = datetime.fromisoformat(e["date"].replace("Z", "+00:00")).astimezone(TZ).date()
            if not (start <= local <= end) or local.year not in (2025, 2026): continue
            days.setdefault(local.isoformat(), []).append(norm_event(lg, e))
    os.makedirs(os.path.join(out_dir, "days"), exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    d = start
    while d <= end:
        if d.year in (2025, 2026):
            k = d.isoformat()
            games = sorted(days.get(k, []), key=lambda x: x["date"])
            with open(os.path.join(out_dir, "days", k + ".json"), "w") as f:
                json.dump({"date": k, "updated": stamp, "games": games}, f, separators=(",", ":"))
            print(k, len(games), "partidos")
        d += timedelta(days=1)
    for e in errors: print("ERROR", e)

if __name__ == "__main__":
    main()
