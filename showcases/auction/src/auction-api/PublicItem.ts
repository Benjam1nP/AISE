import { Currency } from './Currency.js';
import { AuctionStatus } from './AuctionStatus.js';

/**
 * Item data sent to bidders in API responses and lists, never containing the reserve amount.
 *
 * @trace DSN-044 REQ-012
 */
export interface PublicItem {
  id: string;
  sellerId: string;
  title: string;
  startingPrice: number;
  currency: Currency;
  endTime: Date;
  status: AuctionStatus;
  highestBidAmount: number | null;
  highestBidderId: string | null;
  winnerId: string | null;
  reserveMet: boolean | null;
}
