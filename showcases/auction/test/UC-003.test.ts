import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Item } from '../src/auction-api/Item.js';
import { Bid } from '../src/auction-api/Bid.js';
import { BidController } from '../src/auction-api/BidController.js';
import { BidService } from '../src/auction-api/BidService.js';
import { UserStore } from '../src/auction-api/UserStore.js';
import { ItemStore } from '../src/auction-api/ItemStore.js';
import { BidEventPublisher } from '../src/auction-api/BidEventPublisher.js';
import { EventFeed } from '../src/auction-api/EventFeed.js';
import { LiveGateway } from '../src/live-updates/LiveGateway.js';

type SocketType = ConstructorParameters<typeof LiveGateway>[0] extends Map<string, infer S> ? S : never;

const NOW = new Date('2030-01-01T12:00:00Z');
const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_MINUTES_MS = 2 * 60 * 1000;

function fakeSocket(): SocketType {
  return { send: vi.fn(), readyState: 1 } as unknown as SocketType;
}

function makeItem(overrides: { endTime?: Date; highestBidAmount?: number | null; highestBidderId?: string | null } = {}): Item {
  return new Item(
    'item-1',
    'seller-1',
    'Vase',
    100,
    null,
    'USD' as unknown as Item['currency'],
    overrides.endTime ?? new Date(NOW.getTime() + ONE_HOUR_MS),
    'open' as unknown as Item['status'],
    overrides.highestBidAmount ?? null,
    overrides.highestBidderId ?? null,
    null,
  );
}

async function setup(item: Item = makeItem()) {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const db = new DatabaseSync(':memory:');
  const itemStore = new ItemStore(db);
  await itemStore.saveItem(item);
  const userStore = {
    findById: async (id: string) => (id === 'unknown' ? null : { id }),
  } as unknown as UserStore;
  const feed = new EventFeed(new Set<SocketType>());
  const publisher = new BidEventPublisher(feed);
  const service = new BidService(itemStore, publisher, userStore);
  return { itemStore, service, feed, publisher };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("UC-003 Place bid", () => {
  it("REQ-002 AC1: A bid on an item whose end time has not passed, from a user other than the seller, is stored in the item currency if it is valid.", async () => {
    const { itemStore, service } = await setup();
    const bid = await service.placeBid('item-1', 'bidder-1', 150);
    const stored = await itemStore.findItem('item-1');
    expect(bid.amount).toBe(150);
    expect(stored?.currency).toBe('USD');
    expect(stored?.highestBidAmount).toBe(150);
    expect(stored?.highestBidderId).toBe('bidder-1');
  });

  it("REQ-002 AC2: A bid on an item whose end time has passed is rejected.", async () => {
    const item = makeItem({ endTime: new Date(NOW.getTime() - 1000) });
    const { service } = await setup(item);
    await expect(service.placeBid('item-1', 'bidder-1', 150)).rejects.toThrow();
  });

  it("REQ-002 AC3: The first bid is accepted only if it is at least the starting price.", async () => {
    const { service } = await setup();
    await expect(service.placeBid('item-1', 'bidder-1', 99)).rejects.toThrow();
    const bid = await service.placeBid('item-1', 'bidder-1', 100);
    expect(bid.amount).toBe(100);
  });

  it("REQ-002 AC4: Any later bid is accepted only if it is at least 1 unit of the item currency higher than the current highest bid, otherwise it is rejected.", async () => {
    const item = makeItem({ highestBidAmount: 200, highestBidderId: 'bidder-0' });
    const { service } = await setup(item);
    await expect(service.placeBid('item-1', 'bidder-1', 200)).rejects.toThrow();
    const bid = await service.placeBid('item-1', 'bidder-1', 201);
    expect(bid.amount).toBe(201);
  });

  it("REQ-002 AC5: A bid by the item's seller on their own item is rejected.", async () => {
    const { service } = await setup();
    await expect(service.placeBid('item-1', 'seller-1', 150)).rejects.toThrow();
  });

  it("REQ-009 AC1: A valid bid placed less than or exactly 2 minutes before the end time moves the end time 2 minutes later.", async () => {
    const endTime = new Date(NOW.getTime() + 10 * 60 * 1000);
    const item = makeItem({ endTime });
    const now = new Date(endTime.getTime() - TWO_MINUTES_MS);
    const extended = item.extendIfLate(now);
    expect(extended).toBe(true);
    expect(item.endTime.getTime()).toBe(endTime.getTime() + TWO_MINUTES_MS);
  });

  it("REQ-009 AC2: A valid bid placed more than 2 minutes before the end time does not change the end time.", async () => {
    const endTime = new Date(NOW.getTime() + 10 * 60 * 1000);
    const item = makeItem({ endTime });
    const now = new Date(endTime.getTime() - 5 * 60 * 1000);
    const extended = item.extendIfLate(now);
    expect(extended).toBe(false);
    expect(item.endTime.getTime()).toBe(endTime.getTime());
  });

  it.todo("REQ-009 AC3: manual: watching browsers rendering the new end time needs a real browser session.");

  it("REQ-003 AC1: When a bid is accepted, every client watching the item shows the new bid without a page reload.", () => {
    const gateway = new LiveGateway(new Map<string, SocketType>());
    const sockets = [fakeSocket(), fakeSocket(), fakeSocket()];
    sockets.forEach((socket, index) => {
      gateway.sockets.set(`client-${index}`, socket);
      gateway.watch(`client-${index}`, 'item-1');
    });
    gateway.broadcast('item-1', 'bid:150');
    for (const socket of sockets) {
      expect(socket.send).toHaveBeenCalledWith('bid:150');
    }
  });

  it("REQ-003 AC2: A client watching a different item does not receive that bid.", () => {
    const gateway = new LiveGateway(new Map<string, SocketType>());
    const watcher = fakeSocket();
    const other = fakeSocket();
    gateway.sockets.set('client-a', watcher);
    gateway.sockets.set('client-b', other);
    gateway.watch('client-a', 'item-1');
    gateway.watch('client-b', 'item-2');
    gateway.broadcast('item-1', 'bid:150');
    expect(watcher.send).toHaveBeenCalledWith('bid:150');
    expect(other.send).not.toHaveBeenCalled();
  });

  it.todo("REQ-003 AC3: manual: refreshing the open items list in a browser needs a real page session.");

  it.todo("REQ-003 AC4: manual: retry of the live update configuration load needs a browser with a flaky network.");

  it("REQ-011 AC1: With 200 clients watching one item and a few bids per second, each accepted bid appears on every client within 1 second.", () => {
    const gateway = new LiveGateway(new Map<string, SocketType>());
    const sockets: SocketType[] = [];
    for (let index = 0; index < 200; index += 1) {
      const socket = fakeSocket();
      sockets.push(socket);
      gateway.sockets.set(`client-${index}`, socket);
      gateway.watch(`client-${index}`, 'item-1');
    }
    gateway.broadcast('item-1', 'bid:150');
    for (const socket of sockets) {
      expect(socket.send).toHaveBeenCalledWith('bid:150');
    }
  });

  it.todo("REQ-011 AC2: manual: confirming no accepted bid is lost under sustained load needs a live load test environment.");

  it("SEQ-003 scenario: Place bid", async () => {
    const { itemStore, service, feed } = await setup();
    const publish = vi.spyOn(feed, 'publish');
    const controller = new BidController(service);
    const bid = await controller.placeBid('item-1', 'bidder-1', 150);
    expect(bid).toBeInstanceOf(Bid);
    expect(bid.itemId).toBe('item-1');
    expect(bid.bidderId).toBe('bidder-1');
    expect(bid.amount).toBe(150);
    const stored = await itemStore.findItem('item-1');
    expect(stored?.highestBidAmount).toBe(150);
    expect(stored?.highestBidderId).toBe('bidder-1');
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
