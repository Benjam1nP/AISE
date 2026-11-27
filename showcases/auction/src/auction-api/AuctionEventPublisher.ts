import { EventFeed } from './EventFeed.js';
import { Item } from './Item.js';

/**
 * Publishes auction closed events to the internal ws event feed.
 *
 * @trace DSN-030 REQ-003 REQ-004 REQ-007
 */
export class AuctionEventPublisher {
  constructor(private readonly eventFeed: EventFeed) {}

  /** Publishes the closed state and winner of an item to its watchers; throws Error if the item has no id. */
  async publishAuctionClosed(item: Item): Promise<void> {
    if (typeof item.id !== 'string' || item.id.length === 0) {
      throw new Error('item.id must be a non-empty string');
    }
    const payload = JSON.stringify({
      type: 'auction_closed',
      itemId: item.id,
      status: item.status,
      winnerId: item.winnerId,
      highestBidAmount: item.highestBidAmount,
    });
    this.eventFeed.publish(`item:${item.id}`, payload);
  }
}
