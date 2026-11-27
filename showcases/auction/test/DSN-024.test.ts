import { describe, expect, it } from 'vitest';
import { AuctionCloser } from '../src/auction-api/AuctionCloser.js';
import type { ItemService } from '../src/auction-api/ItemService.js';

function makeService(): ItemService {
  return { closeDueAuctions: async () => {} } as unknown as ItemService;
}

describe('DSN-024 AuctionCloser interval validation', () => {
  it('DSN-024: constructing with intervalMs 0 throws', () => {
    expect(() => new AuctionCloser(makeService(), 0)).toThrow();
  });

  it('DSN-024: constructing with intervalMs -1 throws', () => {
    expect(() => new AuctionCloser(makeService(), -1)).toThrow();
  });

  it('DSN-024: constructing with intervalMs 1.5 throws', () => {
    expect(() => new AuctionCloser(makeService(), 1.5)).toThrow();
  });

  it('DSN-024: constructing with intervalMs 1000 does not throw', () => {
    expect(() => new AuctionCloser(makeService(), 1000)).not.toThrow();
  });
});
