import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { Checkbox } from '@/components/ui/checkbox';
import type { Position } from '@/types/portfolio';
import {
  cagr, fmtDate, fmtMoney, fmtNum, fmtPct, invested, marketValue, pnl, pnlPct, totals,
} from '@/lib/portfolio';
import RecommendationsSection from '@/sections/RecommendationsSection';

interface Props {
  positions: Position[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}

type GroupKey = 'profit' | 'neutral' | 'loss';

const GROUP_META: Record<GroupKey, { label: string; color: string; text: string }> = {
  profit: { label: 'Доходные', color: '#34d399', text: 'text-emerald-400' },
  neutral: { label: 'Средние', color: '#fbbf24', text: 'text-amber-400' },
  loss: { label: 'Убыточные', color: '#f87171', text: 'text-red-400' },
};

export default function PortfolioSection({ positions, selectedIds, onToggle, onToggleAll }: Props) {
  const selected = useMemo(
    () => positions.filter((p) => selectedIds.has(p.id)),
    [positions, selectedIds],
  );

  const t = useMemo(() => totals(selected), [selected]);

  // Группы по знаку результата: П/У > 0 — доходные, < 0 — убыточные, ≈0 — средние.
  // Погрешность: меньше 1 ₽ или 0,02% от стоимости позиции считаем нулём
  // (иначе разница в копейках из-за округления цены записывает бумагу «в минус»).
  const groups = useMemo(() => {
    const g: Record<GroupKey, Position[]> = { profit: [], neutral: [], loss: [] };
    for (const p of selected) {
      const gain = pnl(p);
      const eps = Math.max(1, marketValue(p) * 0.0002);
      if (gain > eps) g.profit.push(p);
      else if (gain < -eps) g.loss.push(p);
      else g.neutral.push(p);
    }
    const byPnl = (a: Position, b: Position) => pnl(b) - pnl(a);
    g.profit.sort(byPnl);
    g.neutral.sort(byPnl);
    g.loss.sort(byPnl);
    return g;
  }, [selected]);

  const groupStats = useMemo(() => {
    const calc = (arr: Position[]) => ({
      value: arr.reduce((s, p) => s + marketValue(p), 0),
      invested: arr.reduce((s, p) => s + invested(p), 0),
      pnl: arr.reduce((s, p) => s + pnl(p), 0),
    });
    return {
      profit: calc(groups.profit),
      neutral: calc(groups.neutral),
      loss: calc(groups.loss),
    } as Record<GroupKey, { value: number; invested: number; pnl: number }>;
  }, [groups]);

  const donut: EChartsOption = {
    tooltip: {
      backgroundColor: '#14161f', borderColor: '#2a2d3e', textStyle: { color: '#e6e8f0', fontSize: 12 },
      valueFormatter: (v) => fmtMoney(Number(v)),
    },
    series: [
      {
        type: 'pie',
        radius: ['58%', '82%'],
        center: ['50%', '50%'],
        label: { show: false },
        data: (Object.keys(GROUP_META) as GroupKey[]).map((k) => ({
          name: GROUP_META[k].label,
          value: groupStats[k].value,
          itemStyle: { color: GROUP_META[k].color },
        })),
      },
    ],
  };

  const allSelected = selectedIds.size === positions.length;

  const renderGroup = (key: GroupKey) => {
    const meta = GROUP_META[key];
    const arr = groups[key];
    const gs = groupStats[key];
    const share = t.value > 0 ? (gs.value / t.value) * 100 : 0;
    const groupPnlPct = gs.invested > 0 ? (gs.pnl / gs.invested) * 100 : 0;
    return (
      <div className="panel rounded-xl p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <div className={`text-sm font-bold ${meta.text}`}>
            ● {meta.label}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {arr.length} поз. · {share.toFixed(1)}% портфеля
            </span>
          </div>
          <div className={`text-sm font-semibold tabular-nums ${meta.text}`}>
            {fmtMoney(gs.value)}
          </div>
        </div>
        {arr.length === 0 ? (
          <div className="py-3 text-center text-xs text-muted-foreground">Нет позиций в группе</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">Бумага</th>
                <th className="py-1 text-right font-medium">Погашение</th>
                <th className="py-1 text-right font-medium">Цена</th>
                <th className="py-1 text-right font-medium">Купон</th>
                <th className="py-1 text-right font-medium">П/У</th>
                <th className="py-1 text-right font-medium">П/У %</th>
                <th className="py-1 text-right font-medium">CAGR</th>
                <th className="py-1 text-right font-medium">Вес</th>
              </tr>
            </thead>
            <tbody>
              {arr.map((p) => (
                <tr key={p.id} className="border-t border-border/50">
                  <td className="py-1.5">
                    <span className="font-semibold">{p.ticker}</span>
                    <span className="ml-1.5 text-muted-foreground">×{p.quantity}</span>
                    {p.couponPercent != null && (
                      <span className="ml-1.5 text-muted-foreground">купон {p.couponPercent}%</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                    {p.matdate ? fmtDate(p.matdate) : '—'}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{fmtNum(p.currentPrice)}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {p.nextCouponDate ? (
                      <>
                        <div className="text-muted-foreground">{fmtDate(p.nextCouponDate)}</div>
                        <div className="text-emerald-400">
                          +{fmtNum((p.nextCouponValue ?? 0) * p.quantity)} ₽
                          <span className="text-muted-foreground"> ({p.couponsPerYear} в год)</span>
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className={`py-1.5 text-right tabular-nums ${pnl(p) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtMoney(pnl(p))}
                  </td>
                  <td className={`py-1.5 text-right tabular-nums ${pnlPct(p) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtPct(pnlPct(p))}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{fmtPct(cagr(p))}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                    {((t.weights.get(p.id) ?? 0)).toFixed(1)}%
                  </td>
                </tr>
              ))}
              {/* Итого по группе */}
              <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                <td className="py-1.5">Итого ({arr.length})</td>
                <td className="py-1.5" />
                <td className="py-1.5 text-right tabular-nums">{fmtMoney(gs.value)}</td>
                <td className="py-1.5 text-right tabular-nums text-emerald-400">
                  +{fmtNum(arr.reduce((s, p) => s + (p.nextCouponValue ?? 0) * p.quantity, 0))} ₽
                </td>
                <td className={`py-1.5 text-right tabular-nums ${gs.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {gs.pnl >= 0 ? '+' : ''}{fmtMoney(gs.pnl)}
                </td>
                <td className={`py-1.5 text-right tabular-nums ${groupPnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtPct(groupPnlPct)}
                </td>
                <td className="py-1.5" />
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {share.toFixed(1)}%
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Выбор позиций */}
      <div className="panel rounded-xl p-4">
        <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <Checkbox id="all" checked={allSelected} onCheckedChange={onToggleAll} />
            <label htmlFor="all" className="cursor-pointer text-sm font-medium">
              Все позиции
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {positions.map((p) => (
              <div key={p.id} className="flex items-center gap-1.5">
                <Checkbox
                  id={p.id}
                  checked={selectedIds.has(p.id)}
                  onCheckedChange={() => onToggle(p.id)}
                />
                <label htmlFor={p.id} className="cursor-pointer font-mono text-xs">
                  {p.ticker}
                </label>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Выбрано: {selected.length} из {positions.length} · Группы по знаку П/У: в плюс — доходные,
          в минус — убыточные, около нуля (±копейки от округления цены) — средние · Вложено {fmtMoney(t.invested)} ·
          Стоимость {fmtMoney(t.value)} · П/У{' '}
          <span className={t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
            {t.pnl >= 0 ? '+' : ''}{fmtMoney(t.pnl)} ({fmtPct(t.pnlPct)})
          </span>
          · Сложный процент {fmtPct(t.cagr)} годовых
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
        <div className="panel rounded-xl p-4">
          <div className="mb-1 text-sm font-semibold">Структура по группам</div>
          <ReactECharts option={donut} style={{ height: 220 }} notMerge />
          <div className="space-y-1">
            {(Object.keys(GROUP_META) as GroupKey[]).map((k) => (
              <div key={k} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: GROUP_META[k].color }} />
                  {GROUP_META[k].label}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {t.value > 0 ? ((groupStats[k].value / t.value) * 100).toFixed(1) : 0}%
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {renderGroup('profit')}
          {renderGroup('neutral')}
          {renderGroup('loss')}
        </div>
      </div>

      {/* Рекомендации по работе с бумагами и портфелем */}
      <RecommendationsSection positions={selected} t={t} />
    </div>
  );
}
