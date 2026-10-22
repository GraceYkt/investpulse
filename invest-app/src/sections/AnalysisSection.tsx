import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Search, Target, Activity, TrendingDown, Minus, TrendingUp, Gauge,
  ShoppingCart, Sparkles, Wallet, Landmark, Info, RefreshCw,
} from 'lucide-react';
import analytics from '@/data/pick-analytics.json';
import { fmtDate } from '@/lib/portfolio';
import { fetchSnapshots, modDuration, type BondSnapshot } from '@/lib/securityAnalysis';

type Item = {
  key: string;
  rank: number;
  ideaTitle: string;
  kind: string;
  assetType: string;
  name: string;
  why: string;
  now: string;
  scenDown: string;
  scenFlat: string;
  scenUp: string;
  sensitivity: string;
  buyUrl: string;
  secid?: string;
  isin?: string;
  desc?: string;
  price?: number;
  yield?: number;
  durationDays?: number;
  durationYears?: number;
  modDuration?: number;
  matdate?: string;
  couponPercent?: number | null;
};

const DATA = analytics as unknown as { asOf: string; keyRate: number; items: Item[] };

const SENS_STYLE: Record<string, string> = {
  'низкая': 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  'средняя': 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  'высокая': 'bg-red-500/10 text-red-300 border-red-500/30',
};

function metricLine(it: Item): string {
  if (it.kind === 'bond') {
    return `доходность ${it.yield!.toFixed(2)}% · дюрация ${it.durationYears!.toFixed(1)} г. · погашение ${fmtDate(it.matdate!)}`;
  }
  return it.desc ?? '';
}

/** Итог сценария: сколько зарабатываем в % и как долго держим позицию. */
function scenarioProfit(it: Item, scen: 'down' | 'flat' | 'up'): string {
  const num = (v: number, sign = true) => `${sign && v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}%`;
  if (it.kind === 'bond') {
    const dmod = it.modDuration ?? 0;
    const ytm = it.yield ?? 0;
    const hold = it.matdate ? `держим до погашения ${fmtDate(it.matdate)}` : 'держим до оферты';
    if (scen === 'down') return `${num(dmod * 2)} к цене · ${hold}`;
    if (scen === 'flat') return `~${num(ytm, false)} годовых · ${hold}`;
    return `−${num(dmod * 2).slice(1)} если продать · ${hold} — убытка нет`;
  }
  if (it.kind === 'deposit') return 'доходность зафиксирована · держим до конца срока вклада';
  if (it.kind === 'fund') return 'доходность следом за ставкой · держим до появления идеи';
  return 'горизонт 12+ мес. · держим до снижения ставки ЦБ';
}

function ScenarioBlock({
  icon, title, color, text, profit, profitCls,
}: {
  icon: React.ReactNode;
  title: string;
  color: string;
  text: string;
  profit?: string;
  profitCls?: string;
}) {
  return (
    <div className={`rounded-lg border border-border/60 p-2.5 ${color}`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        {icon} {title}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p>
      {profit && (
        <p className={`mt-1.5 border-t border-border/40 pt-1.5 text-[11px] font-semibold tabular-nums ${profitCls ?? 'text-foreground'}`}>
          {profit}
        </p>
      )}
    </div>
  );
}

function ItemDialog({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const [shock, setShock] = useState(0);
  const bond = item?.kind === 'bond' ? item : null;
  const shockDpct = bond ? -(bond.modDuration ?? 0) * shock : 0;
  const shockPrice = bond ? bond.price! * (1 + shockDpct / 100) : 0;
  const couponIncome = bond?.couponPercent ? Math.round((100000 * bond.couponPercent) / 100) : null;

  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
                {item.name}
                <Badge variant="outline" className="text-[10px]">{item.assetType}</Badge>
                <Badge variant="outline" className={`text-[10px] ${SENS_STYLE[item.sensitivity]}`}>
                  чувствительность к ставке: {item.sensitivity}
                </Badge>
              </DialogTitle>
              <DialogDescription className="pt-1">
                Идея #{item.rank}: {item.ideaTitle} · данные на {fmtDate(DATA.asOf)}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Почему выбрана */}
              <section>
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-300">
                  <Target className="h-3.5 w-3.5" /> Почему именно эта бумага
                </h4>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.why}</p>
              </section>

              {/* Ситуация сейчас */}
              <section>
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-300">
                  <Activity className="h-3.5 w-3.5" /> Ситуация на текущий момент
                </h4>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.now}</p>
                {bond && (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div className="rounded-md bg-muted/40 p-2">
                      <div className="text-muted-foreground">Цена</div>
                      <div className="font-semibold tabular-nums">{bond.price!.toFixed(2)}%</div>
                    </div>
                    <div className="rounded-md bg-muted/40 p-2">
                      <div className="text-muted-foreground">Доходность</div>
                      <div className="font-semibold tabular-nums text-emerald-400">{bond.yield!.toFixed(2)}%</div>
                    </div>
                    <div className="rounded-md bg-muted/40 p-2">
                      <div className="text-muted-foreground">Дюрация</div>
                      <div className="font-semibold tabular-nums">{bond.durationYears!.toFixed(1)} г.</div>
                    </div>
                    <div className="rounded-md bg-muted/40 p-2">
                      <div className="text-muted-foreground">Погашение</div>
                      <div className="font-semibold tabular-nums">{fmtDate(bond.matdate!)}</div>
                    </div>
                  </div>
                )}
              </section>

              {/* Сценарии по ставке */}
              <section>
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-300">
                  <Gauge className="h-3.5 w-3.5" /> Что будет со ставкой ЦБ
                </h4>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  <ScenarioBlock
                    icon={<TrendingDown className="h-3.5 w-3.5 text-emerald-400" />}
                    title="Ставка упадёт"
                    color="border-emerald-500/20"
                    text={item.scenDown}
                    profit={scenarioProfit(item, 'down')}
                    profitCls="text-emerald-400"
                  />
                  <ScenarioBlock
                    icon={<Minus className="h-3.5 w-3.5 text-amber-400" />}
                    title={`Останется ${DATA.keyRate.toFixed(2).replace('.', ',')}%`}
                    color="border-amber-500/20"
                    text={item.scenFlat}
                    profit={scenarioProfit(item, 'flat')}
                    profitCls="text-amber-300"
                  />
                  <ScenarioBlock
                    icon={<TrendingUp className="h-3.5 w-3.5 text-red-400" />}
                    title="Ставка поднимется"
                    color="border-red-500/20"
                    text={item.scenUp}
                    profit={scenarioProfit(item, 'up')}
                    profitCls="text-red-300"
                  />
                </div>
              </section>

              {/* Фишка: сценарный калькулятор для облигаций */}
              {bond && (
                <section className="rounded-lg border border-indigo-500/25 bg-indigo-500/5 p-3">
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300">
                    <Sparkles className="h-3.5 w-3.5" /> Калькулятор: свой сценарий по ставке
                  </h4>
                  <div className="mt-2 flex items-center gap-3">
                    <input
                      type="range"
                      min={-5}
                      max={5}
                      step={0.5}
                      value={shock}
                      onChange={(e) => setShock(Number(e.target.value))}
                      className="w-full accent-indigo-400"
                    />
                    <span className={`w-20 shrink-0 text-right text-sm font-bold tabular-nums ${shock < 0 ? 'text-emerald-400' : shock > 0 ? 'text-red-400' : 'text-amber-400'}`}>
                      {shock > 0 ? '+' : ''}{shock.toFixed(1).replace('.', ',')} п.п.
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    При {shock < 0 ? 'снижении' : shock > 0 ? 'повышении' : 'сохранении'} ставки на{' '}
                    {Math.abs(shock).toFixed(1).replace('.', ',')} п.п. цена бумаги ≈{' '}
                    <span className="font-semibold text-foreground">{shockPrice.toFixed(2)}%</span>{' '}
                    ({shockDpct >= 0 ? '+' : ''}{shockDpct.toFixed(1).replace('.', ',')}%). Оценка по модифицированной
                    дюрации ({bond.modDuration!.toFixed(2)}), линейное приближение.
                  </p>
                  {couponIncome != null && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Wallet className="h-3.5 w-3.5 text-emerald-400" />
                      Купон {bond.couponPercent}% даёт <span className="font-semibold text-foreground">{couponIncome.toLocaleString('ru-RU')} ₽</span> годового
                      денежного потока с каждых 100 тыс. ₽ вложений.
                    </p>
                  )}
                </section>
              )}

              {/* Действие */}
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 p-2.5">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Landmark className="h-3.5 w-3.5" />
                  {item.kind === 'deposit' ? 'Открывается на сайте банка' : 'Покупка в Т-Банке (новая вкладка)'}
                </span>
                <a href={item.buyUrl} target="_blank" rel="noreferrer">
                  <Button size="sm" className="gap-1.5">
                    <ShoppingCart className="h-3.5 w-3.5" />
                    {item.kind === 'deposit' ? 'На сайт банка' : 'Купить'}
                  </Button>
                </a>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function AnalysisSection() {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<string>('Все');
  const [open, setOpen] = useState<Item | null>(null);
  const [snaps, setSnaps] = useState<Map<string, BondSnapshot>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  // Подмешиваем живые данные MOEX в облигации: цена, доходность, дюрация, купон
  const merged = (it: Item): Item => {
    const s = it.secid ? snaps.get(it.secid) : undefined;
    if (!s || it.kind !== 'bond') return it;
    const durY = s.durationDays / 365;
    return {
      ...it,
      price: s.price,
      yield: s.ytm,
      durationDays: s.durationDays,
      durationYears: Math.round(durY * 100) / 100,
      modDuration: Math.round(modDuration(durY, s.ytm) * 100) / 100,
      couponPercent: s.couponPercent ?? it.couponPercent,
    };
  };

  const refresh = async () => {
    setRefreshing(true);
    const secids = DATA.items.filter((i) => i.kind === 'bond' && i.secid).map((i) => i.secid!);
    const m = await fetchSnapshots(secids);
    setSnaps(m);
    setUpdatedAt(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
    setRefreshing(false);
  };

  const types = useMemo(() => ['Все', ...Array.from(new Set(DATA.items.map((i) => i.assetType)))], []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DATA.items
      .filter(
        (i) =>
          (type === 'Все' || i.assetType === type) &&
          (!q || i.name.toLowerCase().includes(q) || i.ideaTitle.toLowerCase().includes(q)),
      )
      .map(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, type, snaps]);

  const byRank = useMemo(() => {
    const m = new Map<number, Item[]>();
    for (const it of filtered) {
      const arr = m.get(it.rank) ?? [];
      arr.push(it);
      m.set(it.rank, arr);
    }
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }, [filtered]);

  return (
    <div className="space-y-3">
      {/* Панель фильтров */}
      <div className="panel space-y-2.5 rounded-xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по названию или идее…"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <span className="text-[11px] text-muted-foreground">
            {filtered.length} из {DATA.items.length} инструментов · ключевая ставка {DATA.keyRate.toFixed(2).replace('.', ',')}%
            · данные на {fmtDate(DATA.asOf)}
            {updatedAt && ` · живой анализ ${updatedAt}`}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={refreshing}
            className="ml-auto h-7 gap-1.5 px-2.5 text-[11px]"
            title="Запустить глубокий анализ: живые котировки, доходность, дюрация и волатильность с MOEX для всех облигаций списка"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Анализ…' : 'Обновить анализ'}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                type === t
                  ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-200'
                  : 'border-border/60 text-muted-foreground hover:border-indigo-400/30'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Список по идеям */}
      {byRank.map(([rank, items]) => (
        <div key={rank} className="panel overflow-hidden rounded-xl">
          <div className="border-b border-border/60 px-4 py-2.5">
            <span className="text-sm font-semibold">
              #{rank} · {items[0].ideaTitle}
            </span>
            <span className="ml-2 text-[11px] text-muted-foreground">{items.length} инструментов</span>
          </div>
          <div className="grid gap-2 p-2 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((it) => (
              <button
                key={it.key}
                onClick={() => setOpen(it)}
                className="rounded-lg border border-border/50 p-2.5 text-left transition-colors hover:border-indigo-400/40 hover:bg-muted/20"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold">{it.name}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">{it.assetType}</Badge>
                </div>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">{metricLine(it)}</p>
                <div className="mt-1.5 flex items-center justify-between">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${SENS_STYLE[it.sensitivity]}`}>
                    чувствит. к ставке: {it.sensitivity}
                  </span>
                  <span className="text-[10px] text-indigo-300">анализ →</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <div className="panel rounded-xl p-6 text-center text-sm text-muted-foreground">
          Ничего не найдено — попробуйте другой запрос или сбросьте фильтр типа.
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Аналитика сформирована на {fmtDate(DATA.asOf)} под ключевую ставку {DATA.keyRate.toFixed(2).replace('.', ',')}%:
          сценарии «ставка упадёт/останется/поднимется» и калькулятор основаны на модифицированной дюрации (линейное
          приближение чувствительности цены). Это модельная оценка, а не гарантия — не является индивидуальной
          инвестиционной рекомендацией (п. 4 ст. 4 39-ФЗ).
        </span>
      </div>

      <ItemDialog item={open} onClose={() => setOpen(null)} />
    </div>
  );
}
