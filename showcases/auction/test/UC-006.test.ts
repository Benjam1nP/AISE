import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { AuctionEventPublisher } from '../src/auction-api/AuctionEventPublisher.js';
import { BidEventPublisher } from '../src/auction-api/BidEventPublisher.js';
import { BidService } from '../src/auction-api/BidService.js';
import { EventFeed } from '../src/auction-api/EventFeed.js';
import { ItemStore } from '../src/auction-api/ItemStore.js';
import { Currency } from '../src/auction-api/Currency.js';
import { ItemController } from '../src/auction-api/ItemController.js';
import type { ItemView } from '../src/auction-api/ItemView.js';
import { ItemService } from '../src/auction-api/ItemService.js';
import { ExchangeRateService } from '../src/exchange-rates/ExchangeRateService.js';
import { FrankfurterClient } from '../src/exchange-rates/FrankfurterClient.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

type Item = ItemView['item'];

function makeItem(): Item {
  return {
    id: 'item-1',
    title: 'Vase',
    startingPrice: 100,
    currency: 'CHF',
    highestBidAmount: 150,
    reserveMet: true,
  } as unknown as Item;
}

function makeFakes(rates: Record<string, number> = { EUR: 0.5, USD: 2 }) {
  const fetchRates = vi.fn(async (_base: Currency) => ({ ...rates }));
  const frankfurterClient = { fetchRates } as unknown as FrankfurterClient;
  const exchangeRateService = new ExchangeRateService(frankfurterClient, ONE_HOUR_MS);
  const getItem = vi.fn(async (_id: string) => makeItem());
  const itemService = {
    getItem,
    listOpenItems: vi.fn(async () => []),
  } as unknown as ItemService;
  const controller = new ItemController(itemService, exchangeRateService);
  return { fetchRates, getItem, itemService, exchangeRateService, controller };
}

// The real services over an in-memory store, so the reserve state is computed, not faked.
function makeReal() {
  const store = new ItemStore(new DatabaseSync(':memory:'));
  const feed = new EventFeed(new Set());
  const users = new Proxy({}, { get: () => async () => ({ id: 'user' }) }) as never;
  const itemService = new ItemService(store, users, new AuctionEventPublisher(feed));
  const bidService = new BidService(store, new BidEventPublisher(feed), users);
  const fetchRates = vi.fn(async (_base: Currency) => ({ EUR: 0.5, USD: 2 }));
  const rates = new ExchangeRateService({ fetchRates } as unknown as FrankfurterClient, ONE_HOUR_MS);
  return { itemService, bidService, controller: new ItemController(itemService, rates) };
}

describe('UC-006 View prices in display currency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('REQ-005 AC1: A bidder who selects CHF, EUR or USD sees item prices and bids converted with a rate obtained from Frankfurter.', async () => {
    const { controller, fetchRates } = makeFakes({ EUR: 0.5, USD: 2 });
    const view = await controller.getItem('item-1', 'EUR');
    expect(fetchRates).toHaveBeenCalledWith(Currency.CHF);
    expect(view.displayCurrency).toBe(Currency.EUR);
    expect(view.convertedStartingPrice).toBeCloseTo(50);
    expect(view.convertedHighestBid).toBeCloseTo(75);
  });

  it('REQ-005 AC2: Only CHF, EUR and USD are offered as display currencies.', async () => {
    const { controller } = makeFakes();
    await expect(controller.getItem('item-1', 'GBP')).rejects.toThrow();
  });

  it('REQ-005 AC3: Converted prices are shown with the currency code.', async () => {
    const { controller } = makeFakes({ EUR: 0.5, USD: 2 });
    const view = await controller.getItem('item-1', 'USD');
    expect(view.displayCurrency).toBe('USD');
    expect(view.convertedStartingPrice).not.toBeNull();
  });

  it('REQ-005 AC4: Conversion is for display only: stored bids and bid validation use the item currency.', async () => {
    const { controller } = makeFakes({ EUR: 0.5, USD: 2 });
    const view = await controller.getItem('item-1', 'EUR');
    expect(view.item.currency).toBe('CHF');
    expect(view.item.startingPrice).toBe(100);
  });

  it('REQ-010 AC1: Within 1 hour of a successful fetch, no further request is made to Frankfurter for the same rates.', async () => {
    const { exchangeRateService, fetchRates } = makeFakes();
    await exchangeRateService.convert(100, Currency.CHF, Currency.EUR);
    vi.advanceTimersByTime(30 * 60 * 1000);
    await exchangeRateService.convert(100, Currency.CHF, Currency.USD);
    expect(fetchRates).toHaveBeenCalledTimes(1);
  });

  it('REQ-010 AC2: After the cache is older than 1 hour, the next conversion fetches fresh rates.', async () => {
    const { exchangeRateService, fetchRates } = makeFakes();
    await exchangeRateService.convert(100, Currency.CHF, Currency.EUR);
    vi.advanceTimersByTime(ONE_HOUR_MS + 1000);
    await exchangeRateService.convert(100, Currency.CHF, Currency.EUR);
    expect(fetchRates).toHaveBeenCalledTimes(2);
  });

  it('REQ-010 AC3: When Frankfurter cannot be reached and no valid cached rate exists, prices are shown only in the item currency and bidding still works.', async () => {
    const { controller, fetchRates, exchangeRateService } = makeFakes();
    fetchRates.mockRejectedValue(new Error('network down'));
    const view = await controller.getItem('item-1', 'EUR');
    expect(view.convertedStartingPrice).toBeNull();
    expect(view.convertedHighestBid).toBeNull();
    expect(view.item.currency).toBe('CHF');
    await expect(exchangeRateService.convert(100, Currency.CHF, Currency.EUR)).resolves.toBeNull();
  });

  it('REQ-012 AC6: Item pages and lists of open items show whether the reserve is met (reserve met / not met) for items that have a reserve.', async () => {
    const { itemService, bidService, controller } = makeReal();
    const end = new Date('2030-01-01T01:00:00Z');
    const reserved = await itemService.listItem('seller-1', 'Vase', 100, end, 'CHF', 4321);
    const plain = await itemService.listItem('seller-1', 'Lamp', 100, end, 'CHF', null);

    // Below the reserve: not met, on the item page and in the list of open items.
    await bidService.placeBid(reserved.id, 'bidder-1', 200);
    expect((await controller.getItem(reserved.id, 'EUR')).item.reserveMet).toBe(false);
    let list = await controller.listOpenItems();
    expect(list.find((i) => i.id === reserved.id)?.reserveMet).toBe(false);

    // Above the reserve: met. (Not at it: the highest bid would then show the reserve amount.)
    await bidService.placeBid(reserved.id, 'bidder-2', 4400);
    const view = await controller.getItem(reserved.id, 'EUR');
    expect(view.item.reserveMet).toBe(true);
    list = await controller.listOpenItems();
    expect(list.find((i) => i.id === reserved.id)?.reserveMet).toBe(true);

    // Without a reserve there is no state to show.
    expect((await controller.getItem(plain.id, 'EUR')).item.reserveMet).toBeNull();
    // Never the amount.
    for (const text of [JSON.stringify(view), JSON.stringify(list)]) {
      expect(text).not.toContain('4321');
      expect(text).not.toContain('reservePrice');
    }
  });

  it('SEQ-006 scenario: View prices in display currency', async () => {
    const { controller, getItem, fetchRates } = makeFakes({ EUR: 0.5, USD: 2 });
    const view = await controller.getItem('item-1', 'EUR');
    expect(getItem).toHaveBeenCalledWith('item-1');
    expect(fetchRates).toHaveBeenCalledTimes(1);
    expect(view.displayCurrency).toBe(Currency.EUR);
    expect(view.item.reserveMet).toBe(true);
    expect(JSON.stringify(view)).not.toContain('reservePrice');
  });
});
