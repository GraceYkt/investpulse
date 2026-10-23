import type { Position } from '@/types/portfolio';
import moex from '@/data/moex-history.json';
import coupons from '@/data/coupons.json';

/**
 * Реальный портфель Т-Банк. Состав и средние цены — по приложению банка
 * на 23.10.2026 (пока API банка недоступен, обновляется вручную со скриншотов;
 * П/У совпадает с «за все время» в Т-Банке).
 * История цен — MOEX ISS (полная цена: чистая + НКД), точка 23.10.2026 из приложения банка.
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

const BUY_DATE = '2026-10-12';

// ticker (secid MOEX) → [отображаемое имя, сектор, количество, цена покупки (полная, с НКД), флаги]
// Цена покупки такова, что qty × (текущая − покупки) = П/У «за все время» из Т-Банка.
const HOLDINGS: [string, string, string, number, number, string[]][] = [
  ['SU26228RMFS5', 'ОФЗ 26228', 'ОФЗ', 1, 812.33, []],
  ['SU26232RMFS7', 'ОФЗ 26232', 'ОФЗ', 1, 942.69, []],
  ['SU26235RMFS0', 'ОФЗ 26235', 'ОФЗ', 1, 717.41, []],
  ['SU26236RMFS8', 'ОФЗ 26236', 'ОФЗ', 10, 910.46, []],
  ['SU26239RMFS2', 'ОФЗ 26239', 'ОФЗ', 1, 745.83, []],
  ['SU26244RMFS2', 'ОФЗ 26244', 'ОФЗ', 1, 805.96, []],
  ['SU26247RMFS5', 'ОФЗ 26247', 'ОФЗ', 3, 841.36, []],
  ['SU26251RMFS7', 'ОФЗ 26251', 'ОФЗ', 11, 855.75, []],
  ['SU26252RMFS5', 'ОФЗ 26252', 'ОФЗ', 1, 855.39, []],
  ['SU26253RMFS3', 'ОФЗ 26253', 'ОФЗ', 2, 834.26, []],
  ['RU000A10CSQ2', 'НоваБев 003Р-01', 'Корпоративные', 1, 997.28, [
    'Высокая долговая нагрузка: обязательства/активы 81%, ЧД/EBITDA ~2,1',
    'Чистая прибыль −38% г/г в 1 полугодии 2026 (МСФО)',
  ]],
  ['RU000A10EJQ7', 'Атомэнергопром 001Р-11', 'Корпоративные', 1, 994.92, []],
];

interface CouponInfo {
  nextDate: string;
  nextValueRub: number;
  perYear: number;
}

const COUPONS = coupons as Record<string, CouponInfo | null>;

export const POSITIONS: Position[] = HOLDINGS.map(([secid, name, sector, qty, buyPrice, flags]) => {
  const m = MOEX[secid];
  const c = COUPONS[secid];
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
    buyDate: BUY_DATE,
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

export const DATA_AS_OF = '23.10.2026'; // дата последних котировок (MOEX + приложение Т-Банк)
