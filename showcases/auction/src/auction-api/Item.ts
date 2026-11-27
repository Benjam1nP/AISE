import { Currency } from './Currency.js';
import { AuctionStatus } from './AuctionStatus.js';

const LATE_WINDOW_MS = 2 * 60 * 1000;
const EXTENSION_MS = 2 * 60 * 1000;

/**
 * Auction item listed by a seller, with prices in the item currency.
 * @trace DSN-015 REQ-001 REQ-002 REQ-004 REQ-009
 */
export class Item {
  constructor(public id: string, public sellerId: string, public title: string, public startingPrice: number, public currency: Currency, public endTime: Date, public status: AuctionStatus, public highestBidAmount: number | null, public highestBidderId: string | null, public winnerId: string | null) {
    if (!Number.isFinite(startingPrice) || startingPrice < 0) {
      throw new Error('Starting price must be a non-negative number');
    }
    if (!Object.values(Currency).includes(currency)) {
      throw new Error('Currency must be CHF, EUR or USD');
    }
    if (!(endTime instanceof Date) || Number.isNaN(endTime.getTime())) {
      throw new Error('End time must be a valid date');
    }
  }

  /** Returns true when the auction is open and its end time has not been reached at the given time. */
  isOpen(now: Date): boolean {
    return this.status === AuctionStatus.open && now.getTime() < this.endTime.getTime();
  }

  /** Returns the lowest amount a new bid must reach: the starting price, or one unit above the highest bid. */
  minimumBid(): number {
    return this.highestBidAmount === null ? this.startingPrice : this.highestBidAmount + 1;
  }

  /** Moves the end time 2 minutes later when the auction is open and now is within the last 2 minutes; returns whether it did. */
  extendIfLate(now: Date): boolean {
    if (!this.isOpen(now)) {
      return false;
    }
    if (this.endTime.getTime() - now.getTime() <= LATE_WINDOW_MS) {
      this.endTime = new Date(this.endTime.getTime() + EXTENSION_MS);
      return true;
    }
    return false;
  }

  /** Records a bid as the new highest bid; throws when the auction is not open, the bidder is the seller, or the amount is below the minimum bid. */
  recordBid(bidderId: string, amount: number): void {
    if (typeof bidderId !== 'string' || bidderId.length === 0) {
      throw new Error('bidderId must be a non-empty string');
    }
    if (!Number.isFinite(amount)) {
      throw new Error('Bid amount must be a finite number');
    }
    if (this.status !== AuctionStatus.open) {
      throw new Error(`Item ${this.id} is not open for bids`);
    }
    if (bidderId === this.sellerId) {
      throw new Error('Seller cannot bid on their own item');
    }
    if (amount < this.minimumBid()) {
      throw new Error(`Bid must be at least ${this.minimumBid()} ${this.currency}`);
    }
    this.highestBidAmount = amount;
    this.highestBidderId = bidderId;
  }
}
