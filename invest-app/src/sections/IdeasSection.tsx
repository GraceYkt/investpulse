import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Percent, CalendarClock, TrendingUp, Info, ShoppingCart, ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react';
import { IDEAS, KEY_RATE } from '@/data/market';
import marketData from '@/data/ideas-market.json';
import ideaPicks from '@/data/idea-picks.json';
import { fmtDate } from '@/lib/portfolio';
import {
  fetchSnapshots, riskScore, GRADE_STYLE, riskComment,
  type BondSnapshot, type RiskGrade,
} from '@/lib/securityAnalysis';
import type { Horizon, Idea, MarketBond } from '@/types/portfolio';

const HORIZONS: { key: Horizon; label: string; hint: string }[] = [
  { key: 'short', label: 'До 1 года', hint: 'консервативный блок под ставку 14%' },
  { key: 'mid', label: '1–3 года', hint: 'ставка на цикл снижения ставки ЦБ' },
  { key: 'long', label: '3+ года', hint: 'капитализация на нормализации ставки' },
];

const RISK_STYLE: Record<Idea['risk'], string> = {
  'низкий': 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  'средний': 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  'выше среднего': 'bg-red-500/10 text-red-300 border-red-500/30',
};

const BUCKETS = (marketData as { asOf: string; buckets: Record<Horizon, MarketBond[]> }).buckets;

type IdeaPickBond = {
  secid: string;
  isin: string;
  name: string;
  type: string;
  price: number;
  yield: number;
  durationDays: number;
  matdate: string;
  couponPercent: number | null;
  listLevel: number;
};

type IdeaPickCurated = {
  kind: 'deposit' | 'fund' | 'stock';
  name: string;
  desc: string;
  buyUrl: string;
};

type IdeaPick = IdeaPickBond | IdeaPickCurated;

function staticRisk(b: MarketBond): { score: number; grade: RiskGrade } {
  return riskScore({
    ytm: b.yield,
    keyRate: KEY_RATE.value,
    durationDays: b.durationDays,
    listLevel: b.listLevel,
    vol: null,
  });
}

type Row = {
  b: MarketBond;
  snap: BondSnapshot | undefined;
  price: number;
  ytm: number;
  durationDays: number;
  couponPercent: number | null;
  risk: { score: number; grade: RiskGrade };
};

function MarketTable({
  horizon,
  filter,
  snaps,
  live,
}: {
  horizon: Horizon;
  filter: RiskGrade | 'all';
  snaps: Map<string, BondSnapshot>;
  live: boolean;
}) {
  const rows: Row[] = (BUCKETS[horizon] ?? []).map((b) => {
    const s = snaps.get(b.secid);
    const risk = s?.risk ?? staticRisk(b);
    return {
      b,
      snap: s,
      price: s?.price ?? b.price,
      ytm: s?.ytm ?? b.yield,
      durationDays: s?.durationDays ?? b.durationDays,
      couponPercent: s?.couponPercent ?? b.couponPercent,
      risk,
    };
  });
  const filtered = filter === 'all' ? rows : rows.filter((r) => r.risk.grade === filter);
  filtered.sort((a, b) => b.ytm - a.ytm);
  return (
    <div className="panel overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <span className="text-sm font-semibold">Рынок сейчас — топ-10 по доходности</span>
        <span className="text-[11px] text-muted-foreground">
          {live ? 'живые данные MOEX' : `данные MOEX на закрытие ${fmtDate(marketData.asOf)}`}
          {filter !== 'all' && ` · фильтр: ${filter} риск`}
          {filtered.length !== rows.length && ` · показано ${filtered.length} из ${rows.length}`}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-1.5 font-medium">#</th>
              <th className="py-1.5 font-medium">Бумага</th>
              <th className="py-1.5 text-right font-medium">Цена, %</th>
              <th className="py-1.5 text-right font-medium">Доходность</th>
              <th className="py-1.5 text-right font-medium">Дюрация</th>
              <th className="py-1.5 text-right font-medium">Погашение</th>
              <th className="py-1.5 text-right font-medium">Купон</th>
              <th className="py-1.5 text-right font-medium">Риск</th>
              <th className="py-1.5 text-right font-medium">Покупка</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.b.secid} className="border-t border-border/50 hover:bg-muted/30">
                <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{i + 1}</td>
                <td className="py-1.5">
                  <span className="font-semibold">{r.b.name}</span>
                  <span className="ml-1.5 text-muted-foreground">{r.b.type}</span>
                </td>
                <td className="py-1.5 text-right tabular-nums">{r.price.toFixed(2)}</td>
                <td className="py-1.5 text-right tabular-nums font-semibold text-emerald-400">
                  {r.ytm.toFixed(2)}%
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {(r.durationDays / 365).toFixed(1)} г.
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {fmtDate(r.b.matdate)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {r.couponPercent != null ? `${r.couponPercent}%` : '—'}
                </td>
                <td className="py-1.5 text-right">
                  <span
                    className={`inline-block rounded border px-1.5 py-0.5 text-[10px] ${GRADE_STYLE[r.risk.grade]}`}
                    title={r.snap ? riskComment(r.snap) : 'оценка по данным на ' + fmtDate(marketData.asOf)}
                  >
                    {r.risk.grade} · {r.risk.score}
                  </span>
                </td>
                <td className="py-1.5 text-right">
                  <a
                    href={`https://www.tbank.ru/invest/bonds/${r.b.isin}/`}
                    target="_blank"
                    rel="noreferrer"
                    title={`Купить ${r.b.name} в Т-Банке (откроется в новой вкладке)`}
                  >
                    <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]">
                      <ShoppingCart className="h-3 w-3" /> Купить
                    </Button>
                  </a>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-center text-muted-foreground">
                  Нет бумаг с уровнем риска «{filter}» в этом горизонте — выберите другой фильтр.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const RISK_FILTERS: { key: RiskGrade | 'all'; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'низкий', label: 'Низкий риск' },
  { key: 'средний', label: 'Средний риск' },
  { key: 'высокий', label: 'Высокий риск' },
];

function IdeaCard({ idea, num, onClick }: { idea: Idea; num: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="panel rounded-xl p-4 text-left transition-colors hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-bold">
            {num}
          </span>
          <span className="text-sm font-semibold leading-tight">{idea.title}</span>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">{idea.type}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1 text-emerald-400">
          <TrendingUp className="h-3.5 w-3.5" /> {idea.expectedYield}
        </span>
        <span className={`rounded border px-1.5 py-0.5 ${RISK_STYLE[idea.risk]}`}>
          Риск: {idea.risk}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{idea.rationale}</p>
      <div className="mt-2 flex items-center gap-1 text-[11px] text-indigo-300">
        <ExternalLink className="h-3 w-3" /> Подробнее — клик
      </div>
    </button>
  );
}

export default function IdeasSection() {
  const [horizon, setHorizon] = useState<Horizon>('short');
  const [openIdea, setOpenIdea] = useState<Idea | null>(null);
  const [riskFilter, setRiskFilter] = useState<RiskGrade | 'all'>('all');
  const [snaps, setSnaps] = useState<Map<string, BondSnapshot>>(new Map());
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketUpdatedAt, setMarketUpdatedAt] = useState<string | null>(null);
  const ideas = IDEAS.filter((i) => i.horizon === horizon).sort((a, b) => a.rank - b.rank);
  const numOf = (idea: Idea) => ideas.findIndex((i) => i.rank === idea.rank) + 1;

  const secids = useMemo(
    () => Array.from(new Set(HORIZONS.flatMap((h) => (BUCKETS[h.key] ?? []).map((b) => b.secid)))),
    [],
  );

  const refreshMarket = async () => {
    setMarketLoading(true);
    const m = await fetchSnapshots(secids);
    setSnaps(m);
    setMarketUpdatedAt(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
    setMarketLoading(false);
  };

  useEffect(() => {
    refreshMarket();
    // кнопка «Обновить котировки» в шапке и автоповтор каждые 10 минут
    const handler = () => void refreshMarket();
    window.addEventListener('investpulse:refresh', handler);
    return () => window.removeEventListener('investpulse:refresh', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      {/* Баннер ключевой ставки */}
      <div className="panel overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 bg-gradient-to-r from-indigo-500/10 via-transparent to-transparent p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/15">
              <Percent className="h-6 w-6 text-indigo-300" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Ключевая ставка ЦБ РФ</div>
              <div className="text-2xl font-bold tabular-nums">{KEY_RATE.value.toFixed(2).replace('.', ',')}%</div>
              <div className="text-[11px] text-muted-foreground">с {KEY_RATE.since}</div>
            </div>
          </div>
          <div className="min-w-60">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
              <CalendarClock className="h-3.5 w-3.5" />
              Заседание ЦБ — {KEY_RATE.nextMeeting}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{KEY_RATE.consensus}</div>
          </div>
          <ul className="text-xs leading-relaxed text-muted-foreground">
            {KEY_RATE.outlook.map((o, i) => (
              <li key={i}>— {o}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Топ-10 реальных бумаг по горизонтам + идеи */}
      <Tabs value={horizon} onValueChange={(v) => setHorizon(v as Horizon)}>
        <div className="flex flex-wrap items-center gap-2">
          <TabsList>
            {HORIZONS.map((h) => (
              <TabsTrigger key={h.key} value={h.key}>{h.label}</TabsTrigger>
            ))}
          </TabsList>
          <span className="text-xs text-muted-foreground">
            {HORIZONS.find((h) => h.key === horizon)?.hint}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
            {RISK_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setRiskFilter(f.key)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  riskFilter === f.key
                    ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-200'
                    : 'border-border/60 text-muted-foreground hover:border-indigo-400/30'
                }`}
              >
                {f.label}
              </button>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={refreshMarket}
              disabled={marketLoading}
              className="h-7 gap-1.5 px-2.5 text-[11px]"
              title="Запустить глубокий анализ бумаг: живые котировки, доходность, дюрация, волатильность и риск-скоринг с MOEX"
            >
              <RefreshCw className={`h-3 w-3 ${marketLoading ? 'animate-spin' : ''}`} />
              {marketLoading ? 'Анализ…' : marketUpdatedAt ? `Обновлено ${marketUpdatedAt}` : 'Обновить анализ'}
            </Button>
          </div>
        </div>
        {HORIZONS.map((h) => (
          <TabsContent key={h.key} value={h.key} className="mt-3 space-y-3">
            <MarketTable horizon={h.key} filter={riskFilter} snaps={snaps} live={snaps.size > 0} />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {ideas.map((idea) => (
                <IdeaCard key={idea.rank} idea={idea} num={numOf(idea)} onClick={() => setOpenIdea(idea)} />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* Диалог с подробным обоснованием идеи */}
      <Dialog open={openIdea !== null} onOpenChange={(o) => !o && setOpenIdea(null)}>
        <DialogContent className="max-w-2xl">
          {openIdea && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 pr-6">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold">
                    {numOf(openIdea)}
                  </span>
                  {openIdea.title}
                </DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
                  <span className="text-emerald-400">{openIdea.expectedYield}</span>
                  <span className={`rounded border px-1.5 py-0.5 ${RISK_STYLE[openIdea.risk]}`}>
                    Риск: {openIdea.risk}
                  </span>
                  <span>{openIdea.type}</span>
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm leading-relaxed text-muted-foreground">{openIdea.rationale}</p>
              {(() => {
                const picks = (ideaPicks as unknown as Record<string, IdeaPick[]>)[String(openIdea.rank)] ?? [];
                if (picks.length === 0) return null;
                return (
                  <div className="mt-4 space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Топ-{picks.length} по этому направлению · данные на {fmtDate(ideaPicks.asOf)}
                    </div>
                    <div className="space-y-1.5">
                      {picks.map((p, i) => {
                        const bond = 'yield' in p ? (p as IdeaPickBond) : null;
                        const curated = bond ? null : (p as IdeaPickCurated);
                        const buyUrl = bond
                          ? `https://www.tbank.ru/invest/bonds/${bond.isin}/`
                          : curated!.buyUrl;
                        return (
                          <div key={bond ? bond.secid : curated!.name} className="rounded-lg border border-border/60 p-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 text-xs">
                                  <span className="tabular-nums text-muted-foreground">{i + 1}.</span>
                                  <span className="truncate font-semibold">{p.name}</span>
                                  {bond && (
                                    <span className="shrink-0 rounded bg-primary/10 px-1 text-[10px] text-primary/80">
                                      {bond.type}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-0.5 text-[11px] text-muted-foreground">
                                  {bond ? (
                                    <>
                                      доходность{' '}
                                      <span className="font-semibold text-emerald-400">{bond.yield.toFixed(2)}%</span>
                                      {' · '}дюрация {(bond.durationDays / 365).toFixed(1)} г.
                                      {' · '}погашение {fmtDate(bond.matdate)}
                                      {' · '}цена {bond.price.toFixed(2)}%
                                      {bond.couponPercent != null && ` · купон ${bond.couponPercent}%`}
                                    </>
                                  ) : (
                                    curated!.desc
                                  )}
                                </div>
                              </div>
                              <a href={buyUrl} target="_blank" rel="noreferrer">
                                <Button size="sm" variant="outline" className="h-6 shrink-0 gap-1 px-2 text-[11px]">
                                  <ShoppingCart className="h-3 w-3" />
                                  {curated?.kind === 'deposit' ? 'На сайт банка' : 'Купить'}
                                </Button>
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </DialogContent>
      </Dialog>

      <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Подборка сформирована по состоянию на 22.10.2026 на основе решения ЦБ от 11.09.2026 (ставка 14,00%)
          и консенсус-прогноза экспертов перед заседанием 23.10.2026. Топ-10 — реальные ликвидные бумаги MOEX
          (отбор по доходности с фильтром ликвидности и листинга). Каждая бумага получает риск-скоринг 0–100
          (премия над ставкой ЦБ + дюрация + уровень листинга + волатильность) — наведите курсор на бейдж риска
          за расшифровкой. Кнопка «Обновить анализ» пересчитывает скоринг по живым данным MOEX. Кнопка «Купить»
          открывает карточку бумаги в Т-Банке.
          Не является индивидуальной инвестиционной рекомендацией (п. 4 ст. 4 39-ФЗ). Источники: cbr.ru, banki.ru, moex.com.
        </span>
      </div>
    </div>
  );
}
