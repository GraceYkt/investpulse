/**
 * Прямая синхронизация портфеля с Т-Инвестиции API из браузера.
 * Токен (только чтение) хранится исключительно в localStorage пользователя —
 * в код и в репозиторий он не попадает.
 */
const API_BASE =
  'https://invest-public-api.tinkoff.ru/rest/tinkoff.public.invest.api.contract.v1';

export interface BrokerHolding {
  secid: string;
  qty: number;
  avg: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Quotation {units, nano} -> число */
const q = (v: unknown): number => {
  const o = v as { units?: number | string; nano?: number } | undefined;
  if (!o) return 0;
  return Number(o.units ?? 0) + Number(o.nano ?? 0) / 1e9;
};

async function post(token: string, path: string, body: unknown = {}, attempt = 0): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // сетевая ошибка или CORS-запрет браузера
    if (attempt < 1) {
      await sleep(1500);
      return post(token, path, body, attempt + 1);
    }
    throw new Error('банк недоступен из браузера (сеть или CORS-запрет)');
  }
  if (res.ok) return res.json();
  // шлюз банка периодически «выпадает» ложным 404 — один повтор
  if ([404, 500, 502, 503].includes(res.status) && attempt < 1) {
    await sleep(1500);
    return post(token, path, body, attempt + 1);
  }
  throw new Error(`API ответил HTTP ${res.status}`);
}

/** Возвращает открытые позиции основного брокерского счёта. */
export async function fetchBrokerPortfolio(token: string): Promise<BrokerHolding[]> {
  const accs = ((await post(token, '/UsersService/GetAccounts')) as { accounts?: { id: string; type: string }[] })
    .accounts ?? [];
  if (!accs.length) throw new Error('нет доступных счетов — проверьте токен');
  const acc = accs.find((a) => a.type === 'ACCOUNT_TYPE_TINKOFF') ?? accs[0];
  const pf = (await post(token, '/OperationsService/GetPortfolio', { accountId: acc.id })) as {
    positions?: {
      ticker?: string;
      figi?: string;
      quantity?: unknown;
      average_buy_price?: unknown;
    }[];
  };
  const pos = (pf.positions ?? []).filter((p) => q(p.quantity) > 0);
  if (!pos.length) throw new Error('портфель пуст');
  return pos.map((p) => ({
    secid: p.ticker || p.figi || '?',
    qty: q(p.quantity),
    avg: q(p.average_buy_price),
  }));
}

const TOKEN_KEY = 'investpulse.tbank.token';

export const getBrokerToken = (): string => localStorage.getItem(TOKEN_KEY) ?? '';
export const saveBrokerToken = (t: string) => localStorage.setItem(TOKEN_KEY, t.trim());
export const clearBrokerToken = () => localStorage.removeItem(TOKEN_KEY);

/* ---------- Облачная синхронизация (GitHub Actions) ----------
 * Браузер не может обратиться к API банка напрямую (CORS), поэтому на
 * опубликованном сайте кнопка «Синхронизировать API» запускает тот же
 * workflow, который раз в час обновляет портфель на сервере GitHub,
 * и ждёт его завершения. Токен GitHub хранится только в localStorage. */

const GH_KEY = 'investpulse.github.token';
const GH_API = 'https://api.github.com';
const GH_REPO = 'GraceYkt/investpulse';
const GH_WORKFLOW = 'investpulse.yml';

export const getGhToken = (): string => localStorage.getItem(GH_KEY) ?? '';
export const saveGhToken = (t: string) => localStorage.setItem(GH_KEY, t.trim());
export const clearGhToken = () => localStorage.removeItem(GH_KEY);

export const isCloudHost = (): boolean => {
  const h = window.location.hostname;
  return h !== 'localhost' && h !== '127.0.0.1';
};

async function ghFetch<T>(token: string, path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(GH_API + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  if (res.status === 404) throw new Error('репозиторий или workflow не найдены — проверьте токен');
  if (res.status === 403) throw new Error('токену не хватает прав (нужен доступ Actions: чтение/запись)');
  if (res.status === 401) throw new Error('токен GitHub не принят — проверьте, не истёк ли он');
  if (!res.ok) throw new Error(`GitHub API ответил HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Запускает workflow синхронизации. Возвращает id запуска. */
export async function dispatchCloudSync(token: string): Promise<number> {
  await ghFetch(token, `/repos/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'main' }),
  });
  // dispatch — асинхронный: ищем свежайший запуск
  await sleep(3000);
  const runs = await ghFetch<{ workflow_runs: { id: number; status: string }[] }>(
    token,
    `/repos/${GH_REPO}/actions/runs?per_page=5`,
  );
  const running = runs.workflow_runs.find((r) => r.status === 'queued' || r.status === 'in_progress' || r.status === 'waiting');
  if (!running) throw new Error('запуск workflow не обнаружен');
  return running.id;
}

export type CloudRunState = 'running' | 'success' | 'failure';

/** Состояние конкретного запуска workflow. */
export async function cloudRunStatus(token: string, runId: number): Promise<CloudRunState> {
  const run = await ghFetch<{ status: string; conclusion: string | null }>(
    token,
    `/repos/${GH_REPO}/actions/runs/${runId}`,
  );
  if (run.status !== 'completed') return 'running';
  return run.conclusion === 'success' ? 'success' : 'failure';
}
