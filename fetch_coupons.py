"""Ближайшие купонные выплаты по бумагам портфеля (MOEX bondization).

Список бумаг берётся из broker-meta.json (создаётся sync_broker.py), иначе — default.
"""
import json
import os
import ssl
import time
import urllib.request
from datetime import date, timedelta

CTX = ssl._create_unverified_context()
TODAY = date.today()

_DEFAULT = [
    "SU26228RMFS5", "SU26232RMFS7", "SU26235RMFS0", "SU26239RMFS2",
    "SU26244RMFS2", "SU26247RMFS5", "SU26252RMFS5", "SU26253RMFS3",
    "RU000A10CSQ2", "RU000A10EJQ7",
]

_meta_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "broker-meta.json")
if os.path.isfile(_meta_path):
    with open(_meta_path, encoding="utf-8") as _f:
        SECIDS = json.load(_f).get("secids") or _DEFAULT
    print(f"secids из broker-meta.json: {len(SECIDS)}")
else:
    SECIDS = _DEFAULT


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


out = {}
for sec in SECIDS:
    d = get_json(f"https://iss.moex.com/iss/securities/{sec}/bondization.json?iss.meta=off")
    coupons = d.get("coupons", {}).get("data", [])
    # upcoming: дата выплаты >= сегодня
    upcoming = [c for c in coupons if date.fromisoformat(c[3]) >= TODAY]
    if not upcoming:
        out[sec] = None
        print(f"{sec}: выплат не ожидается")
        continue
    nxt = upcoming[0]
    next_date = date.fromisoformat(nxt[3])
    next_value = float(nxt[9])  # value, ₽ на одну бумагу
    year_ahead = [c for c in upcoming if date.fromisoformat(c[3]) <= next_date + timedelta(days=366)]
    out[sec] = {
        "nextDate": nxt[3],
        "nextValueRub": round(next_value, 2),
        "perYear": len(year_ahead),
    }
    print(f"{sec}: ближайшая {nxt[3]} — {next_value} ₽, выплат в год: {len(year_ahead)}")
    time.sleep(0.2)

with open("invest-app/src/data/coupons.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print("saved -> invest-app/src/data/coupons.json")
