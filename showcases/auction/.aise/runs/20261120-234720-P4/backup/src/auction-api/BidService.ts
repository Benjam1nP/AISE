import { Bid } from './Bid.js';
import { Item } from './Item.js';
import { ItemStore } from './ItemStore.js';
import { UserStore } from './UserStore.js';
import { BidEventPublisher } from './BidEventPublisher.js';

/**
 * Validates and stores bids, extends end time, publishes events to the event feed.
 *
 * @trace DSN-023 REQ-002 REQ-009 REQ-003 REQ-011
 */
export class BidService {
  private nextBidNumber = 1;

  constructor(
    private readonly itemStore: ItemStore,
    private readonly bidEventPublisher: BidEventPublisher,
    private readonly userStore: UserStore,
  ) {}

  async placeBid(itemId: string, bidderId: string, amount: number): Promise<Bid> {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new Error('Bid amount must be a positive number');
    }
    if (!bidderId || bidderId.trim() === '') {
      throw new Error('Bidder id is required');
    }
    const item = await this.itemStore.findItem(itemId);
    if (item === null) {
      throw new Error(`Item ${itemId} not found`);
    }
    const now = new Date();
    if (!item.isOpen(now)) {
      throw new Error(`Item ${itemId} is not open for bids`);
    }
    if (item.sellerId === bidderId) {
      throw new Error('Sellers cannot bid on their own item');
    }
    const minimum = item.minimumBid();
    if (amount < minimum) {
      throw new Error(`Bid ${amount} is below the minimum bid ${minimum}`);
    }

    const bid = new Bid(
      `bid-${this.nextBidNumber++}`,
      item.id,
      bidderId,
      amount,
      now,
    );

    item.highestBidAmount = amount;
    item.highestBidderId = bidderId;
    item.extendIfLate(now);

    await this.itemStore.saveBid(bid);
    await this.itemStore.saveItem(item);
    await this.bidEventPublisher.publishBidAccepted(bid, item);
    return bid;
  }
}
