"""Топ-5 бумаг под каждое направление идей (живые данные MOEX)."""
import json
import ssl
import time
import urllib.request
from datetime import date

CTX = ssl._create_unverified_context()


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, context=CTX, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_board(board):
    out, start = [], 0
    seen_secids = set()
    while True:
        d = get_json(
            "https://iss.moex.com/iss/engines/stock/markets/bonds"
            f"/boards/{board}/securities.json?iss.meta=off&start={start}"
        )
        sec_cols = d["securities"]["columns"]
        sec_rows = d["securities"]["data"]
        mkt_cols = d["marketdata"]["columns"]
        mkt_rows = {r[0]: r for r in d["marketdata"]["data"]}
        if not sec_rows:
            break
        batch_secids = {r[0] for r in sec_rows}
        # Если API игнорирует start и возвращает те же бумаги — стоп
        if batch_secids and batch_secids.issubset(seen_secids):
            print(f"  {board}: повтор данных, стоп", flush=True)
            break
        seen_secids |= batch_secids
        for sr in sec_rows:
            s = dict(zip(sec_cols, sr))
            m = dict(zip(mkt_cols, mkt_rows.get(s["SECID"], [])))
            out.append({**s, **{f"m_{k}": v for k, v in m.items()}})
        start += len(sec_rows)
        print(f"  {board}: {start}", flush=True)
        if len(sec_rows) < 100:
            break
        time.sleep(0.1)
    # дедуп по SECID с макс. оборотом
    best = {}
    for r in out:
        cur = best.get(r["SECID"])
        if cur is None or (r.get("m_VALUE") or 0) > (cur.get("m_VALUE") or 0):
            best[r["SECID"]] = r
    return list(best.values())


def norm(r, btype):
    try:
        y = float(r.get("m_YIELD") or 0)
        dur = float(r.get("m_DURATION") or 0)
        price = float(r.get("m_MARKETPRICE") or 0)
        trades = float(r.get("m_NUMTRADES") or 0)
        value = float(r.get("m_VALUE") or 0)
    except (TypeError, ValueError):
        return None
    if trades < 5 or value < 2000 or price < 50 or not r.get("MATDATE"):
        return None
    return {
        "secid": r["SECID"],
        "isin": r.get("ISIN") or r["SECID"],
        "name": r.get("SHORTNAME") or r["SECID"],
        "type": btype,
        "price": round(price, 2),
        "yield": round(y, 2),
        "durationDays": int(dur),
        "matdate": r["MATDATE"],
        "couponPercent": r.get("COUPONPERCENT"),
        "listLevel": r.get("LISTLEVEL"),
    }


ofz = [n for r in fetch_board("TQOB") if (n := norm(r, "ОФЗ"))]
time.sleep(0.3)
tqcb_raw = fetch_board("TQCB")
corp = [n for r in tqcb_raw if (n := norm(r, "Корпоративная"))]
# Замещающие на TQCB: в кратком названии есть «ЗО»
subst_all = [n for r in tqcb_raw if (n := norm(r, "Замещающая")) and "ЗО" in (n["name"] or "")]


def top(arr, key, n=5):
    arr = sorted(arr, key=key, reverse=True)
    return arr[:n]


picks = {
    "asOf": str(date.today()),
    # rank 3: короткие ОФЗ (рынок узкий — берём до 1,5 лет)
    "3": top([b for b in ofz if 30 <= b["durationDays"] <= 550], lambda b: b["yield"]),
    # rank 4: ОФЗ средней дюрации 3–4 года
    "4": top([b for b in ofz if 900 <= b["durationDays"] <= 1500], lambda b: b["yield"]),
    # rank 5: корпоративные облигации первого эшелона (1 ур. листинга, доходность 12–18%)
    "5": top(
        [b for b in corp if b["listLevel"] == 1 and 12 <= b["yield"] <= 18],
        lambda b: b["yield"],
    ),
    # rank 6: замещающие облигации
    "6": top(subst_all, lambda b: b["yield"]),
    # rank 10: длинные ОФЗ для ИИС-3
    "10": top([b for b in ofz if b["durationDays"] > 1500], lambda b: b["yield"]),
}

for k, arr in picks.items():
    if k == "asOf":
        continue
    print(f"\nrank {k}: {len(arr)} бумаг")
    for b in arr:
        print(f"  {b['yield']:5.2f}%  {b['name'][:30]:32s} дюр. {b['durationDays']}д")

with open("invest-app/src/data/idea-picks.json", "w", encoding="utf-8") as f:
    json.dump(picks, f, ensure_ascii=False, indent=1)
print("\nsaved -> invest-app/src/data/idea-picks.json")
