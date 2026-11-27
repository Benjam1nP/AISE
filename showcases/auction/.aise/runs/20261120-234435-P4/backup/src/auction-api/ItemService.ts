import { randomUUID } from 'node:crypto';
import { Item } from './Item.js';
import { Currency } from './Currency.js';
import { AuctionStatus } from './AuctionStatus.js';
import { UserStore } from './UserStore.js';
import { ItemStore } from './ItemStore.js';
import { AuctionEventPublisher } from './AuctionEventPublisher.js';

/**
 * Creates and reads items, closes due auctions.
 * @trace DSN-022 REQ-001 REQ-004
 */
export class ItemService {
  constructor(private readonly itemStore: ItemStore, private readonly userStore: UserStore, private readonly auctionEventPublisher: AuctionEventPublisher) {}

  async listItem(sellerId: string, title: string, startingPrice: number, endTime: Date, currency: string): Promise<Item> {
    if (!sellerId || sellerId.trim() === '') {
      throw new Error('Seller id is required');
    }
    if (!title || title.trim() === '') {
      throw new Error('Title is required');
    }
    if (typeof startingPrice !== 'number' || !Number.isFinite(startingPrice) || startingPrice < 0) {
      throw new Error('Starting price is required and must be a non-negative number');
    }
    if (!(endTime instanceof Date) || Number.isNaN(endTime.getTime())) {
      throw new Error('End time is required');
    }
    if (endTime.getTime() <= Date.now()) {
      throw new Error('End time must be in the future');
    }
    const allowed = Object.values(Currency) as string[];
    if (!currency || !allowed.includes(currency)) {
      throw new Error('Currency must be one of CHF, EUR or USD');
    }
    const item = new Item(
      randomUUID(),
      sellerId,
      title,
      startingPrice,
      currency as Currency,
      endTime,
      AuctionStatus.open,
      null,
      null,
      null,
    );
    return this.itemStore.saveItem(item);
  }

  async getItem(id: string): Promise<Item> {
    const item = await this.itemStore.findItem(id);
    if (!item) {
      throw new Error(`Item ${id} not found`);
    }
    return item;
  }

  async listOpenItems(): Promise<Item[]> {
    return this.itemStore.findOpenItems();
  }

  async closeDueAuctions(now: Date): Promise<void> {
    const dueItems = await this.itemStore.findDueItems(now);
    const closedStatus = (Object.values(AuctionStatus) as AuctionStatus[]).find((s) => s !== AuctionStatus.open) ?? AuctionStatus.open;
    for (const item of dueItems) {
      if (item.extendIfLate(now)) {
        await this.itemStore.saveItem(item);
        continue;
      }
      item.winnerId = item.highestBidderId;
      item.status = closedStatus;
      await this.itemStore.saveItem(item);
      await this.auctionEventPublisher.publishAuctionClosed(item);
    }
  }
}
