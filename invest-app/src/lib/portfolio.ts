import type { Position, PricePoint, RiskSignal } from '@/types/portfolio';
import moex from '@/data/moex-history.json';

const MOEX = moex as Record<string, { yieldclose: number | null }>;

/** Доходность к погашению, % годовых: реальная с MOEX, иначе оценка из параметров позиции. */
export function ytmOf(p: Position): number {
  const y = MOEX[p.id]?.yieldclose;
  if (y != null && y > 0) return y;
  if (!p.durationDays || p.currentPrice <= 0) return 0;
  const years = p.durationDays / 365;
  const couponPerYear = p.couponPercent ? (p.couponPercent / 100) * 1000 : 0;
  return (((1000 - p.currentPrice) / years + couponPerYear) / p.currentPrice) * 100;
}

const nfMoney = new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'RUB', maximumFractionDigits: 0,
});
const nfMoneyShort = new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'RUB', notation: 'compact', maximumFractionDigits: 1,
});

export const fmtMoney = (n: number) => nfMoney.format(n);
export const fmtMoneyShort = (n: number) => nfMoneyShort.format(n);
export const fmtNum = (n: number, digits = 2) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtPct = (n: number, digits = 1) =>
  `${n > 0 ? '+' : ''}${n.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
export const fmtDate = (iso: string) =>
  new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('ru-RU');

export const invested = (p: Position) => p.quantity * p.avgBuyPrice;
export const marketValue = (p: Position) => p.quantity * p.currentPrice;
export const pnl = (p: Position) => marketValue(p) - invested(p);
export const pnlPct = (p: Position) => (p.currentPrice / p.avgBuyPrice - 1) * 100;

export function changeForPeriod(p: Position, days: number): number {
  const h = p.history;
  if (h.length < 2) return 0;
  const idx = Math.max(0, h.length - 1 - days);
  return (h[h.length - 1].price / h[idx].price - 1) * 100;
}

export function dayChange(p: Position): number {
  return changeForPeriod(p, 1);
}

/** Сложный процент: годовая доходность от цены покупки до текущей (CAGR) */
export function cagr(p: Position, now = new Date('2026-10-22')): number {
  const buy = new Date(p.buyDate);
  const years = (now.getTime() - buy.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (years <= 0 || p.currentPrice <= 0 || p.avgBuyPrice <= 0) return 0;
  return (Math.pow(p.currentPrice / p.avgBuyPrice, 1 / years) - 1) * 100;
}

export interface PortfolioTotals {
  invested: number;
  value: number;
  pnl: number;
  pnlPct: number;
  dayChange: number; // ₽
  dayChangePct: number;
  cagr: number; // по совокупному капиталу
  weights: Map<string, number>; // id → доля в %
}

export function totals(positions: Position[]): PortfolioTotals {
  const inv = positions.reduce((s, p) => s + invested(p), 0);
  const val = positions.reduce((s, p) => s + marketValue(p), 0);
  const weights = new Map(positions.map((p) => [p.id, val > 0 ? (marketValue(p) / val) * 100 : 0]));
  const dayVal = positions.reduce((s, p) => s + (marketValue(p) / (1 + dayChange(p) / 100)), 0);
  const dayChangeRub = val - dayVal;
  // CAGR по портфелю: оценка от средней даты покупки
  const earliest = positions.length
    ? Math.min(...positions.map((p) => new Date(p.buyDate).getTime()))
    : Date.now();
  const years = (new Date('2026-10-22').getTime() - earliest) / (365.25 * 24 * 3600 * 1000);
  return {
    invested: inv,
    value: val,
    pnl: val - inv,
    pnlPct: inv > 0 ? (val / inv - 1) * 100 : 0,
    dayChange: dayChangeRub,
    dayChangePct: dayVal > 0 ? (dayChangeRub / dayVal) * 100 : 0,
    cagr: inv > 0 && years > 0 && val > 0 ? (Math.pow(val / inv, 1 / years) - 1) * 100 : 0,
    weights,
  };
}

/** Агрегированная дневная история стоимости выбранных позиций (по датам, forward-fill) */
export function portfolioHistory(positions: Position[]): PricePoint[] {
  if (!positions.length) return [];
  // Даты из самой длинной истории
  const allDates = positions.reduce<string[]>(
    (acc, p) => (p.history.length > acc.length ? p.history.map((h) => h.date) : acc),
    [],
  );
  const maps = positions.map((p) => new Map(p.history.map((h) => [h.date, h.price])));
  const out: PricePoint[] = [];
  for (const date of allDates) {
    let sum = 0;
    let known = false;
    positions.forEach((p, idx) => {
      const price = maps[idx].get(date) ?? p.currentPrice;
      if (maps[idx].has(date)) known = true;
      sum += p.quantity * price;
    });
    if (known) out.push({ date, price: +sum.toFixed(0) });
  }
  return out;
}

/** Правила SOS: что нужно срочно продать / взять под контроль */
export function buildRiskSignals(positions: Position[]): RiskSignal[] {
  const t = totals(positions);
  const signals: RiskSignal[] = [];
  for (const p of positions) {
    const pct = pnlPct(p);
    const month = changeForPeriod(p, 21);
    const weight = t.weights.get(p.id) ?? 0;
    const isBond = p.type === 'bond';
    const ytm = isBond ? ytmOf(p) : 0;
    // Стратегия «держим до погашения»: колебания цены облигации — не угроза денег,
    // пока доходность к погашению положительная. Реальная угроза — только YTM < 0.
    const priceRiskMatters = !isBond || ytm <= 0;

    // Критично: облигация, которую доводить до погашения нельзя — там реальный минус
    if (isBond && ytm <= 0 && p.durationDays) {
      signals.push({
        positionId: p.id, ticker: p.ticker, level: 'critical',
        title: 'К погашению — потеря денег',
        detail: `Доходность к погашению ≈ ${ytm.toFixed(1)}% годовых: при удержании позиция принесёт убыток (цена покупки выше суммы погашения с учётом купонов).`,
        action: 'Продать до погашения либо зафиксировать убыток осознанно',
      });
    }

    if (priceRiskMatters && pct <= -25) {
      signals.push({
        positionId: p.id, ticker: p.ticker, level: 'critical',
        title: 'Критическая просадка',
        detail: `Позиция в минусе ${fmtPct(pct)} от цены покупки. Без тезиса на восстановление — удержание превращается в «отложенный убыток».`,
        action: 'Сократить минимум вдвое или закрыть полностью',
      });
    } else if (priceRiskMatters && pct <= -15 && month <= -8) {
      signals.push({
        positionId: p.id, ticker: p.ticker, level: 'critical',
        title: 'Падение ускоряется',
        detail: `${fmtPct(pct)} от покупки и ${fmtPct(month)} за последний месяц. Тренд против позиции.`,
        action: 'Продать сейчас, вернуться после стабилизации',
      });
    }

    // Концентрация: для ОФЗ — не угроза денег (госгарантия, держим до погашения);
    // для корпоративных — реальный кредитный риск, критично от 30%.
    if (weight >= 30) {
      if (p.sector === 'ОФЗ') {
        signals.push({
          positionId: p.id, ticker: p.ticker, level: 'warning',
          title: 'Концентрация в одном ОФЗ',
          detail: `Одна позиция — ${weight.toFixed(1)}% портфеля. У ОФЗ госгарантия и фиксированные выплаты: колебания цены до погашения денег не лишают. Это риск разнообразия по срокам, а не потери.`,
          action: 'При пополнении распределять между разными выпусками и сроками',
        });
      } else {
        signals.push({
          positionId: p.id, ticker: p.ticker, level: 'critical',
          title: 'Концентрационный риск',
          detail: `Одна корпоративная позиция — ${weight.toFixed(1)}% портфеля. Просадка актива на 20% потянет весь портфель на ${(weight * 0.2).toFixed(1)}%, и это уже реальный убыток.`,
          action: 'Снизить долю до 15–20% за 2–3 сделки',
        });
      }
    } else if (weight >= 20 && p.sector !== 'ОФЗ') {
      signals.push({
        positionId: p.id, ticker: p.ticker, level: 'warning',
        title: 'Повышенная доля одного эмитента',
        detail: `Корпоративная позиция — ${weight.toFixed(1)}% портфеля. Проблемы эмитента ударят заметно.`,
        action: 'При пополнении брать бумаги других эмитентов',
      });
    }

    for (const flag of p.fundamentalFlags) {
      signals.push({
        positionId: p.id, ticker: p.ticker, level: 'warning',
        title: 'Фундаментальный флаг',
        detail: flag + '.',
        action: 'Пересмотреть тезис инвестиции, установить стоп-уровень',
      });
    }
    if (priceRiskMatters && pct <= -12 && pct > -25 && month > -8) {
      signals.push({
        positionId: p.id, ticker: p.ticker, level: 'warning',
        title: 'Длительная просадка',
        detail: `${fmtPct(pct)} от покупки, восстановления пока нет.`,
        action: 'Держать под наблюдением, готовить план выхода',
      });
    }
  }
  const order = { critical: 0, warning: 1 };
  return signals.sort((a, b) => order[a.level] - order[b.level]);
}

/** Сигналы уровня портфеля (не привязаны к одной позиции) */
export function buildPortfolioSignals(positions: Position[]): RiskSignal[] {
  const signals: RiskSignal[] = [];
  if (!positions.length) return signals;

  const val = positions.reduce((s, p) => s + marketValue(p), 0);
  const corp = positions
    .filter((p) => p.type === 'bond' && p.sector !== 'ОФЗ')
    .reduce((s, p) => s + marketValue(p), 0);
  const corpShare = val > 0 ? (corp / val) * 100 : 0;

  // Вся корпоративная часть — один эмитент (НоваБев)
  const novabev = positions.find((p) => p.id === 'RU000A10CSQ2');
  if (novabev) {
    const share = val > 0 ? (marketValue(novabev) / val) * 100 : 0;
    signals.push({
      positionId: '_portfolio',
      level: 'warning',
      title: 'Кредитный риск одного эмитента',
      detail: `НоваБев — единственный корпоративный эмитент (${share.toFixed(1)}% портфеля, рейтинг ~A, высокая долговая нагрузка). Проблемы эмитента ударят напрямую.`,
      action: 'Не наращивать долю НоваБев; новые корпоративные покупки — другие эмитенты (АА+ и выше)',
    });
  }

  signals.push({
    positionId: '_portfolio',
    level: 'warning',
    title: 'Портфель целиком в рублёвых облигациях',
    detail: 'Нет инструментов, защищающих от инфляции выше 7% и ослабления рубля. При ставке 14% это осознанная ставка, но резерв на «чёрный день» — только купоны.',
    action: 'При пополнении: 10–15% в золото/замещающие, часть — фонды денежного рынка',
  });

  if (corpShare > 25) {
    signals.push({
      positionId: '_portfolio',
      level: 'warning',
      title: 'Высокая доля корпоративного сегмента',
      detail: `Корпоративные облигации — ${corpShare.toFixed(1)}% портфеля при ставке ЦБ 14%: спреды сжаты, маржа безопасности невысокая.`,
      action: 'Держать корпоративную часть в пределах 15–20%',
    });
  }

  return signals;
}
