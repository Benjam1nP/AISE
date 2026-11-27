import { Item } from './Item.js';
import { Currency } from './Currency.js';

/**
 * Item as shown to a client, with optional converted prices.
 *
 * @trace DSN-017 REQ-005 REQ-010
 */
export interface ItemView {
  item: Item;
  displayCurrency: Currency | null;
  convertedStartingPrice: number | null;
  convertedHighestBid: number | null;
}
