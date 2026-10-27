# -*- coding: utf-8 -*-
"""Синхронизация портфелей с Т-Инвестиции API (токен только на чтение).

Читает токен из broker-token.txt (в корне рабочей папки, НЕ публикуется),
забирает позиции и операции по ВСЕМ доступным счетам (брокерский + ИИС),
перезаписывает:
  - invest-app/src/data/portfolio.ts  (POSITIONS, POSITIONS_IIS, ACCOUNTS_META)
  - broker-meta.json                  (объединённые secids для fetch_moex/fetch_coupons)

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
    # прокси банка «мигает» ложным 404 короткими окнами (1–3 мин плохо / 1–3 мин хорошо) —
    # долбим часто: каждые ~2,5 с, до ~4,5 мин суммарно (шанс попасть в «окно» выше)
    last_err = None
    for attempt in range(110):
        try:
            with urllib.request.urlopen(req, timeout=30, context=CTX) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            detail = e.read().decode('utf-8', 'replace')[:300]
            last_err = RuntimeError(f'API {path}: HTTP {e.code} — {detail}')
            if e.code in (404, 500, 502, 503) and attempt < 109:
                time.sleep(2.5)
                continue
            raise last_err
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = RuntimeError(f'API {path}: сеть — {e}')
            if attempt < 109:
                time.sleep(2.5)
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


def build_account(token, acc):
    """Портфель одного счёта: позиции, цены покупки, дата первой сделки."""
    acc_id = acc.get('id')
    portfolio = api_post(token, '/OperationsService/GetPortfolio', {'accountId': acc_id})
    positions = [p for p in portfolio.get('positions', []) if q_num(p.get('quantity'))]

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

    return {
        'name': acc.get('name', ''),
        'holdings': holdings,
        'global_buy_date': min(first_buy.values()) if first_buy else today,
        'secids': secids,
        'empty': not positions,
    }


# ---------------------------------------------------------------------------
# Генерация portfolio.ts
# ---------------------------------------------------------------------------

TS_HEADER = """import type { Position } from '@/types/portfolio';
import moex from '@/data/moex-history.json';
import coupons from '@/data/coupons.json';

/**
 * Портфели синхронизированы с Т-Инвестиции API (read-only).
 * История цен — MOEX ISS (полная цена с НКД).
 */

interface MoexEntry {
  shortname: string;
  matdate: string | null;
  couponpercent: number | null;
  yieldclose: number | null;
  duration: number | null;
  points: number;
  history: { date: string; price: number }[];
}

const MOEX = moex as Record<string, MoexEntry>;

interface CouponInfo {
  nextDate: string;
  nextValueRub: number;
  perYear: number;
}

const COUPONS = coupons as Record<string, CouponInfo | null>;

// holdings: [secid, отображаемое имя, сектор, количество, цена покупки с НКД, флаги]
function buildPositions(
  holdings: [string, string, string, number, number, string[]][],
  buyDate: string,
): Position[] {
  return holdings.map(([secid, name, sector, qty, buyPrice, flags]) => {
    const m = MOEX[secid];
    const c = COUPONS[secid];
    if (!m) {
      return {
        id: secid,
        ticker: name,
        name,
        type: 'bond' as const,
        sector,
        quantity: qty,
        avgBuyPrice: buyPrice,
        currentPrice: buyPrice,
        buyDate,
        fundamentalFlags: flags,
        history: [{ date: buyDate, price: buyPrice }],
      };
    }
    const last = m.history[m.history.length - 1];
    return {
      id: secid,
      ticker: name,
      name: m.shortname,
      type: 'bond' as const,
      sector,
      quantity: qty,
      avgBuyPrice: buyPrice,
      currentPrice: last.price,
      buyDate,
      matdate: m.matdate ?? undefined,
      couponPercent: m.couponpercent ?? undefined,
      durationDays: m.duration != null ? Math.round(m.duration) : undefined,
      nextCouponDate: c?.nextDate,
      nextCouponValue: c?.nextValueRub,
      couponsPerYear: c?.perYear,
      fundamentalFlags: flags,
      history: m.history,
    };
  });
}
"""


def esc(s):
    return s.replace('\\', '\\\\').replace("'", "\\'")


def gen_holdings_block(key, acc_data):
    lines = []
    lines.append(f'const HOLDINGS_{key}: [string, string, string, number, number, string[]][] = [')
    for h in acc_data['holdings']:
        flag_str = '[' + ', '.join(f"'{esc(fl)}'" for fl in h['flags']) + ']'
        lines.append(
            f"  ['{esc(h['secid'])}', '{esc(h['name'])}', '{esc(h['sector'])}', "
            f"{h['qty']}, {h['avg']}, {flag_str}],"
        )
    lines.append('];')
    lines.append(f"const BUY_DATE_{key} = '{acc_data['global_buy_date']}';")
    lines.append('')
    return lines


def main():
    token = load_token()
    if not token:
        return 2

    accounts = api_post(token, '/UsersService/GetAccounts').get('accounts', [])
    if not accounts:
        print('Нет доступных счетов. Проверьте токен (нужен доступ к счёту, не sandbox).')
        return 1
    broker_acc = next((a for a in accounts if a.get('type') == 'ACCOUNT_TYPE_TINKOFF'), None)
    iis_acc = next((a for a in accounts if a.get('type') == 'ACCOUNT_TYPE_TINKOFF_IIS'), None)
    if broker_acc is None and iis_acc is None:
        # нестандартные типы — берём первый счёт как основной
        broker_acc = accounts[0]

    broker = None
    iis = None
    if broker_acc:
        print(f'Счёт: {broker_acc.get("name", "")}')
        broker = build_account(token, broker_acc)
    if iis_acc:
        print(f'Счёт: {iis_acc.get("name", "")}')
        iis = build_account(token, iis_acc)

    if (broker is None or broker['empty']) and (iis is None or iis['empty']):
        print('Портфели пусты.')
        return 1

    today_ru = date.today().strftime('%d.%m.%Y')
    all_secids = sorted({s for a in (broker, iis) if a for s in a['secids']})

    lines = [TS_HEADER]
    if broker and not broker['empty']:
        lines += gen_holdings_block('BROKER', broker)
    if iis and not iis['empty']:
        lines += gen_holdings_block('IIS', iis)
    lines.append(
        f"export const POSITIONS: Position[] = buildPositions(HOLDINGS_BROKER, BUY_DATE_BROKER);"
        if broker and not broker['empty'] else
        "export const POSITIONS: Position[] = [];"
    )
    lines.append(
        "export const POSITIONS_IIS: Position[] = [];"
        if not iis or iis['empty'] else
        "export const POSITIONS_IIS: Position[] = buildPositions(HOLDINGS_IIS, BUY_DATE_IIS);"
    )
    lines.append('')
    meta_broker = f"'{esc(broker['name'])}'" if broker and not broker['empty'] else 'null'
    meta_iis = f"'{esc(iis['name'])}'" if iis and not iis['empty'] else 'null'
    lines.append('export const ACCOUNTS_META = {')
    lines.append(f'  asOf: \'{today_ru}\',')
    lines.append(f'  broker: {meta_broker},')
    lines.append(f'  iis: {meta_iis},')
    lines.append('};')
    lines.append('')
    lines.append(f"export const DATA_AS_OF = '{today_ru}'; // дата синхронизации с брокером")

    out_path = os.path.join(ROOT, 'invest-app', 'src', 'data', 'portfolio.ts')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    n_broker = len(broker['holdings']) if broker else 0
    n_iis = len(iis['holdings']) if iis else 0
    print(f'portfolio.ts перезаписан (брокерский: {n_broker}, ИИС: {n_iis})')

    with open(os.path.join(ROOT, 'broker-meta.json'), 'w', encoding='utf-8') as f:
        json.dump({
            'asOf': today_ru,
            'accounts': {
                'broker': broker['name'] if broker else None,
                'iis': iis['name'] if iis else None,
            },
            'secids': all_secids,
        }, f, ensure_ascii=False, indent=1)
    print('broker-meta.json обновлён — fetch_moex.py и fetch_coupons.py подтянут новые бумаги автоматически')
    print('Далее: python fetch_moex.py && python fetch_coupons.py && npm run build (в invest-app)')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except RuntimeError as e:
        print(f'Ошибка: {e}')
        sys.exit(1)
