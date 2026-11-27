import { DatabaseSync } from 'node:sqlite';
import { Item } from './Item.js';
import { Bid } from './Bid.js';

type Currency = Item['currency'];
type AuctionStatus = Item['status'];

type ItemRow = {
  id: string;
  seller_id: string;
  title: string;
  starting_price: number;
  currency: string;
  end_time: number;
  status: string;
  highest_bid_amount: number | null;
  highest_bidder_id: string | null;
  winner_id: string | null;
};

type BidRow = {
  id: string;
  item_id: string;
  bidder_id: string;
  amount: number;
  placed_at: number;
};

/**
 * Persistence of items and bids, in the API server's SQLite database.
 * @trace DSN-029 REQ-001 REQ-002 REQ-004
 */
export class ItemStore {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        seller_id TEXT NOT NULL,
        title TEXT NOT NULL,
        starting_price REAL NOT NULL,
        currency TEXT NOT NULL,
        end_time INTEGER NOT NULL,
        status TEXT NOT NULL,
        highest_bid_amount REAL,
        highest_bidder_id TEXT,
        winner_id TEXT
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bids (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        bidder_id TEXT NOT NULL,
        amount REAL NOT NULL,
        placed_at INTEGER NOT NULL
      )
    `);
  }

  async saveItem(item: Item): Promise<Item> {
    if (!item.id) {
      throw new Error('Item id is required');
    }
    this.db
      .prepare(
        `INSERT INTO items (id, seller_id, title, starting_price, currency, end_time, status,
           highest_bid_amount, highest_bidder_id, winner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           seller_id = excluded.seller_id,
           title = excluded.title,
           starting_price = excluded.starting_price,
           currency = excluded.currency,
           end_time = excluded.end_time,
           status = excluded.status,
           highest_bid_amount = excluded.highest_bid_amount,
           highest_bidder_id = excluded.highest_bidder_id,
           winner_id = excluded.winner_id`
      )
      .run(
        item.id,
        item.sellerId,
        item.title,
        item.startingPrice,
        item.currency,
        item.endTime.getTime(),
        item.status,
        item.highestBidAmount,
        item.highestBidderId,
        item.winnerId
      );
    return item;
  }

  async findItem(id: string): Promise<Item | null> {
    const rows = this.db
      .prepare('SELECT * FROM items WHERE id = ?')
      .all(id) as unknown as ItemRow[];
    return rows.length > 0 ? this.toItem(rows[0]) : null;
  }

  async findOpenItems(): Promise<Item[]> {
    const rows = this.db
      .prepare('SELECT * FROM items WHERE status = ? ORDER BY end_time ASC')
      .all('open') as unknown as ItemRow[];
    return rows.map((row) => this.toItem(row));
  }

  async findDueItems(now: Date): Promise<Item[]> {
    const rows = this.db
      .prepare('SELECT * FROM items WHERE status = ? AND end_time <= ? ORDER BY end_time ASC')
      .all('open', now.getTime()) as unknown as ItemRow[];
    return rows.map((row) => this.toItem(row));
  }

  async saveBid(bid: Bid): Promise<Bid> {
    if (!bid.id) {
      throw new Error('Bid id is required');
    }
    this.db
      .prepare(
        `INSERT INTO bids (id, item_id, bidder_id, amount, placed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           item_id = excluded.item_id,
           bidder_id = excluded.bidder_id,
           amount = excluded.amount,
           placed_at = excluded.placed_at`
      )
      .run(bid.id, bid.itemId, bid.bidderId, bid.amount, bid.placedAt.getTime());
    return bid;
  }

  private toItem(row: ItemRow): Item {
    return new Item(
      row.id,
      row.seller_id,
      row.title,
      row.starting_price,
      row.currency as Currency,
      new Date(row.end_time),
      row.status as AuctionStatus,
      row.highest_bid_amount,
      row.highest_bidder_id,
      row.winner_id
    );
  }

  private toBid(row: BidRow): Bid {
    return new Bid(row.id, row.item_id, row.bidder_id, row.amount, new Date(row.placed_at));
  }
}
