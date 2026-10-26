"""Скачивает годовую дневную историю цен облигаций с MOEX ISS (открытый API).

Список бумаг берётся из broker-meta.json (создаётся sync_broker.py после
синхронизации с брокером), иначе — из значения по умолчанию ниже.
"""
import json
import os
import ssl
import time
import urllib.request
import datetime

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

# динамический диапазон: год истории до сегодня (последний торговый день)
_today = datetime.date.today()
FROM, TILL = (_today - datetime.timedelta(days=400)).isoformat(), _today.isoformat()


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


def fetch_live_full_price(secid):
    """Полная цена (чистая + НКД) текущей торговой сессии, или None.
    Перебираем доски: ОФЗ — TQOB, корпоративные — TQCB и др."""
    for board in ("TQOB", "TQCB", "TQIR", None):
        url = (
            "https://iss.moex.com/iss/engines/stock/markets/bonds"
            + (f"/boards/{board}" if board else "")
            + f"/securities/{secid}.json?iss.meta=off"
        )
        try:
            data = get_json(url)
            cols = data["marketdata"]["columns"]
            for row in data["marketdata"]["data"]:
                r = dict(zip(cols, row))
                price = pick(r, "MARKETPRICE", "LAST", "LCURRENTPRICE")
                if price is None:
                    continue
                return round(float(price) * 10 + float(r.get("ACCINT") or 0), 2)
        except Exception:
            continue
    return None


today_iso = _today.isoformat()

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
    # История MOEX содержит только закрытые сессии — в торговый день
    # подхватываем текущую сессию, чтобы данные не «старели» на день.
    if series and series[-1]["date"] < today_iso:
        live = fetch_live_full_price(sec)
        if live is not None:
            series.append({"date": today_iso, "price": live})
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

# DATA_AS_OF = дата последних реальных данных MOEX (банк может быть недоступен,
# а котировки MOEX — нет; лейбл «котировки MOEX на …» должен быть честным)
last_dates = [s["history"][-1]["date"] for s in out.values() if s["history"]]
if last_dates:
    moex_asof = max(last_dates)
    portfolio_ts = os.path.join("invest-app", "src", "data", "portfolio.ts")
    with open(portfolio_ts, encoding="utf-8") as f:
        src = f.read()
    import re as _re
    def _parse(d):
        try:
            return datetime.date.fromisoformat(d)
        except ValueError:
            return None
    m = _re.search(r"DATA_AS_OF = '(\d{2})\.(\d{2})\.(\d{4})'", src)
    cur = datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None
    if _parse(moex_asof) and (cur is None or _parse(moex_asof) > cur):
        ru = f"{moex_asof[8:10]}.{moex_asof[5:7]}.{moex_asof[0:4]}"
        src = _re.sub(
            r"DATA_AS_OF = '[^']+';[^\n]*",
            f"DATA_AS_OF = '{ru}'; // дата последних котировок (MOEX + приложение Т-Банк)",
            src,
        )
        with open(portfolio_ts, "w", encoding="utf-8") as f:
            f.write(src)
        print(f"DATA_AS_OF обновлён -> {ru}")
