import { randomUUID } from 'node:crypto';
import { Item } from './Item.js';
import { ItemStore } from './ItemStore.js';
import { UserStore } from './UserStore.js';
import { AuctionEventPublisher } from './AuctionEventPublisher.js';
import { Currency } from './Currency.js';
import { AuctionStatus } from './AuctionStatus.js';

/**
 * Creates and reads items, and closes auctions whose end time has been reached.
 * @trace DSN-022 REQ-001 REQ-004
 */
export class ItemService {
  constructor(private readonly itemStore: ItemStore, private readonly userStore: UserStore, private readonly auctionEventPublisher: AuctionEventPublisher) {}

  /** Lists a new open item for an existing seller; throws on invalid input or unknown seller. */
  async listItem(sellerId: string, title: string, startingPrice: number, endTime: Date, currency: string): Promise<Item> {
    if (typeof sellerId !== 'string' || sellerId.trim() === '') {
      throw new Error('sellerId must be a non-empty string');
    }
    const seller = await this.userStore.findById(sellerId);
    if (seller === null) {
      throw new Error(`User ${sellerId} not found`);
    }
    if (typeof title !== 'string' || title.trim() === '') {
      throw new Error('title must be a non-empty string');
    }
    if (typeof startingPrice !== 'number' || !Number.isFinite(startingPrice) || startingPrice < 0) {
      throw new Error('startingPrice must be a non-negative number');
    }
    if (!(endTime instanceof Date) || Number.isNaN(endTime.getTime())) {
      throw new Error('endTime must be a valid date');
    }
    if (!(Object.values(Currency) as string[]).includes(currency)) {
      throw new Error('currency must be one of CHF, EUR, USD');
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

  /** Returns the item with the given id; throws if the id is invalid or the item is not found. */
  async getItem(id: string): Promise<Item> {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('id must be a non-empty string');
    }
    const item = await this.itemStore.findItem(id);
    if (item === null) {
      throw new Error(`Item ${id} not found`);
    }
    return item;
  }

  /** Returns all items whose auctions are currently open. */
  async listOpenItems(): Promise<Item[]> {
    return this.itemStore.findOpenItems();
  }

  /** Closes every open auction due at the given time, marking winners or unsold items and publishing each closure. */
  async closeDueAuctions(now: Date): Promise<void> {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new Error('now must be a valid date');
    }
    const dueItems = await this.itemStore.findDueItems(now);
    for (const item of dueItems) {
      if (item.highestBidAmount === null || item.highestBidderId === null) {
        item.status = AuctionStatus.unsold;
        item.winnerId = null;
      } else {
        item.status = AuctionStatus.closed;
        item.winnerId = item.highestBidderId;
      }
      await this.itemStore.saveItem(item);
      await this.auctionEventPublisher.publishAuctionClosed(item);
    }
  }
}
