import { Currency } from '../auction-api/Currency.js';
import { FrankfurterApi } from '../frankfurter-service/FrankfurterApi.js';

interface CachedRates {
  rates: Record<string, number>;
  fetchedAt: number;
}

/**
 * The only caller of the Frankfurter API: fetches rates over HTTPS from api.frankfurter.app.
 * @trace DSN-026 REQ-005 REQ-010
 */
export class FrankfurterClient {
  private readonly cacheTtlMs: number = 60 * 60 * 1000;
  private readonly cache: Map<Currency, CachedRates> = new Map();

  constructor(private readonly frankfurterApi: FrankfurterApi) {}

  /**
   * Returns exchange rates for the given base currency. Rates are cached for one hour.
   * When Frankfurter cannot be reached and no valid cached rate exists, an empty record is
   * returned so that prices are shown only in the item currency.
   */
  async fetchRates(base: Currency): Promise<Record<string, number>> {
    if (!Object.values(Currency).includes(base)) {
      throw new Error(`Unsupported base currency ${String(base)}`);
    }
    const now = Date.now();
    const cached = this.cache.get(base);
    if (cached && now - cached.fetchedAt < this.cacheTtlMs) {
      return { ...cached.rates };
    }
    try {
      const rates = await this.frankfurterApi.latest(base);
      this.cache.set(base, { rates: { ...rates }, fetchedAt: now });
      return { ...rates };
    } catch {
      return {};
    }
  }
}
