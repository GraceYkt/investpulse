// Движок глубокого анализа ценной бумаги.
// Формулы риск-скоринга и сценариев синхронизированы со скиллом security-analysis
// (skills/security-analysis/SKILL.md) — при изменении править в обоих местах.

import { KEY_RATE } from '@/data/market';

export type RiskGrade = 'низкий' | 'средний' | 'высокий';

export interface BondSnapshot {
  secid: string;
  isin: string | null;
  name: string;
  price: number; // % от номинала (чистая, без НКД)
  accint: number; // НКД, ₽
  ytm: number; // доходность к погашению, %
  durationDays: number;
  couponPercent: number | null;
  listLevel: number | null;
  matdate: string | null;
  vol: number | null; // годовая волатильность цены, %
  risk: { score: number; grade: RiskGrade };
  updatedAt: string; // дата торгов
}

/** Модифицированная дюрация (лет на 1 п.п. изменения доходности). */
export function modDuration(durationYears: number, ytmPct: number): number {
  return durationYears / (1 + ytmPct / 100);
}

/** Процентное изменение цены при шоке ставки shockPp (в п.п., линейная оценка). */
export function priceShockPct(modDur: number, shockPp: number): number {
  return -modDur * shockPp;
}

export function gradeOf(score: number): RiskGrade {
  if (score < 30) return 'низкий';
  if (score < 55) return 'средний';
  return 'высокий';
}

export const GRADE_STYLE: Record<RiskGrade, string> = {
  'низкий': 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  'средний': 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  'высокий': 'bg-red-500/10 text-red-300 border-red-500/30',
};

/**
 * Риск-скоринг 0–100: премия за риск над ключевой ставкой (0–25),
 * дюрация (0–30), уровень листинга (0/20/30), волатильность цены (0–15).
 */
export function riskScore(p: {
  ytm: number;
  keyRate: number;
  durationDays: number;
  listLevel: number | null;
  vol: number | null;
}): { score: number; grade: RiskGrade } {
  const spread = Math.max(0, p.ytm - p.keyRate);
  const spreadPts = Math.min(spread * 5, 25);
  const durPts = Math.min(p.durationDays / 365, 10) * 3;
  const listPts = p.listLevel == null ? 15 : p.listLevel === 1 ? 0 : p.listLevel === 2 ? 20 : 30;
  const volPts = p.vol == null ? 5 : Math.min(p.vol, 30) * 0.5;
  const score = Math.round(Math.min(spreadPts + durPts + listPts + volPts, 100));
  return { score, grade: gradeOf(score) };
}

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function rowsOf(block: unknown): Record<string, unknown>[] {
  const b = block as { columns: string[]; data: unknown[][] } | undefined;
  if (!b?.columns?.length || !b.data?.length) return [];
  return b.data.map((row) => Object.fromEntries(b.columns.map((c, i) => [c, row[i]])));
}

const ISS = 'https://iss.moex.com/iss';

/**
 * Живой снимок облигации с MOEX ISS: цена, доходность, дюрация, купон,
 * уровень листинга, волатильность за ~3 месяца и риск-скоринг.
 * Возвращает null, если бумагу не удалось прочитать.
 */
export async function fetchBondSnapshot(secid: string): Promise<BondSnapshot | null> {
  const meta = `${ISS}/engines/stock/markets/bonds/securities/${secid}.json?iss.meta=off&iss.only=securities,marketdata,bonds`;
  const d = await getJson(meta);
  if (!d) return null;
  const sec = rowsOf(d.securities)[0];
  const md = rowsOf(d.marketdata)[0] ?? {};
  const bd = rowsOf(d.bonds)[0] ?? {};
  if (!sec) return null;

  const price = Number(md.MARKETPRICE ?? md.MARKETPRICE3 ?? md.LASTBID ?? 0);
  const ytm = Number(md.YIELD ?? 0);
  if (!price || !ytm) return null;

  const durationDays = Number(bd.DURATION ?? md.DURATION ?? 0) || 0;
  const accint = Number(md.ACCINT ?? sec.ACCINT ?? 0) || 0;
  const listLevelRaw = Number(sec.LISTLEVEL ?? 0);

  // Волатильность: дневные доходности за последние ~3 месяца, annualized.
  let vol: number | null = null;
  const till = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 95 * 86400000).toISOString().slice(0, 10);
  const h = await getJson(
    `${ISS}/history/engines/stock/markets/bonds/securities/${secid}.json?iss.meta=off&from=${from}&till=${till}`,
  );
  const closes = rowsOf(h?.history)
    .map((r) => Number(r.MARKETPRICE3 ?? r.WAPRICE ?? r.LEGALCLOSEPRICE ?? r.CLOSE ?? 0))
    .filter((c) => c > 0);
  if (closes.length > 10) {
    const rets: number[] = [];
    for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
    vol = Math.round(Math.sqrt(variance) * Math.sqrt(252) * 10000) / 100;
  }

  const snap: BondSnapshot = {
    secid,
    isin: (sec.ISIN as string) ?? null,
    name: (sec.SHORTNAME as string) ?? secid,
    price,
    accint,
    ytm,
    durationDays,
    couponPercent: bd.COUPONPERCENT != null ? Number(bd.COUPONPERCENT) : null,
    listLevel: listLevelRaw || null,
    matdate: (bd.MATDATE as string) ?? null,
    vol,
    risk: { score: 0, grade: 'средний' },
    updatedAt: (md.UPDATETIME ?? md.SYSTIME ?? '') as string,
  };
  snap.risk = riskScore({
    ytm: snap.ytm,
    keyRate: KEY_RATE.value,
    durationDays: snap.durationDays,
    listLevel: snap.listLevel,
    vol: snap.vol,
  });
  return snap;
}

/** Пакетное обновление снимков; не падает на отдельных ошибках. */
export async function fetchSnapshots(secids: string[]): Promise<Map<string, BondSnapshot>> {
  const out = new Map<string, BondSnapshot>();
  const results = await Promise.allSettled(secids.map((s) => fetchBondSnapshot(s)));
  secids.forEach((s, i) => {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value) out.set(s, r.value);
  });
  return out;
}

export interface LiquidEntry {
  secid: string;
  isin: string | null;
  name: string;
  kind: 'bond' | 'share';
  board: string;
  price: number | null; // % от номинала (облигации) или ₽ (акции)
  ytm: number | null; // облигации, %
  valueMn: number; // оборот сегодня, млн ₽
  trades: number; // сделок сегодня
}

const LIQ_BOARDS: { board: string; kind: 'bond' | 'share' }[] = [
  { board: 'TQOB', kind: 'bond' }, // ОФЗ
  { board: 'TQCB', kind: 'bond' }, // корпоративные
  { board: 'TQBR', kind: 'share' }, // акции
];

/** ТОП самых ликвидных бумаг MOEX прямо сейчас: ранжирование по обороту дня. */
export async function fetchLiquidTop(n = 10): Promise<LiquidEntry[]> {
  const all: LiquidEntry[] = [];
  await Promise.all(
    LIQ_BOARDS.map(async ({ board, kind }) => {
      const market = kind === 'bond' ? 'bonds' : 'shares';
      let start = 0;
      for (;;) {
        const d = await getJson(
          `${ISS}/engines/stock/markets/${market}/boards/${board}/securities.json` +
            `?iss.meta=off&iss.only=securities,marketdata&start=${start}&limit=100`,
        );
        if (!d) return;
        const secs = rowsOf(d.securities);
        if (!secs.length) return;
        const mdById = new Map(rowsOf(d.marketdata).map((r) => [String(r.SECID), r]));
        for (const s of secs) {
          const m = mdById.get(String(s.SECID)) ?? {};
          const value = Number(m.VALUE ?? 0);
          if (!value || value <= 0) continue;
          all.push({
            secid: String(s.SECID),
            isin: (s.ISIN as string) ?? null,
            name: (s.SHORTNAME as string) ?? String(s.SECID),
            kind,
            board,
            price: Number(m.LAST ?? m.MARKETPRICE ?? m.MARKETPRICE3 ?? 0) || null,
            ytm: kind === 'bond' ? Number(m.YIELD ?? 0) || null : null,
            valueMn: Math.round((value / 1e6) * 10) / 10,
            trades: Number(m.NUMTRADES ?? 0) || 0,
          });
        }
        if (secs.length < 100) return;
        start += 100;
      }
    }),
  );
  return all.sort((a, b) => b.valueMn - a.valueMn).slice(0, n);
}

/** Комментарий к риск-скорингу для подсказок и аналитики. */
export function riskComment(snap: BondSnapshot): string {
  const parts: string[] = [];
  const spread = snap.ytm - KEY_RATE.value;
  parts.push(
    spread > 0
      ? `премия за риск над ставкой ЦБ ${KEY_RATE.value.toFixed(2).replace('.', ',')}%: +${spread.toFixed(1).replace('.', ',')} п.п.`
      : `доходность ниже ключевой ставки на ${Math.abs(spread).toFixed(1).replace('.', ',')} п.п. — возможна недооценка риска`,
  );
  parts.push(`дюрация ${(snap.durationDays / 365).toFixed(1).replace('.', ',')} г.`);
  if (snap.listLevel) parts.push(`${snap.listLevel}-й уровень листинга`);
  if (snap.vol != null) parts.push(`волатильность ${snap.vol.toFixed(1).replace('.', ',')}% годовых`);
  return parts.join(' · ');
}
