import csv
import json
import os
import time
import urllib.parse
import urllib.request

API_KEY = os.environ.get("APEX_API_KEY", "").strip()
API_URL = "https://api.mozambiquehe.re/bridge"
MAP_URL = "https://api.mozambiquehe.re/maprotation"
PLAYERS_FILE = "players.json"
CSV_FILE = "changes.csv"
DATA_FILE = "data.json"

def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)

def fmt_num(v):
    return f"{int(round(v))}" if float(v).is_integer() else f"{v:.2f}"

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

def fetch_map_rotation():
    try:
        params = urllib.parse.urlencode({"auth": API_KEY, "version": "2"})
        req = urllib.request.Request(
            f"{MAP_URL}?{params}",
            headers={"User-Agent": "ApexCloudTracker/1.2"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
        ranked = (raw.get("ranked") or {})
        pubs = (raw.get("battle_royale") or {})
        cur_r = ranked.get("current") or {}
        nxt_r = ranked.get("next") or {}
        cur_p = pubs.get("current") or {}
        return {
            "ranked_current": cur_r.get("map"),
            "ranked_end": cur_r.get("end"),
            "ranked_next": nxt_r.get("map"),
            "pubs_current": cur_p.get("map"),
            "pubs_end": cur_p.get("end")
        }
    except Exception as e:
        print(f"Map rotation errore: {e}")
        return None

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
                if key == "selected_legend":
                    old = r["old"] if r["old"] != "" else None
                    new = r["new"]
                    if old is not None and old == new:
                        latest[f"{uid}|{key}"] = new
                        continue
                    changes.append([ts, uid, key, old, new])
                    latest[f"{uid}|{key}"] = new
                else:
                    old = float(r["old"]) if r["old"] != "" else None
                    new = float(r["new"])
                    if old is not None and round(old, 2) == round(new, 2):
                        latest[f"{uid}|{key}"] = new
                        continue
                    changes.append([ts, uid, key, old, new])
                    latest[f"{uid}|{key}"] = new

    status = {}
    prev_maps = None
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                old_data = json.load(f)
                status = old_data.get("status", {})
                prev_maps = old_data.get("maps")
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
        prev_status_legend = st.get("selected_legend")

        try:
            id_param = "uid" if uid.isdigit() else "player"
            params = urllib.parse.urlencode({
                "auth": API_KEY,
                id_param: uid,
                "platform": plat
            })
            req = urllib.request.Request(
                f"{API_URL}?{params}",
                headers={"User-Agent": "ApexCloudTracker/1.2"}
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            if "Error" in data:
                raise RuntimeError(data["Error"])

            g = data.get("global") or {}
            st["name"] = g.get("name") or st.get("name")
            st["level"] = g.get("level")
            st["next_level_pct"] = g.get("toNextLevelPercent")

            rank = g.get("rank") or {}
            st["rank"] = rank.get("rankName")
            st["rank_div"] = rank.get("rankDiv")
            st["rank_img"] = rank.get("rankImg")

            rt = data.get("realtime") or {}
            st["is_online"] = bool(rt.get("isOnline"))
            st["is_in_game"] = bool(rt.get("isInGame"))
            st["lobby_state"] = rt.get("lobbyState")
            st["state_text"] = rt.get("currentStateAsText")
            new_legend = rt.get("selectedLegend")
            st["selected_legend"] = new_legend

            now = int(time.time())
            st["last_ok"] = now
            st["last_error"] = None

            player_rows = 0

            # Registra nello storico ogni cambio di leggenda attiva
            if isinstance(new_legend, str) and new_legend.strip():
                new_legend = new_legend.strip()
                leg_ident = f"{uid}|selected_legend"
                has_leg = leg_ident in latest
                old_leg = latest[leg_ident] if has_leg else prev_status_legend

                if not has_leg or old_leg != new_legend:
                    latest[leg_ident] = new_legend
                    changes.append([now, uid, "selected_legend", old_leg, new_legend])
                    new_rows.append({
                        "ts": now,
                        "uid": uid,
                        "key": "selected_legend",
                        "old": "" if not old_leg else old_leg,
                        "new": new_legend
                    })
                    player_rows += 1

            metrics = get_metrics(data)
            for k, v in metrics.items():
                ident = f"{uid}|{k}"
                has = ident in latest
                old = latest[ident] if has else None

                if has and round(old, 2) == round(v, 2):
                    continue
                if has and k != "rank_score" and v < old:
                    continue

                latest[ident] = v
                changes.append([now, uid, k, old, v])
                new_rows.append({
                    "ts": now,
                    "uid": uid,
                    "key": k,
                    "old": "" if old is None else fmt_num(old),
                    "new": fmt_num(v)
                })
                player_rows += 1
            print(f"{st['name'] or uid}: OK ({player_rows} variazioni)")
        except Exception as e:
            st["last_error"] = str(e)
            print(f"{uid}: ERRORE - {e}")

        status[uid] = st
        time.sleep(2)

    maps = fetch_map_rotation() or prev_maps

    if new_rows:
        file_exists = os.path.exists(CSV_FILE)
        with open(CSV_FILE, "a", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["ts", "uid", "key", "old", "new"])
            if not file_exists:
                writer.writeheader()
            writer.writerows(new_rows)

    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump({"status": status, "changes": changes, "maps": maps}, f, separators=(",", ":"))

if __name__ == "__main__":
    main()
