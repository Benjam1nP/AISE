import { Bid } from './Bid.js';
import { BidService } from './BidService.js';

/**
 * HTTP route handler that places bids on auction items.
 *
 * @trace DSN-020 REQ-002
 */
export class BidController {
  constructor(private readonly bidService: BidService) {}

  /** Places a bid on an item for a bidder; throws when the ids are empty or the bid is rejected. */
  async placeBid(itemId: string, userId: string, amount: number): Promise<Bid> {
    if (typeof itemId !== 'string' || itemId.length === 0) {
      throw new Error('itemId must be a non-empty string');
    }
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new Error('userId must be a non-empty string');
    }
    return this.bidService.placeBid(itemId, userId, amount);
  }
}
