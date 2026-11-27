import { Currency } from '../auction-api/Currency.js';
import { User } from '../auction-api/User.js';

/**
 * Browser storage (localStorage) for the issued user id, display name and chosen display currency.
 * @trace DSN-036 REQ-008 REQ-005
 */
export class SessionStore {
  private static readonly USER_ID_KEY = 'auction.userId';
  private static readonly DISPLAY_NAME_KEY = 'auction.displayName';
  private static readonly CURRENCY_KEY = 'auction.displayCurrency';

  constructor(public userId: string | null, public displayName: string | null, public displayCurrency: Currency | null) {
    this.userId = userId;
    this.displayName = displayName;
    this.displayCurrency = displayCurrency;
  }

  save(user: User): void {
    if (!user || typeof user.id !== 'string' || user.id.length === 0) {
      throw new Error('User id is required');
    }
    this.userId = user.id;
    this.displayName = user.displayName;
    this.persist(SessionStore.USER_ID_KEY, user.id);
    this.persist(SessionStore.DISPLAY_NAME_KEY, user.displayName);
  }

  setDisplayCurrency(currency: Currency): void {
    const allowed: string[] = [Currency.CHF, Currency.EUR, Currency.USD];
    if (!allowed.includes(currency)) {
      throw new Error(`Unsupported display currency ${String(currency)}`);
    }
    this.displayCurrency = currency;
    this.persist(SessionStore.CURRENCY_KEY, currency);
  }

  private persist(key: string, value: string): void {
    const storage = (globalThis as { localStorage?: { setItem(k: string, v: string): void } }).localStorage;
    if (storage) {
      storage.setItem(key, value);
    }
  }
}
