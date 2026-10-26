import type { Position } from '@/types/portfolio';
import { fmtMoney, fmtPct, marketValue, ytmOf, type PortfolioTotals } from '@/lib/portfolio';

function Card(props: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'up' | 'down' | 'flat';
}) {
  const color =
    props.tone === 'up' ? 'text-emerald-400' : props.tone === 'down' ? 'text-red-400' : 'text-foreground';
  return (
    <div className="panel rounded-xl px-5 py-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{props.label}</div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${color}`}>{props.value}</div>
      {props.sub && <div className="mt-1 text-xs text-muted-foreground">{props.sub}</div>}
    </div>
  );
}

export default function OverviewCards({ t, positions }: { t: PortfolioTotals; positions: Position[] }) {
  const value = positions.reduce((s, p) => s + marketValue(p), 0);
  // Ожидаемые купоны в год: купон % годовых от номинала 1000 ₽
  const couponsYear = positions.reduce(
    (s, p) => s + ((p.couponPercent ?? 0) / 100) * 1000 * p.quantity,
    0,
  );
  // Средневзвешенная дюрация
  const duration =
    value > 0
      ? positions.reduce((s, p) => s + (p.durationDays ?? 0) * marketValue(p), 0) / value
      : 0;
  // Ожидаемая доходность до погашения (YTM), взвешенная по стоимости
  const ytm =
    value > 0
      ? positions.reduce((s, p) => s + ytmOf(p) * marketValue(p), 0) / value
      : 0;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Card label="Стоимость портфеля" value={fmtMoney(t.value)} sub={`${positions.length} позиций`} />
      <Card label="Вложено" value={fmtMoney(t.invested)} sub="сумма покупок 12.10.2026" />
      <Card
        label="Прибыль / убыток"
        value={`${t.pnl >= 0 ? '+' : ''}${fmtMoney(t.pnl)}`}
        sub={`${fmtPct(t.pnlPct)} за период · YTM до погашения ≈ ${fmtPct(ytm)} годовых`}
        tone={t.pnl > 0 ? 'up' : t.pnl < 0 ? 'down' : 'flat'}
      />
      <Card
        label="Сложный процент (CAGR)"
        value={fmtPct(t.cagr)}
        sub="годовая доходность"
        tone={t.cagr > 0 ? 'up' : t.cagr < 0 ? 'down' : 'flat'}
      />
      <Card
        label="Купоны в год"
        value={fmtMoney(couponsYear)}
        sub={`при средней дюрации ${(duration / 365).toFixed(1)} года`}
        tone="up"
      />
      <Card
        label="День"
        value={`${t.dayChange >= 0 ? '+' : ''}${fmtMoney(t.dayChange)}`}
        sub={fmtPct(t.dayChangePct) + ' за день'}
        tone={t.dayChange > 0 ? 'up' : t.dayChange < 0 ? 'down' : 'flat'}
      />
    </div>
  );
}
