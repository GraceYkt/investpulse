export type AssetType = 'stock' | 'bond' | 'etf' | 'money';

export interface PricePoint {
  date: string; // ISO, день
  price: number;
}

export interface Position {
  id: string;
  ticker: string;
  name: string;
  type: AssetType;
  sector: string;
  quantity: number;
  avgBuyPrice: number; // ₽ за штуку, полная цена (с НКД)
  currentPrice: number; // ₽ за штуку, полная цена (с НКД)
  buyDate: string; // ISO
  matdate?: string; // дата погашения
  couponPercent?: number; // купон, % годовых
  durationDays?: number; // модифицированная дюрация, дней
  nextCouponDate?: string; // ближайшая выплата (ISO)
  nextCouponValue?: number; // размер выплаты, ₽ на одну бумагу
  couponsPerYear?: number; // выплат в ближайший год
  fundamentalFlags: string[]; // фундаментальные риски
  history: PricePoint[]; // дневная история полной цены
}

export type RiskLevel = 'critical' | 'warning';

export interface RiskSignal {
  positionId: string;
  ticker?: string;
  level: RiskLevel;
  title: string;
  detail: string;
  action: string;
}

export type Horizon = 'short' | 'mid' | 'long';

export interface Idea {
  rank: number;
  title: string;
  type: string;
  horizon: Horizon;
  expectedYield: string;
  risk: 'низкий' | 'средний' | 'выше среднего';
  rationale: string;
}

/** Реальная бумага из топ-10 подборки MOEX */
export interface MarketBond {
  secid: string;
  isin: string;
  name: string;
  type: 'ОФЗ' | 'Корпоративная';
  listLevel: number | null;
  price: number; // % от номинала
  yield: number; // доходность к погашению, % годовых
  durationDays: number;
  matdate: string;
  couponPercent: number | null;
}
