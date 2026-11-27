import { Currency } from '../auction-api/Currency.js';
import { FrankfurterClient } from './FrankfurterClient.js';

interface CachedRates {
  fetchedAt: number;
  rates: Record<string, number>;
}

/**
 * Converts prices for display using rates cached for a configurable time; returns null when unavailable.
 * @trace DSN-025 REQ-005 REQ-010
 */
export class ExchangeRateService {
  private readonly cache = new Map<Currency, CachedRates>();

  constructor(private readonly frankfurterClient: FrankfurterClient, public cacheTtlMs: number) {}

  /** Converts an item-currency amount to the display currency, returning null when no rate is available; throws on invalid input. */
  async convert(amount: number, from: Currency, to: Currency): Promise<number | null> {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('amount must be a non-negative finite number');
    }
    if (!Object.values(Currency).includes(from)) {
      throw new Error(`from currency ${String(from)} is not supported`);
    }
    if (!Object.values(Currency).includes(to)) {
      throw new Error(`to currency ${String(to)} is not supported`);
    }
    if (from === to) {
      return amount;
    }
    const rates = await this.ratesFor(from);
    if (rates === null) {
      return null;
    }
    const rate = rates[to];
    if (typeof rate !== 'number' || !Number.isFinite(rate)) {
      return null;
    }
    return amount * rate;
  }

  private async ratesFor(base: Currency): Promise<Record<string, number> | null> {
    const cached = this.cache.get(base);
    const now = Date.now();
    if (cached !== undefined && now - cached.fetchedAt < this.cacheTtlMs) {
      return cached.rates;
    }
    try {
      const rates = await this.frankfurterClient.fetchRates(base);
      this.cache.set(base, { fetchedAt: now, rates });
      return rates;
    } catch {
      return null;
    }
  }
}
