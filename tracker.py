import csv
import json
import os
import time
import urllib.parse
import urllib.request

API_KEY = os.environ.get("APEX_API_KEY", "").strip()
API_URL = "https://api.mozambiquehe.re/bridge"
PLAYERS_FILE = "players.json"
CSV_FILE = "changes.csv"
DATA_FILE = "data.json"

def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)

def get_metrics(data):
    m = {}
    g = data.get("global") or {}
    if is_num(g.get("level")):
        m["level"] = float(g["level"])
    rank = g.get("rank") or {}
    if is_num(rank.get("rankScore")):
        m["rank_score"] = float(rank["rankScore"])

    total = data.get("total") or {}
    for k, v in total.items():
        if isinstance(v, dict) and is_num(v.get("value")):
            m[f"total.{k}"] = float(v["value"])

    legends = (data.get("legends") or {}).get("all") or {}
    for leg_name, leg_obj in legends.items():
        if not isinstance(leg_obj, dict):
            continue
        for d in leg_obj.get("data") or []:
            if isinstance(d, dict) and is_num(d.get("value")):
                k = d.get("key") or d.get("name")
                if k:
                    m[f"legend.{leg_name}.{k}"] = float(d["value"])
    return m

def main():
    if not API_KEY:
        raise RuntimeError("APEX_API_KEY non configurata nei GitHub Secrets.")

    with open(PLAYERS_FILE, "r", encoding="utf-8") as f:
        players = json.load(f)

    latest = {}
    changes = []
    if os.path.exists(CSV_FILE):
        with open(CSV_FILE, "r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for r in reader:
                ts = int(r["ts"])
                uid = r["uid"]
                key = r["key"]
                old = float(r["old"]) if r["old"] != "" else None
                new = float(r["new"])
                changes.append([ts, uid, key, old, new])
                latest[f"{uid}|{key}"] = new

    status = {}
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                status = json.load(f).get("status", {})
        except Exception:
            status = {}

    new_rows = []
    for p in players:
        uid = str(p["uid"]).strip()
        plat = str(p.get("platform", "PC")).upper()
        st = status.get(uid, {
            "uid": uid, "platform": plat, "name": None,
            "level": None, "rank": None, "rank_div": None,
            "last_ok": None, "last_error": None
        })
        st["platform"] = plat

        try:
            id_param = "uid" if uid.isdigit() else "player"
            params = urllib.parse.urlencode({
                "auth": API_KEY,
                id_param: uid,
                "platform": plat
            })
            req = urllib.request.Request(
                f"{API_URL}?{params}",
                headers={"User-Agent": "ApexCloudTracker/1.0"}
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            if "Error" in data:
                raise RuntimeError(data["Error"])

            g = data.get("global") or {}
            st["name"] = g.get("name") or st.get("name")
            st["level"] = g.get("level")
            rank = g.get("rank") or {}
            st["rank"] = rank.get("rankName")
            st["rank_div"] = rank.get("rankDiv")

            now = int(time.time())
            st["last_ok"] = now
            st["last_error"] = None

            metrics = get_metrics(data)
            for k, v in metrics.items():
                ident = f"{uid}|{k}"
                has = ident in latest
                if not has or latest[ident] != v:
                    old = latest[ident] if has else None
                    latest[ident] = v
                    changes.append([now, uid, k, old, v])
                    new_rows.append({
                        "ts": now,
                        "uid": uid,
                        "key": k,
                        "old": "" if old is None else f"{old:g}",
                        "new": f"{v:g}"
                    })
            print(f"{st['name'] or uid}: OK")
        except Exception as e:
            st["last_error"] = str(e)
            print(f"{uid}: ERRORE - {e}")

        status[uid] = st
        time.sleep(2)

    if new_rows:
        file_exists = os.path.exists(CSV_FILE)
        with open(CSV_FILE, "a", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["ts", "uid", "key", "old", "new"])
            if not file_exists:
                writer.writeheader()
            writer.writerows(new_rows)

    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump({"status": status, "changes": changes}, f, separators=(",", ":"))

if __name__ == "__main__":
    main()
