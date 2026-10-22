"""Скачивает годовую дневную историю цен облигаций с MOEX ISS (открытый API).

Список бумаг берётся из broker-meta.json (создаётся sync_broker.py после
синхронизации с брокером), иначе — из значения по умолчанию ниже.
"""
import json
import os
import ssl
import time
import urllib.request

CTX = ssl._create_unverified_context()

DEFAULT_SECURITIES = [
    "SU26228RMFS5", "SU26232RMFS7", "SU26235RMFS0", "SU26239RMFS2",
    "SU26244RMFS2", "SU26247RMFS5", "SU26252RMFS5", "SU26253RMFS3",
    "RU000A10CSQ2", "RU000A10EJQ7",
]

_meta_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "broker-meta.json")
if os.path.isfile(_meta_path):
    with open(_meta_path, encoding="utf-8") as _f:
        SECURITIES = json.load(_f).get("secids") or DEFAULT_SECURITIES
    print(f"secids из broker-meta.json: {len(SECURITIES)}")
else:
    SECURITIES = DEFAULT_SECURITIES

FROM, TILL = "2025-10-21", "2026-10-21"


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_history(secid):
    rows, start = [], 0
    while True:
        url = (
            "https://iss.moex.com/iss/history/engines/stock/markets/bonds"
            f"/securities/{secid}.json?from={FROM}&till={TILL}&start={start}"
        )
        data = get_json(url)["history"]
        cols = data["columns"]
        batch = data["data"]
        if not batch:
            break
        rows.extend(dict(zip(cols, r)) for r in batch)
        start += len(batch)
        if len(batch) < 100:
            break
        time.sleep(0.25)
    return rows


def pick(row, *keys):
    for k in keys:
        v = row.get(k)
        if v is not None and v != 0:
            return v
    return None


out = {}
for sec in SECURITIES:
    rows = fetch_history(sec)
    series = []
    last_meta = {}
    for r in rows:
        price = pick(r, "MARKETPRICE3", "WAPRICE", "LEGALCLOSEPRICE", "CLOSE")
        if price is None:
            continue
        # Цены MOEX в % от номинала (номинал 1000 ₽), НКД — в рублях.
        # Приводим к полной цене в рублях: чистая цена + НКД.
        accint = float(r.get("ACCINT") or 0)
        full_rub = round(float(price) * 10 + accint, 2)
        series.append({"date": r["TRADEDATE"], "price": full_rub})
        last_meta = r
    out[sec] = {
        "shortname": last_meta.get("SHORTNAME") or sec,
        "matdate": last_meta.get("MATDATE"),
        "couponpercent": last_meta.get("COUPONPERCENT"),
        "yieldclose": last_meta.get("YIELDCLOSE"),
        "duration": last_meta.get("DURATION"),
        "points": len(series),
        "history": series,
    }
    print(f"{sec}: {len(series)} точек, последняя {series[-1] if series else None}, "
          f"{out[sec]['shortname']}, мат. {out[sec]['matdate']}, купон {out[sec]['couponpercent']}%")
    time.sleep(0.3)

with open("invest-app/src/data/moex-history.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print("saved -> invest-app/src/data/moex-history.json")
