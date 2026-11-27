import { ItemService } from './ItemService.js';

/**
 * Periodic job that closes auctions whose end time was reached.
 * @trace DSN-024 REQ-004
 */
export class AuctionCloser {
  /** Validates intervalMs, which must be a positive integer. */
  constructor(private readonly itemService: ItemService, public intervalMs: number) {
    if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
      throw new Error('intervalMs must be a positive integer');
    }
  }

  /** Closes every auction whose end time has been reached at the current time. */
  async tick(): Promise<void> {
    await this.itemService.closeDueAuctions(new Date());
  }
}
