import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, Wind, Percent, Coins, ChevronDown, ExternalLink } from 'lucide-react';
import screener from '@/data/screener.json';

type Item = {
  secid: string;
  name: string;
  kind: 'ofz' | 'bond' | 'share';
  price?: number;
  maturity: string | null;
  listLevel: number | null;
  turnoverMn: number;
  scores: {
    reliability: number;
    rateFree: number;
    yield: number;
    liquidity: number;
    comfort: number;
    yieldPct: number;
    durationYears: number | null;
    couponPct: number | null;
    cap?: number;
    divPerShare?: number;
  };
  total: number;
  why: string;
};

type Data = {
  generatedAt: string;
  keyRate: number;
  counts: { bonds: number; shares: number };
  groups: Record<'reliable' | 'rateFree' | 'yieldAbove' | 'dividend', Item[]>;
};

const D = screener as unknown as Data;

const CRITERIA = [
  { name: 'Надёжность эмитента', weight: '30%', hint: 'уровень листинга, госгарантия, капитализация' },
  { name: 'Доходность сверх ставки ЦБ', weight: '25%', hint: 'реальная премия над 14%, а не «потому что ставка высокая»' },
  { name: 'Независимость от ставки', weight: '20%', hint: 'короткая дюрация, фиксированный купон, скорое погашение' },
  { name: 'Ликвидность', weight: '15%', hint: 'ежедневные обороты — бумагу всегда можно продать' },
  { name: 'Купонный комфорт', weight: '10%', hint: 'купон сопоставим со ставкой — денежный поток стабилен' },
];

const GROUPS: { key: keyof Data['groups']; title: string; icon: typeof ShieldCheck; hint: string }[] = [
  { key: 'reliable', title: 'Самые надёжные облигации', icon: ShieldCheck, hint: 'высший балл защищённости капитала' },
  { key: 'rateFree', title: 'Меньше всего зависят от ставки ЦБ', icon: Wind, hint: 'короткая дюрация — цена почти не реагирует на ставку' },
  { key: 'yieldAbove', title: 'Доходность выше ставки ЦБ', icon: Percent, hint: `премия сверх ${D.keyRate.toFixed(0)}% годовых` },
  { key: 'dividend', title: 'Дивидендные акции', icon: Coins, hint: 'денежный поток от бизнеса, а не от ставки' },
];

function scoreClass(t: number): string {
  if (t >= 70) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
  if (t >= 55) return 'bg-sky-500/15 text-sky-300 border-sky-500/40';
  return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 truncate text-[10px] text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/40">
        <div
          className="h-full rounded-full bg-indigo-400/80"
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
      <span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">{value.toFixed(0)}</span>
    </div>
  );
}

function ItemCard({ it, rank }: { it: Item; rank: number }) {
  const [open, setOpen] = useState(false);
  const isShare = it.kind === 'share';
  return (
    <div className="rounded-lg border border-border/50 bg-card/40">
      <button
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted/60 text-[11px] font-bold">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{it.name}</span>
            <Badge variant="outline" className="shrink-0 px-1.5 text-[9px]">
              {isShare ? 'акция' : it.kind === 'ofz' ? 'ОФЗ' : 'облигация'}
            </Badge>
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {isShare
              ? `дивдоходность ${it.scores.yieldPct}% · капитализация ${it.scores.cap} млрд ₽`
              : `доходность ${it.scores.yieldPct}%${it.scores.couponPct ? ` · купон ${it.scores.couponPct}%` : ''}${it.scores.durationYears != null ? ` · дюрация ${it.scores.durationYears} г` : ''}${it.maturity ? ` · до ${it.maturity.slice(0, 4)}` : ''}`}
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums ${scoreClass(it.total)}`}>
          {it.total.toFixed(0)}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-border/40 px-3 py-3">
          <p className="text-xs leading-relaxed text-foreground/80">{it.why}</p>
          <div className="space-y-1">
            <ScoreBar label="Надёжность" value={it.scores.reliability} />
            <ScoreBar label="Доходность" value={it.scores.yield} />
            <ScoreBar label="Без ставки" value={it.scores.rateFree} />
            <ScoreBar label="Ликвидность" value={it.scores.liquidity} />
            {!isShare && <ScoreBar label="Купон" value={it.scores.comfort} />}
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {isShare
                ? `цена ${it.price} ₽ · выплачено ${it.scores.divPerShare} ₽/акцию за 12 мес`
                : `листинг: ${it.listLevel ?? '—'} уровень · оборот ${it.turnoverMn} млн ₽/день`}
            </span>
            <a
              className="inline-flex items-center gap-1 text-indigo-300 hover:underline"
              href={`https://www.moex.com/ru/issue.aspx?code=${it.secid}`}
              target="_blank"
              rel="noreferrer"
            >
              карточка на MOEX <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ScreenerSection() {
  return (
    <div className="space-y-4">
      {/* Методика */}
      <div className="rounded-xl border border-border/60 bg-card/60 p-4">
        <h2 className="text-sm font-semibold">
          Скринер «не только про ставку» — расчётный балл 0–100
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Бумаги ранжируются по пяти критериям, а не по одной ключевой ставке. Данные MOEX и
          Smart-Lab · сформировано {D.generatedAt} · ставка ЦБ {D.keyRate.toFixed(0)}%
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {CRITERIA.map((c) => (
            <div key={c.name} className="rounded-lg bg-muted/30 p-2.5">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-medium leading-tight">{c.name}</span>
                <span className="shrink-0 rounded bg-indigo-500/20 px-1.5 text-[10px] font-bold text-indigo-300">
                  {c.weight}
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{c.hint}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Группы */}
      <div className="grid gap-4 lg:grid-cols-2">
        {GROUPS.map((g, gi) => {
          const Icon = g.icon;
          const items = D.groups[g.key] ?? [];
          return (
            <div key={g.key} className="rounded-xl border border-border/60 bg-card/60 p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/15">
                  <Icon className="h-4 w-4 text-indigo-300" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold leading-tight">
                    {gi + 1}. {g.title}
                  </h3>
                  <p className="text-[11px] text-muted-foreground">{g.hint}</p>
                </div>
              </div>
              {items.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Вселенная пуста на момент расчёта — данные обновляются ежечасно
                </p>
              ) : (
                <div className="space-y-1.5">
                  {items.map((it, i) => (
                    <ItemCard key={it.secid} it={it} rank={i + 1} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
