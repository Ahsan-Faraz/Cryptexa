'use server';

import qs from 'query-string';

const BASE_URL = process.env.COINGECKO_BASE_URL;
const API_KEY = process.env.COINGECKO_API_KEY;

if (!BASE_URL) throw new Error('Could not get base url');

// ---------- Rate-limit & retry helpers ----------

const MAX_RETRIES = 3;
const MIN_REQUEST_GAP_MS = 2_500; // Space requests ~2.5s apart (≈24 req/min, under the ~30/min free limit)

let lastRequestTime = 0;
let requestQueue: Promise<void> = Promise.resolve();

/**
 * Ensures CoinGecko requests are spaced at least MIN_REQUEST_GAP_MS apart
 * by chaining them through a global queue. Prevents 429 bursts.
 */
function enqueue(): Promise<void> {
  requestQueue = requestQueue.then(async () => {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_REQUEST_GAP_MS) {
      await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS - elapsed));
    }
    lastRequestTime = Date.now();
  });
  return requestQueue;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit & { next?: { revalidate: number } },
  retries = MAX_RETRIES,
): Promise<Response> {
  await enqueue(); // wait for our turn

  const response = await fetch(url, options);

  if (response.status === 429 && retries > 0) {
    const retryAfter = response.headers.get('retry-after');
    const delay = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : (MAX_RETRIES - retries + 1) * 20_000; // 20s, 40s, 60s
    console.warn(`Rate limited (429). Retrying in ${delay / 1000}s… (${retries} left)`);
    await new Promise((r) => setTimeout(r, delay));
    return fetchWithRetry(url, options, retries - 1);
  }

  return response;
}

// ---------- In-memory cache (deduplicates concurrent identical requests) ----------

const cache = new Map<string, { data: unknown; expiry: number }>();

// ---------- Public fetcher ----------

export async function fetcher<T>(
  endpoint: string,
  params?: QueryParams,
  revalidate = 120,
): Promise<T> {
  const url = qs.stringifyUrl(
    {
      url: `${BASE_URL}/${endpoint}`,
      query: params,
    },
    { skipEmptyString: true, skipNull: true },
  );

  // Serve from in-memory cache if fresh (avoids hitting CoinGecko at all)
  const cached = cache.get(url);
  if (cached && Date.now() < cached.expiry) {
    return cached.data as T;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (API_KEY) {
    headers['x-cg-pro-api-key'] = API_KEY;
  }

  const response = await fetchWithRetry(url, {
    headers,
    next: { revalidate },
  });

  if (!response.ok) {
    const errorBody: CoinGeckoErrorBody = await response.json().catch(() => ({}));
    throw new Error(`API Error: ${response.status}: ${errorBody.error || response.statusText} `);
  }

  const data: T = await response.json();

  // Store in memory cache (seconds → ms)
  cache.set(url, { data, expiry: Date.now() + revalidate * 1000 });

  return data;
}

export async function getPools(
  id: string,
  network?: string | null,
  contractAddress?: string | null,
): Promise<PoolData> {
  const fallback: PoolData = {
    id: '',
    address: '',
    name: '',
    network: '',
  };

  if (network && contractAddress) {
    try {
      const poolData = await fetcher<{ data: PoolData[] }>(
        `/onchain/networks/${network}/tokens/${contractAddress}/pools`,
      );

      return poolData.data?.[0] ?? fallback;
    } catch (error) {
      console.log(error);
      return fallback;
    }
  }

  try {
    const poolData = await fetcher<{ data: PoolData[] }>('/onchain/search/pools', { query: id });

    return poolData.data?.[0] ?? fallback;
  } catch {
    return fallback;
  }
}
