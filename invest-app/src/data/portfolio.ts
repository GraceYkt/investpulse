import type { Position } from '@/types/portfolio';
import moex from '@/data/moex-history.json';
import coupons from '@/data/coupons.json';

/**
 * Портфели синхронизированы с Т-Инвестиции API (read-only).
 * Брокерский: актуально на 23.10.2026 (пока шлюз банка «мигает», обновляется вручную;
 * ИИС открыт 12.10.2026, позиции подтянутся при следующей успешной синхронизации).
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

const HOLDINGS_BROKER: [string, string, string, number, number, string[]][] = [
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
const BUY_DATE_BROKER = '2026-10-12';

export const POSITIONS: Position[] = buildPositions(HOLDINGS_BROKER, BUY_DATE_BROKER);
export const POSITIONS_IIS: Position[] = [];

export const ACCOUNTS_META = {
  asOf: '26.10.2026',
  broker: 'Брокерский счёт 1',
  iis: 'ИИС',
};

export const DATA_AS_OF = '26.10.2026'; // дата последних котировок (MOEX + приложение Т-Банк)
