import { Currency } from '../auction-api/Currency.js';
import { ApiClient } from './ApiClient.js';

/**
 * Page listing open items, with a form to list a new item.
 *
 * @trace DSN-040 REQ-001 REQ-005
 */
export class ItemListPage {
  private openItemCount: number = 0;
  private lastError: string | null = null;

  constructor(private readonly apiClient: ApiClient) {}

  async show(): Promise<void> {
    const items = await this.apiClient.listOpenItems();
    this.openItemCount = items.length;
    this.lastError = null;
  }

  async listItem(title: string, startingPrice: number, endTime: string, currency: Currency): Promise<void> {
    if (!title || title.trim().length === 0) {
      throw new Error('Title is required');
    }
    if (typeof startingPrice !== 'number' || !Number.isFinite(startingPrice) || startingPrice <= 0) {
      throw new Error('Starting price must be a positive number');
    }
    if (!endTime || endTime.trim().length === 0) {
      throw new Error('End time is required');
    }
    if (!currency) {
      throw new Error('Currency is required');
    }
    if (!(Object.values(Currency) as string[]).includes(currency)) {
      throw new Error(`Currency ${String(currency)} is not supported; use CHF, EUR or USD`);
    }
    await this.apiClient.listItem(title.trim(), startingPrice, endTime, currency);
    await this.show();
  }
}
