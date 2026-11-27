import { Bid } from './Bid.js';
import { Item } from './Item.js';
import { EventFeed } from './EventFeed.js';

/**
 * Publishes accepted bid events to the internal ws event feed.
 *
 * @trace DSN-031 REQ-003 REQ-007 REQ-011
 */
export class BidEventPublisher {
  constructor(private readonly eventFeed: EventFeed) {}

  /** Publishes an accepted bid to the item's topic; throws if the bid does not belong to the item. */
  async publishBidAccepted(bid: Bid, item: Item): Promise<void> {
    if (bid.itemId !== item.id) {
      throw new Error(`Bid ${bid.id} does not belong to item ${item.id}`);
    }
    const payload = JSON.stringify({
      bidId: bid.id,
      itemId: item.id,
      bidderId: bid.bidderId,
      amount: bid.amount,
      placedAt: bid.placedAt.toISOString(),
      highestBidAmount: item.highestBidAmount,
      highestBidderId: item.highestBidderId,
      endTime: item.endTime.toISOString(),
      status: item.status,
    });
    this.eventFeed.publish(`item:${item.id}`, payload);
  }
}
