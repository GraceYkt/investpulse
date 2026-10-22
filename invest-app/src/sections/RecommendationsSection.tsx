import { useMemo } from 'react';
import { AlertOctagon, CheckCircle2, ArrowLeftRight, Compass, Info } from 'lucide-react';
import { KEY_RATE } from '@/data/market';
import moex from '@/data/moex-history.json';
import { fmtDate, fmtMoney, fmtPct, marketValue, pnl, totals } from '@/lib/portfolio';
import type { Position } from '@/types/portfolio';

type Tot = ReturnType<typeof totals>;

const YIELDS = moex as Record<string, { yieldclose: number | null }>;

type Rec = {
  pos: Position;
  ytm: number | null;
  points: string[];
};

const fmtN = (v: number, digits = 1) => v.toFixed(digits).replace('.', ',');

function swapTarget(p: Position): string {
  return p.sector === 'ОФЗ'
    ? 'ОФЗ средней дюрации с доходностью ~15–16% к погашению (например, 26249 / 26235) — см. вкладку «Инвестиции»'
    : 'корпоративные облигации первого эшелона (Сбербанк, Газпромбанк, нефтегаз) — доходность 14–16% при сопоставимом сроке';
}

export default function RecommendationsSection({ positions, t }: { positions: Position[]; t: Tot }) {
  const { sell, hold, swap, avgDur } = useMemo(() => {
    const sell: Rec[] = [];
    const hold: Rec[] = [];
    const swap: Rec[] = [];
    let durSum = 0;
    let valSum = 0;
    for (const p of positions) {
      const ytm = YIELDS[p.id]?.yieldclose ?? null;
      const dur = (p.durationDays ?? 0) / 365;
      const mv = marketValue(p);
      durSum += dur * mv;
      valSum += mv;
      const flags = p.fundamentalFlags ?? [];
      if (flags.length) {
        sell.push({
          pos: p,
          ytm,
          points: [
            ...flags,
            `вес в портфеле ${fmtN(t.weights.get(p.id) ?? 0)}% — превышает разумную долю одного эмитента со слабой отчётностью`,
          ],
        });
        continue;
      }
      if (ytm != null && ytm < KEY_RATE.value - 1 && dur > 2) {
        swap.push({
          pos: p,
          ytm,
          points: [
            `доходность к погашению ~${fmtN(ytm)}% — ниже ключевой ставки на ${fmtN(KEY_RATE.value - ytm)} п.п.: деньги работают хуже вклада`,
            `дюрация ${fmtN(dur)} г. — чувствительность к ставке сохраняется, а премии за это нет`,
            `замена: ${swapTarget(p)}`,
          ],
        });
        continue;
      }
      hold.push({
        pos: p,
        ytm,
        points: [
          ytm != null
            ? `доходность к погашению ~${fmtN(ytm)}% — на уровне ставки ЦБ и выше`
            : `купон ${p.couponPercent}%`,
          p.matdate ? `погашение ${fmtDate(p.matdate)} — удерживаем до конца, зарабатываем купон + возврат номинала` : 'держим до оферты',
          `дюрация ${fmtN(dur)} г. — ${dur < 2 ? 'низкая чувствительность к решениям ЦБ' : 'ставка на снижение ставки в 2027'}`,
        ],
      });
    }
    return { sell, hold, swap, avgDur: valSum > 0 ? durSum / valSum : 0 };
  }, [positions, t]);

  const ofzShare = useMemo(
    () =>
      positions
        .filter((p) => p.sector === 'ОФЗ')
        .reduce((s, p) => s + (t.weights.get(p.id) ?? 0), 0),
    [positions, t],
  );
  const corpShare = 100 - ofzShare;

  const TARGETS = [
    { name: 'ОФЗ-лестница', current: ofzShare, target: 60, note: 'ядро портфеля' },
    { name: 'Корпоративные (1-й эшелон)', current: corpShare, target: 15, note: 'премия к ОФЗ, но только качество' },
    { name: 'Денежный рынок / вклады', current: 0, target: 15, note: 'SBMM/LQDT — «касса» под ставку' },
    { name: 'Золото (TGLD / GLDRUB_TOM)', current: 0, target: 10, note: 'защита от инфляции и кризисов' },
  ];

  const renderRec = (rec: Rec, badgeCls: string, badge: string) => (
    <div key={rec.pos.id} className="border-t border-border/50 py-2 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-semibold">
          {rec.pos.ticker}
          <span className={`ml-2 rounded border px-1.5 py-0.5 text-[10px] ${badgeCls}`}>{badge}</span>
        </span>
        <span className={`text-xs tabular-nums ${pnl(rec.pos) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          П/У {pnl(rec.pos) >= 0 ? '+' : ''}{fmtMoney(pnl(rec.pos))} ({fmtPct((pnl(rec.pos) / (rec.pos.avgBuyPrice * rec.pos.quantity)) * 100)})
        </span>
      </div>
      <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-muted-foreground">
        {rec.points.map((pt, i) => (
          <li key={i}>— {pt}</li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Действия по позициям */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="panel rounded-xl p-4">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-red-400">
            <AlertOctagon className="h-4 w-4" /> Продать срочно
            <span className="ml-auto text-xs font-normal text-muted-foreground">{sell.length}</span>
          </div>
          {sell.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">
              Позиций с критическими фундаментальными рисками не выявлено.
            </p>
          ) : (
            sell.map((r) => renderRec(r, 'border-red-500/30 bg-red-500/10 text-red-300', 'срочно'))
          )}
        </div>

        <div className="panel rounded-xl p-4">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Держим до конца
            <span className="ml-auto text-xs font-normal text-muted-foreground">{hold.length}</span>
          </div>
          {hold.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">Нет позиций в этой категории.</p>
          ) : (
            hold.map((r) => renderRec(r, 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', 'держать'))
          )}
        </div>

        <div className="panel rounded-xl p-4">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-amber-400">
            <ArrowLeftRight className="h-4 w-4" /> Заменить на другое
            <span className="ml-auto text-xs font-normal text-muted-foreground">{swap.length}</span>
          </div>
          {swap.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">
              Все бумаги дают доходность на уровне ключевой ставки и выше — замены не требуются.
            </p>
          ) : (
            swap.map((r) => renderRec(r, 'border-amber-500/30 bg-amber-500/10 text-amber-300', 'заменить'))
          )}
        </div>
      </div>

      {/* Общая рекомендация по портфелю */}
      <div className="panel rounded-xl p-4">
        <div className="mb-3 flex items-center gap-1.5 text-sm font-bold">
          <Compass className="h-4 w-4 text-indigo-300" /> Общая рекомендация по портфелю
        </div>

        <div className="mb-3 text-xs text-muted-foreground">
          Средневзвешенная дюрация портфеля <span className="font-semibold text-foreground">{fmtN(avgDur)} г.</span> —{' '}
          {avgDur < 2
            ? 'консервативный профиль: решения ЦБ почти не двигают стоимость.'
            : avgDur < 4
              ? 'умеренный профиль: портфель выиграет от снижения ставки в 2027 и переживёт её сохранение.'
              : 'длинный профиль: сильная зависимость от траектории ставки.'}{' '}
          Портфель полностью в облигациях ({fmtN(ofzShare)}% ОФЗ / {fmtN(corpShare)}% корпоративных) — нет «кассы» и
          защитных активов.
        </div>

        {/* Целевое соотношение */}
        <div className="mb-3 space-y-1.5">
          {TARGETS.map((tg) => {
            const gap = tg.target - tg.current;
            return (
              <div key={tg.name} className="text-xs">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">{tg.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    сейчас {fmtN(tg.current)}% → цель {tg.target}%
                    {gap > 0.5 && <span className="ml-1.5 font-semibold text-indigo-300">+{fmtN(gap)} п.п.</span>}
                  </span>
                </div>
                <div className="mt-0.5 flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted/40">
                  <div
                    className="h-full bg-indigo-400/70"
                    style={{ width: `${Math.min(tg.current, 100)}%` }}
                  />
                  <div
                    className="h-full bg-emerald-400/50"
                    style={{ width: `${Math.max(0, Math.min(gap, 100 - tg.current))}%` }}
                  />
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{tg.note}</div>
              </div>
            );
          })}
        </div>

        <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
          <li>
            — <span className="font-semibold text-foreground">Что добавить:</span> фонд денежного рынка (SBMM / LQDT,
            ~16% годовых, деньги доступны в любой день) и золото через TGLD или GLDRUB_TOM (~10% портфеля) —
            снижает просадку в кризис; при сохранении ставки после 23.10 — короткие ОФЗ под 14%.
          </li>
          <li>
            — <span className="font-semibold text-foreground">Соотношение:</span> цель — 60% ОФЗ-лестница,
            15% корпоративные первого эшелона, 15% денежный рынок, 10% золото. Доля одного корпоративного эмитента —
            не более 5–8% портфеля.
          </li>
          <li>
            — <span className="font-semibold text-foreground">На что обратить внимание:</span> заседание ЦБ 23.10
            (консенсус — сохранение 14,00%; при снижении в декабре длинные ОФЗ портфеля вырастут); фундаментальные
            флаги НоваБева (долг 81% активов, прибыль −38% г/г) — сократить позицию; пополнять ИИС-3 для вычета
            до 52 тыс. ₽ в год.
          </li>
        </ul>

        <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Рекомендации сформированы правилами анализа портфеля (фундаментальные флаги эмитентов, доходность к
            погашению против ключевой ставки {KEY_RATE.value.toFixed(2).replace('.', ',')}%, дюрация) применительно к
            портфелю на {fmtMoney(t.value)}. Не является индивидуальной инвестиционной рекомендацией
            (п. 4 ст. 4 39-ФЗ).
          </span>
        </div>
      </div>
    </div>
  );
}
