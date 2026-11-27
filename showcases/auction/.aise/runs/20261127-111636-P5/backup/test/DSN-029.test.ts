import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app/app.js';
import { ItemStore } from '../src/auction-api/ItemStore.js';
import { UserStore } from '../src/auction-api/UserStore.js';
import { User } from '../src/auction-api/User.js';
import { Item } from '../src/auction-api/Item.js';
import { Bid } from '../src/auction-api/Bid.js';
import { Currency } from '../src/auction-api/Currency.js';
import { AuctionStatus } from '../src/auction-api/AuctionStatus.js';

async function setup() {
  const db = new DatabaseSync(':memory:');
  createApp(db);
  const users = new UserStore(db);
  await users.save(new User('u-seller', 'Seller'));
  await users.save(new User('u-bidder', 'Bidder'));
  const store = new ItemStore(db);
  const endTime = new Date('2031-05-06T07:08:09.000Z');
  const item = new Item(
    'i-1',
    'u-seller',
    'Lamp',
    50,
    Currency.CHF,
    endTime,
    AuctionStatus.open,
    null,
    null,
    null,
  );
  await store.saveItem(item);
  const bid = new Bid('b-1', 'i-1', 'u-bidder', 60, new Date('2031-05-01T10:11:12.000Z'));
  await store.saveBid(bid);
  return { db, store, endTime, bid };
}

describe('DSN-029 ItemStore date storage', () => {
  it('DSN-029: items.endTime is stored as ISO 8601 TEXT', async () => {
    const { db, endTime } = await setup();
    const row = db.prepare('SELECT endTime AS v, typeof(endTime) AS t FROM items WHERE id = ?').get('i-1') as {
      v: string;
      t: string;
    };
    expect(row.t).toBe('text');
    expect(new Date(row.v).toISOString()).toBe(row.v);
    expect(row.v).toBe(endTime.toISOString());
  });

  it('DSN-029: bids.placedAt is stored as ISO 8601 TEXT', async () => {
    const { db, bid } = await setup();
    const row = db.prepare('SELECT placedAt AS v, typeof(placedAt) AS t FROM bids WHERE id = ?').get('b-1') as {
      v: string;
      t: string;
    };
    expect(row.t).toBe('text');
    expect(new Date(row.v).toISOString()).toBe(row.v);
    expect(row.v).toBe(bid.placedAt.toISOString());
  });

  it('DSN-029: an item read back has the same endTime', async () => {
    const { store, endTime } = await setup();
    const found = await store.findItem('i-1');
    expect(found).not.toBeNull();
    expect(found!.endTime).toBeInstanceOf(Date);
    expect(found!.endTime.getTime()).toBe(endTime.getTime());
  });
});
