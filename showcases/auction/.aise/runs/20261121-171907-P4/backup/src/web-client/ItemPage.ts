import { Currency } from '../auction-api/Currency.js';
import { ApiClient } from './ApiClient.js';
import { LiveClient } from './LiveClient.js';
import { SessionStore } from './SessionStore.js';

const SUPPORTED_CURRENCIES: readonly Currency[] = [Currency.CHF, Currency.EUR, Currency.USD];

/**
 * Item page with live bids, bid form, closed/winner/unsold state and a display currency picker (CHF, EUR, USD).
 * @trace DSN-041 REQ-002 REQ-003 REQ-004 REQ-005 REQ-009
 */
export class ItemPage {
  private currentItemId: string | null = null;
  private lastView: unknown = null;
  private readonly session: SessionStore = new SessionStore(null, null, null);
  private updates: string[] = [];

  constructor(private readonly apiClient: ApiClient, private readonly liveClient: LiveClient) {}

  async open(itemId: string): Promise<void> {
    if (!itemId || itemId.trim().length === 0) {
      throw new Error('Item id is required');
    }
    if (this.currentItemId !== null && this.currentItemId !== itemId) {
      this.liveClient.unwatch(this.currentItemId);
    }
    this.currentItemId = itemId;
    this.liveClient.watch(itemId);
    await this.refresh(itemId);
  }

  close(): void {
    if (this.currentItemId !== null) {
      this.liveClient.unwatch(this.currentItemId);
    }
    this.currentItemId = null;
    this.lastView = null;
  }

  async placeBid(amount: number): Promise<void> {
    if (this.currentItemId === null) {
      throw new Error('No item is open');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Bid amount must be a positive number');
    }
    const itemId = this.currentItemId;
    await this.apiClient.placeBid(itemId, amount);
    await this.refresh(itemId);
  }

  async selectCurrency(currency: Currency): Promise<void> {
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
      throw new Error(`Currency ${String(currency)} is not supported`);
    }
    this.session.setDisplayCurrency(currency);
    if (this.currentItemId !== null) {
      await this.refresh(this.currentItemId);
    }
  }

  showUpdate(message: string): void {
    this.updates.push(message);
    if (this.updates.length > 100) {
      this.updates = this.updates.slice(this.updates.length - 100);
    }
  }

  private async refresh(itemId: string): Promise<void> {
    const displayCurrency = this.session.displayCurrency;
    const view = await this.apiClient.getItem(itemId, displayCurrency);
    if (this.currentItemId !== itemId) {
      return;
    }
    this.lastView = view;
    this.updates.push(`Item ${itemId} loaded${displayCurrency ? ` in ${displayCurrency}` : ''}`);
  }
}
