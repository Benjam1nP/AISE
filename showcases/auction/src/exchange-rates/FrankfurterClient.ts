import { Currency } from '../auction-api/Currency.js';

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest';
const CACHE_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;

interface CachedRates {
  rates: Record<string, number>;
  fetchedAt: number;
}

/**
 * Fetches exchange rates from the Frankfurter API and caches them for one hour.
 * @trace DSN-026 REQ-005 REQ-010
 */
export class FrankfurterClient {
  private readonly cache = new Map<Currency, CachedRates>();

  /** Returns rates for the base currency, using the cache when it is under one hour old; throws when Frankfurter fails or returns no rates. */
  async fetchRates(base: Currency): Promise<Record<string, number>> {
    if (!Object.values(Currency).includes(base)) {
      throw new Error(`Unsupported base currency: ${String(base)}`);
    }
    const cached = this.cache.get(base);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return { ...cached.rates };
    }
    const response = await fetch(`${FRANKFURTER_URL}?from=${base}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Frankfurter responded with status ${response.status}`);
    }
    const body = (await response.json()) as { rates?: Record<string, number> };
    if (!body.rates || typeof body.rates !== 'object' || Object.keys(body.rates).length === 0) {
      throw new Error('Frankfurter response has no rates');
    }
    const rates: Record<string, number> = { ...body.rates };
    this.cache.set(base, { rates, fetchedAt: Date.now() });
    return { ...rates };
  }
}
