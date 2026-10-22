import type { Position } from '@/types/portfolio';
import moex from '@/data/moex-history.json';
import coupons from '@/data/coupons.json';

/**
 * Реальный портфель из отчёта Т-Банк (счёт открыт 12.10.2026,
 * сделки 12.10.2026, отчёт по 19.10.2026).
 * История цен — MOEX ISS (полная цена: чистая + НКД), по 21.10.2026.
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

// ticker (secid MOEX) → [отображаемое имя, сектор, количество, цена покупки с НКД, флаги]
const HOLDINGS: [string, string, string, number, number, string[]][] = [
  ['SU26228RMFS5', 'ОФЗ 26228', 'ОФЗ', 1, 847.75, []],
  ['SU26232RMFS7', 'ОФЗ 26232', 'ОФЗ', 1, 940.56, []],
  ['SU26235RMFS0', 'ОФЗ 26235', 'ОФЗ', 1, 715.3, []],
  ['SU26239RMFS2', 'ОФЗ 26239', 'ОФЗ', 1, 743.37, []],
  ['SU26244RMFS2', 'ОФЗ 26244', 'ОФЗ', 1, 801.95, []],
  ['SU26247RMFS5', 'ОФЗ 26247', 'ОФЗ', 3, 836.98, []],
  ['SU26252RMFS5', 'ОФЗ 26252', 'ОФЗ', 1, 913.27, []],
  ['SU26253RMFS3', 'ОФЗ 26253', 'ОФЗ', 2, 894.45, []],
  ['RU000A10CSQ2', 'НоваБев 003Р-01', 'Корпоративные', 1, 1004.03, [
    'Высокая долговая нагрузка: обязательства/активы 81%, ЧД/EBITDA ~2,1',
    'Чистая прибыль −38% г/г в 1 полугодии 2026 (МСФО)',
  ]],
  ['RU000A10EJQ7', 'Атомэнергопром 001Р-11', 'Корпоративные', 1, 989.69, []],
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

export const DATA_AS_OF = '21.10.2026'; // дата последних котировок MOEX
