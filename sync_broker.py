# -*- coding: utf-8 -*-
"""Синхронизация портфеля с Т-Инвестиции API (токен только на чтение).

Читает токен из broker-token.txt (в корне рабочей папки, НЕ публикуется),
забирает позиции и операции, перезаписывает:
  - invest-app/src/data/portfolio.ts      (позиции, цены покупки, дата первой сделки)
  - broker-meta.json                      (secids для fetch_moex.py / fetch_coupons.py)

Далее запустите: python fetch_moex.py && python fetch_coupons.py && npm run build (в invest-app).

Только stdlib. Токен в логи/вывод не выводится.
"""
import json
import os
import ssl
import sys
import time
import urllib.request
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
API = 'https://invest-public-api.tinkoff.ru/rest/tinkoff.public.invest.api.contract.v1'
CTX = ssl._create_unverified_context()

SECTOR_BY_TYPE = {
    'bond': 'Корпоративные',
    'share': 'Акции',
    'etf': 'Фонды',
    'currency': 'Валюта',
}

# Фундаментальные флаги, сохраняются вручную по secid (привязаны к эмитенту)
FUNDAMENTAL_FLAGS = {
    'RU000A10CSQ2': [
        'Высокая долговая нагрузка: обязательства/активы 81%, ЧД/EBITDA ~2,1',
        'Чистая прибыль −38% г/г в 1 полугодии 2026 (МСФО)',
    ],
}


def load_token():
    path = os.path.join(ROOT, 'broker-token.txt')
    if not os.path.isfile(path):
        print('Токен не найден. Положите read-only токен Т-Инвестиции API в broker-token.txt')
        print('(выпускается в приложении Т-Банк: профиль → Инвестиции API → токен, режим «только чтение»)')
        return None
    with open(path, encoding='utf-8') as f:
        token = f.read().strip()
    if not token:
        print('broker-token.txt пуст')
        return None
    return token


def api_post(token, path, payload=None):
    body = json.dumps(payload or {}).encode('utf-8')
    req = urllib.request.Request(
        API + path, data=body, method='POST',
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        },
    )
    # прокси периодически отдаёт ложный 404 — повторяем с паузой
    last_err = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30, context=CTX) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:300]
            last_err = RuntimeError(f'API {path}: HTTP {e.code} — {detail}')
            if e.code in (404, 502, 503) and attempt < 4:
                time.sleep(3 * (attempt + 1))
                continue
            raise last_err
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = RuntimeError(f'API {path}: сеть — {e}')
            if attempt < 4:
                time.sleep(3 * (attempt + 1))
                continue
            raise last_err
    raise last_err


def q_num(q):
    """Quotation {'units','nano'} -> float."""
    if not q:
        return None
    return round(float(q.get('units', 0)) + float(q.get('nano', 0)) / 1e9, 6)


def moex_shortname(secid):
    try:
        url = f'https://iss.moex.com/iss/securities.json?q={secid}&iss.meta=off&iss.only=securities'
        req = urllib.request.Request(url, headers={'User-Agent': 'kimi-sync'})
        with urllib.request.urlopen(req, timeout=15, context=CTX) as r:
            d = json.loads(r.read().decode('utf-8'))
        for row in d.get('securities', {}).get('data', []):
            cols = d['securities']['columns']
            rec = dict(zip(cols, row))
            if rec.get('secid') == secid:
                return rec.get('shortname') or secid
    except Exception:
        pass
    return secid


def main():
    token = load_token()
    if not token:
        return 2

    accounts = api_post(token, '/UsersService/GetAccounts').get('accounts', [])
    if not accounts:
        print('Нет доступных счетов. Проверьте токен (нужен доступ к счёту, не sandbox).')
        return 1
    # предпочитаем обычный брокерский счёт; если только ИИС — берём его
    acc = next((a for a in accounts if a.get('type') == 'ACCOUNT_TYPE_TINKOFF'), accounts[0])
    acc_id = acc.get('id')
    print(f'Счёт: {acc.get("name", "")} (id ...{acc_id[-6:] if acc_id else "?"})')

    portfolio = api_post(token, '/OperationsService/GetPortfolio', {'accountId': acc_id})
    positions = [p for p in portfolio.get('positions', []) if q_num(p.get('quantity'))]
    if not positions:
        print('Портфель пуст.')
        return 1

    # даты первых покупок — из операций (за последние 3 года)
    first_buy = {}
    try:
        ops = api_post(token, '/OperationsService/GetOperations', {
            'accountId': acc_id,
            'from': '2023-01-01T00:00:00Z',
            'to': datetime.now(timezone.utc).isoformat(),
            'state': 'OPERATION_STATE_EXECUTED',
        }).get('operations', [])
        for op in ops:
            if 'BUY' in op.get('type', '') and op.get('figi'):
                d = (op.get('date') or '')[:10]
                figi = op['figi']
                if d and (figi not in first_buy or d < first_buy[figi]):
                    first_buy[figi] = d
    except Exception as e:
        print(f'операции недоступны ({e}), дата покупки — сегодня')

    today = date.today().isoformat()
    buy_dates = [d for d in first_buy.values()]
    global_buy_date = min(buy_dates) if buy_dates else today

    holdings = []
    secids = []
    for p in positions:
        secid = p.get('ticker') or p.get('figi')
        qty = q_num(p.get('quantity'))
        avg = q_num(p.get('average_buy_price')) or 0
        itype = p.get('instrument_type', 'bond')
        sector = 'ОФЗ' if str(secid).startswith('SU26') else SECTOR_BY_TYPE.get(itype, itype)
        buy_date = first_buy.get(p.get('figi'), today)
        name = moex_shortname(secid) if itype == 'bond' else secid
        flags = FUNDAMENTAL_FLAGS.get(secid, [])
        holdings.append({
            'secid': secid, 'name': name, 'sector': sector,
            'qty': qty, 'avg': avg, 'buyDate': buy_date, 'flags': flags,
        })
        secids.append(secid)
        print(f"  {name}: {qty} шт × {avg:.2f} ₽ ({sector}), первая покупка {buy_date}")

    # перезаписываем portfolio.ts
    def esc(s):
        return s.replace('\\', '\\\\').replace("'", "\\'")

    lines = []
    lines.append("import type { Position } from '@/types/portfolio';")
    lines.append("import moex from '@/data/moex-history.json';")
    lines.append("import coupons from '@/data/coupons.json';")
    lines.append("")
    lines.append("/**")
    lines.append(" * Портфель синхронизирован с Т-Инвестиции API (read-only).")
    lines.append(f" * Счёт: {acc.get('name', '')} · первая сделка: {global_buy_date}.")
    lines.append(" * История цен — MOEX ISS (полная цена с НКД).")
    lines.append(" */")
    lines.append("")
    lines.append("interface MoexEntry {")
    lines.append("  shortname: string;")
    lines.append("  matdate: string | null;")
    lines.append("  couponpercent: number | null;")
    lines.append("  yieldclose: number | null;")
    lines.append("  duration: number | null;")
    lines.append("  points: number;")
    lines.append("  history: { date: string; price: number }[];")
    lines.append("}")
    lines.append("")
    lines.append("const MOEX = moex as Record<string, MoexEntry>;")
    lines.append("")
    lines.append("const BUY_DATE = '" + global_buy_date + "';")
    lines.append("")
    lines.append("// ticker (secid MOEX) → [отображаемое имя, сектор, количество, цена покупки с НКД, флаги]")
    lines.append("const HOLDINGS: [string, string, string, number, number, string[]][] = [")
    for h in holdings:
        flag_str = "[" + ", ".join(f"'{esc(fl)}'" for fl in h['flags']) + "]"
        lines.append(
            f"  ['{esc(h['secid'])}', '{esc(h['name'])}', '{esc(h['sector'])}', "
            f"{h['qty']}, {h['avg']}, {flag_str}],"
        )
    lines.append("];")
    lines.append("")
    lines.append("interface CouponInfo {")
    lines.append("  nextDate: string;")
    lines.append("  nextValueRub: number;")
    lines.append("  perYear: number;")
    lines.append("}")
    lines.append("")
    lines.append("const COUPONS = coupons as Record<string, CouponInfo | null>;")
    lines.append("")
    lines.append("export const POSITIONS: Position[] = HOLDINGS.map(([secid, name, sector, qty, buyPrice, flags]) => {")
    lines.append("  const m = MOEX[secid];")
    lines.append("  const c = COUPONS[secid];")
    lines.append("  if (!m) {")
    lines.append("    return {")
    lines.append("      id: secid,")
    lines.append("      ticker: name,")
    lines.append("      name,")
    lines.append("      type: 'bond' as const,")
    lines.append("      sector,")
    lines.append("      quantity: qty,")
    lines.append("      avgBuyPrice: buyPrice,")
    lines.append("      currentPrice: buyPrice,")
    lines.append("      buyDate: BUY_DATE,")
    lines.append("      fundamentalFlags: flags,")
    lines.append("      history: [{ date: BUY_DATE, price: buyPrice }],")
    lines.append("    };")
    lines.append("  }")
    lines.append("  const last = m.history[m.history.length - 1];")
    lines.append("  return {")
    lines.append("    id: secid,")
    lines.append("    ticker: name,")
    lines.append("    name: m.shortname,")
    lines.append("    type: 'bond' as const,")
    lines.append("    sector,")
    lines.append("    quantity: qty,")
    lines.append("    avgBuyPrice: buyPrice,")
    lines.append("    currentPrice: last.price,")
    lines.append("    buyDate: BUY_DATE,")
    lines.append("    matdate: m.matdate ?? undefined,")
    lines.append("    couponPercent: m.couponpercent ?? undefined,")
    lines.append("    durationDays: m.duration != null ? Math.round(m.duration) : undefined,")
    lines.append("    nextCouponDate: c?.nextDate,")
    lines.append("    nextCouponValue: c?.nextValueRub,")
    lines.append("    couponsPerYear: c?.perYear,")
    lines.append("    fundamentalFlags: flags,")
    lines.append("    history: m.history,")
    lines.append("  };")
    lines.append("});")
    lines.append("")
    lines.append(f"export const DATA_AS_OF = '{today}'; // дата синхронизации с брокером")

    out_path = os.path.join(ROOT, 'invest-app', 'src', 'data', 'portfolio.ts')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print(f'portfolio.ts перезаписан ({len(holdings)} позиций)')

    with open(os.path.join(ROOT, 'broker-meta.json'), 'w', encoding='utf-8') as f:
        json.dump({'asOf': today, 'account': acc.get('name', ''), 'secids': secids}, f, ensure_ascii=False, indent=1)
    print('broker-meta.json обновлён — fetch_moex.py и fetch_coupons.py подтянут новые бумаги автоматически')
    print('Далее: python fetch_moex.py && python fetch_coupons.py && npm run build (в invest-app)')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except RuntimeError as e:
        print(f'Ошибка: {e}')
        sys.exit(1)
