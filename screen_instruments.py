# -*- coding: utf-8 -*-
"""Скринер «выгодные и надёжные, не зависящие только от ставки ЦБ».

Считает композитный балл (0–100) для облигаций (ОФЗ + корпоративные) и
дивидендных акций с Московской биржи (MOEX ISS, без токенов).

Компоненты балла:
  - надёжность: уровень листинга (1 — высший), для акций — капитализация;
  - независимость от ставки: короткая дюрация / фиксированный купон /
    скорое погашение (у акций — устойчивость дивидендов);
  - доходность сверх ставки ЦБ;
  - ликвидность: обороты за день;
  - купонный комфорт: купон близок или выше ставки.

Результат: invest-app/src/data/screener.json
Только stdlib.
"""
import json
import math
import os
import re
import time
import urllib.request
from datetime import date, datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'invest-app', 'src', 'data', 'screener.json')
ISS = 'https://iss.moex.com/iss'
KEY_RATE = 14.0  # ключевая ставка ЦБ, % — как в шапке приложения


def get(path, timeout=25):
    req = urllib.request.Request(ISS + path, headers={'User-Agent': 'investpulse-screener'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def table(block, name):
    t = block.get(name, {})
    cols = t.get('columns', [])
    return [dict(zip(cols, row)) for row in t.get('data', [])]


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def board_universe(board, take, min_value=100_000, min_trades=20):
    """Самые ликвидные бумаги доски: объединяем securities + marketdata."""
    d = get(f'/engines/stock/markets/{"bonds" if "QO" in board or "QC" in board else "shares"}/boards/{board}/securities.json?iss.only=securities,marketdata')
    secs = {r['SECID']: r for r in table(d, 'securities')}
    mds = {r['SECID']: r for r in table(d, 'marketdata')}
    out = []
    for secid, s in secs.items():
        m = mds.get(secid, {})
        value = float(m.get('VALUE') or 0)
        trades = int(m.get('NUMTRADES') or 0)
        if value < min_value or trades < min_trades:
            continue
        out.append({**s, **m})
    out.sort(key=lambda x: float(x.get('VALUE') or 0), reverse=True)
    return out[:take]


def listlevel_score(level, is_ofz=False):
    if is_ofz:
        return 95.0
    return {1: 100.0, 2: 70.0, 3: 40.0}.get(level, 25.0)


def bond_scores(b):
    """Компоненты балла для облигации. Все 0–100."""
    yld = float(b.get('YIELD') or 0)
    dur_years = float(b.get('DURATION') or 0) / 365.0
    value = float(b.get('VALUE') or 0)
    coupon = float(b.get('COUPONPERCENT') or 0)
    is_ofz = b.get('BOARDID') == 'TQOB'

    reliability = listlevel_score(b.get('LISTLEVEL'), is_ofz)
    # дюрация до 10 лет: чем короче, тем меньше зависимость от ставки
    rate_free = (1 - clamp(dur_years / 10.0)) * 100
    # доходность: 12% -> 0 баллов, 20% и выше -> 100
    yield_score = clamp((yld - 12.0) / 8.0) * 100
    # ликвидность: от 0,2 млн до 300 млн оборота в день (лог-шкала)
    liquid = clamp((math.log10(value + 1) - math.log10(2e5)) /
                   (math.log10(3e8) - math.log10(2e5))) * 100
    # купон не ниже ~90% ставки — комфортный денежный поток
    comfort = clamp((coupon / (KEY_RATE * 0.9) - 0.5) / 1.0) * 100
    return {
        'reliability': round(reliability, 1),
        'rateFree': round(rate_free, 1),
        'yield': round(yield_score, 1),
        'liquidity': round(liquid, 1),
        'comfort': round(comfort, 1),
        'yieldPct': round(yld, 2),
        'durationYears': round(dur_years, 2),
        'couponPct': round(coupon, 2),
    }


def bond_total(sc):
    return round(
        0.30 * sc['reliability'] + 0.25 * sc['yield'] + 0.20 * sc['rateFree'] +
        0.15 * sc['liquidity'] + 0.10 * sc['comfort'], 1)


def why_text(kind, it):
    parts = []
    sc = it['scores']
    if kind == 'bond':
        if sc['durationYears'] is not None and sc['durationYears'] < 2:
            parts.append(f"короткая дюрация {sc['durationYears']} г — почти не зависит от ставки")
        if it.get('isOfz'):
            parts.append('госгарантия (ОФЗ)')
        elif sc['reliability'] >= 70:
            parts.append('высший/первый уровень листинга')
        if sc['yieldPct'] > KEY_RATE:
            parts.append(f"доходность {sc['yieldPct']}% выше ставки ЦБ")
        if sc['couponPct'] and sc['couponPct'] >= KEY_RATE * 0.9:
            parts.append('купон сопоставим со ставкой')
    else:
        if sc['yieldPct'] >= KEY_RATE * 0.7:
            parts.append(f"дивидендная доходность {sc['yieldPct']}% — денежный поток не привязан к ставке")
        if sc['reliability'] >= 60:
            parts.append(f"крупная капитализация ({sc['cap']} млрд ₽)")
        if sc['divPerShare']:
            parts.append(f"выплачено {sc['divPerShare']} ₽/акцию за год")
    return '; '.join(parts[:3]) if parts else 'сбалансированный профиль'


SMARTLAB_DIV = 'https://smart-lab.ru/dividends/index/?year={year}'


def trailing_dividends():
    """Дивиденды за 365 дней по тикерам с Smart-Lab: {ticker: {'div': руб/акцию, 'yield': %}}.
    Берём текущий и предыдущий год — чтобы захватить поздние выплаты прошлого года."""
    today = date.today()
    per = {}
    for year in (today.year, today.year - 1):
        req = urllib.request.Request(
            SMARTLAB_DIV.format(year=year), headers={'User-Agent': 'Mozilla/5.0'})
        html = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'ignore')
        for row in re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.S):
            cells = [re.sub(r'<[^>]+>', '', c).replace('&nbsp;', ' ').strip()
                     for c in re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)]
            if len(cells) < 10:
                continue
            try:
                ticker = cells[1].upper()
                div = float((cells[3] or '0').replace(',', '.').replace(' ', ''))
                dte = datetime.strptime(cells[7], '%d.%m.%Y').date()
                price = float((cells[9] or '0').replace(',', '.').replace(' ', ''))
            except (ValueError, IndexError):
                continue
            if not ticker or div <= 0 or price <= 0:
                continue
            if 0 <= (today - dte).days <= 365:
                rec = per.setdefault(ticker, {'div': 0.0, 'price': price})
                rec['div'] += div
                rec['price'] = price
    return {t: {'div': r['div'], 'yield': round(r['div'] / r['price'] * 100, 2)}
            for t, r in per.items()}


def main():
    bonds = []
    for board, is_ofz, take in (('TQOB', True, 40), ('TQCB', False, 70)):
        for b in board_universe(board, take):
            mat = str(b.get('MATDATE', '') or '')[:10]
            if mat and mat < (date.today().isoformat()[:4] + '-12-31') and mat < date.today().isoformat():
                continue  # погашена
            try:
                if mat and (datetime.strptime(mat, '%Y-%m-%d').date() - date.today()).days < 120:
                    continue  # погашение меньше чем через 4 месяца — не интересно
            except ValueError:
                pass
            sc = bond_scores(b)
            if sc['yieldPct'] <= 0:
                continue
            it = {
                'secid': b['SECID'], 'name': b.get('SHORTNAME', b['SECID']),
                'kind': 'ofz' if is_ofz else 'bond',
                'isOfz': is_ofz,
                'maturity': mat or None,
                'listLevel': b.get('LISTLEVEL'),
                'turnoverMn': round(float(b.get('VALUE') or 0) / 1e6, 1),
                'scores': sc,
                'total': bond_total(sc),
            }
            it['why'] = why_text('bond', it)
            bonds.append(it)
        time.sleep(0.4)

    shares = []
    try:
        divs = trailing_dividends()
    except Exception as e:
        print(f'дивиденды Smart-Lab недоступны ({e}) — акции пропускаем')
        divs = {}
    for ticker, dv in sorted(divs.items(), key=lambda kv: -kv[1]['yield']):
        if dv['yield'] < 3.0:  # без заметной дивдоходности — не про этот модуль
            continue
        try:
            d = get(f'/engines/stock/markets/shares/boards/TQBR/securities/{ticker}.json?iss.only=securities,marketdata')
            s = table(d, 'securities')[0]
            m = (table(d, 'marketdata') or [{}])[0]
        except Exception:
            continue
        price = (float(m.get('LAST') or 0) or float(m.get('MARKETPRICE3') or 0)
                 or float(s.get('PREVLEGALCLOSEPRICE') or 0) or 0)
        if price <= 0:
            price = dv['div'] / (dv['yield'] / 100)
        value = float(m.get('VALUE') or 0)
        issuesize = float(s.get('ISSUESIZE') or 0)
        cap = price * issuesize
        div_yield = dv['yield']

        # надёжность — по капитализации: 30 млрд -> 0, 3 трлн -> 100
        reliability = clamp((math.log10(cap + 1) - math.log10(3e10)) /
                            (math.log10(3e12) - math.log10(3e10))) * 100
        # независимость от ставки: дивидендная доходность выше ставки = слабая связь
        rate_free = clamp(div_yield / (KEY_RATE * 1.5)) * 100
        yield_score = clamp((div_yield - 4.0) / 8.0) * 100  # 4% -> 0, 12%+ -> 100
        liquid = clamp((math.log10(value + 1) - math.log10(2e5)) /
                       (math.log10(3e9) - math.log10(2e5))) * 100
        sc = {
            'reliability': round(reliability, 1),
            'rateFree': round(rate_free, 1),
            'yield': round(yield_score, 1),
            'liquidity': round(liquid, 1),
            'comfort': 0.0,
            'yieldPct': div_yield,
            'durationYears': None,
            'couponPct': None,
            'cap': round(cap / 1e9, 1),
            'divPerShare': round(dv['div'], 2),
        }
        it = {
            'secid': ticker, 'name': s.get('SHORTNAME', ticker),
            'kind': 'share', 'price': round(price, 2),
            'maturity': None, 'listLevel': s.get('LISTLEVEL'),
            'turnoverMn': round(value / 1e6, 1),
            'scores': sc,
            'total': round(0.30 * sc['reliability'] + 0.25 * sc['yield'] +
                           0.20 * sc['rateFree'] + 0.15 * sc['liquidity'] + 0.10 * 50.0, 1),
        }
        it['why'] = why_text('share', it)
        shares.append(it)
        if len(shares) >= 25:
            break

    def top(items, key, n=10):
        return sorted(items, key=key, reverse=True)[:n]

    groups = {
        'reliable': top(bonds, lambda x: (x['scores']['reliability'], x['total'])),
        'rateFree': top(bonds, lambda x: (x['scores']['rateFree'], x['total'])),
        'yieldAbove': top([b for b in bonds if b['scores']['yieldPct'] > KEY_RATE],
                          lambda x: x['scores']['yieldPct']),
        'dividend': top(shares, lambda x: (x['total'], x['scores']['yieldPct'])),
    }

    out = {
        'generatedAt': datetime.now().strftime('%Y-%m-%d %H:%M'),
        'keyRate': KEY_RATE,
        'counts': {'bonds': len(bonds), 'shares': len(shares)},
        'groups': groups,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"screener.json: облигаций {len(bonds)}, акций {len(shares)}")
    for g, items in groups.items():
        print(f"  {g}: " + ', '.join(f"{i['secid']} {i['total']}" for i in items[:5]))


if __name__ == '__main__':
    main()
