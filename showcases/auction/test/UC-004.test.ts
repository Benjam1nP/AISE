import { describe, expect, it } from 'vitest';
import { LiveGateway } from '../src/live-updates/LiveGateway.js';
import { EventFeedClient } from '../src/live-updates/EventFeedClient.js';
import { EventFeed } from '../src/auction-api/EventFeed.js';
import { BidEventPublisher } from '../src/auction-api/BidEventPublisher.js';
import { Bid } from '../src/auction-api/Bid.js';
import { Item } from '../src/auction-api/Item.js';

type SocketMap = ConstructorParameters<typeof LiveGateway>[0];
type SocketValue = SocketMap extends Map<string, infer S> ? S : never;

function fakeSocket(): { socket: SocketValue; received: string[] } {
  const received: string[] = [];
  const socket = {
    readyState: 1,
    send: (message: string) => {
      received.push(message);
    },
  };
  return { socket: socket as unknown as SocketValue, received };
}

function makeInstance(clientId: string) {
  const { socket, received } = fakeSocket();
  const sockets = new Map<string, SocketValue>([[clientId, socket]]) as unknown as SocketMap;
  const gateway = new LiveGateway(sockets);
  const feedClient = new EventFeedClient(gateway);
  gateway.watch(clientId, 'item-1');
  return { gateway, feedClient, received };
}

// Produces a real bid event (topic and payload) by running the API server's publisher.
async function makeBidEvent(
  bidId: string,
  amount: number,
  reservePrice: number | null = null,
): Promise<{ topic: string; payload: string }> {
  const events: Array<{ topic: string; payload: string }> = [];
  const feed = new EventFeed(new Set());
  feed.publish = (topic: string, payload: string): void => {
    events.push({ topic, payload });
  };
  const publisher = new BidEventPublisher(feed);
  const item = new Item(
    'item-1',
    'seller-1',
    'Vase',
    100,
    reservePrice,
    'USD' as unknown as Item['currency'],
    new Date('2030-01-01T12:00:00Z'),
    'open' as unknown as Item['status'],
    amount,
    'bidder-1',
    null,
  );
  const bid = new Bid(bidId, 'item-1', 'bidder-1', amount, new Date('2030-01-01T11:00:00Z'));
  await publisher.publishBidAccepted(bid, item);
  return events[0];
}

describe('UC-004 Watch item live', () => {
  it('REQ-007 AC1: With two or more live update server instances running, a client connected to any instance receives every bid for the item it watches.', async () => {
    const a = makeInstance('client-a');
    const b = makeInstance('client-b');
    const first = await makeBidEvent('bid-1', 150);
    const second = await makeBidEvent('bid-2', 160);
    for (const inst of [a, b]) {
      inst.feedClient.onEvent(first.topic, first.payload);
      inst.feedClient.onEvent(second.topic, second.payload);
    }
    expect(a.received.length).toBe(2);
    expect(b.received.length).toBe(2);
  });

  it('REQ-007 AC2: Adding an instance requires no code change.', async () => {
    const instances = [makeInstance('c1'), makeInstance('c2'), makeInstance('c3')];
    const event = await makeBidEvent('bid-1', 150);
    for (const inst of instances) {
      inst.feedClient.onEvent(event.topic, event.payload);
    }
    for (const inst of instances) {
      expect(inst.received.length).toBe(1);
    }
  });

  it('REQ-012 AC8: Live bid and close events carry the reserve-met state, so watchers see it update without reloading.', async () => {
    const inst = makeInstance('client-r');
    const event = await makeBidEvent('bid-1', 1000, 987);
    inst.feedClient.onEvent(event.topic, event.payload);
    expect(inst.received.length).toBe(1);
    expect(inst.received[0]).toMatch(/reserveMet\W+true/);
    expect(inst.received[0]).not.toContain('987');
  });

  it('SEQ-004 scenario: Watch item live', async () => {
    const { socket, received } = fakeSocket();
    const sockets = new Map<string, SocketValue>([['client-1', socket]]) as unknown as SocketMap;
    const gateway = new LiveGateway(sockets);
    const eventFeedClient = new EventFeedClient(gateway);

    gateway.watch('client-1', 'item-1');

    const first = await makeBidEvent('bid-42', 150);
    eventFeedClient.onEvent(first.topic, first.payload);
    expect(received.length).toBe(1);
    expect(received[0]).toContain('item-1');

    gateway.unwatch('client-1', 'item-1');
    const second = await makeBidEvent('bid-43', 160);
    eventFeedClient.onEvent(second.topic, second.payload);
    expect(received.length).toBe(1);
  });
});
