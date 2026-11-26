#!/usr/bin/env python3
"""Props de jugadores de NFL: elige las mejores, las fija el día del partido y las califica.

Uso: python3 tools/props.py DAYS_DIR
Recorre los archivos de DAYS_DIR (uno por día, hora de Ciudad de México) y, para los
partidos de NFL:
  - Compara cada línea de DraftKings (yardas por pase, por tierra, por recepción y
    recepciones) con el promedio de la temporada del jugador y elige las que más se
    alejan hacia arriba ("Más de").
  - Las fija a partir de las 5:30 a.m. del día del partido (antes son provisionales).
  - Al terminar cada partido, las califica con la hoja de estadísticas de ESPN.
Guarda el resultado en el campo "props" de cada día.
"""
import json, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Mexico_City")
CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl"
SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
# tipo de ESPN -> (categoría de estadística, clave, texto, línea mínima)
TYPES = {
    "Total Passing Yards (incl. overtime)": ("passing", "passingYards", "yardas por pase", 150),
    "Total Rushing Yards (incl. overtime)": ("rushing", "rushingYards", "yardas por tierra", 25),
    "Total Receiving Yards (incl. overtime)": ("receiving", "receivingYards", "yardas por recepción", 25),
    "Total Receptions (incl. overtime)": ("receiving", "receptions", "recepciones", 3.5),
}
MIN_EDGE, MAX_EDGE = 0.15, 0.60   # más de 60 % suele ser un cambio de rol, no una ventaja
PER_GAME, PER_DAY = 3, 8
BAD_STATUS = {"out", "questionable", "doubtful", "injured reserve", "suspension", "day-to-day"}


def get(url):
    url = url.replace("http://", "https://")
    req = urllib.request.Request(url, headers={"User-Agent": "parley-page"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def injured():
    out = set()
    try:
        for t in get(f"{SITE}/injuries").get("injuries", []):
            for i in t.get("injuries", []):
                if str(i.get("status", "")).lower() in BAD_STATUS:
                    out.add(str(i.get("athlete", {}).get("id") or ""))
                    out.add(i.get("athlete", {}).get("displayName", ""))
    except Exception as e:  # noqa
        print("aviso: sin reporte de lesiones:", e)
    return out


def athlete(aid, season):
    a = get(f"{CORE}/seasons/{season}/athletes/{aid}?lang=en&region=us")
    st, gp = {}, None
    try:
        s = get(f"{CORE}/seasons/{season}/types/2/athletes/{aid}/statistics?lang=en&region=us")
        for c in s.get("splits", {}).get("categories", []):
            for x in c.get("stats", []):
                st[(c["name"], x["name"])] = x.get("value")
                if x["name"] == "gamesPlayed" and x.get("value"):
                    gp = x["value"]
    except Exception:  # noqa
        pass
    return {"id": aid, "name": a.get("displayName"), "pos": (a.get("position") or {}).get("abbreviation"), "gp": gp, "st": st}


def pick_props(game, season, hurt):
    gid = game["id"]
    raw = []
    for page in range(1, 6):
        try:
            d = get(f"{CORE}/events/{gid}/competitions/{gid}/odds/100/propBets?lang=en&region=us&limit=1000&page={page}")
        except Exception:  # noqa
            break
        for i in d.get("items", []):
            t = i.get("type", {}).get("name")
            tgt = (i.get("current") or {}).get("target")
            if t in TYPES and "athlete" in i and tgt:
                m = re.search(r"athletes/(\d+)", i["athlete"]["$ref"])
                if m:
                    raw.append((t, m.group(1), float(tgt["value"])))
        if page >= d.get("pageCount", 1):
            break
    raw = sorted(set(raw))
    ids = sorted({r[1] for r in raw} - hurt)
    with ThreadPoolExecutor(8) as ex:
        A = {a["id"]: a for a in ex.map(lambda x: athlete(x, season), ids)}
    match = f'{game["away"]["ab"]} @ {game["home"]["ab"]}'
    picks = []
    for t, aid, line in raw:
        a = A.get(aid)
        if not a or a["name"] in hurt or not a["gp"] or a["gp"] < 5:
            continue
        cat, key, txt, minline = TYPES[t]
        tot = a["st"].get((cat, key))
        if tot is None or line < minline:
            continue
        avg = tot / a["gp"]
        edge = (avg - line) / line
        if MIN_EDGE <= edge <= MAX_EDGE:
            picks.append({"gid": gid, "match": match, "start": game["date"], "aid": aid, "player": a["name"],
                          "pos": a["pos"], "cat": cat, "key": key, "side": "O", "line": line,
                          "label": f'{a["name"]} más de {line:g} {txt}', "avg": round(avg, 1),
                          "gp": int(a["gp"]), "edge": round(edge, 3)})
    picks.sort(key=lambda p: -p["edge"])
    seen, best = set(), []
    for p in picks:  # una apuesta por jugador
        if p["aid"] not in seen:
            seen.add(p["aid"]); best.append(p)
    return best[:PER_GAME]


def grade(picks, games_by_id):
    """Califica las props de partidos terminados con la hoja de estadísticas de ESPN."""
    now = datetime.now(timezone.utc)
    need = set()
    for p in picks:
        g = games_by_id.get(p["gid"], {})
        started = datetime.fromisoformat(p["start"].replace("Z", "+00:00"))
        if "result" not in p and (g.get("state") == "post" or (now - started).total_seconds() > 3 * 3600):
            need.add(p["gid"])
    for gid in need:
        try:
            summ = get(f"{SITE}/summary?event={gid}")
        except Exception as e:  # noqa
            print("aviso: sin estadísticas de", gid, e)
            continue
        st = (((summ.get("header") or {}).get("competitions") or [{}])[0].get("status") or {}).get("type") or {}
        if not st.get("completed"):
            continue
        box = summ.get("boxscore", {})
        vals = {}
        for team in box.get("players", []):
            for s in team.get("statistics", []):
                keys = s.get("keys", [])
                for a in s.get("athletes", []):
                    for k, v in zip(keys, a.get("stats", [])):
                        try:
                            vals[(str(a["athlete"]["id"]), s["name"], k)] = float(v)
                        except (TypeError, ValueError):
                            pass
        for p in picks:
            if p["gid"] != gid or "result" in p:
                continue
            v = vals.get((p["aid"], p["cat"], p["key"]), 0.0)  # no aparece = no registró esa estadística
            p["value"] = v
            p["result"] = "win" if v > p["line"] else "loss"


def main():
    days_dir = sys.argv[1]
    now = datetime.now(TZ)
    today = now.date().isoformat()
    lock_open = now.hour * 60 + now.minute >= 5 * 60 + 30
    hurt = None
    for f in sorted(os.listdir(days_dir)):
        if not f.endswith(".json"):
            continue
        path = os.path.join(days_dir, f)
        doc = json.load(open(path))
        day = doc["date"]
        nfl = [g for g in doc.get("games", []) if g.get("lg") == "nfl"]
        if not nfl:
            continue
        props = doc.get("props") or {}
        by_id = {g["id"]: g for g in doc["games"]}
        if not props.get("locked") and day >= today:
            if hurt is None:
                hurt = injured()
            y = int(day[:4]); season = y if int(day[5:7]) >= 8 else y - 1
            picks = []
            for g in nfl:
                if g["state"] != "pre":
                    # partido ya empezado: conserva lo que se había elegido
                    picks += [p for p in props.get("picks", []) if p["gid"] == g["id"]]
                    continue
                try:
                    picks += pick_props(g, season, hurt)
                except Exception as e:  # noqa
                    print("aviso: sin props de", g["id"], e)
            picks.sort(key=lambda p: -p["edge"])
            props = {"picks": picks[:PER_DAY], "locked": day < today or (day == today and lock_open),
                     "computedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "odds": 1.87}
        if props.get("picks"):
            grade(props["picks"], by_id)
            doc["props"] = props
            json.dump(doc, open(path, "w"), separators=(",", ":"))
            res = [p.get("result", "pend") for p in props["picks"]]
            print(day, "props", "fijas" if props["locked"] else "provisionales", len(props["picks"]), res)


if __name__ == "__main__":
    main()
