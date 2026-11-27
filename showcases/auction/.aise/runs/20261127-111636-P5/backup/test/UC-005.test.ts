import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { AuctionStatus } from '../src/auction-api/AuctionStatus.js';
import { Item } from '../src/auction-api/Item.js';
import { ItemService } from '../src/auction-api/ItemService.js';
import { BidService } from '../src/auction-api/BidService.js';
import { AuctionCloser } from '../src/auction-api/AuctionCloser.js';
import { ItemStore } from '../src/auction-api/ItemStore.js';
import { AuctionEventPublisher } from '../src/auction-api/AuctionEventPublisher.js';
import { BidEventPublisher } from '../src/auction-api/BidEventPublisher.js';
import { EventFeedClient } from '../src/live-updates/EventFeedClient.js';
import { LiveGateway } from '../src/live-updates/LiveGateway.js';
import { EventFeed } from '../src/auction-api/EventFeed.js';

const START = new Date('2030-01-01T00:00:00.000Z');
const END = new Date('2030-01-01T01:00:00.000Z');
const AFTER_END = new Date('2030-01-01T02:00:00.000Z');

function userStoreStub(): never {
  // A permissive stand-in: any lookup resolves to a user-like object.
  return new Proxy(
    {},
    { get: () => async () => ({ id: 'user' }) },
  ) as never;
}

function fakeSocket(): { send: ReturnType<typeof vi.fn>; readyState: number } {
  return { send: vi.fn(), readyState: 1 };
}

function build() {
  const db = new DatabaseSync(':memory:');
  const store = new ItemStore(db);
  const socket = fakeSocket();
  const feed = new EventFeed(new Set([socket as never]));
  const publisher = new AuctionEventPublisher(feed);
  const bidPublisher = new BidEventPublisher(feed);
  const itemService = new ItemService(store, userStoreStub(), publisher);
  const bidService = new BidService(store, bidPublisher, userStoreStub());
  return { store, socket, feed, itemService, bidService };
}

describe('UC-005 Close auction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('REQ-004 AC1: At the end time the item no longer accepts bids.', () => {
    const item = new Item(
      'item-1',
      'seller-1',
      'Lamp',
      10,
      'USD' as never,
      END,
      AuctionStatus.open,
      null,
      null,
      null,
    );

    expect(item.isOpen(END)).toBe(false);
  });

  it('REQ-004 AC2: The bidder with the highest bid at the end time is recorded as the winner and the winning user sees on the item page that they won.', async () => {
    const { itemService, bidService } = build();
    const listed = await itemService.listItem('seller-1', 'Lamp', 10, END, 'USD');
    await bidService.placeBid(listed.id, 'bidder-1', 15);
    await bidService.placeBid(listed.id, 'bidder-2', 20);

    vi.setSystemTime(AFTER_END);
    await itemService.closeDueAuctions(AFTER_END);

    const page = await itemService.getItem(listed.id);
    expect(page.status).toBe(AuctionStatus.closed);
    expect(page.winnerId).toBe('bidder-2');
  });

  it('REQ-004 AC3: Watchers of the item see the closed state and the winner.', async () => {
    const { itemService, bidService, socket } = build();
    const listed = await itemService.listItem('seller-1', 'Lamp', 10, END, 'USD');
    await bidService.placeBid(listed.id, 'bidder-1', 15);
    socket.send.mockClear();

    vi.setSystemTime(AFTER_END);
    await itemService.closeDueAuctions(AFTER_END);

    expect(socket.send).toHaveBeenCalled();
    const sent = socket.send.mock.calls.map((call) => String(call[0])).join(' ');
    expect(sent).toContain('closed');
    expect(sent).toContain('bidder-1');
  });

  it('REQ-004 AC4: An auction that ends with no bids is shown as unsold and has no winner.', async () => {
    const { itemService } = build();
    const listed = await itemService.listItem('seller-1', 'Lamp', 10, END, 'USD');

    vi.setSystemTime(AFTER_END);
    await itemService.closeDueAuctions(AFTER_END);

    const page = await itemService.getItem(listed.id);
    expect(page.status).toBe(AuctionStatus.unsold);
    expect(page.winnerId).toBeNull();
  });

  it('SEQ-005 scenario: Close auction', async () => {
    const { itemService, bidService, store, socket } = build();
    const listed = await itemService.listItem('seller-1', 'Lamp', 10, END, 'USD');
    await bidService.placeBid(listed.id, 'bidder-1', 15);
    socket.send.mockClear();

    const closeSpy = vi.spyOn(itemService, 'closeDueAuctions');
    const findSpy = vi.spyOn(store, 'findDueItems');
    const saveSpy = vi.spyOn(store, 'saveItem');

    const closer = new AuctionCloser(itemService, 1000);
    vi.setSystemTime(AFTER_END);
    await closer.tick();

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(findSpy).toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
    expect(socket.send).toHaveBeenCalled();

    const page = await itemService.getItem(listed.id);
    expect(page.status).toBe(AuctionStatus.closed);
    expect(page.winnerId).toBe('bidder-1');
  });
});
