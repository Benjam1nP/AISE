import { randomUUID } from 'node:crypto';
import { Bid } from './Bid.js';
import { Item } from './Item.js';
import { ItemStore } from './ItemStore.js';
import { UserStore } from './UserStore.js';
import { BidEventPublisher } from './BidEventPublisher.js';

/**
 * Validates and stores bids, extends end time, and publishes accepted bids to the event feed.
 *
 * @trace DSN-023 REQ-002 REQ-009 REQ-003 REQ-011
 */
export class BidService {
  constructor(
    private readonly itemStore: ItemStore,
    private readonly bidEventPublisher: BidEventPublisher,
    private readonly userStore: UserStore,
  ) {}

  /** Accepts a valid bid, extends a late auction, and publishes it; throws on invalid input, unknown item or bidder, or a rejected bid. */
  async placeBid(itemId: string, bidderId: string, amount: number): Promise<Bid> {
    if (typeof itemId !== 'string' || itemId.length === 0) {
      throw new Error('itemId must be a non-empty string');
    }
    if (typeof bidderId !== 'string' || bidderId.length === 0) {
      throw new Error('bidderId must be a non-empty string');
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new Error('amount must be a positive number');
    }

    const item = await this.itemStore.findItem(itemId);
    if (item === null) {
      throw new Error(`Item ${itemId} not found`);
    }
    const bidder = await this.userStore.findById(bidderId);
    if (bidder === null) {
      throw new Error(`User ${bidderId} not found`);
    }

    const now = new Date();
    if (!item.isOpen(now)) {
      throw new Error(`Item ${itemId} is not open for bids`);
    }
    if (item.sellerId === bidderId) {
      throw new Error('The seller cannot bid on their own item');
    }
    const minimum = item.minimumBid();
    if (amount < minimum) {
      throw new Error(`Bid must be at least ${minimum}`);
    }

    const bid = await this.itemStore.saveBid(new Bid(randomUUID(), itemId, bidderId, amount, now));
    item.extendIfLate(now);
    await this.itemStore.saveItem(item);
    await this.bidEventPublisher.publishBidAccepted(bid, item);
    return bid;
  }
}
