import { DatabaseSync } from 'node:sqlite';
import { Item } from './Item.js';
import { Bid } from './Bid.js';
import { Currency } from './Currency.js';
import { AuctionStatus } from './AuctionStatus.js';

/**
 * Persistence of items and bids, in the API server's SQLite database.
 *
 * @trace DSN-029 REQ-001 REQ-002 REQ-004
 */
export class ItemStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      sellerId TEXT NOT NULL,
      title TEXT NOT NULL,
      startingPrice REAL NOT NULL,
      currency TEXT NOT NULL,
      endTime TEXT NOT NULL,
      status TEXT NOT NULL,
      highestBidAmount REAL,
      highestBidderId TEXT,
      winnerId TEXT
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS bids (
      id TEXT PRIMARY KEY,
      itemId TEXT NOT NULL,
      bidderId TEXT NOT NULL,
      amount REAL NOT NULL,
      placedAt TEXT NOT NULL
    )`);
  }

  /** Inserts the item if its id is new, otherwise updates its stored row. */
  async saveItem(item: Item): Promise<Item> {
    const exists = this.db.prepare('SELECT id FROM items WHERE id = ?').get(item.id) !== undefined;
    if (exists) {
      this.db
        .prepare(`UPDATE items SET sellerId = ?, title = ?, startingPrice = ?, currency = ?, endTime = ?,
          status = ?, highestBidAmount = ?, highestBidderId = ?, winnerId = ? WHERE id = ?`)
        .run(
          item.sellerId,
          item.title,
          item.startingPrice,
          item.currency,
          item.endTime.toISOString(),
          item.status,
          item.highestBidAmount,
          item.highestBidderId,
          item.winnerId,
          item.id,
        );
    } else {
      this.db
        .prepare(`INSERT INTO items (id, sellerId, title, startingPrice, currency, endTime, status,
          highestBidAmount, highestBidderId, winnerId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          item.id,
          item.sellerId,
          item.title,
          item.startingPrice,
          item.currency,
          item.endTime.toISOString(),
          item.status,
          item.highestBidAmount,
          item.highestBidderId,
          item.winnerId,
        );
    }
    return item;
  }

  /** Returns the item with the given id, or null when it is not stored. */
  async findItem(id: string): Promise<Item | null> {
    const row = this.db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    if (row === undefined) {
      return null;
    }
    return this.toItem(row as unknown as ItemRow);
  }

  /** Returns all items whose status is open, the one ending soonest first. */
  async findOpenItems(): Promise<Item[]> {
    const rows = this.db
      .prepare('SELECT * FROM items WHERE status = ? ORDER BY endTime ASC')
      .all(AuctionStatus.open) as unknown as ItemRow[];
    return rows.map((row) => this.toItem(row));
  }

  /** Returns the open items whose end time is not after the given instant. */
  async findDueItems(now: Date): Promise<Item[]> {
    const rows = this.db
      .prepare('SELECT * FROM items WHERE status = ? AND endTime <= ? ORDER BY endTime ASC')
      .all(AuctionStatus.open, now.toISOString()) as unknown as ItemRow[];
    return rows.map((row) => this.toItem(row));
  }

  /** Inserts the bid if its id is new, otherwise updates its stored row. */
  async saveBid(bid: Bid): Promise<Bid> {
    const exists = this.db.prepare('SELECT id FROM bids WHERE id = ?').get(bid.id) !== undefined;
    if (exists) {
      this.db
        .prepare('UPDATE bids SET itemId = ?, bidderId = ?, amount = ?, placedAt = ? WHERE id = ?')
        .run(bid.itemId, bid.bidderId, bid.amount, bid.placedAt.toISOString(), bid.id);
    } else {
      this.db
        .prepare('INSERT INTO bids (id, itemId, bidderId, amount, placedAt) VALUES (?, ?, ?, ?, ?)')
        .run(bid.id, bid.itemId, bid.bidderId, bid.amount, bid.placedAt.toISOString());
    }
    return bid;
  }

  private toItem(row: ItemRow): Item {
    return new Item(
      row.id,
      row.sellerId,
      row.title,
      row.startingPrice,
      row.currency as Currency,
      new Date(row.endTime),
      row.status as AuctionStatus,
      row.highestBidAmount,
      row.highestBidderId,
      row.winnerId,
    );
  }
}

type ItemRow = {
  id: string;
  sellerId: string;
  title: string;
  startingPrice: number;
  currency: string;
  endTime: string;
  status: string;
  highestBidAmount: number | null;
  highestBidderId: string | null;
  winnerId: string | null;
};
