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
