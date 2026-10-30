import { useEffect, useMemo, useRef, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Activity, PieChart, Lightbulb, Radio, RefreshCw, BarChart3, CloudDownload, KeyRound, Search } from 'lucide-react';
import { DATA_AS_OF, POSITIONS, POSITIONS_IIS, ACCOUNTS_META } from '@/data/portfolio';
import { buildPortfolioSignals, buildRiskSignals, portfolioHistory, totals } from '@/lib/portfolio';
import {
  fetchBrokerPortfolio, getBrokerToken, saveBrokerToken, type BrokerHolding,
  isCloudHost, getGhToken, saveGhToken, dispatchCloudSync, cloudRunStatus,
} from '@/lib/brokerSync';
import type { Position } from '@/types/portfolio';
import OverviewCards from '@/sections/OverviewCards';
import PortfolioChart from '@/sections/PortfolioChart';
import RiskSignals from '@/sections/RiskSignals';
import PortfolioSection from '@/sections/PortfolioSection';
import IdeasSection from '@/sections/IdeasSection';
import AnalysisSection from '@/sections/AnalysisSection';
import ScreenerSection from '@/sections/ScreenerSection';

interface QuoteUpdate {
  id: string;
  date: string;
  price: number;
}

async function fetchLatestQuote(secid: string): Promise<QuoteUpdate | null> {
  const till = new Date().toISOString().slice(0, 10);
  const fromD = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  const url =
    'https://iss.moex.com/iss/history/engines/stock/markets/bonds' +
    `/securities/${secid}.json?from=${fromD}&till=${till}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const cols: string[] = data.history.columns;
  const rows = data.history.data as unknown[][];
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const r = Object.fromEntries(cols.map((c, i) => [c, last[i]])) as Record<string, number | string>;
  const clean = Number(r.MARKETPRICE3 ?? r.WAPRICE ?? r.LEGALCLOSEPRICE ?? r.CLOSE ?? 0);
  if (!clean) return null;
  const accint = Number(r.ACCINT ?? 0);
  return { id: secid, date: String(r.TRADEDATE), price: +(clean * 10 + accint).toFixed(2) };
}

type AccountKey = 'broker' | 'iis';

const HAS_IIS = POSITIONS_IIS.length > 0;

function initialAccount(): AccountKey {
  if (!HAS_IIS) return 'broker';
  try {
    return localStorage.getItem('investpulse:account') === 'iis' ? 'iis' : 'broker';
  } catch {
    return 'broker';
  }
}

function accountPositions(key: AccountKey): Position[] {
  return key === 'iis' && HAS_IIS ? POSITIONS_IIS : POSITIONS;
}

export default function Home() {
  const [account, setAccount] = useState<AccountKey>(initialAccount);
  const [positions, setPositions] = useState<Position[]>(() => accountPositions(initialAccount()));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(accountPositions(initialAccount()).map((p) => p.id)),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  const [syncState, setSyncState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [brokerStatus, setBrokerStatus] = useState<string | null>(null);
  const [brokerSyncing, setBrokerSyncing] = useState(false);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [tokenDraft, setTokenDraft] = useState('');
  const [ghDialogOpen, setGhDialogOpen] = useState(false);
  const [ghDraft, setGhDraft] = useState('');
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const autoSyncRan = useRef(false);

  // Метка последней успешной синхронизации в облаке (пишет workflow в sync-meta.json)
  useEffect(() => {
    fetch(`sync-meta.json?v=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.syncedAt) setSyncedAt(String(d.syncedAt));
      })
      .catch(() => {});
  }, []);

  // Переключение счёта: пересобираем позиции, выбор и показатели
  const switchAccount = (key: AccountKey) => {
    setAccount(key);
    try {
      localStorage.setItem('investpulse:account', key);
    } catch {
      /* приватный режим — просто не запоминаем */
    }
    const next = accountPositions(key);
    setPositions(next);
    setSelectedIds(new Set(next.map((p) => p.id)));
    setLastRefresh(null);
  };
  const accountLabel =
    account === 'iis' ? (ACCOUNTS_META.iis ?? 'ИИС') : (ACCOUNTS_META.broker ?? 'брокерский');

  // Свежесть данных: <3 ч — зелёный, <36 ч — жёлтый, старше — красный
  const syncInfo = useMemo(() => {
    if (!syncedAt) return null;
    const dt = new Date(syncedAt);
    if (isNaN(dt.getTime())) return null;
    const ageMin = (Date.now() - dt.getTime()) / 60000;
    const label = dt.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    if (ageMin < 180) return { label, text: 'данные свежие', dot: 'bg-emerald-400', textCls: 'text-emerald-400' };
    if (ageMin < 2160) return { label, text: 'данные за сутки', dot: 'bg-amber-400', textCls: 'text-amber-300' };
    return { label, text: 'данные устарели — нажмите «Синхронизировать API»', dot: 'bg-red-400', textCls: 'text-red-400' };
  }, [syncedAt]);

  // Облачная синхрониза: диспатчим workflow и ждём завершения, затем перезагрузка
  const cloudSync = async () => {
    const gh = getGhToken();
    if (!gh) {
      setGhDraft('');
      setGhDialogOpen(true);
      return;
    }
    setSyncState('running');
    setSyncMsg('Запускаю синхронизацию в облаке GitHub (обращение к банку идёт с сервера — в браузере оно заблокировано CORS)…');
    let runId: number;
    try {
      runId = await dispatchCloudSync(gh);
    } catch (e) {
      setSyncState('error');
      setSyncMsg(`Не удалось запустить синхронизацию: ${e instanceof Error ? e.message : e}. Проверьте токен GitHub (значок ключа рядом).`);
      return;
    }
    const started = Date.now();
    const poll = async (): Promise<void> => {
      let st: 'running' | 'success' | 'failure';
      try {
        st = await cloudRunStatus(gh, runId);
      } catch {
        st = 'running'; // временные сбои API — просто ждём дальше
      }
      if (st === 'running') {
        if (Date.now() - started > 12 * 60 * 1000) {
          setSyncState('error');
          setSyncMsg('Синхронизация в облаке идёт дольше 12 минут. Проверьте статус позже — страница сама обновится, когда GitHub опубликует данные.');
          return;
        }
        setSyncMsg('Синхронизация в облаке выполняется: банк → MOEX → купоны → сборка → публикация…');
        await new Promise((r) => setTimeout(r, 8000));
        return poll();
      }
      if (st === 'success') {
        setSyncState('done');
        setSyncMsg('Синхронизация завершена, обновляю страницу…');
        setTimeout(() => window.location.reload(), 3000);
      } else {
        setSyncState('error');
        setSyncMsg('Синхронизация в облаке завершилась с ошибкой. Попробуйте ещё раз — если банк недоступен, данные останутся прежними.');
      }
    };
    await poll().catch(() => {
      setSyncState('error');
      setSyncMsg('Не удалось отследить синхронизацию (сбой GitHub API). Данные на сайте обновляются автоматически каждый час.');
    });
  };

  // Кнопка «Синхронизировать API»: локальный сервер (sync-server.bat) гоняет
  // цепочку sync_broker → MOEX → купоны → сборка; здесь только следим за статусом.
  const syncApi = async () => {
    setSyncState('running');
    setSyncMsg(null);
    try {
      const res = await fetch('http://127.0.0.1:8765/run');
      if (!res.ok) throw new Error('http ' + res.status);
    } catch {
      setSyncState('error');
      setSyncMsg('Сервер синхронизации не запущен. Откройте sync-server.bat в папке проекта и нажмите кнопку снова.');
      return;
    }
    const poll = async (): Promise<void> => {
      const st = await (await fetch('http://127.0.0.1:8765/status')).json() as {
        phase: string; startedAt?: string; finishedAt?: string; log?: string;
      };
      if (st.phase === 'running') {
        await new Promise((r) => setTimeout(r, 2500));
        return poll();
      }
      if (st.phase === 'done') {
        setSyncState('done');
        setSyncMsg(`Портфель синхронизирован с брокером в ${st.finishedAt ?? ''}. Обновите страницу (F5).`);
      } else {
        setSyncState('error');
        const tail = (st.log ?? '').split('\n').slice(-3).join(' · ');
        setSyncMsg(`Синхронизация не завершилась успешно${tail ? ': ' + tail : ''}. Попробуйте позже или скажите мне «синхронизируй портфель».`);
      }
    };
    await poll().catch(() => {
      setSyncState('error');
      setSyncMsg('Сервер синхронизации недоступен. Запустите sync-server.bat.');
    });
  };

  // --- Прямая синхронизация с банком из браузера ---
  const applyBrokerHoldings = (holdings: BrokerHolding[]) => {
    const today = new Date().toISOString().slice(0, 10);
    const map = new Map(holdings.map((h) => [h.secid, h]));
    let added = 0;
    setPositions((prev) => {
      const updated = prev.map((p) => {
        const h = map.get(p.id);
        return h ? { ...p, quantity: h.qty, avgBuyPrice: h.avg } : p;
      });
      const known = new Set(prev.map((p) => p.id));
      const fresh: Position[] = holdings
        .filter((h) => !known.has(h.secid))
        .map((h) => ({
          id: h.secid,
          ticker: h.secid,
          name: h.secid,
          type: 'bond' as const,
          sector: h.secid.startsWith('SU26') ? 'ОФЗ' : 'Корпоративные',
          quantity: h.qty,
          avgBuyPrice: h.avg,
          currentPrice: h.avg,
          buyDate: today,
          fundamentalFlags: [],
          history: [{ date: today, price: h.avg }],
        }));
      added = fresh.length;
      return [...updated, ...fresh];
    });
    return added;
  };

  const directBrokerSync = async (auto = false): Promise<boolean> => {
    const token = getBrokerToken();
    if (!token) {
      if (!auto) {
        setTokenDraft('');
        setTokenDialogOpen(true);
      }
      return false;
    }
    if (!auto) {
      setBrokerSyncing(true);
      setSyncState('running');
      setSyncMsg(null);
    }
    try {
      const holdings = await fetchBrokerPortfolio(token);
      const added = applyBrokerHoldings(holdings);
      const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      setBrokerStatus(`Портфель загружен из банка в ${time}${added ? ` · новых позиций: ${added}` : ''}`);
      setSyncState('done');
      return true;
    } catch (e) {
      setBrokerStatus(null);
      if (!auto) {
        setSyncState('error');
        const reason = e instanceof Error ? e.message : String(e);
        const local = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        setSyncMsg(`Прямое подключение к банку не удалось: ${reason}.${local ? ' Пробую локальный сервер синхронизации…' : ''}`);
      }
      return false;
    } finally {
      setBrokerSyncing(false);
    }
  };

  // При открытии страницы — обращаемся в банк напрямую, только если сайт
  // открыт локально (с облачного хоста браузеру банк недоступен — CORS)
  useEffect(() => {
    if (autoSyncRan.current) return;
    autoSyncRan.current = true;
    if (!isCloudHost() && getBrokerToken()) directBrokerSync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSyncClick = async () => {
    if (isCloudHost()) {
      await cloudSync();
      return;
    }
    if (!getBrokerToken()) {
      setTokenDraft('');
      setTokenDialogOpen(true);
      return;
    }
    const ok = await directBrokerSync(false);
    if (!ok) await syncApi(); // запасной путь: локальный сервер (sync-server.bat)
  };

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  const selected = useMemo(
    () => positions.filter((p) => selectedIds.has(p.id)),
    [positions, selectedIds],
  );

  const t = useMemo(() => totals(selected), [selected]);
  // График — с момента самой ранней покупки выбранных позиций
  const history = useMemo(() => {
    const pts = portfolioHistory(selected);
    if (!selected.length) return pts;
    const earliest = selected.reduce((m, p) => (p.buyDate < m ? p.buyDate : m), selected[0].buyDate);
    return pts.filter((h) => h.date >= earliest);
  }, [selected]);
  const signals = useMemo(
    () => [...buildRiskSignals(positions), ...buildPortfolioSignals(positions)],
    [positions],
  );
  const criticalCount = signals.filter((s) => s.level === 'critical').length;

  // актуальный список позиций для асинхронных обновлений (без устаревших замыканий)
  const positionsRef = useRef<Position[]>(positions);
  positionsRef.current = positions;

  const refreshQuotes = async () => {
    setRefreshing(true);
    setRefreshError(false);
    try {
      const updates = (await Promise.all(positionsRef.current.map((p) => fetchLatestQuote(p.id)))).filter(
        (u): u is QuoteUpdate => u !== null,
      );
      if (!updates.length) throw new Error('no data');
      setPositions((prev) =>
        prev.map((p) => {
          const u = updates.find((x) => x.id === p.id);
          if (!u) return p;
          const withoutDup = p.history.filter((h) => h.date !== u.date);
          return { ...p, currentPrice: u.price, history: [...withoutDup, { date: u.date, price: u.price }] };
        }),
      );
      setLastRefresh(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
      // оповещаем Аналитику и другие live-блоки: перечитать данные с MOEX
      window.dispatchEvent(new CustomEvent('investpulse:refresh'));
    } catch {
      setRefreshError(true);
    } finally {
      setRefreshing(false);
    }
  };

  // При открытии страницы сразу тянем живые котировки с MOEX —
  // пончик, показатели и график сразу актуальные, без ручных кнопок.
  // Далее — автоповтор каждые 10 минут, пока вкладка открыта.
  useEffect(() => {
    refreshQuotes();
    const timer = setInterval(refreshQuotes, 10 * 60 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelectedIds((prev) =>
      prev.size === positions.length ? new Set() : new Set(positions.map((p) => p.id)),
    );

  return (
    <Tabs defaultValue="portfolio" className="min-h-screen bg-background pb-10 text-foreground">
      {/* Шапка (фиксированная, вкладки всегда наверху) */}
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/15">
            <Activity className="h-5 w-5 text-indigo-300" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight">ИнвестПульс</h1>
            <p className="text-[11px] leading-tight text-muted-foreground">
              портфель Т-Банк · {accountLabel} · актуально на {DATA_AS_OF}
            </p>
          </div>
          {HAS_IIS && (
            <div className="flex overflow-hidden rounded-lg border border-border/60 text-[11px]">
              {(['broker', 'iis'] as AccountKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => switchAccount(k)}
                  className={`px-2.5 py-1 transition-colors ${
                    account === k
                      ? 'bg-indigo-500/20 font-semibold text-indigo-200'
                      : 'text-muted-foreground hover:bg-muted/30'
                  }`}
                >
                  {k === 'broker' ? 'Брокерский' : 'ИИС'}
                </button>
              ))}
            </div>
          )}
          <Badge variant="outline" className="ml-1 hidden border-emerald-500/40 bg-emerald-500/10 text-emerald-300 lg:inline-flex">
            Реальный портфель · котировки MOEX на {DATA_AS_OF}
          </Badge>

          {/* Вкладки — зафиксированы в шапке */}
          <TabsList className="mx-auto">
            <TabsTrigger value="portfolio" className="gap-1.5">
              <PieChart className="h-4 w-4" /> Портфель
            </TabsTrigger>
            <TabsTrigger value="ideas" className="gap-1.5">
              <Lightbulb className="h-4 w-4" /> Инвестиции
              {criticalCount > 0 && (
                <span className="ml-1 rounded-full bg-red-500/15 px-1.5 text-[10px] text-red-300">
                  {criticalCount} рисков
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="analysis" className="gap-1.5">
              <BarChart3 className="h-4 w-4" /> Аналитика
            </TabsTrigger>
            <TabsTrigger value="screener" className="gap-1.5">
              <Search className="h-4 w-4" /> Скринер
            </TabsTrigger>
          </TabsList>

          <div className="ml-auto flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={refreshQuotes}
              disabled={refreshing}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="sm:hidden">{refreshing ? '…' : 'Обновить'}</span>
              <span className="hidden sm:inline">{refreshing ? 'Обновление…' : 'Обновить котировки'}</span>
            </Button>
            <Button
              variant={syncState === 'error' ? 'destructive' : 'outline'}
              size="sm"
              onClick={onSyncClick}
              disabled={syncState === 'running' || brokerSyncing}
              className="gap-1.5"
              title={isCloudHost()
                ? 'Запустить синхронизацию портфеля в облаке GitHub (банк, MOEX, аналитика) и обновить страницу'
                : 'Синхронизировать портфель напрямую с брокерским счётом через Т-Инвестиции API (токен сохраняется только в вашем браузере)'}
            >
              <CloudDownload className={`h-3.5 w-3.5 ${syncState === 'running' || brokerSyncing ? 'animate-bounce' : ''}`} />
              <span className="hidden sm:inline">
                {syncState === 'running' || brokerSyncing ? 'Синхронизация…' : 'Синхронизировать API'}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (isCloudHost()) {
                  setGhDraft(getGhToken());
                  setGhDialogOpen(true);
                } else {
                  setTokenDraft(getBrokerToken());
                  setTokenDialogOpen(true);
                }
              }}
              title={isCloudHost()
                ? (getGhToken() ? 'Токен GitHub сохранён (нажмите, чтобы заменить)' : 'Ввести токен GitHub — нужен для кнопки синхронизации в облаке')
                : (getBrokerToken() ? 'Токен Т-Инвестиции API сохранён (нажмите, чтобы заменить)' : 'Ввести токен Т-Инвестиции API (только чтение)')}
              className={`h-8 w-8 px-0 ${getBrokerToken() ? 'text-emerald-400' : 'text-muted-foreground'}`}
            >
              <KeyRound className="h-3.5 w-3.5" />
            </Button>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground xl:flex">
              <Radio className="h-3.5 w-3.5 text-emerald-400" />
              Ключевая ставка ЦБ: <span className="font-semibold text-foreground">14,00%</span>
              · заседание 18.12
            </div>
            {syncInfo && (
              <div
                className="hidden items-center gap-2 text-xs xl:flex"
                title="Время последней успешной синхронизации портфеля и котировок в облаке GitHub (мск)"
              >
                <span className={`h-2 w-2 animate-pulse rounded-full ${syncInfo.dot}`} />
                <span className="text-muted-foreground">Синхронизация:</span>
                <span className="font-semibold tabular-nums text-foreground">{syncInfo.label}</span>
                <span className={syncInfo.textCls}>· {syncInfo.text}</span>
              </div>
            )}
          </div>
          {(lastRefresh || refreshError) && (
            <div className="w-full text-right text-[11px] text-muted-foreground">
              {refreshError
                ? 'Живые котировки MOEX сейчас недоступны (выходной/сеть). Показаны данные от ' + DATA_AS_OF
                : `Котировки живые, обновлены в ${lastRefresh} (MOEX) · сайт пересобирается ежечасно`}
            </div>
          )}
          {syncMsg && (
            <div
              className={`w-full text-right text-[11px] ${
                syncState === 'done' ? 'text-emerald-400' : 'text-amber-300'
              }`}
            >
              {syncMsg}
            </div>
          )}
          {brokerStatus && (
            <div className="w-full text-right text-[11px] text-emerald-400">{brokerStatus}</div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 pt-4">
        <OverviewCards t={t} positions={selected} />

        <TabsContent value="portfolio">
          <RiskSignals signals={signals} />
          <div className="mb-4">
            <PortfolioChart history={history} investedBaseline={t.invested} />
          </div>
          <PortfolioSection
            positions={positions}
            selectedIds={selectedIds}
            onToggle={toggle}
            onToggleAll={toggleAll}
          />
        </TabsContent>

        <TabsContent value="ideas">
          <IdeasSection />
        </TabsContent>

        <TabsContent value="analysis">
          <AnalysisSection />
        </TabsContent>

        <TabsContent value="screener">
          <ScreenerSection />
        </TabsContent>
      </main>

      {/* Диалог ввода токена GitHub (для облачной синхронизации) */}
      <Dialog open={ghDialogOpen} onOpenChange={setGhDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Токен GitHub (для синхронизации в облаке)</DialogTitle>
            <DialogDescription>
              Браузеру запрещено обращаться к банку напрямую (CORS), поэтому на опубликованном
              сайте кнопка синхронизации запускает облачный workflow, который сам обращается к
              банку с сервера GitHub. Для этого нужен токен GitHub с правом запуска Actions.
              Хранится только в браузере этого устройства. Создать: github.com → Settings →
              Developer settings → Personal access tokens (классический) → scope «repo» и «workflow».
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="ghp_XXXX… или github_pat_…"
              value={ghDraft}
              onChange={(e) => setGhDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ghDraft.trim()) {
                  saveGhToken(ghDraft);
                  setGhDialogOpen(false);
                  cloudSync();
                }
              }}
            />
            <Button
              disabled={!ghDraft.trim()}
              onClick={() => {
                saveGhToken(ghDraft);
                setGhDialogOpen(false);
                cloudSync();
              }}
            >
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Диалог ввода токена Т-Инвестиции API */}
      <Dialog open={tokenDialogOpen} onOpenChange={setTokenDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Токен Т-Инвестиции API</DialogTitle>
            <DialogDescription>
              Нужен токен <b>только для чтения</b> (read-only). Он хранится исключительно в
              браузере этого устройства и отправляется напрямую в API банка. Выпускается в
              приложении Т-Инвестиций: Профиль → Настройки → Токены для API.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="t.XXXX…"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tokenDraft.trim()) {
                  saveBrokerToken(tokenDraft);
                  setTokenDialogOpen(false);
                  directBrokerSync(false);
                }
              }}
            />
            <Button
              disabled={!tokenDraft.trim()}
              onClick={() => {
                saveBrokerToken(tokenDraft);
                setTokenDialogOpen(false);
                directBrokerSync(false);
              }}
            >
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
