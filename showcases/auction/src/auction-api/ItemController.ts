import { PublicItem } from './PublicItem.js';
import { ItemView } from './ItemView.js';
import { ItemService } from './ItemService.js';
import { ExchangeRateService } from '../exchange-rates/ExchangeRateService.js';
import { Currency } from './Currency.js';

const SUPPORTED_CURRENCIES: readonly string[] = [Currency.CHF, Currency.EUR, Currency.USD];

function requireText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseCurrency(value: unknown, name: string): Currency {
  if (typeof value !== 'string' || !SUPPORTED_CURRENCIES.includes(value)) {
    throw new Error(`${name} must be one of CHF, EUR, USD`);
  }
  return value as Currency;
}

/**
 * HTTP-facing controller for items: listing, viewing and listing open auctions.
 * @trace DSN-019 REQ-001 REQ-005 REQ-004 REQ-012
 */
export class ItemController {
  constructor(private readonly itemService: ItemService, private readonly exchangeRateService: ExchangeRateService) {}

  /** Lists a new item for a seller; throws an Error when a field is missing, the currency is not CHF, EUR or USD, or the reserve is invalid. */
  async listItem(userId: string, title: string, startingPrice: number, endTime: string, currency: string, reservePrice: number | null): Promise<PublicItem> {
    requireText(userId, 'userId');
    requireText(title, 'title');
    if (typeof startingPrice !== 'number' || !Number.isFinite(startingPrice) || startingPrice < 0) {
      throw new Error('startingPrice must be a non-negative number');
    }
    if (reservePrice !== null && reservePrice !== undefined && (typeof reservePrice !== 'number' || !Number.isFinite(reservePrice))) {
      throw new Error('reservePrice must be a number');
    }
    const end = new Date(requireText(endTime, 'endTime'));
    if (Number.isNaN(end.getTime())) {
      throw new Error('endTime must be a valid date');
    }
    const itemCurrency = parseCurrency(currency, 'currency');
    return this.itemService.listItem(userId, title, startingPrice, end, itemCurrency, reservePrice ?? null);
  }

  /** Returns an item with prices converted to the display currency when one is given; throws Item <id> not found when missing. */
  async getItem(id: string, displayCurrency: string | undefined): Promise<ItemView> {
    requireText(id, 'id');
    const item = await this.itemService.getItem(id);
    if (displayCurrency === undefined) {
      return { item, displayCurrency: null, convertedStartingPrice: null, convertedHighestBid: null };
    }
    const target = parseCurrency(displayCurrency, 'displayCurrency');
    const convertedStartingPrice = await this.exchangeRateService.convert(item.startingPrice, item.currency, target);
    const convertedHighestBid =
      item.highestBidAmount === null
        ? null
        : await this.exchangeRateService.convert(item.highestBidAmount, item.currency, target);
    return { item, displayCurrency: target, convertedStartingPrice, convertedHighestBid };
  }

  /** Returns all items whose auctions are currently open. */
  async listOpenItems(): Promise<PublicItem[]> {
    return this.itemService.listOpenItems();
  }
}
