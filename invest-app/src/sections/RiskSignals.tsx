import { AlertTriangle, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { RiskSignal } from '@/types/portfolio';

export default function RiskSignals({ signals }: { signals: RiskSignal[] }) {
  const critical = signals.filter((s) => s.level === 'critical');
  const warnings = signals.filter((s) => s.level === 'warning');

  return (
    <div className="panel rounded-xl p-4">
      <div className="mb-3 flex items-center gap-2 px-1">
        {critical.length > 0 ? (
          <ShieldAlert className="h-5 w-5 text-red-400" />
        ) : (
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
        )}
        <h2 className="text-base font-semibold">Сигналы риска — что продать, чтобы не улететь</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {signals.length ? `${critical.length} критических · ${warnings.length} предупреждений` : 'всё чисто'}
        </span>
      </div>

      {signals.length === 0 ? (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300">
          Критических рисков не выявлено. Портфель в порядке.
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {signals.map((s, i) => (
            <div
              key={`${s.positionId}-${i}`}
              className={`rounded-lg border px-4 py-3 ${
                s.level === 'critical'
                  ? 'border-red-500/30 bg-red-500/[0.06]'
                  : 'border-amber-500/25 bg-amber-500/[0.05]'
              }`}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle
                  className={`h-4 w-4 shrink-0 ${s.level === 'critical' ? 'text-red-400' : 'text-amber-400'}`}
                />
                {s.ticker && (
                  <span className={`font-mono text-sm font-bold ${s.level === 'critical' ? 'text-red-300' : 'text-amber-300'}`}>
                    {s.ticker}
                  </span>
                )}
                <span className="text-sm font-semibold">{s.title}</span>
                {s.level === 'critical' && (
                  <span className="ml-auto rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-300">
                    Срочно
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.detail}</p>
              <p className="mt-1.5 text-xs font-medium text-foreground">
                <span className="text-muted-foreground">Действие: </span>
                {s.action}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
